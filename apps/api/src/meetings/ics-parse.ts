import { createHash } from 'node:crypto';

import ICAL from 'ical.js';
import {
  isHttpUrl,
  MAX_MEETING_REMINDERS,
  MEETING_ICS_MAX_BYTES,
  MEETING_ICS_MAX_EVENTS,
  MEETING_REMINDER_MAX_MINUTES,
  type MeetingLinkProvider,
  type MeetingStatus,
} from '@botss/shared-types';

import { rebaseSeries, ruleProblem, type OverrideShape } from './recurrence';
import {
  addLocalDays,
  ianaZoneForTzid,
  wallToUtc,
  zoneOffsetMs,
  type WallTime,
} from './time-zones';

/**
 * .ics parsing for the import (ical.js, in memory; the file is never stored).
 *
 * Time zones, in order: a `Z` time is UTC; a TZID that names an IANA zone
 * (Google, Apple) or a Windows zone (Outlook, mapped through CLDR) is read
 * in that zone; any other TZID is read through the file's own VTIMEZONE; a
 * floating time or an all-day date is read in the importer's zone. Pure.
 */

type IcalComponent = InstanceType<typeof ICAL.Component>;
type IcalProperty = InstanceType<typeof ICAL.Property>;
type IcalTime = InstanceType<typeof ICAL.Time>;

export interface ParsedIcsEvent {
  uid: string;
  sequence: number;
  title: string;
  description: string | null;
  location: string | null;
  meetingUrl: string | null;
  meetingProvider: MeetingLinkProvider | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  timeZone: string;
  rrule: string | null;
  exdates: Date[];
  overrides: OverrideShape[];
  status: MeetingStatus;
  reminders: number[];
  /** Why the event cannot be imported, or null. */
  problem: string | null;
}

export interface ParsedIcsFile {
  calendarName: string | null;
  events: ParsedIcsEvent[];
  /** Events that could not be read (no start, unreadable times) and were left out. */
  unreadable: number;
}

export class IcsImportError extends Error {
  constructor(
    readonly code: 'ics_invalid' | 'ics_too_large' | 'ics_too_many_events' | 'ics_empty',
    message: string,
  ) {
    super(message);
  }
}

const DEFAULT_TIMED_MS = 30 * 60_000;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 10_000;
const MAX_LOCATION = 500;
/** Cancelled dates (EXDATE and cancelled exceptions) one imported series may carry. */
export const MAX_IMPORT_EXDATES = 1_000;
/** Changed occurrences one imported series may carry. */
export const MAX_IMPORT_OVERRIDES = 500;
/** An imported series is stored from its first occurrence in the last year at the earliest. */
const REBASE_WINDOW_MS = 365 * 86_400_000;
/** Time one file may spend fast-forwarding old series. */
const REBASE_FILE_BUDGET_MS = 2_000;

interface ParseContext {
  fallbackZone: string;
  /** Series starting before this are moved to their first occurrence on or after it. */
  notBeforeMs: number;
  rebaseBudget: { ms: number };
}

function clip(value: string | null | undefined, max: number): string | null {
  if (typeof value !== 'string') return null;
  const v = value.replace(/\r\n?/g, '\n').trim();
  if (v === '') return null;
  return v.length > max ? v.slice(0, max) : v;
}

function textProp(comp: IcalComponent, name: string): string | null {
  const v = comp.getFirstPropertyValue(name) as unknown;
  return typeof v === 'string' ? v : null;
}

// ------------------------------------------------------------ meeting links

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;

function cleanUrl(raw: string): string {
  return raw.replace(/&amp;/g, '&').replace(/[)\].,;:!?]+$/, '');
}

export function linkProvider(url: string): MeetingLinkProvider | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const path = u.pathname;
  if (host === 'meet.google.com' && /^\/[a-z]{3,}-[a-z]{3,}-[a-z]{3,}/.test(path))
    return 'google-meet';
  if (
    (host === 'zoom.us' ||
      host.endsWith('.zoom.us') ||
      host === 'zoomgov.com' ||
      host.endsWith('.zoomgov.com')) &&
    /^\/(j|my|w|s|wc)\//.test(path)
  ) {
    return 'zoom';
  }
  if (
    (host === 'teams.microsoft.com' && /^\/(l\/meetup-join|meet)\//.test(path)) ||
    (host === 'teams.live.com' && path.startsWith('/meet/'))
  ) {
    return 'teams';
  }
  if (host === 'webex.com' || host.endsWith('.webex.com')) return 'webex';
  return null;
}

