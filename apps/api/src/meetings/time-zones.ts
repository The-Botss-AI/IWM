import { isValidIanaTimeZone } from '@botss/shared-types';

/**
 * Time-zone arithmetic on the runtime's own IANA data (Intl), so a meeting at
 * 09:00 Asia/Karachi or Europe/Istanbul stays at 09:00 local across DST
 * changes without shipping a tz database. Pure; no I/O.
 */

/** A wall-clock time: month 1-12. */
export interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(zone, f);
  }
  return f;
}

/** The wall-clock time in `zone` at the instant `utcMs`. */
export function utcToWall(utcMs: number, zone: string): WallTime {
  const out: WallTime = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of formatter(zone).formatToParts(new Date(utcMs))) {
    if (part.type === 'year') out.year = Number(part.value);
    else if (part.type === 'month') out.month = Number(part.value);
    else if (part.type === 'day') out.day = Number(part.value);
    else if (part.type === 'hour') out.hour = Number(part.value) % 24;
    else if (part.type === 'minute') out.minute = Number(part.value);
    else if (part.type === 'second') out.second = Number(part.value);
  }
  return out;
}

function wallAsUtcMs(w: WallTime): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

/** Offset of `zone` from UTC at `utcMs`, in milliseconds (local minus UTC). */
export function zoneOffsetMs(zone: string, utcMs: number): number {
  const whole = Math.floor(utcMs / 1000) * 1000;
  return wallAsUtcMs(utcToWall(whole, zone)) - whole;
}

/**
 * The instant a wall-clock time in `zone` happens. A time skipped by a DST
 * gap moves forward by the gap (02:30 on a spring-forward night is 03:30); a
 * repeated time takes its first occurrence, as RFC 5545 asks.
 */
export function wallToUtc(w: WallTime, zone: string): number {
  const guess = wallAsUtcMs(w);
  const before = zoneOffsetMs(zone, guess - DAY_MS / 2);
  const after = zoneOffsetMs(zone, guess + DAY_MS / 2);
  if (before === after) return guess - before;
  // A transition is near: try both offsets and keep the ones that round-trip.
  const candidates = [guess - before, guess - after].filter(
    (t) => wallAsUtcMs(utcToWall(t, zone)) === guess,
  );
  if (candidates.length > 0) return Math.min(...candidates);
  // In the gap: the time does not exist; use the offset before the gap.
  return guess - before;
}

/** 00:00 of the local day `utcMs` falls on, in `zone`. */
export function startOfLocalDay(utcMs: number, zone: string): number {
  const w = utcToWall(utcMs, zone);
  return wallToUtc({ ...w, hour: 0, minute: 0, second: 0 }, zone);
}

/** 00:00 of the local day `days` after the day `utcMs` falls on, in `zone`. */
export function addLocalDays(utcMs: number, days: number, zone: string): number {
  const w = utcToWall(utcMs, zone);
  const d = new Date(Date.UTC(w.year, w.month - 1, w.day + days));
  return wallToUtc(
    {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: 0,
      minute: 0,
      second: 0,
    },
    zone,
  );
}

/**
 * Snap an all-day range to whole local days: the start down to 00:00, the
 * end up to the next 00:00 (exclusive), at least one day.
 */
export function snapAllDay(
  startMs: number,
  endMs: number,
  zone: string,
): { start: number; end: number } {
  const start = startOfLocalDay(startMs, zone);
  let end = startOfLocalDay(endMs, zone);
  if (end < endMs) end = addLocalDays(endMs, 1, zone);
  if (end <= start) end = addLocalDays(start, 1, zone);
  return { start, end };
}

// ------------------------------------------------------------ zone names

/**
 * Windows zone names (Outlook / Exchange `TZID`s) to IANA, from the CLDR
 * windowsZones table (territory 001), with current canonical IANA names.
 */
