import {
  createMeetingSchema,
  isHttpUrl,
  type CreateMeetingRequest,
  type Meeting,
  type MeetingEditScope,
  type MeetingFrequency,
  type MeetingPerson,
  type MeetingRecurrenceInput,
  type MeetingWeekday,
  type UpdateMeetingRequest,
} from '@botss/shared-types';
import { addMinutes } from 'date-fns';

import {
  addDaysField,
  fromZonedFields,
  localFields,
  toZonedFields,
  viewerTimeZone,
} from './meeting-time';

/**
 * Form state of the meeting dialog and its conversion to API requests. Pure
 * functions only: the dialog component holds no meeting rules.
 */

export type RepeatChoice = 'none' | MeetingFrequency;
export type RepeatEnd = 'never' | 'until' | 'count';

export interface ExternalGuest {
  email: string;
  name?: string;
}

export interface MeetingFormState {
  title: string;
  description: string;
  location: string;
  meetingUrl: string;
  allDay: boolean;
  /** `yyyy-MM-dd` in `timeZone`. For an all-day meeting `endDate` is the last day, inclusive. */
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timeZone: string;
  repeat: RepeatChoice;
  interval: number;
  byDay: MeetingWeekday[];
  endMode: RepeatEnd;
  untilDate: string;
  count: number;
  /** The series carries a rule richer than this editor (imported); it is kept, not edited. */
  richRecurrence: boolean;
  status: 'CONFIRMED' | 'TENTATIVE';
  color: string | null;
  leadId: string | null;
  clientId: string | null;
  projectId: string | null;
  people: MeetingPerson[];
  guests: ExternalGuest[];
  reminders: number[];
}

export type MeetingFormErrors = Partial<Record<keyof MeetingFormState | 'form', string>>;

export const WEEKDAYS: readonly MeetingWeekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
export const WEEKDAY_LABEL: Record<MeetingWeekday, string> = {
  MO: 'Mon',
  TU: 'Tue',
  WE: 'Wed',
  TH: 'Thu',
  FR: 'Fri',
  SA: 'Sat',
  SU: 'Sun',
};

export const MEETING_COLORS = [
  '#0ea5e9',
  '#6366f1',
  '#0d9488',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#64748b',
] as const;

/** The weekday code of a `yyyy-MM-dd` field. */
export function weekdayOfField(date: string): MeetingWeekday {
  const [y, m, d] = date.split('-').map(Number);
  const js = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getDay(); // 0 = Sunday
  return WEEKDAYS[(js + 6) % 7] ?? 'MO';
}

/** A blank form starting at `start` (local time), one hour long. */
export function blankForm(start: Date, reminders: number[], allDay = false): MeetingFormState {
  const timeZone = viewerTimeZone();
  const end = addMinutes(start, 60);
  const s = localFields(start);
  const e = localFields(end);
  return {
    title: '',
    description: '',
    location: '',
    meetingUrl: '',
    allDay,
    startDate: s.date,
    startTime: s.time,
    endDate: allDay ? s.date : e.date,
    endTime: e.time,
    timeZone,
    repeat: 'none',
    interval: 1,
    byDay: [weekdayOfField(s.date)],
    endMode: 'never',
    untilDate: '',
    count: 10,
    richRecurrence: false,
    status: 'CONFIRMED',
    color: null,
    leadId: null,
    clientId: null,
    projectId: null,
    people: [],
    guests: [],
    reminders,
  };
}

/** Round `d` up to the next quarter hour (a sensible default start). */
export function nextQuarterHour(d: Date): Date {
  const x = new Date(d);
  x.setSeconds(0, 0);
  const m = x.getMinutes();
  x.setMinutes(m + ((15 - (m % 15)) % 15 || 15));
  return x;
}

/**
 * Start and end of one occurrence of a series: the changed times when the
 * occurrence has an override, else the series length from `occurrenceStart`.
 */
