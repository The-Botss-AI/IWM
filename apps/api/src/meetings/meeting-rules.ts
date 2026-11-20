import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@botss/database';
import type { MeetingResponse, MeetingStatus } from '@botss/shared-types';

import type { UserScope } from '../common/decorators/user-scope.decorator';
import { utcToWall } from './time-zones';

/**
 * Who may see a meeting, in one place, plus the small pure helpers the
 * meetings services share. Kept free of Prisma calls so
 * `scripts/check-meetings.ts` can check the rules without a database.
 *
 * THE rule: a meeting is visible ONLY to its organizer and the internal
 * attendees added to it, and only inside its organization. No workspace
 * membership, admin role or platform role widens it; a caller without an
 * organization sees nothing. Every read path (list, get, calendar, feed,
 * reminders, snooze) composes `meetingVisibleWhere`.
 */

export interface MeetingViewer {
  userId: string;
  /** The caller's own organization; null sees nothing. */
  organizationId: string | null;
}

export interface MeetingActor extends MeetingViewer {
  name: string;
  email: string;
  /** Active workspace (context for links), if any. */
  workspaceId: string | null;
}

/** What the caller may link a meeting to, in the active workspace. */
export interface LinkAccess {
  userId: string;
  workspaceId: string;
  scope: UserScope;
  canReadLeads: boolean;
  fullLeads: boolean;
  canReadClients: boolean;
  fullClients: boolean;
  financeAccess: boolean;
  canReadProjects: boolean;
}

/** Meetings this viewer may read. Matches nothing without an organization. */
export function meetingVisibleWhere(viewer: MeetingViewer): Prisma.MeetingWhereInput {
  if (!viewer.organizationId) return { organizationId: '__none__' };
  return {
    organizationId: viewer.organizationId,
    deletedAt: null,
    OR: [{ organizerId: viewer.userId }, { attendees: { some: { userId: viewer.userId } } }],
  };
}

/** In-memory form of `meetingVisibleWhere` for an already loaded meeting. */
export function canSeeMeeting(
  viewer: MeetingViewer,
  meeting: {
    organizationId: string;
    organizerId: string;
    deletedAt: Date | null;
    attendees: readonly { userId: string | null }[];
  },
): boolean {
  if (!viewer.organizationId || meeting.organizationId !== viewer.organizationId) return false;
  if (meeting.deletedAt) return false;
  return (
    meeting.organizerId === viewer.userId ||
    meeting.attendees.some((a) => a.userId === viewer.userId)
  );
}

/**
 * May this person still get a reminder for this meeting: the meeting is live,
 * they are in its organization, and they are its organizer or an attendee
 * who has not declined.
 */
export function reminderRecipientOk(
  meeting: {
    organizationId: string;
    organizerId: string;
    deletedAt: Date | null;
    status: MeetingStatus;
    attendees: readonly { userId: string | null; response: MeetingResponse }[];
  },
  user: { id: string; organizationId: string | null; deletedAt: Date | null },
): boolean {
  if (meeting.deletedAt || meeting.status === 'CANCELLED') return false;
  if (user.deletedAt || user.organizationId !== meeting.organizationId) return false;
  if (meeting.organizerId === user.id) return true;
  const row = meeting.attendees.find((a) => a.userId === user.id);
  return !!row && row.response !== 'DECLINED';
}

// --------------------------------------------------------------- problems

export function meetingNotFound(): NotFoundException {
  return new NotFoundException({
    title: 'Meeting not found',
    status: 404,
    code: 'meeting_not_found',
  });
}

export function occurrenceNotFound(): NotFoundException {
  return new NotFoundException({
    title: 'Occurrence not found',
    status: 404,
    detail: 'That date is not part of this meeting.',
    code: 'meeting_occurrence_not_found',
  });
}

export function organizerOnly(): ForbiddenException {
  return new ForbiddenException({
    title: 'Only the organizer can do this',
    status: 403,
    detail: 'Only the person who organized this meeting can change it.',
    code: 'meeting_organizer_only',
  });
}

export function meetingCancelled(): ConflictException {
  return new ConflictException({
    title: 'Meeting cancelled',
    status: 409,
    detail: 'This meeting was cancelled.',
    code: 'meeting_cancelled',
  });
}

export function noOrganization(): ForbiddenException {
  return new ForbiddenException({
    title: 'No organization',
    status: 403,
    detail: 'Meetings need an organization account.',
    code: 'meeting_no_organization',
  });
}

export function badMeeting(detail: string, code: string): BadRequestException {
  return new BadRequestException({ title: 'Invalid meeting', status: 400, detail, code });
}

// --------------------------------------------------------------- formatting

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayLabel(ms: number, tz: string): string {
  const w = utcToWall(ms, tz);
  const dow = new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();
  return `${DAYS[dow]}, ${w.day} ${MONTHS[w.month - 1]} ${w.year}`;
}

function clock(ms: number, tz: string): string {
  const w = utcToWall(ms, tz);
  return `${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`;
}

/** "Mon, 2 Nov 2026, 09:00 - 10:00 (Europe/Berlin)" in the meeting's zone. */
export function formatWhen(start: Date, end: Date, allDay: boolean, tz: string): string {
  const s = start.getTime();
  const e = end.getTime();
  if (allDay) {
    const lastDay = e - 1;
    const first = dayLabel(s, tz);
    const last = dayLabel(lastDay, tz);
    return first === last ? `${first} (all day)` : `${first} - ${last} (all day)`;
  }
  const sameDay = dayLabel(s, tz) === dayLabel(e, tz);
  return sameDay
    ? `${dayLabel(s, tz)}, ${clock(s, tz)} - ${clock(e, tz)} (${tz})`
    : `${dayLabel(s, tz)}, ${clock(s, tz)} - ${dayLabel(e, tz)}, ${clock(e, tz)} (${tz})`;
}

/** "in 5 minutes", "in 1 hour", "in 2 days", "now". */
export function inHowLong(minutes: number): string {
  if (minutes <= 0) return 'now';
  if (minutes < 60 || (minutes % 60 !== 0 && minutes < 1440))
    return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return `in ${d} day${d === 1 ? '' : 's'}`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return `in ${h} hour${h === 1 ? '' : 's'}`;
  }
  return `in ${minutes} minutes`;
}

/** Reminder banner title: "<title> in N minutes". */
export function reminderTitle(title: string, minutesLeft: number): string {
  const when = inHowLong(minutesLeft);
  return when === 'now' ? `${title} is starting now` : `${title} ${when}`;
}

const FREQ_WORD: Record<string, [string, string]> = {
  DAILY: ['day', 'Daily'],
  WEEKLY: ['week', 'Weekly'],
  MONTHLY: ['month', 'Monthly'],
  YEARLY: ['year', 'Yearly'],
};

/** "Weekly", "Every 2 weeks" for an email or notification. */
export function describeRule(rrule: string | null): string | null {
  if (!rrule) return null;
  const freq = /FREQ=([A-Z]+)/.exec(rrule)?.[1] ?? '';
  const interval = Number(/INTERVAL=(\d+)/.exec(rrule)?.[1] ?? '1');
  const words = FREQ_WORD[freq];
  if (!words) return 'Repeats';
  return interval > 1 ? `Every ${interval} ${words[0]}s` : words[1];
}

/** Deep link of a meeting (and one occurrence) in the web app. */
export function meetingPath(meetingId: string, occurrenceStart?: Date | null): string {
  return occurrenceStart
    ? `/meetings/${meetingId}?occurrence=${encodeURIComponent(occurrenceStart.toISOString())}`
    : `/meetings/${meetingId}`;
}
