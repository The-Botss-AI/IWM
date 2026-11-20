import {
  BadRequestException,
  Injectable,
  Logger,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { IcsImportPreview, IcsImportResult, IcsImportSelection } from '@botss/shared-types';

import { PrismaService } from '../prisma/prisma.service';
import { IcsImportError, parseIcsFile, type ParsedIcsEvent, type ParsedIcsFile } from './ics-parse';
import type { MeetingActor, MeetingViewer } from './meeting-rules';
import { meetingClock, refreshMeetingReminders } from './meeting-reminder-schedule';
import { MeetingsService } from './meetings.service';
import { computeLastEndsAt, type OverrideShape } from './recurrence';

/** The multipart file as multer hands it over (memory storage). */
export interface UploadedIcsFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

function toProblem(err: IcsImportError): Error {
  const body = { title: 'Calendar file not imported', detail: err.message, code: err.code };
  if (err.code === 'ics_too_large') return new PayloadTooLargeException({ ...body, status: 413 });
  if (err.code === 'ics_too_many_events')
    return new UnprocessableEntityException({ ...body, status: 422 });
  return new BadRequestException({ ...body, status: 400 });
}

function noFile(detail: string): BadRequestException {
  return new BadRequestException({
    title: 'Calendar file not imported',
    status: 400,
    detail,
    code: 'ics_invalid',
  });
}

/** Is this upload an .ics file (by type or name)? */
export function looksLikeIcs(file: Pick<UploadedIcsFile, 'originalname' | 'mimetype'>): boolean {
  const type = file.mimetype.toLowerCase().split(';')[0]?.trim() ?? '';
  return type === 'text/calendar' || /\.ics$/i.test(file.originalname);
}

function overrideKey(o: OverrideShape): string {
  return JSON.stringify([
    o.originalStart.getTime(),
    o.startsAt.getTime(),
    o.endsAt.getTime(),
    o.title,
    o.description,
    o.location,
    o.meetingUrl,
  ]);
}

interface ExistingImport {
  id: string;
  organizationId: string;
  source: 'MANUAL' | 'ICS';
  sequence: number;
  deletedAt: Date | null;
  title: string;
  description: string | null;
  location: string | null;
  meetingUrl: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  timeZone: string;
  rrule: string | null;
  exdates: Date[];
  status: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  overrides: OverrideShape[];
  /** At most one row: whether anyone was added in the app since the import. */
  attendees: { id: string }[];
}

/** Same meeting content as in the file (so a re-import changes nothing). */
export function sameContent(a: ExistingImport, b: ParsedIcsEvent): boolean {
  const dates = (list: readonly Date[]) =>
    [...list]
      .map((d) => d.getTime())
      .sort((x, y) => x - y)
      .join(',');
  const overrides = (list: readonly OverrideShape[]) => list.map(overrideKey).sort().join('|');
  return (
    a.title === b.title &&
    a.description === b.description &&
    a.location === b.location &&
    a.meetingUrl === b.meetingUrl &&
    a.startsAt.getTime() === b.startsAt.getTime() &&
    a.endsAt.getTime() === b.endsAt.getTime() &&
    a.allDay === b.allDay &&
    a.timeZone === b.timeZone &&
    a.rrule === b.rrule &&
    a.status === b.status &&
    dates(a.exdates) === dates(b.exdates) &&
    overrides(a.overrides) === overrides(b.overrides)
  );
}

/**
 * .ics import in two steps, the file parsed in memory both times and never
 * stored: preview (what is in it, what is already imported, what cannot be
 * imported) and import (the chosen UIDs, or all). Imported meetings belong to
 * the importer alone (no attendees are added and nobody is notified). A
 * re-import updates by UID: a newer SEQUENCE with changed content updates the
 * meeting; an equal one only while nobody was added to it in the app (an app
 * edit bumps the SEQUENCE too); an older one is left alone; meetings made in
 * the app are never overwritten. A deleted import comes back as a fresh copy
 * of the file's event (no attendees) with a SEQUENCE above both.
 */
@Injectable()
export class MeetingImportService {
  private readonly logger = new Logger(MeetingImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly meetings: MeetingsService,
  ) {}

  parse(file: UploadedIcsFile | undefined, fallbackZone: string): ParsedIcsFile {
    if (!file || !file.buffer) throw noFile('Choose an .ics file to import.');
    if (!looksLikeIcs(file)) throw noFile('Only calendar (.ics) files can be imported.');
    try {
      return parseIcsFile(file.buffer, fallbackZone, meetingClock.now().getTime());
    } catch (err) {
      if (err instanceof IcsImportError) throw toProblem(err);
      throw noFile('This file is not a valid calendar (.ics) file.');
    }
  }

  private async userZone(userId: string): Promise<string> {
    const u = await this.prisma.client.user.findFirst({
      where: { id: userId },
      select: { timezone: true },
    });
    const zone = u?.timezone ?? 'UTC';
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone });
      return zone;
    } catch {
      return 'UTC';
    }
  }

  private async existing(
    organizerId: string,
    uids: string[],
  ): Promise<Map<string, ExistingImport>> {
    if (uids.length === 0) return new Map();
    // The raw client sees soft-deleted rows too: a deleted import is revived
    // instead of colliding with the (organizerId, icsUid) unique key.
    const rows = await this.prisma.raw.meeting.findMany({
      where: { organizerId, icsUid: { in: uids } },
      select: {
        id: true,
        icsUid: true,
        organizationId: true,
        source: true,
        sequence: true,
        deletedAt: true,
        title: true,
        description: true,
        location: true,
        meetingUrl: true,
        startsAt: true,
        endsAt: true,
        allDay: true,
        timeZone: true,
        rrule: true,
        exdates: true,
        status: true,
        overrides: true,
        attendees: { select: { id: true }, take: 1 },
      },
    });
    return new Map(rows.map((r) => [r.icsUid, r]));
  }

  async preview(
    viewer: MeetingViewer,
    file: UploadedIcsFile | undefined,
  ): Promise<IcsImportPreview> {
    const orgId = this.meetings.requireOrg(viewer);
    const parsed = this.parse(file, await this.userZone(viewer.userId));
    const existing = await this.existing(
      viewer.userId,
      parsed.events.map((e) => e.uid),
    );
    return {
      calendarName: parsed.calendarName,
      unreadable: parsed.unreadable,
      events: parsed.events.map((e) => {
        const prior = existing.get(e.uid);
        const alreadyImported = !!prior && !prior.deletedAt && prior.organizationId === orgId;
        const problem =
          e.problem ??
          (e.status === 'CANCELLED' && !alreadyImported ? 'This event was cancelled' : null) ??
          (prior && prior.source === 'MANUAL' ? 'This meeting was made in the app' : null);
        return {
          uid: e.uid,
          title: e.title,
          startsAt: e.startsAt,
          endsAt: e.endsAt,
          allDay: e.allDay,
          timeZone: e.timeZone,
          recurring: e.rrule !== null,
          rrule: e.rrule,
          location: e.location,
          meetingUrl: e.meetingUrl,
          meetingProvider: e.meetingProvider,
          reminders: e.reminders,
          alreadyImported,
          importable: problem === null,
          problem,
        };
      }),
    };
  }

  async import(
    actor: MeetingActor,
    file: UploadedIcsFile | undefined,
    selection: IcsImportSelection,
  ): Promise<IcsImportResult> {
    const orgId = this.meetings.requireOrg(actor);
    const parsed = this.parse(file, await this.userZone(actor.userId));
    const chosen =
      'all' in selection
        ? parsed.events
        : (() => {
            const wanted = new Set(selection.uids);
            return parsed.events.filter((e) => wanted.has(e.uid));
          })();
    const notFound = 'all' in selection ? 0 : new Set(selection.uids).size - chosen.length;
    const existing = await this.existing(
      actor.userId,
      chosen.map((e) => e.uid),
    );
    const defaults = (await this.meetings.defaultReminders([actor.userId])).get(actor.userId) ?? [];
    const result: IcsImportResult = {
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: notFound,
      meetingIds: [],
    };

    for (const ev of chosen) {
      const prior = existing.get(ev.uid);
      if (ev.problem) {
        result.skipped += 1;
        continue;
      }
      let lastEndsAt: Date | null;
      try {
        lastEndsAt = computeLastEndsAt(ev);
      } catch {
        result.skipped += 1;
        continue;
      }
      if (prior) {
        if (prior.organizationId !== orgId || prior.source === 'MANUAL') {
          result.skipped += 1;
          continue;
        }
        if (prior.deletedAt) {
          // Revive a deleted import, but never as a cancelled event (and
          // never hand back the id of a meeting that stays deleted).
          if (ev.status === 'CANCELLED') {
            result.skipped += 1;
            continue;
          }
          await this.updateImported(actor.userId, prior.id, ev, lastEndsAt, {
            revive: true,
            sequence: Math.max(prior.sequence + 1, ev.sequence),
          });
          result.updated += 1;
          result.meetingIds.push(prior.id);
          continue;
        }
        const newer =
          ev.sequence > prior.sequence ||
          (ev.sequence === prior.sequence && prior.attendees.length === 0);
        if (!newer || sameContent(prior, ev)) {
          result.unchanged += 1;
          result.meetingIds.push(prior.id);
          continue;
        }
        await this.updateImported(actor.userId, prior.id, ev, lastEndsAt, {
          revive: false,
          sequence: ev.sequence,
        });
        result.updated += 1;
        result.meetingIds.push(prior.id);
        continue;
      }
      if (ev.status === 'CANCELLED') {
        result.skipped += 1;
        continue;
      }
      const created = await this.prisma.client.meeting.create({
        data: {
          organizationId: orgId,
          workspaceId: actor.workspaceId,
          organizerId: actor.userId,
          title: ev.title,
          description: ev.description,
          location: ev.location,
          meetingUrl: ev.meetingUrl,
          startsAt: ev.startsAt,
          endsAt: ev.endsAt,
          allDay: ev.allDay,
          timeZone: ev.timeZone,
          rrule: ev.rrule,
          exdates: ev.exdates,
          lastEndsAt,
          status: ev.status,
          source: 'ICS',
          icsUid: ev.uid,
          sequence: ev.sequence,
          overrides: { create: ev.overrides.map((o) => ({ ...o })) },
          reminders: {
            create: (ev.reminders.length > 0 ? ev.reminders : defaults).map((minutesBefore) => ({
              userId: actor.userId,
              minutesBefore,
            })),
          },
        },
        select: { id: true },
      });
      await refreshMeetingReminders(this.prisma.client, created.id);
      result.created += 1;
      result.meetingIds.push(created.id);
    }
    this.logger.log(
      `ics import userId=${actor.userId} created=${result.created} updated=${result.updated} unchanged=${result.unchanged} skipped=${result.skipped}`,
    );
    return result;
  }

  private async updateImported(
    userId: string,
    id: string,
    ev: ParsedIcsEvent,
    lastEndsAt: Date | null,
    opts: { revive: boolean; sequence: number },
  ): Promise<void> {
    await this.prisma.raw.$transaction(async (tx) => {
      await tx.meetingOccurrence.deleteMany({ where: { meetingId: id } });
      if (opts.revive) {
        // A revived import is the importer's alone again: people added
        // before it was deleted are not brought back with it.
        await tx.meetingAttendee.deleteMany({ where: { meetingId: id } });
        await tx.meetingReminder.deleteMany({ where: { meetingId: id, userId: { not: userId } } });
      }
      await tx.meeting.update({
        where: { id },
        data: {
          title: ev.title,
          description: ev.description,
          location: ev.location,
          meetingUrl: ev.meetingUrl,
          startsAt: ev.startsAt,
          endsAt: ev.endsAt,
          allDay: ev.allDay,
          timeZone: ev.timeZone,
          rrule: ev.rrule,
          exdates: ev.exdates,
          lastEndsAt,
          status: ev.status,
          sequence: opts.sequence,
          deletedAt: null,
          overrides: { create: ev.overrides.map((o) => ({ ...o })) },
        },
      });
      if (ev.reminders.length > 0) {
        const have = await tx.meetingReminder.findMany({
          where: { meetingId: id, userId },
          select: { id: true, minutesBefore: true },
        });
        const wanted = new Set(ev.reminders);
        const drop = have.filter((r) => !wanted.has(r.minutesBefore)).map((r) => r.id);
        if (drop.length > 0) await tx.meetingReminder.deleteMany({ where: { id: { in: drop } } });
        const kept = new Set(have.map((r) => r.minutesBefore));
        const add = ev.reminders.filter((m) => !kept.has(m));
        if (add.length > 0) {
          await tx.meetingReminder.createMany({
            data: add.map((minutesBefore) => ({ meetingId: id, userId, minutesBefore })),
            skipDuplicates: true,
          });
        }
      }
    });
    await refreshMeetingReminders(this.prisma.client, id);
  }
}