/**
 * The video link of an event: the first Meet, Zoom, Teams or Webex link in
 * the conference properties, URL, LOCATION or DESCRIPTION; otherwise the
 * event's URL or a LOCATION that is a bare link.
 */
export function detectMeetingLink(texts: {
  conference: (string | null)[];
  url: string | null;
  location: string | null;
  description: string | null;
}): { url: string; provider: MeetingLinkProvider | null } | null {
  const ordered = [...texts.conference, texts.url, texts.location, texts.description];
  for (const text of ordered) {
    if (!text) continue;
    for (const match of text.match(URL_RE) ?? []) {
      const url = cleanUrl(match);
      if (url.length > 2048 || !isHttpUrl(url)) continue;
      const provider = linkProvider(url);
      if (provider) return { url, provider };
    }
  }
  for (const text of [texts.url, texts.location]) {
    const v = text?.trim();
    if (v && /^https?:\/\/\S+$/i.test(v) && v.length <= 2048 && isHttpUrl(v))
      return { url: v, provider: null };
  }
  return null;
}

// ------------------------------------------------------------ times

interface Instant {
  ms: number;
  isDate: boolean;
  /** The IANA zone the value was written in, 'UTC', or null when only the file's VTIMEZONE knew it. */
  zone: string | null;
  /** Offset (ms) the value had, for zones only the file describes. */
  offsetMs: number;
}

function wallOf(t: IcalTime): WallTime {
  return {
    year: t.year,
    month: t.month,
    day: t.day,
    hour: t.hour,
    minute: t.minute,
    second: t.second,
  };
}

function instantOf(t: IcalTime, tzid: string | null, fallbackZone: string): Instant {
  if (t.isDate) {
    const ms = wallToUtc({ ...wallOf(t), hour: 0, minute: 0, second: 0 }, fallbackZone);
    return { ms, isDate: true, zone: fallbackZone, offsetMs: zoneOffsetMs(fallbackZone, ms) };
  }
  if (t.zone && t.zone.tzid === 'UTC') {
    const ms = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
    return { ms, isDate: false, zone: 'UTC', offsetMs: 0 };
  }
  if (tzid) {
    const iana = ianaZoneForTzid(tzid);
    if (iana) {
      const ms = wallToUtc(wallOf(t), iana);
      return { ms, isDate: false, zone: iana, offsetMs: zoneOffsetMs(iana, ms) };
    }
    if (t.zone && t.zone.tzid && t.zone.tzid !== 'floating') {
      // Only the file's VTIMEZONE knows this zone: let ical.js apply it.
      const ms = t.toUnixTime() * 1000;
      const wallMs = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
      return { ms, isDate: false, zone: null, offsetMs: wallMs - ms };
    }
  }
  const ms = wallToUtc(wallOf(t), fallbackZone);
  return { ms, isDate: false, zone: fallbackZone, offsetMs: zoneOffsetMs(fallbackZone, ms) };
}

function propInstants(prop: IcalProperty, fallbackZone: string): Instant[] {
  const tzid = prop.getParameter('tzid');
  const tz = typeof tzid === 'string' ? tzid : null;
  const out: Instant[] = [];
  for (const v of prop.getValues() as unknown[]) {
    if (v instanceof ICAL.Time) out.push(instantOf(v, tz, fallbackZone));
    else if (v instanceof ICAL.Period && v.start) out.push(instantOf(v.start, tz, fallbackZone));
  }
  return out;
}

function firstInstant(comp: IcalComponent, name: string, fallbackZone: string): Instant | null {
  const prop = comp.getFirstProperty(name);
  if (!prop) return null;
  return propInstants(prop, fallbackZone)[0] ?? null;
}

// ------------------------------------------------------------ events

function stableUid(comp: IcalComponent): string {
  const basis = [
    textProp(comp, 'summary') ?? '',
    String(comp.getFirstPropertyValue('dtstart') ?? ''),
    String(comp.getFirstPropertyValue('dtend') ?? ''),
  ].join('|');
  return `${createHash('sha256').update(basis).digest('hex').slice(0, 32)}@import`;
}

