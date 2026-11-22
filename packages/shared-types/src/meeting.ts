import { z } from 'zod';

import { linkToken } from './common/access-code.js';
import { cuid } from './common/id.js';

/* eslint-disable @typescript-eslint/no-redeclare */

/**
 * Meetings: one-off or recurring, with internal attendees (staff of the same
 * organization), external attendees (an email address with a login-free RSVP
 * link) and per-person reminders.
 *
 * Visibility rule every read path keeps: a meeting is visible ONLY to its
 * organizer and the internal attendees added to it, inside its organization.
 * Nothing here carries an organization id.
 *
 * Time: every instant on the wire is UTC (ISO 8601). `timeZone` is the IANA
 * zone a recurring series and the dates of an all-day meeting are anchored
 * in. An all-day meeting starts at 00:00 in that zone and its end is
 * exclusive (00:00 of the day after its last day).
 */

// ------------------------------------------------------------- constants

/** Reminder presets offered in the picker (minutes before the start). */
export const MEETING_REMINDER_PRESETS = [5, 10, 15, 20, 30, 60, 1440] as const;
/** A custom reminder is 1 minute to 28 days before the start. */
export const MEETING_REMINDER_MAX_MINUTES = 40_320;
export const MAX_MEETING_REMINDERS = 5;
/** Reminders for someone who never set their own defaults (Settings, user preferences). */
export const DEFAULT_MEETING_REMINDERS: readonly number[] = [10];
/** "Snooze" on a fired reminder rings again this many minutes later. */
export const MEETING_SNOOZE_MINUTES = 5;
/** `data.type` of a meeting reminder push: clients show Join and Snooze. */
export const MEETING_REMINDER_PUSH_TYPE = 'meeting-reminder' as const;
/** Android channel (mobile shell) for meeting reminders: high importance. */
export const MEETING_REMINDER_ANDROID_CHANNEL = 'meeting-reminders' as const;
/** .ics import limits. */
export const MEETING_ICS_MAX_BYTES = 2 * 1024 * 1024;
export const MEETING_ICS_MAX_EVENTS = 2000;
/** Longest range one list call may expand. */
export const MEETING_LIST_MAX_DAYS = 400;
export const MAX_MEETING_ATTENDEES = 300;
export const MAX_MEETING_EXTERNAL_ATTENDEES = 100;

// ----------------------------------------------------------------- enums

export const MeetingStatus = z.enum(['CONFIRMED', 'TENTATIVE', 'CANCELLED']);
export type MeetingStatus = z.infer<typeof MeetingStatus>;

export const MeetingSource = z.enum(['MANUAL', 'ICS']);
export type MeetingSource = z.infer<typeof MeetingSource>;

/** An attendee's answer (iCalendar PARTSTAT). */
export const MeetingResponse = z.enum(['NEEDS_ACTION', 'ACCEPTED', 'TENTATIVE', 'DECLINED']);
export type MeetingResponse = z.infer<typeof MeetingResponse>;

/** What a person can answer. */
export const MeetingRsvpAnswer = z.enum(['ACCEPTED', 'TENTATIVE', 'DECLINED']);
export type MeetingRsvpAnswer = z.infer<typeof MeetingRsvpAnswer>;

/** Which occurrences of a recurring meeting a change applies to. */
export const MeetingEditScope = z.enum(['all', 'this', 'following']);
export type MeetingEditScope = z.infer<typeof MeetingEditScope>;

export const MeetingWeekday = z.enum(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']);
export type MeetingWeekday = z.infer<typeof MeetingWeekday>;

export const MeetingFrequency = z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);
export type MeetingFrequency = z.infer<typeof MeetingFrequency>;

/** Video providers recognized in imported events. */
export const MeetingLinkProvider = z.enum(['google-meet', 'zoom', 'teams', 'webex']);
export type MeetingLinkProvider = z.infer<typeof MeetingLinkProvider>;

// ------------------------------------------------------------ primitives

