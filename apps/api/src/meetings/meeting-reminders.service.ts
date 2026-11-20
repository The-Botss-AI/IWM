import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@botss/database';
import {
  MEETING_REMINDER_PUSH_TYPE,
  MEETING_SNOOZE_MINUTES,
  type MeetingReminderPushData,
} from '@botss/shared-types';

import { AddonsService } from '../addons/addons.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  computeNextFireAt,
  REMINDER_GRACE_MS,
  REMINDER_SELECT,
  seriesOfReminder,
  type ReminderRow,
} from './meeting-reminder-schedule';
import { formatWhen, meetingPath, reminderRecipientOk, reminderTitle } from './meeting-rules';
import { expandOccurrences, type Occurrence } from './recurrence';

export { REMINDER_GRACE_MS, type ReminderRow } from './meeting-reminder-schedule';

/** Deliveries for occurrences older than this are pruned (they can never fire again). */
const DELIVERY_RETENTION_MS = 2 * 86_400_000;
const SNOOZES_CAP = 1_000;
/** Reminders read per query; the cron pages through all of them. */
export const REMINDER_BATCH = 500;

type Cursor = { at: Date; id: string } | null;

/** Keyset paging on (nextFireAt, id): every row once, even when some fail to update. */
function after(cursor: Cursor): Prisma.MeetingReminderWhereInput {
  if (!cursor) return {};
  return {
    OR: [{ nextFireAt: { gt: cursor.at } }, { nextFireAt: cursor.at, id: { gt: cursor.id } }],
  };
}

/**
 * Occurrences of this reminder's meeting whose reminder time
 * (start - minutesBefore) fell in (now - grace, now]. Cancelled occurrences
 * (exdates) are not produced; a moved occurrence rings by its new time.
 */
export function dueOccurrences(
  row: ReminderRow,
  now: Date,
  graceMs = REMINDER_GRACE_MS,
): Occurrence[] {
  const offset = row.minutesBefore * 60_000;
  const fromMs = now.getTime() - graceMs + offset;
  const toMs = now.getTime() + offset;
  return expandOccurrences(
    seriesOfReminder(row),
    new Date(fromMs - 86_400_000),
    new Date(toMs + 86_400_000),
    {
      match: (start) => start > fromMs && start <= toMs,
      limit: 50,
    },
  ).items;
}

/**
 * Meeting reminders, run every minute by `MeetingReminderCronService` in the
 * worker role. The cron reads only reminders whose `nextFireAt` fell in the
 * last REMINDER_GRACE_MS (an index range, paged), then moves each one to its
 * next ring. Each (reminder, occurrence) fires once: the delivery row with
 * its unique key is inserted BEFORE the notification, so a second worker or
 * an overlapping run loses the insert and skips. A snooze sets
 * `snoozedUntil`; the snoozed delivery is claimed again through
 * `snoozeFiredAt`. Nothing fires for a deleted or cancelled meeting, a
 * cancelled occurrence, someone removed from the meeting or who declined, a
 * person in another organization, or an organization with the add-on off.
 * Rows older than the grace window (the worker was down) are moved on
 * without ringing.
 */
@Injectable()
export class MeetingRemindersService {
  private readonly logger = new Logger(MeetingRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly addons?: AddonsService,
  ) {}

  async sweep(now = new Date()): Promise<number> {
    const enabled = new Map<string, boolean>();
    await this.catchUp(now);
    let fired = await this.fireDue(now, enabled);
    fired += await this.fireSnoozed(now, enabled);
    if (now.getUTCMinutes() === 0) await this.prune(now);
    return fired;
  }

  private async addonOn(orgId: string, cache: Map<string, boolean>): Promise<boolean> {
    if (!this.addons) return true;
    const hit = cache.get(orgId);
    if (hit !== undefined) return hit;
    const on = await this.addons.isEnabled(orgId, 'meetings');
    cache.set(orgId, on);
    return on;
  }

  /** One page of reminders matching `where`, in (nextFireAt, id) order. */
  private page(where: Prisma.MeetingReminderWhereInput, cursor: Cursor): Promise<ReminderRow[]> {
    return this.prisma.client.meetingReminder.findMany({
      where: { AND: [where, after(cursor)] },
      orderBy: [{ nextFireAt: 'asc' }, { id: 'asc' }],
      take: REMINDER_BATCH,
      select: REMINDER_SELECT,
    });
  }

  private async moveOn(row: ReminderRow, afterMs: number): Promise<void> {
    const next = computeNextFireAt(row, afterMs);
    await this.prisma.client.meetingReminder.update({
      where: { id: row.id },
      data: { nextFireAt: next },
    });
  }