export function occurrenceTimes(
  meeting: Meeting,
  occurrenceStart: Date | null,
): { start: Date; end: Date } {
  if (!occurrenceStart) return { start: meeting.startsAt, end: meeting.endsAt };
  const override = meeting.overrides.find(
    (o) => o.originalStart.getTime() === occurrenceStart.getTime(),
  );
  if (override) return { start: override.startsAt, end: override.endsAt };
  const length = meeting.endsAt.getTime() - meeting.startsAt.getTime();
  return { start: occurrenceStart, end: new Date(occurrenceStart.getTime() + length) };
}

export interface OccurrenceText {
  title: string;
  description: string;
  location: string;
  meetingUrl: string;
}

/**
 * Text fields of one occurrence: the override's value when it has one (null
 * means the series value, "" means empty), else the series value.
 */
export function occurrenceText(meeting: Meeting, occurrenceStart: Date | null): OccurrenceText {
  const override = occurrenceStart
    ? meeting.overrides.find((o) => o.originalStart.getTime() === occurrenceStart.getTime())
    : undefined;
  return {
    title: override?.title ?? meeting.title,
    description: override?.description ?? meeting.description ?? '',
    location: override?.location ?? meeting.location ?? '',
    meetingUrl: override?.meetingUrl ?? meeting.meetingUrl ?? '',
  };
}

/** Form for editing a meeting (or one occurrence of it). */
export function formFromMeeting(
  meeting: Meeting,
  times: { start: Date; end: Date },
  occurrenceStart: Date | null = null,
): MeetingFormState {
  const text = occurrenceText(meeting, occurrenceStart);
  const tz = meeting.timeZone;
  const s = toZonedFields(times.start, tz);
  // The stored end of an all-day meeting is exclusive; the form shows the last day.
  const e = toZonedFields(times.end, tz);
  const rec = meeting.recurrence;
  return {
    title: text.title,
    description: text.description,
    location: text.location,
    meetingUrl: text.meetingUrl,
    allDay: meeting.allDay,
    startDate: s.date,
    startTime: s.time,
    endDate: meeting.allDay ? addDaysField(e.date, -1) : e.date,
    endTime: e.time,
    timeZone: tz,
    repeat: rec ? rec.freq : 'none',
    interval: rec?.interval ?? 1,
    byDay: rec?.byDay ?? [weekdayOfField(s.date)],
    endMode: rec?.count ? 'count' : rec?.until ? 'until' : 'never',
    untilDate: rec?.until ? toZonedFields(rec.until, tz).date : '',
    count: rec?.count ?? 10,
    richRecurrence: !!meeting.rrule && !rec,
    status: meeting.status === 'TENTATIVE' ? 'TENTATIVE' : 'CONFIRMED',
    color: meeting.color,
    leadId: meeting.lead?.id ?? null,
    clientId: meeting.client?.id ?? null,
    projectId: meeting.project?.id ?? null,
    people: meeting.attendees
      .filter((a) => !a.external && a.userId)
      .map((a) => ({
        id: a.userId as string,
        name: a.name ?? a.email,
        email: a.email,
        image: a.image,
      })),
    guests: meeting.attendees
      .filter((a) => a.external)
      .map((a) => ({ email: a.email, ...(a.name ? { name: a.name } : {}) })),
    reminders: meeting.myReminders,
  };
}

interface Times {
  startsAt: Date;
  endsAt: Date;
}

/** The instants the form describes, or an error for the field that is wrong. */
export function formTimes(
  f: MeetingFormState,
): { ok: true; value: Times } | { ok: false; errors: MeetingFormErrors } {
  const errors: MeetingFormErrors = {};
  let startsAt: Date | null;
  let endsAt: Date | null;
  if (f.allDay) {
    startsAt = fromZonedFields(f.startDate, '00:00', f.timeZone);
    endsAt = fromZonedFields(addDaysField(f.endDate || f.startDate), '00:00', f.timeZone);
  } else {
    startsAt = fromZonedFields(f.startDate, f.startTime, f.timeZone);
    endsAt = fromZonedFields(f.endDate, f.endTime, f.timeZone);
  }
  if (!startsAt) errors.startDate = 'Pick a start date and time';
  if (!endsAt) errors.endDate = 'Pick an end date and time';
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    errors.endDate = 'The end must be after the start';
  }
  if (errors.startDate || errors.endDate || !startsAt || !endsAt) return { ok: false, errors };
  return { ok: true, value: { startsAt, endsAt } };
}