function statusOf(comp: IcalComponent): MeetingStatus {
  const s = (textProp(comp, 'status') ?? '').toUpperCase();
  if (s === 'CANCELLED') return 'CANCELLED';
  if (s === 'TENTATIVE') return 'TENTATIVE';
  return 'CONFIRMED';
}

function sequenceOf(comp: IcalComponent): number {
  const v = comp.getFirstPropertyValue('sequence') as unknown;
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? '0'), 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 1_000_000) : 0;
}

/** The event's alarms as minutes before the start (1 to 40,320, at most 5). */
function alarmsOf(
  comp: IcalComponent,
  startMs: number,
  endMs: number,
  fallbackZone: string,
): number[] {
  const out = new Set<number>();
  for (const alarm of comp.getAllSubcomponents('valarm')) {
    const prop = alarm.getFirstProperty('trigger');
    if (!prop) continue;
    const value = prop.getFirstValue() as unknown;
    let triggerMs: number | null = null;
    if (value instanceof ICAL.Duration) {
      const related = String(prop.getParameter('related') ?? 'START').toUpperCase();
      triggerMs = (related === 'END' ? endMs : startMs) + value.toSeconds() * 1000;
    } else if (value instanceof ICAL.Time) {
      triggerMs = instantOf(value, null, fallbackZone).ms;
    }
    if (triggerMs === null) continue;
    let minutes = Math.round((startMs - triggerMs) / 60_000);
    // "At the start" is the closest we can ring: one minute before.
    if (minutes === 0) minutes = 1;
    if (minutes >= 1 && minutes <= MEETING_REMINDER_MAX_MINUTES) out.add(minutes);
  }
  return [...out].sort((a, b) => a - b).slice(0, MAX_MEETING_REMINDERS);
}

function conferenceLinks(comp: IcalComponent): (string | null)[] {
  return [
    'x-google-conference',
    'x-microsoft-skypeteamsmeetingurl',
    'x-microsoft-onlinemeetingexternallink',
  ].map((n) => textProp(comp, n));
}

interface Times {
  start: Instant;
  endMs: number;
}

function timesOf(comp: IcalComponent, fallbackZone: string): Times | null {
  const start = firstInstant(comp, 'dtstart', fallbackZone);
  if (!start) return null;
  const end = firstInstant(comp, 'dtend', fallbackZone);
  let endMs: number | null = end ? end.ms : null;
  if (endMs === null) {
    const dur = comp.getFirstPropertyValue('duration') as unknown;
    if (dur instanceof ICAL.Duration) endMs = start.ms + dur.toSeconds() * 1000;
  }
  return { start, endMs: endMs ?? start.ms };
}

/** The meeting's zone: the start's IANA zone, or the importer's when it has the same offsets. */
function meetingZone(start: Instant, fallbackZone: string): string {
  if (start.zone) return start.zone;
  return zoneOffsetMs(fallbackZone, start.ms) === start.offsetMs ? fallbackZone : 'UTC';
}

