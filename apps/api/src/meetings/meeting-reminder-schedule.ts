import type { Prisma } from '@botss/database';

import type { PrismaService } from '../prisma/prisma.service';
import { reminderRecipientOk } from './meeting-rules';
import { nextOccurrenceAfter, type SeriesShape } from './recurrence';

/**
 * When each reminder next rings (`MeetingReminder.nextFireAt`). The reminder
 * cron selects only rows whose time fell in the last REMINDER_GRACE_MS, so
 * its query is an index range instead of a scan of every series. The time is
 * written:
 *  - after every change to a meeting, its reminders, or someone's answer
 *    (`refreshMeetingReminders`, from now - grace, so a reminder that is due
 *    right now still rings once; the delivery row keeps it to once);
 *  - after each ring, from the ring time on (the cron);
 *  - for rows left behind by downtime, from now - grace (the cron), so a
 *    restart never floods people with old reminders.
 */

/** A reminder due within this long ago still rings (a worker restart, a slow minute). */
export const REMINDER_GRACE_MS = 10 * 60_000;

/** The clock writes of `nextFireAt` read. The check script replaces `now`. */
export const meetingClock = { now: (): Date => new Date() };

export const REMINDER_SELECT = {
  id: true,
  userId: true,
  minutesBefore: true,
  nextFireAt: true,
  user: { select: { id: true, organizationId: true, deletedAt: true } },
  meeting: {
    select: {
      id: true,
      organizationId: true,
      organizerId: true,
      title: true,
      location: true,
      meetingUrl: true,
      startsAt: true,
      endsAt: true,
      allDay: true,
      timeZone: true,
      rrule: true,
      exdates: true,
      status: true,
      deletedAt: true,
      overrides: true,
      attendees: { select: { userId: true, response: true } },
    },
  },
} satisfies Prisma.MeetingReminderSelect;

export type ReminderRow = Prisma.MeetingReminderGetPayload<{ select: typeof REMINDER_SELECT }>;

export function seriesOfReminder(row: ReminderRow): SeriesShape {
  const m = row.meeting;
  return {
    startsAt: m.startsAt,
    endsAt: m.endsAt,
    allDay: m.allDay,
    timeZone: m.timeZone,
    rrule: m.rrule,
    exdates: m.exdates,
    overrides: m.overrides,
  };
}

/**
 * The first ring time after `afterMs` (start of the next live occurrence
 * minus the reminder's offset), or null when it never rings again or the
 * person may not get it (not in the meeting, declined, other organization).
 */
export function computeNextFireAt(row: ReminderRow, afterMs: number): Date | null {
  if (!reminderRecipientOk(row.meeting, row.user)) return null;
  const offset = row.minutesBefore * 60_000;
  try {
    const occ = nextOccurrenceAfter(seriesOfReminder(row), afterMs + offset);
    return occ ? new Date(occ.startsAt.getTime() - offset) : null;
  } catch {
    // A stored rule this build cannot read never rings.
    return null;
  }
}

/** A client or an interactive transaction of it. */
export interface ReminderStore {
  meetingReminder: PrismaService['client']['meetingReminder'];
}

/** Write `nextFireAt` for the given reminders when it changed. */
export async function writeNextFireAt(
  db: ReminderStore,
  rows: readonly ReminderRow[],
  afterMs: number,
): Promise<void> {
  for (const row of rows) {
    const next = computeNextFireAt(row, afterMs);
    if ((next?.getTime() ?? null) === (row.nextFireAt?.getTime() ?? null)) continue;
    await db.meetingReminder.update({ where: { id: row.id }, data: { nextFireAt: next } });
  }
}

/**
 * Recompute every reminder of these meetings (all people). Call after any
 * write that can move, add, cancel or silence an occurrence or a reminder.
 */
export async function refreshMeetingReminders(
  db: ReminderStore,
  meetingIds: string | readonly string[],
  now: Date = meetingClock.now(),
): Promise<void> {
  const ids = typeof meetingIds === 'string' ? [meetingIds] : [...new Set(meetingIds)];
  if (ids.length === 0) return;
  const rows = await db.meetingReminder.findMany({
    where: { meetingId: { in: ids } },
    select: REMINDER_SELECT,
  });
  await writeNextFireAt(db, rows, now.getTime() - REMINDER_GRACE_MS);
}