/** True for an IANA zone name this runtime knows (`Asia/Karachi`, `UTC`). */
export function isValidIanaTimeZone(value: string): boolean {
  if (!/^(?:UTC|[A-Za-z][A-Za-z_-]*(?:\/[A-Za-z0-9_+-]+){1,2})$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const ianaTimeZone = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidIanaTimeZone, 'Use an IANA time zone such as Asia/Karachi');

/** True for an absolute http(s) URL. */
export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.length > 0;
  } catch {
    return false;
  }
}

export const meetingUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine(isHttpUrl, 'Use an http:// or https:// link');

export const meetingColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex string');

/** Minutes before the start: a preset or a custom value (1 to 40,320). */
export const reminderMinutesSchema = z.number().int().min(1).max(MEETING_REMINDER_MAX_MINUTES);

/** A person's reminders for one meeting (or their defaults): deduplicated, ascending. */
export const reminderMinutesListSchema = z
  .array(reminderMinutesSchema)
  .max(MAX_MEETING_REMINDERS)
  .transform((list) => [...new Set(list)].sort((a, b) => a - b));

const emailAddress = z.string().trim().toLowerCase().email().max(254);

const booleanQueryFlag = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true'));

// ------------------------------------------------------------ recurrence

/**
 * The recurrence a person can set in the app: DAILY, WEEKLY (optionally on
 * chosen weekdays), MONTHLY (on the start's day of the month) or YEARLY,
 * every `interval`, ending after `count` occurrences, at `until`, or never.
 * Imported series may carry richer rules; those come back with
 * `recurrence: null` and their raw `rrule`.
 */
export const meetingRecurrenceSchema = z
  .object({
    freq: MeetingFrequency,
    interval: z.number().int().min(1).max(99).default(1),
    byDay: z.array(MeetingWeekday).min(1).max(7).optional(),
    count: z.number().int().min(1).max(1000).optional(),
    until: z.coerce.date().optional(),
  })
  .superRefine((r, ctx) => {
    if (r.count !== undefined && r.until !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['until'],
        message: 'Set either an end date or a number of occurrences, not both',
      });
    }
    if (r.byDay !== undefined && r.freq !== 'WEEKLY') {
      ctx.addIssue({
        code: 'custom',
        path: ['byDay'],
        message: 'Weekdays apply to weekly meetings only',
      });
    }
  });
export type MeetingRecurrence = z.infer<typeof meetingRecurrenceSchema>;
export type MeetingRecurrenceInput = z.input<typeof meetingRecurrenceSchema>;

// ---------------------------------------------------------------- inputs

/**
 * Attendees. `userIds` are staff of the caller's organization (anyone else is
 * refused); `emails` are external guests. An address that belongs to a staff
 * member of the organization is added as that person.
 */
export const meetingAttendeesInputSchema = z.object({
  userIds: z.array(cuid).max(MAX_MEETING_ATTENDEES).default([]),
  emails: z
    .array(
      z.object({
        email: emailAddress,
        name: z.string().trim().min(1).max(120).optional(),
      }),
    )
    .max(MAX_MEETING_EXTERNAL_ATTENDEES)
    .default([]),
});
export type MeetingAttendeesInput = z.infer<typeof meetingAttendeesInputSchema>;

/** One-line text: any line break (CRLF, CR, LF) becomes a space. */
const singleLine = (v: string) => v.replace(/\r\n?|\n/g, ' ');
/** Multi-line text: CRLF and a lone CR become LF, the only line break stored. */
const unixLines = (v: string) => v.replace(/\r\n?/g, '\n');

