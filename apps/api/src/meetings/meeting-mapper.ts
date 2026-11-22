import type { Prisma } from '@botss/database';
import type { Meeting, MeetingLink, MeetingResponse } from '@botss/shared-types';

import { ruleToRecurrence, type SeriesShape } from './recurrence';
import type { IcsMeeting } from './ics-export';

/** What every single-meeting read and write loads. */
export const MEETING_INCLUDE = {
  organizer: { select: { id: true, name: true, email: true, image: true } },
  attendees: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      userId: true,
      email: true,
      name: true,
      response: true,
      respondedAt: true,
      user: { select: { name: true, image: true } },
    },
  },
  overrides: { orderBy: { originalStart: 'asc' } },
} satisfies Prisma.MeetingInclude;

export type MeetingRow = Prisma.MeetingGetPayload<{ include: typeof MEETING_INCLUDE }>;
export type MeetingAttendeeRow = MeetingRow['attendees'][number];

export function seriesOf(
  row: Pick<
    MeetingRow,
    'startsAt' | 'endsAt' | 'allDay' | 'timeZone' | 'rrule' | 'exdates' | 'overrides'
  >,
): SeriesShape {
  return {
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    allDay: row.allDay,
    timeZone: row.timeZone,
    rrule: row.rrule,
    exdates: row.exdates,
    overrides: row.overrides,
  };
}

export interface MeetingLinks {
  lead: MeetingLink | null;
  client: MeetingLink | null;
  project: MeetingLink | null;
}

export function myResponseIn(
  row: {
    organizerId: string;
    attendees: readonly { userId: string | null; response: MeetingResponse }[];
  },
  userId: string,
): MeetingResponse | null {
  if (row.organizerId === userId) return null;
  return row.attendees.find((a) => a.userId === userId)?.response ?? null;
}

/** The wire shape of one meeting for `viewerId`. */
export function toMeeting(
  row: MeetingRow,
  viewerId: string,
  myReminders: number[],
  links: MeetingLinks,
): Meeting {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    description: row.description,
    location: row.location,
    meetingUrl: row.meetingUrl,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    allDay: row.allDay,
    timeZone: row.timeZone,
    rrule: row.rrule,
    recurrence: ruleToRecurrence(row.rrule, row.timeZone),
    exdates: [...row.exdates].sort((a, b) => a.getTime() - b.getTime()),
    overrides: row.overrides.map((o) => ({
      originalStart: o.originalStart,
      startsAt: o.startsAt,
      endsAt: o.endsAt,
      title: o.title,
      description: o.description,
      location: o.location,
      meetingUrl: o.meetingUrl,
    })),
    status: row.status,
    color: row.color,
    source: row.source,
    sequence: row.sequence,
    organizer: {
      id: row.organizer.id,
      name: row.organizer.name,
      email: row.organizer.email,
      image: row.organizer.image,
    },
    isOrganizer: row.organizerId === viewerId,
    myResponse: myResponseIn(row, viewerId),
    myReminders: [...myReminders].sort((a, b) => a - b),
    attendees: row.attendees.map((a) => ({
      id: a.id,
      userId: a.userId,
      email: a.email,
      name: a.user?.name ?? a.name,
      image: a.user?.image ?? null,
      external: a.userId === null,
      response: a.response,
      respondedAt: a.respondedAt,
    })),
    lead: links.lead,
    client: links.client,
    project: links.project,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The iCalendar view of a meeting (invites and the feed). */
export function toIcsMeeting(row: MeetingRow): IcsMeeting {
  return {
    uid: row.icsUid,
    sequence: row.sequence,
    title: row.title,
    description: row.description,
    location: row.location,
    meetingUrl: row.meetingUrl,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    allDay: row.allDay,
    timeZone: row.timeZone,
    rrule: row.rrule,
    exdates: row.exdates,
    overrides: row.overrides,
    status: row.status,
    organizer: { email: row.organizer.email, name: row.organizer.name },
    attendees: row.attendees.map((a) => ({
      email: a.email,
      name: a.user?.name ?? a.name,
      response: a.response,
      external: a.userId === null,
    })),
    updatedAt: row.updatedAt,
  };
}