const WINDOWS_ZONES: Readonly<Record<string, string>> = {
  'Dateline Standard Time': 'Etc/GMT+12',
  'UTC-11': 'Etc/GMT+11',
  'Aleutian Standard Time': 'America/Adak',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Marquesas Standard Time': 'Pacific/Marquesas',
  'Alaskan Standard Time': 'America/Anchorage',
  'UTC-09': 'Etc/GMT+9',
  'Pacific Standard Time (Mexico)': 'America/Tijuana',
  'UTC-08': 'Etc/GMT+8',
  'Pacific Standard Time': 'America/Los_Angeles',
  'US Mountain Standard Time': 'America/Phoenix',
  'Mountain Standard Time (Mexico)': 'America/Mazatlan',
  'Mountain Standard Time': 'America/Denver',
  'Yukon Standard Time': 'America/Whitehorse',
  'Central America Standard Time': 'America/Guatemala',
  'Central Standard Time': 'America/Chicago',
  'Easter Island Standard Time': 'Pacific/Easter',
  'Central Standard Time (Mexico)': 'America/Mexico_City',
  'Canada Central Standard Time': 'America/Regina',
  'SA Pacific Standard Time': 'America/Bogota',
  'Eastern Standard Time (Mexico)': 'America/Cancun',
  'Eastern Standard Time': 'America/New_York',
  'Haiti Standard Time': 'America/Port-au-Prince',
  'Cuba Standard Time': 'America/Havana',
  'US Eastern Standard Time': 'America/Indiana/Indianapolis',
  'Turks And Caicos Standard Time': 'America/Grand_Turk',
  'Paraguay Standard Time': 'America/Asuncion',
  'Atlantic Standard Time': 'America/Halifax',
  'Venezuela Standard Time': 'America/Caracas',
  'Central Brazilian Standard Time': 'America/Cuiaba',
  'SA Western Standard Time': 'America/La_Paz',
  'Pacific SA Standard Time': 'America/Santiago',
  'Newfoundland Standard Time': 'America/St_Johns',
  'Tocantins Standard Time': 'America/Araguaina',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'SA Eastern Standard Time': 'America/Cayenne',
  'Argentina Standard Time': 'America/Argentina/Buenos_Aires',
  'Greenland Standard Time': 'America/Nuuk',
  'Montevideo Standard Time': 'America/Montevideo',
  'Magallanes Standard Time': 'America/Punta_Arenas',
  'Saint Pierre Standard Time': 'America/Miquelon',
  'Bahia Standard Time': 'America/Bahia',
  'UTC-02': 'Etc/GMT+2',
  'Mid-Atlantic Standard Time': 'Etc/GMT+2',
  'Azores Standard Time': 'Atlantic/Azores',
  'Cape Verde Standard Time': 'Atlantic/Cape_Verde',
  UTC: 'UTC',
  'Coordinated Universal Time': 'UTC',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'Sao Tome Standard Time': 'Africa/Sao_Tome',
  'Morocco Standard Time': 'Africa/Casablanca',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Romance Standard Time': 'Europe/Paris',
  'Central European Standard Time': 'Europe/Warsaw',
  'W. Central Africa Standard Time': 'Africa/Lagos',
  'Jordan Standard Time': 'Asia/Amman',
  'GTB Standard Time': 'Europe/Bucharest',
  'Middle East Standard Time': 'Asia/Beirut',
  'Egypt Standard Time': 'Africa/Cairo',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'Syria Standard Time': 'Asia/Damascus',
  'West Bank Standard Time': 'Asia/Hebron',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'FLE Standard Time': 'Europe/Kyiv',
  'Israel Standard Time': 'Asia/Jerusalem',
  'South Sudan Standard Time': 'Africa/Juba',
  'Kaliningrad Standard Time': 'Europe/Kaliningrad',
  'Sudan Standard Time': 'Africa/Khartoum',
  'Libya Standard Time': 'Africa/Tripoli',
  'Namibia Standard Time': 'Africa/Windhoek',
  'Arabic Standard Time': 'Asia/Baghdad',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Arab Standard Time': 'Asia/Riyadh',
  'Belarus Standard Time': 'Europe/Minsk',
  'Russian Standard Time': 'Europe/Moscow',
  'E. Africa Standard Time': 'Africa/Nairobi',
  'Volgograd Standard Time': 'Europe/Volgograd',
  'Iran Standard Time': 'Asia/Tehran',
  'Arabian Standard Time': 'Asia/Dubai',
  'Astrakhan Standard Time': 'Europe/Astrakhan',
  'Azerbaijan Standard Time': 'Asia/Baku',
  'Russia Time Zone 3': 'Europe/Samara',
  'Mauritius Standard Time': 'Indian/Mauritius',
  'Saratov Standard Time': 'Europe/Saratov',
  'Georgian Standard Time': 'Asia/Tbilisi',
  'Caucasus Standard Time': 'Asia/Yerevan',
  'Afghanistan Standard Time': 'Asia/Kabul',
  'West Asia Standard Time': 'Asia/Tashkent',
  'Ekaterinburg Standard Time': 'Asia/Yekaterinburg',
  'Pakistan Standard Time': 'Asia/Karachi',
  'Qyzylorda Standard Time': 'Asia/Qyzylorda',
  'India Standard Time': 'Asia/Kolkata',
  'Sri Lanka Standard Time': 'Asia/Colombo',
  'Nepal Standard Time': 'Asia/Kathmandu',
  'Central Asia Standard Time': 'Asia/Bishkek',
  'Bangladesh Standard Time': 'Asia/Dhaka',
  'Omsk Standard Time': 'Asia/Omsk',
  'Myanmar Standard Time': 'Asia/Yangon',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'Altai Standard Time': 'Asia/Barnaul',
  'W. Mongolia Standard Time': 'Asia/Hovd',
  'North Asia Standard Time': 'Asia/Krasnoyarsk',
  'N. Central Asia Standard Time': 'Asia/Novosibirsk',
  'Tomsk Standard Time': 'Asia/Tomsk',
  'China Standard Time': 'Asia/Shanghai',
  'North Asia East Standard Time': 'Asia/Irkutsk',
  'Singapore Standard Time': 'Asia/Singapore',
  'W. Australia Standard Time': 'Australia/Perth',
  'Taipei Standard Time': 'Asia/Taipei',
  'Ulaanbaatar Standard Time': 'Asia/Ulaanbaatar',
  'Aus Central W. Standard Time': 'Australia/Eucla',
  'Transbaikal Standard Time': 'Asia/Chita',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'North Korea Standard Time': 'Asia/Pyongyang',
  'Korea Standard Time': 'Asia/Seoul',
  'Yakutsk Standard Time': 'Asia/Yakutsk',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Central Standard Time': 'Australia/Darwin',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'West Pacific Standard Time': 'Pacific/Port_Moresby',
  'Tasmania Standard Time': 'Australia/Hobart',
  'Vladivostok Standard Time': 'Asia/Vladivostok',
  'Lord Howe Standard Time': 'Australia/Lord_Howe',
  'Bougainville Standard Time': 'Pacific/Bougainville',
  'Russia Time Zone 10': 'Asia/Srednekolymsk',
  'Magadan Standard Time': 'Asia/Magadan',
  'Norfolk Standard Time': 'Pacific/Norfolk',
  'Sakhalin Standard Time': 'Asia/Sakhalin',
  'Central Pacific Standard Time': 'Pacific/Guadalcanal',
  'Russia Time Zone 11': 'Asia/Kamchatka',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'UTC+12': 'Etc/GMT-12',
  'Fiji Standard Time': 'Pacific/Fiji',
  'Chatham Islands Standard Time': 'Pacific/Chatham',
  'UTC+13': 'Etc/GMT-13',
  'Tonga Standard Time': 'Pacific/Tongatapu',
  'Samoa Standard Time': 'Pacific/Apia',
  'Line Islands Standard Time': 'Pacific/Kiritimati',
};

