import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type {
  CancelMeetingInput,
  CreateMeetingInput,
  Meeting,
  MeetingMutationResponse,
  MeetingRecurrence,
  UpdateMeetingInput,
} from '@botss/shared-types';

import { PrismaService } from '../prisma/prisma.service';
import { MEETING_INCLUDE, seriesOf, type MeetingRow } from './meeting-mapper';
import { MeetingNotifier, type NotifyActor } from './meeting-notifier.service';
import { refreshMeetingReminders } from './meeting-reminder-schedule';
import {
  badMeeting,
  meetingCancelled,
  occurrenceNotFound,
  organizerOnly,
  type LinkAccess,
  type MeetingActor,
} from './meeting-rules';
import { MeetingsService, type ResolvedAttendees } from './meetings.service';
import {
  buildRrule,
  computeLastEndsAt,
  countOccurrencesBefore,
  occurrenceAt,
  ruleToRecurrence,
  truncateRule,
  weekdayIn,
  withCount,
  type Occurrence,
  type SeriesShape,
} from './recurrence';
import { snapAllDay } from './time-zones';

/** A fresh iCalendar UID for a meeting made in the app. */
export function newMeetingUid(): string {
  return `${randomUUID()}@meetings.botss`;
}

function sameTime(a: Date | null | undefined, b: Date | null | undefined): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

/** Text patch for one occurrence: undefined keeps, null clears (""), a string sets. */
function patchText(input: string | null | undefined, current: string | null): string | null {
  if (input === undefined) return current;
  return input === null ? '' : input;
}

/**
 * Meeting writes: create, update (all / this occurrence / this and
 * following), cancel and delete. Organizer only. Attendees are told after the
 * change is committed (MeetingNotifier, best effort).
 */
