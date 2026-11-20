import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@botss/database';
import {
  DEFAULT_MEETING_REMINDERS,
  MAX_MEETING_ATTENDEES,
  MEETING_SNOOZE_MINUTES,
  parseStoredUserPreferences,
  type AttendeeCandidatesQuery,
  type AttendeeCandidatesResponse,
  type ListMeetingsQuery,
  type Meeting,
  type MeetingAttendeesInput,
  type MeetingListResponse,
  type MeetingOccurrence,
  type MeetingRemindersResponse,
  type MeetingRsvpInput,
  type MeetingSnoozeResponse,
} from '@botss/shared-types';

import { projectAccessWhere } from '../common/project-access';
import { invalidReference } from '../common/tenant-scope';
import { clientVisibleWhere } from '../clients/client-visibility';
import { PrismaService } from '../prisma/prisma.service';
import {
  MEETING_INCLUDE,
  myResponseIn,
  seriesOf,
  toMeeting,
  type MeetingLinks,
  type MeetingRow,
} from './meeting-mapper';
import { MeetingNotifier } from './meeting-notifier.service';
import { meetingClock, refreshMeetingReminders } from './meeting-reminder-schedule';
import {
  badMeeting,
  meetingCancelled,
  meetingNotFound,
  meetingVisibleWhere,
  noOrganization,
  type LinkAccess,
  type MeetingActor,
  type MeetingViewer,
} from './meeting-rules';
import { expandOccurrences, newExpansionBudget } from './recurrence';

/** Meetings one list call loads before expanding (each may hold many occurrences). */
const LIST_MEETINGS_CAP = 2000;
/** Occurrences one list call returns. */
const LIST_OCCURRENCES_CAP = 1500;
const CANDIDATES_CAP = 2000;

export interface ResolvedAttendees {
  internal: { userId: string; email: string; name: string }[];
  external: { email: string; name: string | null }[];
  /** People already on the meeting who left the organization (or were deleted): dropped, not refused. */
  dropped: string[];
}

export interface LinkIds {
  leadId?: string | null;
  clientId?: string | null;
  projectId?: string | null;
}

/**
 * Meeting reads (list, one meeting, calendar ranges), RSVP, personal
 * reminders and snooze, the attendee picker, and the checks the editor
 * shares (links, attendees, default reminders).
 *
 * Every query that returns a meeting composes `meetingVisibleWhere`: the
 * organizer and internal attendees only, inside the caller's organization.
 * A meeting someone cannot see is a 404, never a 403.
 */