const meetingFields = {
  title: z.string().overwrite(singleLine).trim().min(1).max(200),
  description: z.string().overwrite(unixLines).max(10_000).nullable(),
  location: z.string().overwrite(singleLine).trim().max(500).nullable(),
  meetingUrl: meetingUrlSchema.nullable(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  allDay: z.boolean(),
  timeZone: ianaTimeZone,
  recurrence: meetingRecurrenceSchema.nullable(),
  /** CANCELLED goes through the cancel endpoint. */
  status: z.enum(['CONFIRMED', 'TENTATIVE']),
  color: meetingColorSchema.nullable(),
  /** Optional links. Each must be in the active workspace and visible to the caller. */
  leadId: cuid.nullable(),
  clientId: cuid.nullable(),
  projectId: cuid.nullable(),
};

/**
 * Create a meeting. For an all-day meeting the server snaps `startsAt` down
 * and `endsAt` up to 00:00 in `timeZone`. `reminders` are the organizer's
 * own; omitted means their default reminders (Settings, user preferences).
 * `notifyAttendees: false` adds people without notifications or emails.
 */
export const createMeetingSchema = z
  .object({
    title: meetingFields.title,
    description: meetingFields.description.optional(),
    location: meetingFields.location.optional(),
    meetingUrl: meetingFields.meetingUrl.optional(),
    startsAt: meetingFields.startsAt,
    endsAt: meetingFields.endsAt,
    allDay: meetingFields.allDay.default(false),
    timeZone: meetingFields.timeZone,
    recurrence: meetingFields.recurrence.optional(),
    status: meetingFields.status.default('CONFIRMED'),
    color: meetingFields.color.optional(),
    leadId: meetingFields.leadId.optional(),
    clientId: meetingFields.clientId.optional(),
    projectId: meetingFields.projectId.optional(),
    attendees: meetingAttendeesInputSchema.default({ userIds: [], emails: [] }),
    reminders: reminderMinutesListSchema.optional(),
    notifyAttendees: z.boolean().default(true),
  })
  .refine((v) => v.endsAt.getTime() > v.startsAt.getTime(), {
    path: ['endsAt'],
    message: 'The end must be after the start',
  });
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;
export type CreateMeetingRequest = z.input<typeof createMeetingSchema>;

/**
 * Change a meeting (organizer only). On a recurring meeting `scope` picks
 * the occurrences: `all` (the series), `this` (one occurrence, named by its
 * `occurrenceStart`) or `following` (that occurrence and every later one,
 * which splits the series). `this` may change only title, description,
 * location, meetingUrl, startsAt and endsAt. `attendees` replaces the list.
 */
export const updateMeetingSchema = z
  .object({
    scope: MeetingEditScope.default('all'),
    occurrenceStart: z.coerce.date().optional(),
    title: meetingFields.title.optional(),
    description: meetingFields.description.optional(),
    location: meetingFields.location.optional(),
    meetingUrl: meetingFields.meetingUrl.optional(),
    startsAt: meetingFields.startsAt.optional(),
    endsAt: meetingFields.endsAt.optional(),
    allDay: meetingFields.allDay.optional(),
    timeZone: meetingFields.timeZone.optional(),
    recurrence: meetingFields.recurrence.optional(),
    status: meetingFields.status.optional(),
    color: meetingFields.color.optional(),
    leadId: meetingFields.leadId.optional(),
    clientId: meetingFields.clientId.optional(),
    projectId: meetingFields.projectId.optional(),
    attendees: meetingAttendeesInputSchema.optional(),
    notifyAttendees: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.scope !== 'all' && !v.occurrenceStart) {
      ctx.addIssue({
        code: 'custom',
        path: ['occurrenceStart'],
        message: 'Pick the occurrence to change',
      });
    }
    if (v.startsAt && v.endsAt && v.endsAt.getTime() <= v.startsAt.getTime()) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'The end must be after the start',
      });
    }
    if (v.scope === 'this') {
      for (const key of [
        'allDay',
        'timeZone',
        'recurrence',
        'status',
        'color',
        'leadId',
        'clientId',
        'projectId',
        'attendees',
      ] as const) {
        if (v[key] !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'Change this for the whole series instead',
          });
        }
      }
    }
  });
export type UpdateMeetingInput = z.infer<typeof updateMeetingSchema>;
export type UpdateMeetingRequest = z.input<typeof updateMeetingSchema>;