function eventFromMaster(
  master: IcalComponent,
  exceptions: IcalComponent[],
  ctx: ParseContext,
  uid: string,
): ParsedIcsEvent | null {
  const { fallbackZone } = ctx;
  const times = timesOf(master, fallbackZone);
  if (!times) return null;
  const allDay = times.start.isDate;
  const timeZone = allDay ? fallbackZone : meetingZone(times.start, fallbackZone);
  let startsAt = times.start.ms;
  let endsAt = times.endMs;
  if (allDay) {
    if (endsAt <= startsAt) endsAt = addLocalDays(startsAt, 1, timeZone);
  } else if (endsAt <= startsAt) {
    endsAt = startsAt + DEFAULT_TIMED_MS;
  }

  const title = clip(textProp(master, 'summary'), MAX_TITLE) ?? '(No title)';
  const description = clip(textProp(master, 'description'), MAX_DESCRIPTION);
  const location = clip(textProp(master, 'location'), MAX_LOCATION);
  const link = detectMeetingLink({
    conference: conferenceLinks(master),
    url: textProp(master, 'url'),
    location,
    description,
  });

  let problem: string | null = null;
  let rrule: string | null = null;
  const rrules = master.getAllProperties('rrule');
  if (rrules.length > 1) problem = 'Events with more than one repeat rule are not supported';
  else if (rrules.length === 1) {
    const recur = rrules[0]!.getFirstValue() as unknown;
    rrule = recur instanceof ICAL.Recur ? recur.toString() : String(recur ?? '');
    problem = ruleProblem(rrule);
  }
  if (!problem && master.getAllProperties('rdate').length > 0) {
    problem = 'Extra dates (RDATE) are not supported';
  }

  let exdates: Date[] = [];
  if (rrule) {
    for (const prop of master.getAllProperties('exdate')) {
      for (const inst of propInstants(prop, timeZone)) exdates.push(new Date(inst.ms));
    }
  }

  let overrides: OverrideShape[] = [];
  if (rrule) {
    const duration = endsAt - startsAt;
    for (const ex of exceptions) {
      const rid = firstInstant(ex, 'recurrence-id', timeZone);
      if (!rid) continue;
      if (statusOf(ex) === 'CANCELLED') {
        exdates.push(new Date(rid.ms));
        continue;
      }
      const exTimes = timesOf(ex, timeZone);
      const s = exTimes ? exTimes.start.ms : rid.ms;
      let e = exTimes ? exTimes.endMs : s + duration;
      if (e <= s) e = s + duration;
      const own = (v: string | null, series: string | null): string | null =>
        v === series ? null : (v ?? '');
      const exTitle = clip(textProp(ex, 'summary'), MAX_TITLE);
      const exLocation = clip(textProp(ex, 'location'), MAX_LOCATION);
      const exDescription = clip(textProp(ex, 'description'), MAX_DESCRIPTION);
      const exLink = detectMeetingLink({
        conference: conferenceLinks(ex),
        url: textProp(ex, 'url'),
        location: exLocation,
        description: exDescription,
      });
      overrides.push({
        originalStart: new Date(rid.ms),
        startsAt: new Date(s),
        endsAt: new Date(e),
        title: exTitle && exTitle !== title ? exTitle : null,
        description: own(exDescription, description),
        location: own(exLocation, location),
        meetingUrl: own(exLink?.url ?? null, link?.url ?? null),
      });
    }
  }

  // Alarms are read against the series' own first start (they are relative).
  const reminders = alarmsOf(master, startsAt, endsAt, fallbackZone);
  if (rrule && !problem) {
    // A long-running series is stored from its first occurrence in the last
    // year, with the cancelled and changed dates from there on.
    const rebased = rebaseSeries(
      { startsAt: new Date(startsAt), endsAt: new Date(endsAt), allDay, timeZone, rrule },
      ctx.notBeforeMs,
      ctx.rebaseBudget,
    );
    if (rebased.kind === 'too-long') {
      problem = 'This repeating event goes back too far to import';
    } else if (rebased.kind === 'rebased') {
      startsAt = rebased.startsAt.getTime();
      endsAt = rebased.endsAt.getTime();
      exdates = exdates.filter((d) => d.getTime() >= startsAt);
      overrides = overrides.filter((o) => o.originalStart.getTime() >= startsAt);
    }
  }
  if (!problem && exdates.length > MAX_IMPORT_EXDATES) {
    problem = `Repeating events with more than ${MAX_IMPORT_EXDATES.toLocaleString('en-US')} cancelled dates are not supported`;
  }
  if (!problem && overrides.length > MAX_IMPORT_OVERRIDES) {
    problem = `Repeating events with more than ${MAX_IMPORT_OVERRIDES} changed dates are not supported`;
  }

  return {
    uid,
    sequence: sequenceOf(master),
    title,
    description,
    location,
    meetingUrl: link?.url ?? null,
    meetingProvider: link?.provider ?? null,
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    allDay,
    timeZone,
    rrule,
    exdates,
    overrides,
    status: statusOf(master),
    reminders,
    problem,
  };
}