@Injectable()
export class MeetingEditorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly meetings: MeetingsService,
    private readonly notifier: MeetingNotifier,
  ) {}

  // ------------------------------------------------------------ helpers

  private normalizeTimes(
    startsAt: Date,
    endsAt: Date,
    allDay: boolean,
    timeZone: string,
  ): { startsAt: Date; endsAt: Date } {
    if (endsAt.getTime() <= startsAt.getTime()) {
      throw badMeeting('The end must be after the start.', 'meeting_end_before_start');
    }
    if (!allDay) return { startsAt, endsAt };
    const snapped = snapAllDay(startsAt.getTime(), endsAt.getTime(), timeZone);
    return { startsAt: new Date(snapped.start), endsAt: new Date(snapped.end) };
  }

  private ruleFor(
    rec: MeetingRecurrence | null,
    allDay: boolean,
    timeZone: string,
    startsAt: Date,
  ): string | null {
    if (!rec) return null;
    if (
      rec.freq === 'WEEKLY' &&
      rec.byDay &&
      !rec.byDay.includes(weekdayIn(startsAt.getTime(), timeZone))
    ) {
      throw badMeeting(
        'The first meeting must fall on one of the chosen weekdays.',
        'meeting_start_not_on_weekday',
      );
    }
    if (rec.until && rec.until.getTime() < startsAt.getTime() - 86_400_000) {
      throw badMeeting(
        'The repeat must end after the first meeting.',
        'meeting_until_before_start',
      );
    }
    return buildRrule(rec, allDay, timeZone);
  }

  /** The stored rule, rebuilt when the zone or all-day changes (UNTIL is written per zone). */
  private carryRule(
    rrule: string | null,
    from: { allDay: boolean; timeZone: string },
    to: { allDay: boolean; timeZone: string; startsAt: Date },
  ): string | null {
    if (!rrule || (from.allDay === to.allDay && from.timeZone === to.timeZone)) return rrule;
    const rec = ruleToRecurrence(rrule, from.timeZone);
    return rec ? this.ruleFor(rec, to.allDay, to.timeZone, to.startsAt) : rrule;
  }

  private loadOrganized(actor: MeetingActor, id: string): Promise<MeetingRow> {
    return this.meetings.loadVisible(actor, id).then((row) => {
      if (row.organizerId !== actor.userId) throw organizerOnly();
      return row;
    });
  }

  private async reload(id: string): Promise<MeetingRow> {
    return this.prisma.client.meeting.findFirstOrThrow({ where: { id }, include: MEETING_INCLUDE });
  }

  private notifyActor(actor: MeetingActor): NotifyActor {
    return { userId: actor.userId, name: actor.name };
  }

  private attendeeCreateRows(people: ResolvedAttendees) {
    return [
      ...people.internal.map((p) => ({ userId: p.userId, email: p.email, name: p.name })),
      ...people.external.map((p) => ({ userId: null, email: p.email, name: p.name })),
    ];
  }

  /** Default reminders of people added to a meeting (looked up before the write). */
  private async defaultReminderRows(
    userIds: readonly string[],
  ): Promise<{ userId: string; minutesBefore: number }[]> {
    if (userIds.length === 0) return [];
    const defaults = await this.meetings.defaultReminders(userIds);
    return [...defaults.entries()].flatMap(([userId, list]) =>
      list.map((minutesBefore) => ({ userId, minutesBefore })),
    );
  }

  // ------------------------------------------------------------ create

  async create(
    actor: MeetingActor,
    input: CreateMeetingInput,
    links: LinkAccess | null,
  ): Promise<Meeting> {
    const organizationId = this.meetings.requireOrg(actor);
    const { startsAt, endsAt } = this.normalizeTimes(
      input.startsAt,
      input.endsAt,
      input.allDay,
      input.timeZone,
    );
    const rrule = this.ruleFor(input.recurrence ?? null, input.allDay, input.timeZone, startsAt);
    await this.meetings.assertLinks(organizationId, links, input);
    const people = await this.meetings.resolveAttendees(organizationId, actor, input.attendees);
    const series: SeriesShape = {
      startsAt,
      endsAt,
      allDay: input.allDay,
      timeZone: input.timeZone,
      rrule,
      exdates: [],
      overrides: [],
    };
    const lastEndsAt = computeLastEndsAt(series);
    const organizerReminders =
      input.reminders ??
      (await this.meetings.defaultReminders([actor.userId])).get(actor.userId) ??
      [];
    const inviteeReminders = await this.defaultReminderRows(people.internal.map((p) => p.userId));

    const created = await this.prisma.client.meeting.create({
      data: {
        organizationId,
        workspaceId: actor.workspaceId,
        organizerId: actor.userId,
        title: input.title,
        description: input.description ?? null,
        location: input.location ?? null,
        meetingUrl: input.meetingUrl ?? null,
        startsAt,
        endsAt,
        allDay: input.allDay,
        timeZone: input.timeZone,
        rrule,
        lastEndsAt,
        status: input.status,
        color: input.color ?? null,
        source: 'MANUAL',
        icsUid: newMeetingUid(),
        leadId: input.leadId ?? null,
        clientId: input.clientId ?? null,
        projectId: input.projectId ?? null,
        attendees: { create: this.attendeeCreateRows(people) },
        reminders: {
          create: [
            ...organizerReminders.map((minutesBefore) => ({ userId: actor.userId, minutesBefore })),
            ...inviteeReminders,
          ],
        },
      },
      select: { id: true },
    });
    await refreshMeetingReminders(this.prisma.client, created.id);

    const row = await this.reload(created.id);
    if (input.notifyAttendees) {
      await this.notifier.notifyPeople(
        row,
        row.attendees.map((a) => a.userId),
        'invite',
        this.notifyActor(actor),
      );
      await this.notifier.emailGuests(row, row.attendees, 'invite');
    }
    return this.meetings.present(row, actor.userId, links);
  }

  // ------------------------------------------------------------ update

  async update(
    actor: MeetingActor,
    id: string,
    input: UpdateMeetingInput,
    links: LinkAccess | null,
  ): Promise<MeetingMutationResponse> {
    this.meetings.requireOrg(actor);
    const row = await this.loadOrganized(actor, id);
    if (row.status === 'CANCELLED') throw meetingCancelled();
    if (row.rrule && input.scope !== 'all' && input.occurrenceStart) {
      const occ = occurrenceAt(seriesOf(row), input.occurrenceStart);
      if (!occ) throw occurrenceNotFound();
      if (input.scope === 'this') return this.updateOccurrence(actor, row, occ, input, links);
      if (occ.originalStart.getTime() !== row.startsAt.getTime()) {
        return this.splitSeries(actor, row, occ, input, links);
      }
    }
    return this.updateSeries(actor, row, input, links);
  }

  /** Attendee changes: who stays, who is new, who is gone. */
  private async diffAttendees(row: MeetingRow, actor: MeetingActor, input: UpdateMeetingInput) {
    if (!input.attendees) return null;
    const existing = new Set(row.attendees.map((a) => a.userId).filter((v): v is string => !!v));
    const people = await this.meetings.resolveAttendees(
      row.organizationId,
      actor,
      input.attendees,
      existing,
    );
    const wantedUsers = new Set(people.internal.map((p) => p.userId));
    const wantedEmails = new Set(people.external.map((p) => p.email));
    const removed = row.attendees.filter((a) =>
      a.userId ? !wantedUsers.has(a.userId) : !wantedEmails.has(a.email),
    );
    const haveUsers = new Set(row.attendees.map((a) => a.userId).filter((v): v is string => !!v));
    const haveEmails = new Set(row.attendees.filter((a) => !a.userId).map((a) => a.email));
    const added: ResolvedAttendees = {
      internal: people.internal.filter((p) => !haveUsers.has(p.userId)),
      // An address that moved from guest to staff member (or back) is a new row.
      external: people.external.filter((p) => !haveEmails.has(p.email)),
      dropped: [],
    };
    return { removed, added, dropped: new Set(people.dropped) };
  }

  private async updateSeries(
    actor: MeetingActor,
    row: MeetingRow,
    input: UpdateMeetingInput,
    links: LinkAccess | null,
  ): Promise<MeetingMutationResponse> {
    const allDay = input.allDay ?? row.allDay;
    const timeZone = input.timeZone ?? row.timeZone;
    const rawStart = input.startsAt ?? row.startsAt;
    const rawEnd =
      input.endsAt ??
      (input.startsAt
        ? new Date(input.startsAt.getTime() + (row.endsAt.getTime() - row.startsAt.getTime()))
        : row.endsAt);
    const { startsAt, endsAt } = this.normalizeTimes(rawStart, rawEnd, allDay, timeZone);
    const rrule =
      input.recurrence === undefined
        ? this.carryRule(row.rrule, row, { allDay, timeZone, startsAt })
        : this.ruleFor(input.recurrence, allDay, timeZone, startsAt);
    if (input.recurrence === undefined && rrule && !sameTime(startsAt, row.startsAt)) {
      // A weekly series moved to a day it does not repeat on.
      const rec = ruleToRecurrence(rrule, timeZone);
      if (rec) this.ruleFor(rec, allDay, timeZone, startsAt);
    }

    const alignmentBroken =
      !sameTime(startsAt, row.startsAt) ||
      allDay !== row.allDay ||
      timeZone !== row.timeZone ||
      rrule !== row.rrule;
    const timingChanged = alignmentBroken || !sameTime(endsAt, row.endsAt);
    const next = {
      title: input.title ?? row.title,
      description: input.description === undefined ? row.description : input.description,
      location: input.location === undefined ? row.location : input.location,
      meetingUrl: input.meetingUrl === undefined ? row.meetingUrl : input.meetingUrl,
      status: input.status ?? row.status,
      color: input.color === undefined ? row.color : input.color,
      leadId: input.leadId === undefined ? row.leadId : input.leadId,
      clientId: input.clientId === undefined ? row.clientId : input.clientId,
      projectId: input.projectId === undefined ? row.projectId : input.projectId,
    };
    const contentChanged =
      timingChanged ||
      next.title !== row.title ||
      next.description !== row.description ||
      next.location !== row.location ||
      next.meetingUrl !== row.meetingUrl ||
      next.status !== row.status;
    await this.meetings.assertLinks(row.organizationId, links, {
      leadId: next.leadId !== row.leadId ? next.leadId : null,
      clientId: next.clientId !== row.clientId ? next.clientId : null,
      projectId: next.projectId !== row.projectId ? next.projectId : null,
    });
    const diff = await this.diffAttendees(row, actor, input);
    const exdates = alignmentBroken ? [] : row.exdates;
    const overrides = alignmentBroken ? [] : row.overrides;
    const lastEndsAt = computeLastEndsAt({
      startsAt,
      endsAt,
      allDay,
      timeZone,
      rrule,
      exdates,
      overrides,
    });
    const newcomerReminders = diff
      ? await this.defaultReminderRows(diff.added.internal.map((p) => p.userId))
      : [];

    await this.prisma.client.$transaction(async (tx) => {
      if (alignmentBroken && row.overrides.length > 0) {
        await tx.meetingOccurrence.deleteMany({ where: { meetingId: row.id } });
      }
      if (diff) {
        if (diff.removed.length > 0) {
          await tx.meetingAttendee.deleteMany({
            where: { meetingId: row.id, id: { in: diff.removed.map((a) => a.id) } },
          });
          const gone = diff.removed.map((a) => a.userId).filter((v): v is string => !!v);
          if (gone.length > 0)
            await tx.meetingReminder.deleteMany({
              where: { meetingId: row.id, userId: { in: gone } },
            });
        }
        const rows = this.attendeeCreateRows(diff.added);
        if (rows.length > 0) {
          await tx.meetingAttendee.createMany({
            data: rows.map((r) => ({ ...r, meetingId: row.id })),
            skipDuplicates: true,
          });
        }
        if (newcomerReminders.length > 0) {
          await tx.meetingReminder.createMany({
            data: newcomerReminders.map((r) => ({ ...r, meetingId: row.id })),
            skipDuplicates: true,
          });
        }
      }
      if (timingChanged) {
        // New time: everyone answers again.
        await tx.meetingAttendee.updateMany({
          where: { meetingId: row.id },
          data: { response: 'NEEDS_ACTION', respondedAt: null },
        });
      }
      await tx.meeting.update({
        where: { id: row.id },
        data: {
          ...next,
          startsAt,
          endsAt,
          allDay,
          timeZone,
          rrule,
          exdates,
          lastEndsAt,
          sequence: contentChanged ? row.sequence + 1 : row.sequence,
        },
      });
      await refreshMeetingReminders(tx, row.id);
    });

    const updated = await this.reload(row.id);
    const who = this.notifyActor(actor);
    const addedUserIds = new Set(diff?.added.internal.map((p) => p.userId) ?? []);
    const addedEmails = new Set(diff?.added.external.map((p) => p.email) ?? []);
    const newcomers = updated.attendees.filter((a) =>
      a.userId ? addedUserIds.has(a.userId) : addedEmails.has(a.email),
    );
    const stayers = updated.attendees.filter((a) => !newcomers.includes(a));
    if (input.notifyAttendees) {
      if (contentChanged) {
        await this.notifier.notifyPeople(
          updated,
          stayers.map((a) => a.userId),
          'update',
          who,
        );
        await this.notifier.emailGuests(updated, stayers, 'update');
      }
      await this.notifier.notifyPeople(
        updated,
        newcomers.map((a) => a.userId),
        'invite',
        who,
      );
      await this.notifier.emailGuests(updated, newcomers, 'invite');
      if (diff && diff.removed.length > 0) {
        const told = diff.removed.filter((a) => !a.userId || !diff.dropped.has(a.userId));
        await this.notifier.notifyPeople(
          updated,
          told.map((a) => a.userId),
          'removed',
          who,
        );
        await this.notifier.emailGuests(updated, diff.removed, 'cancel');
      }
    }
    return {
      meeting: await this.meetings.present(updated, actor.userId, links),
      newMeetingId: null,
    };
  }

  /** Change one occurrence (stored as an override keyed by its original start). */
  private async updateOccurrence(
    actor: MeetingActor,
    row: MeetingRow,
    occ: Occurrence,
    input: UpdateMeetingInput,
    links: LinkAccess | null,
  ): Promise<MeetingMutationResponse> {
    const current = occ.override;
    const length = occ.endsAt.getTime() - occ.startsAt.getTime();
    const startsAt = input.startsAt ?? occ.startsAt;
    const endsAt =
      input.endsAt ?? (input.startsAt ? new Date(input.startsAt.getTime() + length) : occ.endsAt);
    const times = this.normalizeTimes(startsAt, endsAt, row.allDay, row.timeZone);
    const data = {
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      title: input.title === undefined ? (current?.title ?? null) : input.title,
      description: patchText(input.description, current?.description ?? null),
      location: patchText(input.location, current?.location ?? null),
      meetingUrl: patchText(input.meetingUrl, current?.meetingUrl ?? null),
    };
    const overrides = [
      ...row.overrides.filter((o) => o.originalStart.getTime() !== occ.originalStart.getTime()),
      { originalStart: occ.originalStart, ...data },
    ];
    const lastEndsAt = computeLastEndsAt({ ...seriesOf(row), overrides });
    await this.prisma.client.$transaction(async (tx) => {
      await tx.meetingOccurrence.upsert({
        where: { meetingId_originalStart: { meetingId: row.id, originalStart: occ.originalStart } },
        create: { meetingId: row.id, originalStart: occ.originalStart, ...data },
        update: data,
      });
      await tx.meeting.update({
        where: { id: row.id },
        data: { lastEndsAt, sequence: row.sequence + 1 },
      });
      await refreshMeetingReminders(tx, row.id);
    });
    const updated = await this.reload(row.id);
    if (input.notifyAttendees) {
      const one = {
        startsAt: times.startsAt,
        endsAt: times.endsAt,
        originalStart: occ.originalStart,
      };
      await this.notifier.notifyPeople(
        updated,
        updated.attendees.map((a) => a.userId),
        'update',
        this.notifyActor(actor),
        one,
      );
      await this.notifier.emailGuests(updated, updated.attendees, 'update', one);
    }
    return {
      meeting: await this.meetings.present(updated, actor.userId, links),
      newMeetingId: null,
    };
  }

  /**
   * "This and following": the series stops before the occurrence and a new
   * series (new UID) starts there with the changes. Reminders and, unless
   * replaced, attendees carry over; exdates and changed occurrences carry
   * over only when the new series keeps the same rhythm.
   */
  private async splitSeries(
    actor: MeetingActor,
    row: MeetingRow,
    occ: Occurrence,
    input: UpdateMeetingInput,
    links: LinkAccess | null,
  ): Promise<MeetingMutationResponse> {
    const t = occ.originalStart;
    const series = seriesOf(row);
    const rule = row.rrule as string;
    const oldRule = truncateRule(rule, t, row.allDay, row.timeZone);
    const oldExdates = row.exdates.filter((d) => d.getTime() < t.getTime());
    const keptOverrides = row.overrides.filter((o) => o.originalStart.getTime() < t.getTime());
    const oldLastEndsAt = computeLastEndsAt({
      ...series,
      rrule: oldRule,
      exdates: oldExdates,
      overrides: keptOverrides,
    });

    const allDay = input.allDay ?? row.allDay;
    const timeZone = input.timeZone ?? row.timeZone;
    const length = row.endsAt.getTime() - row.startsAt.getTime();
    const rawStart = input.startsAt ?? t;
    const rawEnd = input.endsAt ?? new Date(rawStart.getTime() + length);
    const { startsAt, endsAt } = this.normalizeTimes(rawStart, rawEnd, allDay, timeZone);
    let rrule: string | null;
    if (input.recurrence === undefined) {
      const count = /(?:^|;)COUNT=(\d+)/i.exec(rule)?.[1];
      const carried = count
        ? withCount(rule, Math.max(1, Number(count) - countOccurrencesBefore(series, t)))
        : rule;
      rrule = this.carryRule(carried, row, { allDay, timeZone, startsAt });
    } else {
      rrule = this.ruleFor(input.recurrence, allDay, timeZone, startsAt);
    }
    const sameRhythm =
      sameTime(startsAt, t) &&
      allDay === row.allDay &&
      timeZone === row.timeZone &&
      input.recurrence === undefined;
    const newExdates = sameRhythm ? row.exdates.filter((d) => d.getTime() >= t.getTime()) : [];
    const newOverrides = sameRhythm
      ? row.overrides.filter((o) => o.originalStart.getTime() >= t.getTime())
      : [];
    const next = {
      title: input.title ?? row.title,
      description: input.description === undefined ? row.description : input.description,
      location: input.location === undefined ? row.location : input.location,
      meetingUrl: input.meetingUrl === undefined ? row.meetingUrl : input.meetingUrl,
      status: input.status ?? row.status,
      color: input.color === undefined ? row.color : input.color,
      leadId: input.leadId === undefined ? row.leadId : input.leadId,
      clientId: input.clientId === undefined ? row.clientId : input.clientId,
      projectId: input.projectId === undefined ? row.projectId : input.projectId,
    };
    await this.meetings.assertLinks(row.organizationId, links, {
      leadId: next.leadId !== row.leadId ? next.leadId : null,
      clientId: next.clientId !== row.clientId ? next.clientId : null,
      projectId: next.projectId !== row.projectId ? next.projectId : null,
    });
    const timingChanged = !sameRhythm || !sameTime(endsAt, new Date(t.getTime() + length));
    const existingUsers = new Set(
      row.attendees.map((a) => a.userId).filter((v): v is string => !!v),
    );
    const people: ResolvedAttendees = input.attendees
      ? await this.meetings.resolveAttendees(
          row.organizationId,
          actor,
          input.attendees,
          existingUsers,
        )
      : {
          internal: row.attendees
            .filter((a) => a.userId)
            .map((a) => ({
              userId: a.userId as string,
              email: a.email,
              name: a.user?.name ?? a.name ?? a.email,
            })),
          external: row.attendees
            .filter((a) => !a.userId)
            .map((a) => ({ email: a.email, name: a.name })),
          dropped: [],
        };
    const previous = new Map(row.attendees.map((a) => [a.userId ?? a.email, a] as const));
    const attendeeRows = this.attendeeCreateRows(people).map((a) => {
      const before = previous.get(a.userId ?? a.email);
      return {
        ...a,
        response: before && !timingChanged ? before.response : ('NEEDS_ACTION' as const),
        respondedAt: before && !timingChanged ? before.respondedAt : null,
      };
    });
    const members = new Set([actor.userId, ...people.internal.map((p) => p.userId)]);
    const reminders = await this.prisma.client.meetingReminder.findMany({
      where: { meetingId: row.id },
      select: { userId: true, minutesBefore: true },
    });
    const lastEndsAt = computeLastEndsAt({
      startsAt,
      endsAt,
      allDay,
      timeZone,
      rrule,
      exdates: newExdates,
      overrides: newOverrides,
    });
    const carried = new Set(reminders.map((r) => r.userId));
    const newcomerReminders = await this.defaultReminderRows(
      people.internal.map((p) => p.userId).filter((u) => !carried.has(u)),
    );

    const newId = await this.prisma.client.$transaction(async (tx) => {
      await tx.meetingOccurrence.deleteMany({
        where: { meetingId: row.id, originalStart: { gte: t } },
      });
      await tx.meeting.update({
        where: { id: row.id },
        data: {
          rrule: oldRule,
          exdates: oldExdates,
          lastEndsAt: oldLastEndsAt,
          sequence: row.sequence + 1,
        },
      });
      const created = await tx.meeting.create({
        data: {
          organizationId: row.organizationId,
          workspaceId: row.workspaceId,
          organizerId: row.organizerId,
          ...next,
          startsAt,
          endsAt,
          allDay,
          timeZone,
          rrule,
          exdates: newExdates,
          lastEndsAt,
          source: row.source,
          icsUid: newMeetingUid(),
          attendees: { create: attendeeRows },
          overrides: {
            create: newOverrides.map((o) => ({
              originalStart: o.originalStart,
              startsAt: o.startsAt,
              endsAt: o.endsAt,
              title: o.title,
              description: o.description,
              location: o.location,
              meetingUrl: o.meetingUrl,
            })),
          },
          reminders: {
            create: [
              ...reminders
                .filter((r) => members.has(r.userId))
                .map((r) => ({ userId: r.userId, minutesBefore: r.minutesBefore })),
              ...newcomerReminders,
            ],
          },
        },
        select: { id: true },
      });
      await refreshMeetingReminders(tx, [row.id, created.id]);
      return created.id;
    });

    const [oldSeries, newSeries] = await Promise.all([this.reload(row.id), this.reload(newId)]);
    if (input.notifyAttendees) {
      const who = this.notifyActor(actor);
      const before = new Set(row.attendees.map((a) => a.userId ?? a.email));
      const stayers = newSeries.attendees.filter((a) => before.has(a.userId ?? a.email));
      const newcomers = newSeries.attendees.filter((a) => !before.has(a.userId ?? a.email));
      const now = new Set(newSeries.attendees.map((a) => a.userId ?? a.email));
      const leavers = row.attendees.filter((a) => !now.has(a.userId ?? a.email));
      await this.notifier.notifyPeople(
        newSeries,
        stayers.map((a) => a.userId),
        'update',
        who,
      );
      await this.notifier.notifyPeople(
        newSeries,
        newcomers.map((a) => a.userId),
        'invite',
        who,
      );
      await this.notifier.notifyPeople(
        oldSeries,
        leavers.map((a) => a.userId),
        'removed',
        who,
      );
      // Guests: the shortened series, then the new one.
      await this.notifier.emailGuests(oldSeries, oldSeries.attendees, 'update');
      await this.notifier.emailGuests(newSeries, newSeries.attendees, 'invite');
    }
    return {
      meeting: await this.meetings.present(newSeries, actor.userId, links),
      newMeetingId: newId,
    };
  }

  // ------------------------------------------------------------ cancel / delete

  async cancel(
    actor: MeetingActor,
    id: string,
    input: CancelMeetingInput,
    links: LinkAccess | null,
  ): Promise<MeetingMutationResponse> {
    this.meetings.requireOrg(actor);
    const row = await this.loadOrganized(actor, id);
    if (row.status === 'CANCELLED') throw meetingCancelled();
    const who = this.notifyActor(actor);

    if (row.rrule && input.scope !== 'all' && input.occurrenceStart) {
      const occ = occurrenceAt(seriesOf(row), input.occurrenceStart);
      if (!occ) throw occurrenceNotFound();
      const t = occ.originalStart;
      if (input.scope === 'this') {
        const exdates = [...row.exdates, t];
        const overrides = row.overrides.filter((o) => o.originalStart.getTime() !== t.getTime());
        const lastEndsAt = computeLastEndsAt({ ...seriesOf(row), exdates, overrides });
        await this.prisma.client.$transaction(async (tx) => {
          await tx.meetingOccurrence.deleteMany({ where: { meetingId: row.id, originalStart: t } });
          await tx.meeting.update({
            where: { id: row.id },
            data: { exdates, lastEndsAt, sequence: row.sequence + 1 },
          });
          await refreshMeetingReminders(tx, row.id);
        });
        const updated = await this.reload(row.id);
        if (input.notifyAttendees) {
          const one = { startsAt: occ.startsAt, endsAt: occ.endsAt, originalStart: t };
          await this.notifier.notifyPeople(
            updated,
            updated.attendees.map((a) => a.userId),
            'cancel',
            who,
            one,
          );
          await this.notifier.emailGuests(updated, updated.attendees, 'cancel', one);
        }
        return {
          meeting: await this.meetings.present(updated, actor.userId, links),
          newMeetingId: null,
        };
      }
      if (t.getTime() !== row.startsAt.getTime()) {
        // This and following: the series ends before the occurrence.
        const rrule = truncateRule(row.rrule, t, row.allDay, row.timeZone);
        const exdates = row.exdates.filter((d) => d.getTime() < t.getTime());
        const overrides = row.overrides.filter((o) => o.originalStart.getTime() < t.getTime());
        const lastEndsAt = computeLastEndsAt({ ...seriesOf(row), rrule, exdates, overrides });
        await this.prisma.client.$transaction(async (tx) => {
          await tx.meetingOccurrence.deleteMany({
            where: { meetingId: row.id, originalStart: { gte: t } },
          });
          await tx.meeting.update({
            where: { id: row.id },
            data: { rrule, exdates, lastEndsAt, sequence: row.sequence + 1 },
          });
          await refreshMeetingReminders(tx, row.id);
        });
        const updated = await this.reload(row.id);
        if (input.notifyAttendees) {
          await this.notifier.notifyPeople(
            updated,
            updated.attendees.map((a) => a.userId),
            'update',
            who,
          );
          await this.notifier.emailGuests(updated, updated.attendees, 'update');
        }
        return {
          meeting: await this.meetings.present(updated, actor.userId, links),
          newMeetingId: null,
        };
      }
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.meeting.update({
        where: { id: row.id },
        data: { status: 'CANCELLED', sequence: row.sequence + 1 },
      });
      await tx.meetingReminder.updateMany({
        where: { meetingId: row.id },
        data: { nextFireAt: null },
      });
    });
    const updated = await this.reload(row.id);
    if (input.notifyAttendees) await this.tellCancelled(updated, who);
    return {
      meeting: await this.meetings.present(updated, actor.userId, links),
      newMeetingId: null,
    };
  }

  private async tellCancelled(m: MeetingRow, who: NotifyActor): Promise<void> {
    await this.notifier.notifyPeople(
      m,
      m.attendees.map((a) => a.userId),
      'cancel',
      who,
    );
    await this.notifier.emailGuests(m, m.attendees, 'cancel');
  }

  /** Soft delete. A meeting that was not cancelled yet is cancelled for everyone first. */
  async remove(actor: MeetingActor, id: string, notify: boolean): Promise<{ ok: true }> {
    this.meetings.requireOrg(actor);
    const row = await this.loadOrganized(actor, id);
    const wasLive = row.status !== 'CANCELLED';
    if (wasLive) {
      await this.prisma.client.meeting.update({
        where: { id: row.id },
        data: { sequence: row.sequence + 1 },
      });
    }
    await this.prisma.client.meeting.delete({ where: { id: row.id } });
    await this.prisma.client.meetingReminder.updateMany({
      where: { meetingId: row.id },
      data: { nextFireAt: null },
    });
    if (wasLive && notify) {
      await this.tellCancelled(
        { ...row, sequence: row.sequence + 1, status: 'CANCELLED' },
        this.notifyActor(actor),
      );
    }
    return { ok: true };
  }
}