@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: MeetingNotifier,
  ) {}

  // ------------------------------------------------------------ helpers

  requireOrg(viewer: MeetingViewer): string {
    if (!viewer.organizationId) throw noOrganization();
    return viewer.organizationId;
  }

  async loadVisible(viewer: MeetingViewer, id: string): Promise<MeetingRow> {
    const row = await this.prisma.client.meeting.findFirst({
      where: { AND: [{ id }, meetingVisibleWhere(viewer)] },
      include: MEETING_INCLUDE,
    });
    if (!row) throw meetingNotFound();
    return row;
  }

  async myReminders(meetingId: string, userId: string): Promise<number[]> {
    const rows = await this.prisma.client.meetingReminder.findMany({
      where: { meetingId, userId },
      select: { minutesBefore: true },
      orderBy: { minutesBefore: 'asc' },
    });
    return rows.map((r) => r.minutesBefore);
  }

  /** Each user's default reminders (their preference, else the product default). */
  async defaultReminders(userIds: readonly string[]): Promise<Map<string, number[]>> {
    const out = new Map<string, number[]>();
    const ids = [...new Set(userIds)];
    for (const id of ids) out.set(id, [...DEFAULT_MEETING_REMINDERS]);
    if (ids.length === 0) return out;
    const rows = await this.prisma.client.userPreferences.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, data: true },
    });
    for (const row of rows) {
      const list = parseStoredUserPreferences(row.data).meetings?.defaultReminders;
      if (list) out.set(row.userId, list);
    }
    return out;
  }

  /**
   * Internal attendees must be STAFF of the organizer's organization (anyone
   * else is a 400 that does not say who or why). An email that belongs to
   * such a person adds them as that person; other emails are guests. On an
   * edit, `existingUserIds` are the people already on the meeting: one of
   * them who no longer resolves (left the organization, deleted) is dropped
   * silently, so the organizer can still save; only NEW ids are refused.
   */
  async resolveAttendees(
    organizationId: string,
    organizer: { userId: string; email: string },
    input: MeetingAttendeesInput,
    existingUserIds: ReadonlySet<string> = new Set(),
  ): Promise<ResolvedAttendees> {
    const organizerEmail = organizer.email.toLowerCase();
    const userIds = [...new Set(input.userIds)].filter((id) => id !== organizer.userId);
    const emailMap = new Map<string, string | null>();
    for (const e of input.emails) {
      const email = e.email.toLowerCase();
      if (email !== organizerEmail && !emailMap.has(email)) emailMap.set(email, e.name ?? null);
    }
    const staffWhere = { organizationId, accountType: 'STAFF' as const, deletedAt: null };
    const byId = userIds.length
      ? await this.prisma.client.user.findMany({
          where: { id: { in: userIds }, ...staffWhere },
          select: { id: true, email: true, name: true },
        })
      : [];
    const found = new Set(byId.map((u) => u.id));
    const missing = userIds.filter((id) => !found.has(id));
    if (missing.some((id) => !existingUserIds.has(id))) {
      throw badMeeting(
        'Some of the people you added are not in your organization.',
        'meeting_attendee_not_in_org',
      );
    }
    const emails = [...emailMap.keys()];
    const byEmail = emails.length
      ? await this.prisma.client.user.findMany({
          where: { email: { in: emails }, ...staffWhere },
          select: { id: true, email: true, name: true },
        })
      : [];
    const internal = new Map<string, { userId: string; email: string; name: string }>();
    for (const u of [...byId, ...byEmail]) {
      if (u.id === organizer.userId) continue;
      internal.set(u.id, { userId: u.id, email: u.email.toLowerCase(), name: u.name });
    }
    const internalEmails = new Set([...internal.values()].map((u) => u.email));
    const external = emails
      .filter((email) => !internalEmails.has(email))
      .map((email) => ({ email, name: emailMap.get(email) ?? null }));
    if (internal.size + external.length > MAX_MEETING_ATTENDEES) {
      throw badMeeting(
        `A meeting can have at most ${MAX_MEETING_ATTENDEES} people.`,
        'meeting_too_many_attendees',
      );
    }
    return { internal: [...internal.values()], external, dropped: missing };
  }

  /**
   * A lead, client or project linked to a meeting must be in the caller's
   * active workspace and visible to them (the same rules as their own
   * pages). Anything else is the standard invalid-reference 400.
   */
  async assertLinks(organizationId: string, links: LinkAccess | null, ids: LinkIds): Promise<void> {
    const wanted = [ids.leadId, ids.clientId, ids.projectId].some((v) => !!v);
    if (!wanted) return;
    if (!links) {
      throw badMeeting(
        'Open a workspace to link a lead, client or project.',
        'meeting_link_needs_workspace',
      );
    }
    const inOrg = { workspace: { organizationId } };
    if (ids.leadId) {
      const lead = links.canReadLeads
        ? await this.prisma.client.lead.findFirst({
            where: {
              id: ids.leadId,
              workspaceId: links.workspaceId,
              ...(links.fullLeads ? {} : { assigneeId: links.userId }),
              ...inOrg,
            },
            select: { id: true },
          })
        : null;
      if (!lead) throw invalidReference('lead', 'meeting_invalid_lead');
    }
    if (ids.clientId) {
      const client = links.canReadClients
        ? await this.prisma.client.client.findFirst({
            where: { AND: [{ id: ids.clientId }, clientVisibleWhere(links), inOrg] },
            select: { id: true },
          })
        : null;
      if (!client) throw invalidReference('client', 'meeting_invalid_client');
    }
    if (ids.projectId) {
      const project = links.canReadProjects
        ? await this.prisma.client.project.findFirst({
            where: {
              AND: [
                { id: ids.projectId },
                projectAccessWhere(links.scope) as Prisma.ProjectWhereInput,
                inOrg,
              ],
            },
            select: { id: true },
          })
        : null;
      if (!project) throw invalidReference('project', 'meeting_invalid_project');
    }
  }

  /** Linked records, named only when this viewer may see them in their active workspace. */
  async linkNames(
    row: Pick<MeetingRow, 'leadId' | 'clientId' | 'projectId'>,
    links: LinkAccess | null,
  ): Promise<MeetingLinks> {
    const out: MeetingLinks = {
      lead: row.leadId ? { id: row.leadId, name: null } : null,
      client: row.clientId ? { id: row.clientId, name: null } : null,
      project: row.projectId ? { id: row.projectId, name: null } : null,
    };
    if (!links) return out;
    const [lead, client, project] = await Promise.all([
      row.leadId && links.canReadLeads
        ? this.prisma.client.lead.findFirst({
            where: {
              id: row.leadId,
              workspaceId: links.workspaceId,
              ...(links.fullLeads ? {} : { assigneeId: links.userId }),
            },
            select: { name: true },
          })
        : null,
      row.clientId && links.canReadClients
        ? this.prisma.client.client.findFirst({
            where: { AND: [{ id: row.clientId }, clientVisibleWhere(links)] },
            select: { name: true },
          })
        : null,
      row.projectId && links.canReadProjects
        ? this.prisma.client.project.findFirst({
            where: {
              AND: [
                { id: row.projectId },
                projectAccessWhere(links.scope) as Prisma.ProjectWhereInput,
              ],
            },
            select: { name: true },
          })
        : null,
    ]);
    if (out.lead && lead) out.lead.name = lead.name;
    if (out.client && client) out.client.name = client.name;
    if (out.project && project) out.project.name = project.name;
    return out;
  }

  async present(row: MeetingRow, viewerId: string, links: LinkAccess | null): Promise<Meeting> {
    const [reminders, names] = await Promise.all([
      this.myReminders(row.id, viewerId),
      this.linkNames(row, links),
    ]);
    return toMeeting(row, viewerId, reminders, names);
  }

  // ------------------------------------------------------------ reads

  async get(viewer: MeetingViewer, id: string, links: LinkAccess | null): Promise<Meeting> {
    const row = await this.loadVisible(viewer, id);
    return this.present(row, viewer.userId, links);
  }

  /**
   * The viewer's occurrences overlapping [from, to), expanded from their
   * visible meetings (series, exdates and changed occurrences applied).
   */
  async occurrences(
    viewer: MeetingViewer,
    from: Date,
    to: Date,
    opts: { includeCancelled: boolean; limit?: number },
  ): Promise<MeetingListResponse> {
    if (!viewer.organizationId) return { items: [], truncated: false };
    const rows = await this.prisma.client.meeting.findMany({
      where: {
        AND: [
          meetingVisibleWhere(viewer),
          opts.includeCancelled ? {} : { status: { not: 'CANCELLED' } },
          { OR: [{ startsAt: { lt: to } }, { overrides: { some: { startsAt: { lt: to } } } }] },
          { OR: [{ lastEndsAt: null }, { lastEndsAt: { gt: from } }] },
        ],
      },
      include: {
        organizer: { select: { id: true, name: true, email: true, image: true } },
        attendees: { select: { userId: true, response: true } },
        overrides: true,
      },
      orderBy: { startsAt: 'asc' },
      take: LIST_MEETINGS_CAP,
    });
    const limit = opts.limit ?? LIST_OCCURRENCES_CAP;
    const items: MeetingOccurrence[] = [];
    let truncated = rows.length >= LIST_MEETINGS_CAP;
    // One iteration budget for the whole call: many long series together
    // stay bounded, and what did not fit is reported as truncated.
    const budget = newExpansionBudget();
    for (const row of rows) {
      let expanded: ReturnType<typeof expandOccurrences>;
      try {
        expanded = expandOccurrences(seriesOf(row), from, to, { limit, budget });
      } catch (err) {
        // A stored rule this build cannot read must not hide every other meeting.
        this.logger.warn(
          `meeting expansion failed meetingId=${row.id}: ${(err as Error)?.message ?? 'unknown'}`,
        );
        continue;
      }
      if (expanded.truncated) truncated = true;
      for (const occ of expanded.items) {
        const o = occ.override;
        items.push({
          meetingId: row.id,
          occurrenceStart: occ.originalStart,
          startsAt: occ.startsAt,
          endsAt: occ.endsAt,
          title: o?.title ? o.title : row.title,
          location: o && o.location !== null ? o.location || null : row.location,
          meetingUrl: o && o.meetingUrl !== null ? o.meetingUrl || null : row.meetingUrl,
          allDay: row.allDay,
          timeZone: row.timeZone,
          status: row.status,
          color: row.color,
          isRecurring: row.rrule !== null,
          isException: o !== null,
          isOrganizer: row.organizerId === viewer.userId,
          myResponse: myResponseIn(row, viewer.userId),
          organizer: row.organizer,
          attendeeCount: row.attendees.length,
        });
      }
    }
    if (budget.exhausted) truncated = true;
    items.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    if (items.length > limit) {
      items.length = limit;
      truncated = true;
    }
    return { items, truncated };
  }

  list(viewer: MeetingViewer, q: ListMeetingsQuery): Promise<MeetingListResponse> {
    return this.occurrences(viewer, q.from, q.to, {
      includeCancelled: q.includeCancelled ?? false,
    });
  }

  // ------------------------------------------------------------ RSVP

  /** An internal attendee answers for the whole series. The organizer is told. */
  async rsvp(
    actor: MeetingActor,
    id: string,
    input: MeetingRsvpInput,
    links: LinkAccess | null,
  ): Promise<Meeting> {
    const row = await this.loadVisible(actor, id);
    if (row.organizerId === actor.userId) {
      throw badMeeting('You organize this meeting.', 'meeting_organizer_rsvp');
    }
    if (row.status === 'CANCELLED') throw meetingCancelled();
    const mine = row.attendees.find((a) => a.userId === actor.userId);
    if (!mine) throw meetingNotFound();
    if (mine.response !== input.response) {
      await this.prisma.client.meetingAttendee.update({
        where: { id: mine.id },
        data: { response: input.response, respondedAt: new Date() },
      });
      // A decline silences this person's reminders; an accept brings them back.
      await refreshMeetingReminders(this.prisma.client, row.id);
      await this.notifier.notifyRsvp(
        row,
        { userId: actor.userId, name: actor.name },
        input.response,
      );
    }
    return this.get(actor, id, links);
  }

  // ------------------------------------------------------------ reminders

  /** Replace the caller's own reminders on a meeting they can see. */
  async setReminders(
    viewer: MeetingViewer,
    id: string,
    minutes: number[],
  ): Promise<MeetingRemindersResponse> {
    const row = await this.loadVisible(viewer, id);
    const existing = await this.prisma.client.meetingReminder.findMany({
      where: { meetingId: row.id, userId: viewer.userId },
      select: { id: true, minutesBefore: true },
    });
    const wanted = new Set(minutes);
    const remove = existing.filter((r) => !wanted.has(r.minutesBefore)).map((r) => r.id);
    const have = new Set(existing.map((r) => r.minutesBefore));
    const add = minutes.filter((m) => !have.has(m));
    // Kept rows keep their id, so a reminder that already fired for an
    // occurrence does not fire again.
    await this.prisma.client.$transaction(async (tx) => {
      if (remove.length > 0) await tx.meetingReminder.deleteMany({ where: { id: { in: remove } } });
      if (add.length > 0) {
        await tx.meetingReminder.createMany({
          data: add.map((m) => ({ meetingId: row.id, userId: viewer.userId, minutesBefore: m })),
          skipDuplicates: true,
        });
      }
      await refreshMeetingReminders(tx, row.id);
    });
    return { minutesBefore: [...minutes].sort((a, b) => a - b) };
  }

  /** Ring a fired reminder again in five minutes (the owner of the reminder only). */
  async snooze(
    viewer: MeetingViewer,
    deliveryId: string,
    now = meetingClock.now(),
  ): Promise<MeetingSnoozeResponse> {
    const delivery = await this.prisma.client.meetingReminderDelivery.findFirst({
      where: {
        id: deliveryId,
        reminder: { userId: viewer.userId, meeting: meetingVisibleWhere(viewer) },
      },
      select: {
        id: true,
        occurrenceStart: true,
        reminder: {
          select: {
            meeting: {
              select: {
                startsAt: true,
                endsAt: true,
                allDay: true,
                timeZone: true,
                rrule: true,
                exdates: true,
                overrides: true,
              },
            },
          },
        },
      },
    });
    if (!delivery)
      throw new NotFoundException({
        title: 'Reminder not found',
        status: 404,
        code: 'meeting_reminder_not_found',
      });
    // Ringing again after the meeting is over helps nobody. A delivery is
    // keyed by the occurrence's (possibly moved) start.
    const start = delivery.occurrenceStart.getTime();
    let endsAt: number | null = null;
    try {
      const occ = expandOccurrences(
        seriesOf(delivery.reminder.meeting),
        new Date(start - 86_400_000),
        new Date(start + 86_400_000),
        {
          match: (s) => s === start,
          limit: 5,
        },
      ).items[0];
      endsAt = occ ? occ.endsAt.getTime() : null;
    } catch {
      endsAt = null;
    }
    if (endsAt !== null && endsAt <= now.getTime()) {
      throw new ConflictException({
        title: 'Meeting already ended',
        status: 409,
        detail: 'This meeting is already over, so the reminder cannot ring again.',
        code: 'meeting_snooze_ended',
      });
    }
    const snoozedUntil = new Date(now.getTime() + MEETING_SNOOZE_MINUTES * 60_000);
    await this.prisma.client.meetingReminderDelivery.update({
      where: { id: delivery.id },
      data: { snoozedUntil, snoozeFiredAt: null },
    });
    return { snoozedUntil };
  }

  // ------------------------------------------------------------ attendee picker

  /**
   * Candidate attendees for "add everyone": active staff of the caller's
   * organization, or of one of its workspaces the caller is a member of.
   * Never anyone outside it.
   */
  async attendeeCandidates(
    viewer: MeetingViewer,
    q: AttendeeCandidatesQuery,
  ): Promise<AttendeeCandidatesResponse> {
    const orgId = this.requireOrg(viewer);
    if (q.workspaceId) {
      // Only a workspace the caller belongs to: its member list is not
      // theirs to read otherwise.
      const [ws, member] = await Promise.all([
        this.prisma.client.workspace.findFirst({
          where: { id: q.workspaceId, organizationId: orgId },
          select: { id: true },
        }),
        this.prisma.client.workspaceMembership.findFirst({
          where: { workspaceId: q.workspaceId, userId: viewer.userId },
          select: { id: true },
        }),
      ]);
      if (!ws || !member)
        throw new NotFoundException({ title: 'Workspace not found', status: 404 });
    }
    const where: Prisma.UserWhereInput = {
      organizationId: orgId,
      accountType: 'STAFF',
      deletedAt: null,
      id: { not: viewer.userId },
      ...(q.workspaceId ? { workspaceMemberships: { some: { workspaceId: q.workspaceId } } } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { email: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.client.user.findMany({
      where,
      select: { id: true, name: true, email: true, image: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: CANDIDATES_CAP + 1,
    });
    return { items: rows.slice(0, CANDIDATES_CAP), truncated: rows.length > CANDIDATES_CAP };
  }
}