/** Every IANA zone the Windows table maps to (for tests). */
export const WINDOWS_ZONE_TARGETS: readonly string[] = [...new Set(Object.values(WINDOWS_ZONES))];

/**
 * An IANA zone for a TZID from an .ics file, or null when it names none:
 * an IANA name as is (Google, Apple), a Windows name (Outlook), or an IANA
 * name at the end of a prefixed id (`/mozilla.org/20070129_1/Europe/Paris`).
 */
export function ianaZoneForTzid(tzid: string | null | undefined): string | null {
  if (!tzid) return null;
  const id = tzid.trim().replace(/^"|"$/g, '');
  if (id === '') return null;
  if (isValidIanaTimeZone(id)) return id;
  const windows = WINDOWS_ZONES[id];
  if (windows) return windows;
  const suffix = /([A-Za-z]+(?:\/[A-Za-z0-9_+-]+){1,2})$/.exec(id)?.[1];
  if (suffix && isValidIanaTimeZone(suffix)) return suffix;
  return null;
}

// ------------------------------------------------------------ transitions

export interface ZoneTransition {
  /** Instant of the change. */
  at: number;
  fromOffsetMs: number;
  toOffsetMs: number;
}

/**
 * Offset changes of `zone` between `fromMs` and `toMs` (DST and rule
 * changes), found by stepping a day at a time and narrowing to the minute.
 */
export function zoneTransitions(zone: string, fromMs: number, toMs: number): ZoneTransition[] {
  const out: ZoneTransition[] = [];
  let t = Math.floor(fromMs / MINUTE_MS) * MINUTE_MS;
  let offset = zoneOffsetMs(zone, t);
  while (t < toMs) {
    const next = Math.min(t + DAY_MS, toMs);
    const nextOffset = zoneOffsetMs(zone, next);
    if (nextOffset !== offset) {
      let lo = t;
      let hi = next;
      while (hi - lo > MINUTE_MS) {
        const mid = lo + Math.floor((hi - lo) / 2 / MINUTE_MS) * MINUTE_MS;
        if (zoneOffsetMs(zone, mid) === offset) lo = mid;
        else hi = mid;
      }
      out.push({ at: hi, fromOffsetMs: offset, toOffsetMs: nextOffset });
      offset = nextOffset;
    }
    t = next;
  }
  return out;
}