function recurrenceOf(f: MeetingFormState): MeetingRecurrenceInput | null {
  if (f.repeat === 'none') return null;
  const rule: MeetingRecurrenceInput = { freq: f.repeat, interval: f.interval };
  if (f.repeat === 'WEEKLY' && f.byDay.length > 0) rule.byDay = f.byDay;
  if (f.endMode === 'count') rule.count = f.count;
  if (f.endMode === 'until') {
    const until = fromZonedFields(f.untilDate, '23:59', f.timeZone);
    if (until) rule.until = until;
  }
  return rule;
}

/** Problems with the fields the schema cannot word well; empty when fine. */
export function validateForm(f: MeetingFormState): MeetingFormErrors {
  const errors: MeetingFormErrors = {};
  if (!f.title.trim()) errors.title = 'Give the meeting a title';
  const url = f.meetingUrl.trim();
  if (url && !isHttpUrl(url)) errors.meetingUrl = 'Use a link that starts with http:// or https://';
  const times = formTimes(f);
  if (!times.ok) Object.assign(errors, times.errors);
  if (f.repeat !== 'none') {
    if (!Number.isInteger(f.interval) || f.interval < 1 || f.interval > 99)
      errors.interval = 'Use a number from 1 to 99';
    if (f.repeat === 'WEEKLY' && f.byDay.length === 0) errors.byDay = 'Pick at least one weekday';
    if (f.endMode === 'count' && (!Number.isInteger(f.count) || f.count < 1 || f.count > 1000)) {
      errors.count = 'Use a number from 1 to 1000';
    }
    if (f.endMode === 'until') {
      const until = fromZonedFields(f.untilDate, '23:59', f.timeZone);
      if (!until) errors.untilDate = 'Pick the last day';
      else if (times.ok && until.getTime() < times.value.startsAt.getTime()) {
        errors.untilDate = 'The last day is before the first meeting';
      }
    }
  }
  return errors;
}

function attendeesOf(f: MeetingFormState) {
  return { userIds: f.people.map((p) => p.id), emails: f.guests };
}

/** Request to create the meeting; errors name the field when the form is not valid. */
export function buildCreateRequest(
  f: MeetingFormState,
  notifyAttendees: boolean,
): { ok: true; value: CreateMeetingRequest } | { ok: false; errors: MeetingFormErrors } {
  const errors = validateForm(f);
  const times = formTimes(f);
  if (Object.keys(errors).length > 0 || !times.ok) return { ok: false, errors };
  const request: CreateMeetingRequest = {
    title: f.title.trim(),
    description: f.description.trim() || null,
    location: f.location.trim() || null,
    meetingUrl: f.meetingUrl.trim() || null,
    startsAt: times.value.startsAt,
    endsAt: times.value.endsAt,
    allDay: f.allDay,
    timeZone: f.timeZone,
    recurrence: recurrenceOf(f),
    status: f.status,
    color: f.color,
    leadId: f.leadId,
    clientId: f.clientId,
    projectId: f.projectId,
    attendees: attendeesOf(f),
    reminders: f.reminders,
    notifyAttendees,
  };
  // The schema is the source of truth; surface whatever it still rejects.
  const parsed = createMeetingSchema.safeParse(request);
  if (!parsed.success) {
    return {
      ok: false,
      errors: { form: parsed.error.issues[0]?.message ?? 'Check the meeting details' },
    };
  }
  return { ok: true, value: request };
}

export interface UpdateContext {
  meeting: Meeting;
  /** Times the form was filled from (the occurrence being edited). */
  initial: { start: Date; end: Date };
  /** The occurrence being edited; null for a one-off meeting. */
  occurrenceStart: Date | null;
  scope: MeetingEditScope;
  notifyAttendees: boolean;
}

