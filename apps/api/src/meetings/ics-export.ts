import ICAL from 'ical.js';
import type { MeetingResponse, MeetingStatus } from '@botss/shared-types';

import { utcToWall, zoneOffsetMs, zoneTransitions } from './time-zones';
import type { OverrideShape } from './recurrence';

/**
 * iCalendar output built with ical.js (escaping and line folding included):
 * invitations (METHOD:REQUEST / CANCEL) and the private feed (PUBLISH).
 *
 * Times: an all-day meeting uses DATE values in its zone; a recurring timed
 * meeting uses TZID local times plus a generated VTIMEZONE, so DST is right
 * in every client; a one-off timed meeting is written in UTC. Pure.
 */

type IcalComponent = InstanceType<typeof ICAL.Component>;

export interface IcsPerson {
  email: string;
  name: string | null;
}

export interface IcsAttendee extends IcsPerson {
  response: MeetingResponse;
  /** A guest outside the organization (email + RSVP link). */
  external: boolean;
}

export interface IcsMeeting {
  uid: string;
  sequence: number;
  title: string;
  description: string | null;
  location: string | null;
  meetingUrl: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  timeZone: string;
  rrule: string | null;
  exdates: readonly Date[];
  overrides: readonly OverrideShape[];
  status: MeetingStatus;
  organizer: IcsPerson;
  attendees: readonly IcsAttendee[];
  updatedAt: Date;
}

export type IcsMethod = 'REQUEST' | 'CANCEL' | 'PUBLISH';

const PRODID = '-//The Botss//Meetings//EN';

/**
 * Text for a TEXT property: CRLF and lone CR become LF (which ical.js
 * escapes as \n), every other control character is dropped, so no value can
 * end a content line and start a property of its own.
 */
export function icsText(value: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
}

const PARTSTAT: Record<MeetingResponse, string> = {
  NEEDS_ACTION: 'NEEDS-ACTION',
  ACCEPTED: 'ACCEPTED',
  TENTATIVE: 'TENTATIVE',
  DECLINED: 'DECLINED',
};

function newCalendar(method: IcsMethod, name?: string): IcalComponent {
  const cal = new ICAL.Component(['vcalendar', [], []]);
  cal.addPropertyWithValue('prodid', PRODID);
  cal.addPropertyWithValue('version', '2.0');
  cal.addPropertyWithValue('calscale', 'GREGORIAN');
  cal.addPropertyWithValue('method', method);
  if (name) {
    cal.addPropertyWithValue('x-wr-calname', icsText(name));
  }
  return cal;
}

function utcTime(ms: number) {
  return ICAL.Time.fromJSDate(new Date(ms), true);
}

function usesTzid(m: Pick<IcsMeeting, 'allDay' | 'rrule' | 'timeZone'>): boolean {
  return !m.allDay && m.rrule !== null && m.timeZone !== 'UTC';
}

/** A time value for DTSTART / DTEND / EXDATE / RECURRENCE-ID of this meeting. */
function timeValue(m: Pick<IcsMeeting, 'allDay' | 'rrule' | 'timeZone'>, ms: number) {
  if (m.allDay) {
    const w = utcToWall(ms, m.timeZone);
    return ICAL.Time.fromData({ year: w.year, month: w.month, day: w.day, isDate: true });
  }
  if (usesTzid(m)) {
    const w = utcToWall(ms, m.timeZone);
    return ICAL.Time.fromData({
      year: w.year,
      month: w.month,
      day: w.day,
      hour: w.hour,
      minute: w.minute,
      second: w.second,
    });
  }
  return utcTime(ms);
}

function addTime(
  comp: IcalComponent,
  name: string,
  m: Pick<IcsMeeting, 'allDay' | 'rrule' | 'timeZone'>,
  values: number[],
): void {
  const prop = new ICAL.Property(name);
  if (usesTzid(m)) prop.setParameter('tzid', m.timeZone);
  if (values.length === 1) prop.setValue(timeValue(m, values[0]!));
  else prop.setValues(values.map((v) => timeValue(m, v)));
  comp.addProperty(prop);
}