/** Cancel a meeting, one occurrence, or an occurrence and the rest of the series. */
export const cancelMeetingSchema = z
  .object({
    scope: MeetingEditScope.default('all'),
    occurrenceStart: z.coerce.date().optional(),
    notifyAttendees: z.boolean().default(true),
  })
  .refine((v) => v.scope === 'all' || !!v.occurrenceStart, {
    path: ['occurrenceStart'],
    message: 'Pick the occurrence to cancel',
  });
export type CancelMeetingInput = z.infer<typeof cancelMeetingSchema>;
export type CancelMeetingRequest = z.input<typeof cancelMeetingSchema>;

/** DELETE /meetings/:id query: a live meeting is cancelled for everyone first unless false. */
export const deleteMeetingQuerySchema = z.object({
  notifyAttendees: booleanQueryFlag.default(true),
});
export type DeleteMeetingQuery = z.infer<typeof deleteMeetingQuerySchema>;

/** `{ ok: true }` answers (delete, revoke). */
export const meetingOkSchema = z.object({ ok: z.literal(true) });

/** An internal attendee's own answer (the whole series). */
export const meetingRsvpSchema = z.object({ response: MeetingRsvpAnswer });
export type MeetingRsvpInput = z.infer<typeof meetingRsvpSchema>;

/** Replace the caller's own reminders for one meeting. */
export const setMeetingRemindersSchema = z.object({ minutesBefore: reminderMinutesListSchema });
export type SetMeetingRemindersInput = z.infer<typeof setMeetingRemindersSchema>;

/** List the caller's meeting occurrences in [from, to] (at most 400 days). */
export const listMeetingsQuerySchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    includeCancelled: booleanQueryFlag.optional(),
  })
  .refine((q) => q.to.getTime() > q.from.getTime(), {
    path: ['to'],
    message: 'The end must be after the start',
  })
  .refine((q) => q.to.getTime() - q.from.getTime() <= MEETING_LIST_MAX_DAYS * 86_400_000, {
    path: ['to'],
    message: `Pick a range of at most ${MEETING_LIST_MAX_DAYS} days`,
  });
export type ListMeetingsQuery = z.infer<typeof listMeetingsQuerySchema>;

/** Attendee picker source: active staff of my organization, or of one of its workspaces. */
export const attendeeCandidatesQuerySchema = z.object({
  workspaceId: cuid.optional(),
  search: z.string().trim().max(100).optional(),
});
export type AttendeeCandidatesQuery = z.infer<typeof attendeeCandidatesQuerySchema>;

// --------------------------------------------------------------- outputs

export const meetingPersonSchema = z.object({
  id: cuid,
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
});
export type MeetingPerson = z.infer<typeof meetingPersonSchema>;

export const meetingAttendeeSchema = z.object({
  id: cuid,
  /** Set for internal attendees. */
  userId: cuid.nullable(),
  email: z.string(),
  name: z.string().nullable(),
  image: z.string().nullable(),
  external: z.boolean(),
  response: MeetingResponse,
  respondedAt: z.coerce.date().nullable(),
});
export type MeetingAttendee = z.infer<typeof meetingAttendeeSchema>;