  /** Reminders whose time passed before the grace window: no ring, just their next time. */
  private async catchUp(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - REMINDER_GRACE_MS);
    let cursor: Cursor = null;
    for (;;) {
      const rows = await this.page({ nextFireAt: { lte: cutoff } }, cursor);
      for (const row of rows) {
        try {
          await this.moveOn(row, cutoff.getTime());
        } catch (err) {
          this.logger.warn(
            `meeting reminder catch-up failed reminderId=${row.id}: ${(err as Error)?.message ?? 'unknown'}`,
          );
        }
      }
      const last = rows.at(-1);
      if (!last || rows.length < REMINDER_BATCH || !last.nextFireAt) return;
      cursor = { at: last.nextFireAt, id: last.id };
    }
  }

  private async fireDue(now: Date, enabled: Map<string, boolean>): Promise<number> {
    const window = { gt: new Date(now.getTime() - REMINDER_GRACE_MS), lte: now };
    let fired = 0;
    let cursor: Cursor = null;
    for (;;) {
      const rows = await this.page({ nextFireAt: window }, cursor);
      for (const row of rows) {
        try {
          if (
            reminderRecipientOk(row.meeting, row.user) &&
            (await this.addonOn(row.meeting.organizationId, enabled))
          ) {
            for (const occ of dueOccurrences(row, now)) {
              const deliveryId = await this.claim(row.id, occ.startsAt);
              if (!deliveryId) continue;
              await this.fire(row, occ, deliveryId, now);
              fired += 1;
            }
          }
        } catch (err) {
          this.logger.warn(
            `meeting reminder failed reminderId=${row.id}: ${(err as Error)?.message ?? 'unknown'}`,
          );
        }
        try {
          await this.moveOn(row, now.getTime());
        } catch (err) {
          this.logger.warn(
            `meeting reminder reschedule failed reminderId=${row.id}: ${(err as Error)?.message ?? 'unknown'}`,
          );
        }
      }
      const last = rows.at(-1);
      if (!last || rows.length < REMINDER_BATCH || !last.nextFireAt) return fired;
      cursor = { at: last.nextFireAt, id: last.id };
    }
  }

  /** Insert the delivery row; null when another run already did (it fired there). */
  async claim(reminderId: string, occurrenceStart: Date): Promise<string | null> {
    try {
      const row = await this.prisma.client.meetingReminderDelivery.create({
        data: { reminderId, occurrenceStart },
        select: { id: true },
      });
      return row.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
      throw err;
    }
  }

  private async fireSnoozed(now: Date, enabled: Map<string, boolean>): Promise<number> {
    const due = await this.prisma.client.meetingReminderDelivery.findMany({
      where: { snoozedUntil: { lte: now }, snoozeFiredAt: null },
      select: {
        id: true,
        occurrenceStart: true,
        snoozedUntil: true,
        reminder: { select: REMINDER_SELECT },
      },
      orderBy: { snoozedUntil: 'asc' },
      take: SNOOZES_CAP,
    });
    let fired = 0;
    for (const d of due) {
      try {
        // Claim first: whatever happens next, this snooze is spent.
        const claimed = await this.prisma.client.meetingReminderDelivery.updateMany({
          where: { id: d.id, snoozeFiredAt: null, snoozedUntil: d.snoozedUntil },
          data: { snoozeFiredAt: now },
        });
        if (claimed.count !== 1) continue;
        const row = d.reminder;
        if (!reminderRecipientOk(row.meeting, row.user)) continue;
        if (!(await this.addonOn(row.meeting.organizationId, enabled))) continue;
        // The occurrence must still be on (not cancelled or moved since) and
        // not over yet.
        const start = d.occurrenceStart.getTime();
        const occ = expandOccurrences(
          seriesOfReminder(row),
          new Date(start - 86_400_000),
          new Date(start + 86_400_000),
          {
            match: (s) => s === start,
            limit: 5,
          },
        ).items[0];
        if (!occ || occ.endsAt.getTime() <= now.getTime()) continue;
        await this.fire(row, occ, d.id, now);
        fired += 1;
      } catch (err) {
        this.logger.warn(
          `meeting snooze failed deliveryId=${d.id}: ${(err as Error)?.message ?? 'unknown'}`,
        );
      }
    }
    return fired;
  }

  private async fire(
    row: ReminderRow,
    occ: Occurrence,
    deliveryId: string,
    now: Date,
  ): Promise<void> {
    const m = row.meeting;
    const o = occ.override;
    const title = o?.title ? o.title : m.title;
    const location = o && o.location !== null ? o.location || null : m.location;
    const meetingUrl = o && o.meetingUrl !== null ? o.meetingUrl || null : m.meetingUrl;
    const minutesLeft = Math.round((occ.startsAt.getTime() - now.getTime()) / 60_000);
    const when = formatWhen(occ.startsAt, occ.endsAt, m.allDay, m.timeZone);
    const data: MeetingReminderPushData = {
      type: MEETING_REMINDER_PUSH_TYPE,
      meetingId: m.id,
      occurrenceStart: occ.originalStart.toISOString(),
      meetingUrl,
      snooze: { deliveryId, minutes: MEETING_SNOOZE_MINUTES },
    };
    await this.notifications.emit({
      userId: row.userId,
      type: 'MEETING_REMINDER',
      title: reminderTitle(title, minutesLeft).slice(0, 200),
      body: location ? `${when} · ${location}`.slice(0, 400) : when,
      entityType: 'meeting',
      entityId: m.id,
      url: meetingPath(m.id, m.rrule ? occ.originalStart : null),
      pushData: data,
      requireInteraction: true,
    });
  }

  private async prune(now: Date): Promise<void> {
    try {
      await this.prisma.client.meetingReminderDelivery.deleteMany({
        where: {
          occurrenceStart: { lt: new Date(now.getTime() - DELIVERY_RETENTION_MS) },
          OR: [{ snoozedUntil: null }, { snoozeFiredAt: { not: null } }],
        },
      });
    } catch (err) {
      this.logger.warn(`meeting reminder prune failed: ${(err as Error)?.message ?? 'unknown'}`);
    }
  }
}