/** The text fields that differ from what the occurrence shows. */
export function changedText(
  text: {
    title: string;
    description: string | null;
    location: string | null;
    meetingUrl: string | null;
  },
  was: OccurrenceText,
): Partial<typeof text> {
  const changed: Partial<typeof text> = {};
  if (text.title !== was.title.trim()) changed.title = text.title;
  if ((text.description ?? '') !== was.description.trim()) changed.description = text.description;
  if ((text.location ?? '') !== was.location.trim()) changed.location = text.location;
  if ((text.meetingUrl ?? '') !== was.meetingUrl.trim()) changed.meetingUrl = text.meetingUrl;
  return changed;
}

/** Request to update: `this` changes the occurrence only, `all` shifts the series by the move. */
export function buildUpdateRequest(
  f: MeetingFormState,
  ctx: UpdateContext,
): { ok: true; value: UpdateMeetingRequest } | { ok: false; errors: MeetingFormErrors } {
  const errors = validateForm(f);
  const times = formTimes(f);
  if (Object.keys(errors).length > 0 || !times.ok) return { ok: false, errors };
  const base = {
    scope: ctx.scope,
    ...(ctx.occurrenceStart ? { occurrenceStart: ctx.occurrenceStart } : {}),
    notifyAttendees: ctx.notifyAttendees,
  };
  const text = {
    title: f.title.trim(),
    description: f.description.trim() || null,
    location: f.location.trim() || null,
    meetingUrl: f.meetingUrl.trim() || null,
  };
  if (ctx.scope === 'this') {
    // Only fields changed from what the occurrence shows, so later series edits still reach the rest.
    const was = occurrenceText(ctx.meeting, ctx.occurrenceStart);
    const changed = changedText(text, was);
    return {
      ok: true,
      value: { ...base, ...changed, startsAt: times.value.startsAt, endsAt: times.value.endsAt },
    };
  }
  let { startsAt, endsAt } = times.value;
  if (ctx.scope === 'all' && ctx.occurrenceStart) {
    const delta = startsAt.getTime() - ctx.initial.start.getTime();
    const length = endsAt.getTime() - startsAt.getTime();
    startsAt = new Date(ctx.meeting.startsAt.getTime() + delta);
    endsAt = new Date(startsAt.getTime() + length);
  }
  const value: UpdateMeetingRequest = {
    ...base,
    ...text,
    startsAt,
    endsAt,
    allDay: f.allDay,
    timeZone: f.timeZone,
    status: f.status,
    color: f.color,
    leadId: f.leadId,
    clientId: f.clientId,
    projectId: f.projectId,
    attendees: attendeesOf(f),
    ...(f.richRecurrence ? {} : { recurrence: recurrenceOf(f) }),
  };
  return { ok: true, value };
}

/** Request to move one meeting by dragging it to a new start (same length). */
export function buildMoveRequest(
  meeting: Meeting,
  occurrence: { start: Date; end: Date; occurrenceStart: Date },
  newStart: Date,
  scope: MeetingEditScope,
  notifyAttendees: boolean,
): UpdateMeetingRequest {
  const length = occurrence.end.getTime() - occurrence.start.getTime();
  const newEnd = new Date(newStart.getTime() + length);
  if (scope === 'all') {
    const delta = newStart.getTime() - occurrence.start.getTime();
    const startsAt = new Date(meeting.startsAt.getTime() + delta);
    return {
      scope,
      occurrenceStart: occurrence.occurrenceStart,
      startsAt,
      endsAt: new Date(
        startsAt.getTime() + (meeting.endsAt.getTime() - meeting.startsAt.getTime()),
      ),
      notifyAttendees,
    };
  }
  return {
    scope,
    occurrenceStart: occurrence.occurrenceStart,
    startsAt: newStart,
    endsAt: newEnd,
    notifyAttendees,
  };
}