/** One changed occurrence of a series. Null text inherits; "" clears. */
export const meetingOccurrenceOverrideSchema = z.object({
  originalStart: z.coerce.date(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  meetingUrl: z.string().nullable(),
});
export type MeetingOccurrenceOverride = z.infer<typeof meetingOccurrenceOverrideSchema>;

/** A linked record. `name` is null when the viewer cannot see that record. */
export const meetingLinkSchema = z.object({ id: cuid, name: z.string().nullable() });
export type MeetingLink = z.infer<typeof meetingLinkSchema>;

export const meetingSchema = z.object({
  id: cuid,
  workspaceId: cuid.nullable(),
  title: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  meetingUrl: z.string().nullable(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  allDay: z.boolean(),
  timeZone: z.string(),
  /** Raw RRULE (no `RRULE:` prefix), null for a one-off meeting. */
  rrule: z.string().nullable(),
  /** The rule in the app's editable shape; null when one-off or richer than the editor. */
  recurrence: meetingRecurrenceSchema.nullable(),
  exdates: z.array(z.coerce.date()),
  overrides: z.array(meetingOccurrenceOverrideSchema),
  status: MeetingStatus,
  color: z.string().nullable(),
  source: MeetingSource,
  sequence: z.number().int(),
  organizer: meetingPersonSchema,
  isOrganizer: z.boolean(),
  /** The caller's answer; null for the organizer. */
  myResponse: MeetingResponse.nullable(),
  /** The caller's own reminders (minutes before), ascending. */
  myReminders: z.array(z.number().int()),
  attendees: z.array(meetingAttendeeSchema),
  lead: meetingLinkSchema.nullable(),
  client: meetingLinkSchema.nullable(),
  project: meetingLinkSchema.nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Meeting = z.infer<typeof meetingSchema>;

/** One occurrence in a list or calendar range. */
export const meetingOccurrenceSchema = z.object({
  meetingId: cuid,
  /** The occurrence's start in the series (its key for `this` / `following`). */
  occurrenceStart: z.coerce.date(),
  /** Actual times, after any change to this occurrence. */
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  title: z.string(),
  location: z.string().nullable(),
  meetingUrl: z.string().nullable(),
  allDay: z.boolean(),
  timeZone: z.string(),
  status: MeetingStatus,
  color: z.string().nullable(),
  isRecurring: z.boolean(),
  /** This occurrence was changed on its own. */
  isException: z.boolean(),
  isOrganizer: z.boolean(),
  myResponse: MeetingResponse.nullable(),
  organizer: meetingPersonSchema,
  attendeeCount: z.number().int().nonnegative(),
});
export type MeetingOccurrence = z.infer<typeof meetingOccurrenceSchema>;

export const meetingListResponseSchema = z.object({
  items: z.array(meetingOccurrenceSchema),
  /** True when the range held more occurrences than one response returns. */
  truncated: z.boolean(),
});
export type MeetingListResponse = z.infer<typeof meetingListResponseSchema>;

export const attendeeCandidatesResponseSchema = z.object({
  items: z.array(meetingPersonSchema),
  truncated: z.boolean(),
});
export type AttendeeCandidatesResponse = z.infer<typeof attendeeCandidatesResponseSchema>;

export const meetingRemindersResponseSchema = z.object({
  minutesBefore: z.array(z.number().int()),
});
export type MeetingRemindersResponse = z.infer<typeof meetingRemindersResponseSchema>;

export const meetingSnoozeResponseSchema = z.object({ snoozedUntil: z.coerce.date() });
export type MeetingSnoozeResponse = z.infer<typeof meetingSnoozeResponseSchema>;

/** Result of create/update/cancel: the series that now holds the change. */
export const meetingMutationResponseSchema = z.object({
  meeting: meetingSchema.nullable(),
  /** Set when `following` split the series: the new series' id. */
  newMeetingId: cuid.nullable(),
});
export type MeetingMutationResponse = z.infer<typeof meetingMutationResponseSchema>;

/**
 * `data` of a MEETING_REMINDER push (Web Push, Expo, desktop socket). Clients
 * show Join (when `meetingUrl` is set) and Snooze, which posts to
 * `/meetings/reminder-deliveries/<deliveryId>/snooze`.
 */
export const meetingReminderPushDataSchema = z.object({
  type: z.literal(MEETING_REMINDER_PUSH_TYPE),
  meetingId: cuid,
  occurrenceStart: z.string(),
  meetingUrl: z.string().nullable(),
  snooze: z.object({ deliveryId: cuid, minutes: z.number().int() }),
});
export type MeetingReminderPushData = z.infer<typeof meetingReminderPushDataSchema>;

// ------------------------------------------------------------ ICS import

/** Multipart field `selection` of POST /meetings/import (JSON text). */
export const icsImportSelectionSchema = z.union([
  z.object({ all: z.literal(true) }).strict(),
  z
    .object({ uids: z.array(z.string().min(1).max(512)).min(1).max(MEETING_ICS_MAX_EVENTS) })
    .strict(),
]);
export type IcsImportSelection = z.infer<typeof icsImportSelectionSchema>;

/** The multipart text field, parsed. */
export const icsImportSelectionFieldSchema = z
  .string()
  .max(1_200_000)
  .transform((raw, ctx) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Selection must be JSON' });
      return z.NEVER;
    }
  })
  .pipe(icsImportSelectionSchema);

export const icsImportEventSchema = z.object({
  uid: z.string(),
  title: z.string(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  allDay: z.boolean(),
  timeZone: z.string(),
  recurring: z.boolean(),
  rrule: z.string().nullable(),
  location: z.string().nullable(),
  /** A video link found in URL, LOCATION or DESCRIPTION. */
  meetingUrl: z.string().nullable(),
  meetingProvider: MeetingLinkProvider.nullable(),
  /** Reminders (minutes before) from the event's alarms. */
  reminders: z.array(z.number().int()),
  /** A meeting with this UID is already in your calendar. */
  alreadyImported: z.boolean(),
  /** False when this event cannot be imported; `problem` says why. */
  importable: z.boolean(),
  problem: z.string().nullable(),
});
export type IcsImportEvent = z.infer<typeof icsImportEventSchema>;

export const icsImportPreviewSchema = z.object({
  calendarName: z.string().nullable(),
  events: z.array(icsImportEventSchema),
  /** Events in the file that could not be read and are not listed. */
  unreadable: z.number().int().nonnegative(),
});
export type IcsImportPreview = z.infer<typeof icsImportPreviewSchema>;

export const icsImportResultSchema = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  /** Already imported at the same or a newer SEQUENCE. */
  unchanged: z.number().int().nonnegative(),
  /** Selected but not importable. */
  skipped: z.number().int().nonnegative(),
  meetingIds: z.array(cuid),
});
export type IcsImportResult = z.infer<typeof icsImportResultSchema>;

// ------------------------------------------------------------ calendar feed

export const meetingFeedStatusSchema = z.object({
  active: z.boolean(),
  createdAt: z.coerce.date().nullable(),
  lastUsedAt: z.coerce.date().nullable(),
});
export type MeetingFeedStatus = z.infer<typeof meetingFeedStatusSchema>;

/** Returned once, when the link is made: the raw token is never stored. */
export const meetingFeedLinkSchema = z.object({
  url: z.string(),
  webcalUrl: z.string(),
  createdAt: z.coerce.date(),
});
export type MeetingFeedLink = z.infer<typeof meetingFeedLinkSchema>;

/** `<token>.ics` path segment of the feed. */
export const meetingFeedFileSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}\.ics$/, 'Invalid link')
  .transform((v) => v.slice(0, -4));

// ------------------------------------------------------------ public RSVP

export const meetingRsvpToken = linkToken;

/** What an RSVP link reveals: that one meeting's title and time, nothing else. */
export const publicMeetingRsvpSchema = z.object({
  title: z.string(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  allDay: z.boolean(),
  timeZone: z.string(),
  recurring: z.boolean(),
  cancelled: z.boolean(),
  response: MeetingResponse,
});
export type PublicMeetingRsvp = z.infer<typeof publicMeetingRsvpSchema>;

// ------------------------------------------------------------ calendar events

/** `meta` of a calendar event of type `meeting` (GET /calendar/events). */
export const calendarMeetingMetaSchema = z.object({
  meetingId: cuid,
  occurrenceStart: z.coerce.date(),
  allDay: z.boolean(),
  timeZone: z.string(),
  status: MeetingStatus,
  location: z.string().nullable(),
  meetingUrl: z.string().nullable(),
  isRecurring: z.boolean(),
  isOrganizer: z.boolean(),
  myResponse: MeetingResponse.nullable(),
});
export type CalendarMeetingMeta = z.infer<typeof calendarMeetingMetaSchema>;
