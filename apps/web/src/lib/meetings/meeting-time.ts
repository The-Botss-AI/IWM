import { addDays, format } from 'date-fns';

/**
 * Time zone arithmetic for meetings. Every instant on the wire is UTC; a
 * meeting's wall clock (what the organizer typed) lives in `timeZone`.
 * Intl does the work, no extra dependency.
 */

export interface ZonedParts {
  year: number;
  month: number; // 1 to 12
  day: number;
  hour: number;
  minute: number;
}

/** The viewer's IANA zone. */
export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** The wall clock of an instant in a zone. */
export function utcToZonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
  };
}

function offsetMs(instant: Date, timeZone: string): number {
  const p = utcToZonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(instant.getTime() / 60_000) * 60_000;
}

/** The instant a wall clock reads in a zone (`month` is 1 to 12). */
export function zonedWallToUtc(parts: ZonedParts, timeZone: string): Date {
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const first = guess - offsetMs(new Date(guess), timeZone);
  const second = guess - offsetMs(new Date(first), timeZone);
  return new Date(second);
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `yyyy-MM-dd` and `HH:mm` of an instant in a zone, as form fields hold them. */
export function toZonedFields(instant: Date, timeZone: string): { date: string; time: string } {
  const p = utcToZonedParts(instant, timeZone);
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}

/** Inverse of `toZonedFields`; null when either field is not valid. */
export function fromZonedFields(date: string, time: string, timeZone: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const parts: ZonedParts = {
    year: Number(d[1]),
    month: Number(d[2]),
    day: Number(d[3]),
    hour: Number(t[1]),
    minute: Number(t[2]),
  };
  if (
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.day > 31 ||
    parts.hour > 23 ||
    parts.minute > 59
  ) {
    return null;
  }
  return zonedWallToUtc(parts, timeZone);
}

function parseDayField(date: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return d ? new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3])) : null;
}

/** `yyyy-MM-dd` of the day after (or `n` days from) `date`. */
export function addDaysField(date: string, n = 1): string {
  const d = parseDayField(date);
  return d ? format(addDays(d, n), 'yyyy-MM-dd') : date;
}

/** `yyyy-MM-dd` and `HH:mm` of a local Date. */
export function localFields(d: Date): { date: string; time: string } {
  return { date: format(d, 'yyyy-MM-dd'), time: format(d, 'HH:mm') };
}

/**
 * The local calendar day an event sits on, as a local midnight Date. An
 * all-day meeting keeps the day it has in its own zone, whatever zone the
 * viewer is in; everything else follows the viewer's clock.
 */
export function displayDay(instant: Date, allDay: boolean, timeZone: string): Date {
  if (!allDay) return new Date(instant.getFullYear(), instant.getMonth(), instant.getDate());
  const p = utcToZonedParts(instant, timeZone);
  return new Date(p.year, p.month - 1, p.day);
}

/** Short zone label such as `GMT+5`. */
export function zoneLabel(instant: Date, timeZone: string): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(instant)
      .find((p) => p.type === 'timeZoneName');
    return part?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

/** IANA zones the runtime knows, for the zone picker. */
export function listTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    const zones = intl.supportedValuesOf?.('timeZone');
    if (zones && zones.length > 0) return zones.includes('UTC') ? zones : ['UTC', ...zones];
  } catch {
    /* older runtime */
  }
  return ['UTC', viewerTimeZone()];
}

/** "Mon, Nov 20, 2026, 3:00 PM to 4:00 PM" in the viewer's zone. */
export function formatRange(start: Date, end: Date, allDay: boolean, timeZone: string): string {
  if (allDay) {
    const s = displayDay(start, true, timeZone);
    const e = addDays(displayDay(end, true, timeZone), -1);
    const sLabel = format(s, 'EEE, MMM d, yyyy');
    return e.getTime() > s.getTime()
      ? `${sLabel} to ${format(e, 'EEE, MMM d, yyyy')}`
      : `${sLabel}, all day`;
  }
  const sameDay = format(start, 'yyyy-MM-dd') === format(end, 'yyyy-MM-dd');
  return sameDay
    ? `${format(start, 'EEE, MMM d, yyyy, p')} to ${format(end, 'p')}`
    : `${format(start, 'EEE, MMM d, p')} to ${format(end, 'EEE, MMM d, p')}`;
}