function mailto(email: string): string {
  return `mailto:${email}`;
}

function addPerson(
  comp: IcalComponent,
  name: 'organizer' | 'attendee',
  person: IcsPerson,
  extra: Record<string, string> = {},
): void {
  const prop = new ICAL.Property(name);
  if (person.name) prop.setParameter('cn', person.name.replace(/["\r\n]/g, ' ').slice(0, 120));
  for (const [k, v] of Object.entries(extra)) prop.setParameter(k, v);
  prop.setValue(mailto(person.email));
  comp.addProperty(prop);
}

/** Description text: the meeting's own, plus the join link. */
function descriptionText(description: string | null, meetingUrl: string | null): string | null {
  const parts: string[] = [];
  if (description && description.trim()) parts.push(description.trim());
  if (meetingUrl) parts.push(`Join: ${meetingUrl}`);
  return parts.length > 0 ? parts.join('\n\n') : null;
}

/**
 * A VTIMEZONE for an IANA zone, listing every offset change from the year
 * before the meeting starts to five years past now (or past its start, when
 * that is later), one observance per change, no rules, which every client
 * reads. A series that started years ago is still covered today.
 */
const vtimezoneCache = new Map<string, IcalComponent>();

export function buildVtimezone(
  zone: string,
  aroundMs: number,
  nowMs: number = Date.now(),
): IcalComponent {
  const startYear = new Date(aroundMs).getUTCFullYear();
  const fromYear = startYear - 1;
  const toYear = Math.max(startYear, new Date(nowMs).getUTCFullYear()) + 5;
  const key = `${zone}|${fromYear}|${toYear}`;
  const hit = vtimezoneCache.get(key);
  if (hit) return new ICAL.Component(hit.toJSON());
  const fromMs = Date.UTC(fromYear, 0, 1);
  const toMs = Date.UTC(toYear + 1, 0, 1);
  const transitions = zoneTransitions(zone, fromMs, toMs);
  const initial = zoneOffsetMs(zone, fromMs);
  const offsets = [initial, ...transitions.map((t) => t.toOffsetMs)];
  const standard = Math.min(...offsets);

  const tz = new ICAL.Component('vtimezone');
  tz.addPropertyWithValue('tzid', zone);
  const observance = (atLocalMs: number, from: number, to: number) => {
    const sub = new ICAL.Component(to === standard ? 'standard' : 'daylight');
    const w = new Date(atLocalMs);
    sub.addPropertyWithValue(
      'dtstart',
      ICAL.Time.fromData({
        year: w.getUTCFullYear(),
        month: w.getUTCMonth() + 1,
        day: w.getUTCDate(),
        hour: w.getUTCHours(),
        minute: w.getUTCMinutes(),
        second: w.getUTCSeconds(),
      }),
    );
    sub.addPropertyWithValue('tzoffsetfrom', ICAL.UtcOffset.fromSeconds(Math.round(from / 1000)));
    sub.addPropertyWithValue('tzoffsetto', ICAL.UtcOffset.fromSeconds(Math.round(to / 1000)));
    tz.addSubcomponent(sub);
  };
  observance(fromMs + initial, initial, initial);
  for (const t of transitions) observance(t.at + t.fromOffsetMs, t.fromOffsetMs, t.toOffsetMs);
  vtimezoneCache.set(key, tz);
  return new ICAL.Component(tz.toJSON());
}

interface EventOptions {
  method: IcsMethod;
  /** REQUEST/CANCEL: who the copy is for (gets RSVP=TRUE). */
  recipientEmail?: string;
  /** PUBLISH: the reader's reminders (minutes before). */
  alarms?: readonly number[];
  /** DTSTAMP. */
  now: number;
}

function baseEvent(m: IcsMeeting, opts: EventOptions): IcalComponent {
  const ev = new ICAL.Component('vevent');
  ev.addPropertyWithValue('uid', m.uid);
  ev.addPropertyWithValue('dtstamp', utcTime(opts.now));
  ev.addPropertyWithValue('sequence', m.sequence);
  ev.addPropertyWithValue('last-modified', utcTime(m.updatedAt.getTime()));
  return ev;
}

function addCommonFields(
  ev: IcalComponent,
  m: IcsMeeting,
  fields: {
    title: string;
    description: string | null;
    location: string | null;
    meetingUrl: string | null;
  },
  opts: EventOptions,
): void {
  ev.addPropertyWithValue('summary', icsText(fields.title));
  const desc = descriptionText(fields.description, fields.meetingUrl);
  if (desc) ev.addPropertyWithValue('description', icsText(desc));
  if (fields.location) ev.addPropertyWithValue('location', icsText(fields.location));
  if (fields.meetingUrl) ev.addPropertyWithValue('url', icsText(fields.meetingUrl));
  ev.addPropertyWithValue(
    'status',
    m.status === 'CANCELLED' || opts.method === 'CANCEL'
      ? 'CANCELLED'
      : m.status === 'TENTATIVE'
        ? 'TENTATIVE'
        : 'CONFIRMED',
  );
  if (opts.method !== 'PUBLISH') {
    addPerson(ev, 'organizer', m.organizer);
    for (const a of attendeesFor(m, opts)) {
      const isRecipient = !!opts.recipientEmail && a.email === opts.recipientEmail;
      addPerson(ev, 'attendee', a, {
        role: 'REQ-PARTICIPANT',
        partstat: PARTSTAT[a.response],
        ...(isRecipient && opts.method === 'REQUEST' ? { rsvp: 'TRUE' } : {}),
      });
    }
  } else {
    addPerson(ev, 'organizer', m.organizer);
    for (const minutes of opts.alarms ?? []) {
      const alarm = new ICAL.Component('valarm');
      alarm.addPropertyWithValue('action', 'DISPLAY');
      alarm.addPropertyWithValue('description', icsText(fields.title));
      alarm.addPropertyWithValue('trigger', ICAL.Duration.fromSeconds(-minutes * 60));
      ev.addSubcomponent(alarm);
    }
  }
}

/**
 * Who an invitation lists. A copy for an external guest names only the
 * organizer and that guest: the addresses of the staff and of the other
 * guests are not theirs to see. Anyone else (and the feed) gets the list.
 */
function attendeesFor(m: IcsMeeting, opts: EventOptions): readonly IcsAttendee[] {
  if (!opts.recipientEmail) return m.attendees;
  const recipient = m.attendees.find((a) => a.email === opts.recipientEmail);
  if (recipient && !recipient.external) return m.attendees;
  return [
    recipient ?? {
      email: opts.recipientEmail,
      name: null,
      response: 'NEEDS_ACTION',
      external: true,
    },
  ];
}

function masterEvent(m: IcsMeeting, opts: EventOptions): IcalComponent {
  const ev = baseEvent(m, opts);
  addTime(ev, 'dtstart', m, [m.startsAt.getTime()]);
  addTime(ev, 'dtend', m, [m.endsAt.getTime()]);
  if (m.rrule) {
    ev.addPropertyWithValue('rrule', ICAL.Recur.fromString(m.rrule));
    if (m.exdates.length > 0) {
      addTime(
        ev,
        'exdate',
        m,
        [...m.exdates].map((d) => d.getTime()).sort((a, b) => a - b),
      );
    }
  }
  addCommonFields(ev, m, m, opts);
  return ev;
}

function overrideEvent(m: IcsMeeting, o: OverrideShape, opts: EventOptions): IcalComponent {
  const ev = baseEvent(m, opts);
  addTime(ev, 'recurrence-id', m, [o.originalStart.getTime()]);
  addTime(ev, 'dtstart', m, [o.startsAt.getTime()]);
  addTime(ev, 'dtend', m, [o.endsAt.getTime()]);
  const pick = (own: string | null, series: string | null) =>
    own === null ? series : own === '' ? null : own;
  addCommonFields(
    ev,
    m,
    {
      title: o.title !== null && o.title !== '' ? o.title : m.title,
      description: pick(o.description, m.description),
      location: pick(o.location, m.location),
      meetingUrl: pick(o.meetingUrl, m.meetingUrl),
    },
    opts,
  );
  return ev;
}

function addZones(cal: IcalComponent, meetings: readonly IcsMeeting[], now: number): void {
  // One VTIMEZONE per zone, wide enough for the earliest series in it.
  const earliest = new Map<string, number>();
  for (const m of meetings) {
    if (!usesTzid(m)) continue;
    const at = m.startsAt.getTime();
    earliest.set(m.timeZone, Math.min(earliest.get(m.timeZone) ?? at, at));
  }
  for (const [zone, at] of earliest) cal.addSubcomponent(buildVtimezone(zone, at, now));
}

/** An invitation or update (METHOD:REQUEST): the series and its changed occurrences. */
export function buildRequestIcs(m: IcsMeeting, recipientEmail: string, now = Date.now()): string {
  const cal = newCalendar('REQUEST');
  addZones(cal, [m], now);
  const opts: EventOptions = { method: 'REQUEST', recipientEmail, now };
  cal.addSubcomponent(masterEvent(m, opts));
  if (m.rrule) for (const o of m.overrides) cal.addSubcomponent(overrideEvent(m, o, opts));
  return cal.toString();
}

/**
 * A cancellation (METHOD:CANCEL) of the whole meeting, or of one occurrence
 * when `occurrenceStart` is set.
 */
export function buildCancelIcs(
  m: IcsMeeting,
  recipientEmail: string,
  occurrenceStart: Date | null = null,
  now = Date.now(),
): string {
  const cal = newCalendar('CANCEL');
  addZones(cal, [m], now);
  const opts: EventOptions = { method: 'CANCEL', recipientEmail, now };
  const ev = baseEvent(m, opts);
  if (occurrenceStart && m.rrule) {
    addTime(ev, 'recurrence-id', m, [occurrenceStart.getTime()]);
    addTime(ev, 'dtstart', m, [occurrenceStart.getTime()]);
  } else {
    addTime(ev, 'dtstart', m, [m.startsAt.getTime()]);
    addTime(ev, 'dtend', m, [m.endsAt.getTime()]);
    if (m.rrule) ev.addPropertyWithValue('rrule', ICAL.Recur.fromString(m.rrule));
  }
  ev.addPropertyWithValue('summary', icsText(m.title));
  ev.addPropertyWithValue('status', 'CANCELLED');
  addPerson(ev, 'organizer', m.organizer);
  const recipient = m.attendees.find((a) => a.email === recipientEmail);
  addPerson(ev, 'attendee', recipient ?? { email: recipientEmail, name: null }, {
    role: 'REQ-PARTICIPANT',
  });
  cal.addSubcomponent(ev);
  return cal.toString();
}

export interface FeedEntry {
  meeting: IcsMeeting;
  alarms: readonly number[];
}

/** The private subscription feed (METHOD:PUBLISH) with the reader's reminders as VALARMs. */
export function buildFeedIcs(
  entries: readonly FeedEntry[],
  calendarName: string,
  now = Date.now(),
): string {
  const cal = newCalendar('PUBLISH', calendarName);
  addZones(
    cal,
    entries.map((e) => e.meeting),
    now,
  );
  for (const { meeting, alarms } of entries) {
    const opts: EventOptions = { method: 'PUBLISH', alarms, now };
    cal.addSubcomponent(masterEvent(meeting, opts));
    if (meeting.rrule)
      for (const o of meeting.overrides) cal.addSubcomponent(overrideEvent(meeting, o, opts));
  }
  return cal.toString();
}