function rootComponents(text: string): IcalComponent[] {
  let jcal: unknown;
  try {
    jcal = ICAL.parse(text);
  } catch {
    throw new IcsImportError('ics_invalid', 'This file is not a valid calendar (.ics) file.');
  }
  const list = Array.isArray(jcal) && Array.isArray(jcal[0]) ? (jcal as unknown[]) : [jcal];
  const out: IcalComponent[] = [];
  for (const item of list) {
    const comp = new ICAL.Component(item as ConstructorParameters<typeof ICAL.Component>[0]);
    if (comp.name === 'vcalendar') out.push(comp);
  }
  if (out.length === 0)
    throw new IcsImportError('ics_invalid', 'This file is not a valid calendar (.ics) file.');
  return out;
}

/**
 * Parse an .ics file into importable events. Throws `IcsImportError` for a
 * file that is too big, not a calendar, empty, or holds more than 2,000
 * events. A series without COUNT that started over a year before `now` is
 * moved to its first occurrence since then (see `rebaseSeries`).
 */
export function parseIcsFile(bytes: Buffer, fallbackZone: string, now = Date.now()): ParsedIcsFile {
  if (bytes.length > MEETING_ICS_MAX_BYTES) {
    throw new IcsImportError('ics_too_large', 'The file is larger than 2 MB.');
  }
  const text = bytes.toString('utf8').replace(/^﻿/, '');
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new IcsImportError('ics_invalid', 'This file is not a valid calendar (.ics) file.');
  }
  const calendars = rootComponents(text);
  let calendarName: string | null = null;
  const vevents: IcalComponent[] = [];
  for (const cal of calendars) {
    calendarName ??= clip(textProp(cal, 'x-wr-calname'), 200);
    vevents.push(...cal.getAllSubcomponents('vevent'));
    if (vevents.length > MEETING_ICS_MAX_EVENTS) {
      throw new IcsImportError(
        'ics_too_many_events',
        `The file has more than ${MEETING_ICS_MAX_EVENTS.toLocaleString('en-US')} events. Export a shorter date range and try again.`,
      );
    }
  }
  if (vevents.length === 0) throw new IcsImportError('ics_empty', 'The file has no events.');

  // Group by UID: the series (no RECURRENCE-ID) and its changed occurrences.
  const groups = new Map<string, { master: IcalComponent | null; exceptions: IcalComponent[] }>();
  for (const ev of vevents) {
    const uid = clip(textProp(ev, 'uid'), 512) ?? stableUid(ev);
    const group = groups.get(uid) ?? { master: null, exceptions: [] };
    if (ev.hasProperty('recurrence-id')) group.exceptions.push(ev);
    else group.master ??= ev;
    groups.set(uid, group);
  }

  const ctx: ParseContext = {
    fallbackZone,
    notBeforeMs: now - REBASE_WINDOW_MS,
    rebaseBudget: { ms: REBASE_FILE_BUDGET_MS },
  };
  // A lone changed occurrence is a one-off: never moved.
  const oneOffCtx: ParseContext = { ...ctx, notBeforeMs: Number.NEGATIVE_INFINITY };
  const events: ParsedIcsEvent[] = [];
  let unreadable = 0;
  // One broken event (no start, a time ical.js cannot read) is counted and
  // skipped; it never fails the rest of the file.
  const read = (fn: () => ParsedIcsEvent | null): ParsedIcsEvent | null => {
    let ev: ParsedIcsEvent | null;
    try {
      ev = fn();
    } catch {
      ev = null;
    }
    if (ev && Number.isFinite(ev.startsAt.getTime()) && Number.isFinite(ev.endsAt.getTime()))
      return ev;
    unreadable += 1;
    return null;
  };
  for (const [uid, group] of groups) {
    if (group.master) {
      const master = group.master;
      const ev = read(() => eventFromMaster(master, group.exceptions, ctx, uid));
      if (ev) events.push(ev);
      continue;
    }
    // Changed occurrences without their series (an invitation to one
    // occurrence): each becomes a one-off meeting of its own.
    for (const ex of group.exceptions) {
      const ev = read(() => {
        const rid = firstInstant(ex, 'recurrence-id', fallbackZone);
        const one = eventFromMaster(
          ex,
          [],
          oneOffCtx,
          rid ? `${uid}#${new Date(rid.ms).toISOString()}` : uid,
        );
        return one ? { ...one, rrule: null, exdates: [], overrides: [] } : null;
      });
      if (ev) events.push(ev);
    }
  }
  events.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return { calendarName, events, unreadable };
}
