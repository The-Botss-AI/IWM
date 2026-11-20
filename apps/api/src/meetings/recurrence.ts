import ICAL from 'ical.js';
import type { MeetingRecurrence, MeetingWeekday } from '@botss/shared-types';

import { addLocalDays, utcToWall, wallToUtc, type WallTime } from './time-zones';

/**
 * Recurring meetings, expanded with ical.js in the meeting's own zone: the
 * iterator walks floating wall-clock times (09:00, 09:00, ...) and each one
 * becomes an instant through the zone's real offsets, so a series keeps its
 * local time across DST. `UNTIL` is applied here, on instants, instead of
 * inside ical.js (which would compare a floating time with a UTC one). Pure.
 */

export interface OverrideShape {
  originalStart: Date;
  startsAt: Date;
  endsAt: Date;
  title: string | null;
  description: string | null;
  location: string | null;
  meetingUrl: string | null;
}

export interface SeriesShape {
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  timeZone: string;
  rrule: string | null;
  exdates: readonly Date[];
  overrides: readonly OverrideShape[];
}

export interface Occurrence {
  /** The occurrence's start in the series (its RECURRENCE-ID). */
  originalStart: Date;
  startsAt: Date;
  endsAt: Date;
  override: OverrideShape | null;
}

/** Parts a stored rule may carry besides FREQ, INTERVAL, COUNT and UNTIL. */
const SUPPORTED_PARTS = new Set(['BYDAY', 'BYMONTHDAY', 'BYMONTH', 'BYSETPOS', 'WKST']);
const SUPPORTED_FREQ = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);
/** Parts that pick days inside a month or year: meaningless (and unsafe in ical.js) for DAILY and WEEKLY. */
const PERIOD_ONLY_PARTS = ['BYMONTHDAY', 'BYYEARDAY', 'BYSETPOS'] as const;
const WEEKDAYS: readonly MeetingWeekday[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
/** Most days each month can have (February counts its leap day). */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** Most occurrences a stored rule's COUNT may ask for (the editor's own cap). */
export const MAX_RULE_COUNT = 1000;
/** Iterations one walk of a series may take (a daily series ~55 years long). */
export const MAX_ITERATIONS = 20_000;
/** Wall-clock bound of one walk: no rule may hold the event loop longer. */
const MAX_WALK_MS = 250;
/** How long the parse-time probe of a rule may take before it is refused. */
const MAX_PROBE_MS = 100;
const DAY_MS = 86_400_000;

export class RuleError extends Error {}

type Recur = InstanceType<typeof ICAL.Recur>;
type IcalTime = InstanceType<typeof ICAL.Time>;

interface ParsedRule {
  recur: Recur;
  /** Last allowed occurrence start (inclusive), or null. */
  untilMs: number | null;
  count: number | null;
}

/**
 * Iterations shared by every expansion of one request (a list or calendar
 * call over many series), so many long series together stay bounded too.
 */
export interface ExpansionBudget {
  remaining: number;
  /** Set once an expansion ran out of budget. */
  exhausted: boolean;
}

export const REQUEST_EXPANSION_BUDGET = 200_000;

export function newExpansionBudget(iterations = REQUEST_EXPANSION_BUDGET): ExpansionBudget {
  return { remaining: iterations, exhausted: false };
}

/** Why a rule cannot be stored, or null when it can. */
export function ruleProblem(rrule: string): string | null {
  try {
    probeRule(parseRuleString(rrule));
    return null;
  } catch (err) {
    return err instanceof RuleError ? err.message : 'This repeat rule is not valid';
  }
}

function numberParts(recur: Recur, name: 'BYMONTHDAY' | 'BYMONTH' | 'BYSETPOS'): number[] {
  const raw = (recur.parts[name] ?? []) as unknown[];
  return raw.map((v) => Number(v));
}

const hasOrdinal = (d: unknown) => /^[+-]?\d/.test(String(d));

/** Most days one period (month or year) of this rule can produce, for BYSETPOS. */
function setSizeBound(recur: Recur): number {
  const byDay = (recur.parts.BYDAY ?? []) as unknown[];
  const perMonthByDay = byDay.reduce<number>((n, d) => n + (hasOrdinal(d) ? 1 : 5), 0);
  const monthDays = numberParts(recur, 'BYMONTHDAY').length;
  if (recur.freq === 'MONTHLY') return monthDays || perMonthByDay || 1;
  const listedMonths = numberParts(recur, 'BYMONTH').length;
  const months = listedMonths || 12;
  if (monthDays) return monthDays * months;
  if (byDay.length) {
    return listedMonths
      ? perMonthByDay * months
      : byDay.reduce<number>((n, d) => n + (hasOrdinal(d) ? 1 : 53), 0);
  }
  return months;
}

/**
 * Combinations ical.js cannot expand safely: day-of-month and set-position
 * parts on DAILY and WEEKLY (an impossible one loops forever, WEEKLY ones
 * crash), BYMONTHDAY values no listed month has (MONTHLY never matches,
 * YEARLY rolls over into the next month), BYSETPOS past the set.
 */
function assertExpandable(recur: Recur): void {
  if (recur.freq === 'DAILY' || recur.freq === 'WEEKLY') {
    for (const part of PERIOD_ONLY_PARTS) {
      if (recur.parts[part]) throw new RuleError(`Daily and weekly repeats cannot use ${part}`);
    }
  }
  const monthDays = numberParts(recur, 'BYMONTHDAY');
  if (monthDays.some((d) => !Number.isInteger(d) || d === 0 || Math.abs(d) > 31)) {
    throw new RuleError('This repeat rule is not valid');
  }
  const months = numberParts(recur, 'BYMONTH');
  if (months.some((m) => !Number.isInteger(m) || m < 1 || m > 12))
    throw new RuleError('This repeat rule is not valid');
  if (months.length > 0 && monthDays.length > 0) {
    const fits = (m: number, d: number) => Math.abs(d) <= (MONTH_DAYS[m - 1] ?? 0);
    const anyFits = months.some((m) => monthDays.some((d) => fits(m, d)));
    const allFit = months.every((m) => monthDays.every((d) => fits(m, d)));
    if (!anyFits || (recur.freq === 'YEARLY' && !allFit)) {
      throw new RuleError('This repeat rule names a day that its months do not have');
    }
  }
  const positions = numberParts(recur, 'BYSETPOS');
  if (positions.length > 0) {
    const bound = setSizeBound(recur);
    if (positions.some((p) => !Number.isInteger(p) || p === 0 || Math.abs(p) > bound)) {
      throw new RuleError('This repeat rule never produces a date');
    }
  }
}

/**
 * Run the rule (without COUNT and UNTIL) from a fixed start and require three
 * dates, fast. A rule that throws, stops, or needs long to find them is
 * refused before it is ever stored or expanded.
 */
function probeRule(recur: Recur): void {
  let probe: Recur;
  try {
    probe = ICAL.Recur.fromString(recur.toString());
    probe.count = null;
    probe.until = null;
  } catch {
    throw new RuleError('This repeat rule is not valid');
  }
  const started = Date.now();
  try {
    const iterator = probe.iterator(
      ICAL.Time.fromData({ year: 2024, month: 1, day: 1, hour: 9, minute: 0, second: 0 }),
    );
    let last: IcalTime | null = null;
    for (let i = 0; i < 3; i += 1) {
      const next = iterator.next() as IcalTime | null;
      if (!next || (last && next.compare(last) <= 0))
        throw new RuleError('This repeat rule never produces a date');
      last = next.clone();
    }
  } catch (err) {
    if (err instanceof RuleError) throw err;
    throw new RuleError('This repeat rule is not valid');
  }
  if (Date.now() - started > MAX_PROBE_MS) throw new RuleError('This repeat rule is too complex');
}

function parseRuleString(rrule: string): Recur {
  const text = rrule.trim().replace(/^RRULE:/i, '');
  if (text.length === 0 || text.length > 500) throw new RuleError('This repeat rule is not valid');
  let recur: Recur;
  try {
    recur = ICAL.Recur.fromString(text);
  } catch {
    throw new RuleError('This repeat rule is not valid');
  }
  if (!SUPPORTED_FREQ.has(recur.freq)) {
    throw new RuleError('Only daily, weekly, monthly and yearly repeats are supported');
  }
  for (const part of Object.keys(recur.parts)) {
    if (!SUPPORTED_PARTS.has(part))
      throw new RuleError(`Repeat rules with ${part} are not supported`);
  }
  if (!Number.isInteger(recur.interval) || recur.interval < 1 || recur.interval > 999) {
    throw new RuleError('This repeat rule is not valid');
  }
  if (recur.count !== null && recur.count !== undefined) {
    if (!Number.isInteger(recur.count) || recur.count < 1)
      throw new RuleError('This repeat rule is not valid');
    if (recur.count > MAX_RULE_COUNT) {
      throw new RuleError(
        `Repeats of more than ${MAX_RULE_COUNT.toLocaleString('en-US')} meetings are not supported`,
      );
    }
  }
  assertExpandable(recur);
  return recur;
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

function parseRule(rrule: string, timeZone: string): ParsedRule {
  const recur = parseRuleString(rrule);
  let untilMs: number | null = null;
  const until = recur.until as IcalTime | null;
  if (until) {
    if (until.isDate) {
      // A DATE until includes that whole local day.
      const startOfDay = wallToUtc({ ...wallOf(until), hour: 0, minute: 0, second: 0 }, timeZone);
      untilMs = addLocalDays(startOfDay, 1, timeZone) - 1;
    } else if (until.zone && until.zone.tzid === 'UTC') {
      untilMs = until.toUnixTime() * 1000;
    } else {
      // Floating (not RFC compliant, but seen): read it in the meeting's zone.
      untilMs = wallToUtc(wallOf(until), timeZone);
    }
    recur.until = null;
  }
  const count = typeof recur.count === 'number' ? recur.count : null;
  return { recur, untilMs, count };
}

function startTime(series: Pick<SeriesShape, 'startsAt' | 'allDay' | 'timeZone'>): IcalTime {
  const w = utcToWall(series.startsAt.getTime(), series.timeZone);
  return series.allDay
    ? ICAL.Time.fromData({ year: w.year, month: w.month, day: w.day, isDate: true })
    : ICAL.Time.fromData({
        year: w.year,
        month: w.month,
        day: w.day,
        hour: w.hour,
        minute: w.minute,
        second: w.second,
      });
}

/** End of an occurrence starting at `startMs`, keeping the series' length. */
function endFor(
  series: Pick<SeriesShape, 'startsAt' | 'endsAt' | 'allDay' | 'timeZone'>,
  startMs: number,
): number {
  if (series.allDay) {
    const days = Math.max(
      1,
      Math.round((series.endsAt.getTime() - series.startsAt.getTime()) / DAY_MS),
    );
    return addLocalDays(startMs, days, series.timeZone);
  }
  return startMs + (series.endsAt.getTime() - series.startsAt.getTime());
}

/**
 * Walk the series' generated occurrence starts (exdates and overrides not
 * applied) in order. `visit` returns false to stop. Returns false when the
 * walk was cut short: the iteration cap, the wall-clock bound, or the
 * request's shared budget (which is then marked exhausted). No input can
 * hold the event loop for longer than MAX_WALK_MS.
 */
function walk(
  series: SeriesShape,
  visit: (originalStartMs: number, index: number) => boolean,
  budget?: ExpansionBudget,
): boolean {
  if (!series.rrule) {
    visit(series.startsAt.getTime(), 0);
    return true;
  }
  const rule = parseRule(series.rrule, series.timeZone);
  const iterator = rule.recur.iterator(startTime(series));
  const startedAt = Date.now();
  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    if (budget) {
      if (budget.remaining <= 0) {
        budget.exhausted = true;
        return false;
      }
      budget.remaining -= 1;
    }
    if ((i & 255) === 255 && Date.now() - startedAt > MAX_WALK_MS) return false;
    const next = iterator.next() as IcalTime | null;
    if (!next) return true;
    const w = wallOf(next);
    const ms = wallToUtc(
      series.allDay ? { ...w, hour: 0, minute: 0, second: 0 } : w,
      series.timeZone,
    );
    if (rule.untilMs !== null && ms > rule.untilMs) return true;
    if (!visit(ms, i)) return true;
  }
  return false;
}

export interface ExpandOptions {
  /** Keep an occurrence when this says so (default: overlaps [from, to)). */
  match?: (startMs: number, endMs: number) => boolean;
  limit?: number;
  /** Iterations shared with the other expansions of the same request. */
  budget?: ExpansionBudget;
}

/**
 * Occurrences of a series that overlap [from, to), in start order, with
 * exdates removed and per-occurrence changes applied.
 */
export function expandOccurrences(
  series: SeriesShape,
  from: Date,
  to: Date,
  opts: ExpandOptions = {},
): { items: Occurrence[]; truncated: boolean } {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const match = opts.match ?? ((s: number, e: number) => s < toMs && e > fromMs);
  const limit = opts.limit ?? 1000;
  const excluded = new Set(series.exdates.map((d) => d.getTime()));
  const overrides = new Map<number, OverrideShape>();
  if (series.rrule) {
    for (const o of series.overrides) overrides.set(o.originalStart.getTime(), o);
  }
  const items: Occurrence[] = [];
  let truncated = false;
  const stop: { at: number | null } = { at: null };
  const generatedOverrides = new Set<number>();

  // The earliest an occurrence of this length can start and still overlap.
  const span = series.allDay
    ? Math.max(1, Math.round((series.endsAt.getTime() - series.startsAt.getTime()) / DAY_MS)) *
        DAY_MS +
      2 * 3_600_000
    : series.endsAt.getTime() - series.startsAt.getTime();
  const completed = walk(
    series,
    (ms) => {
      if (overrides.has(ms)) generatedOverrides.add(ms);
      if (ms >= toMs) {
        stop.at = ms;
        return false;
      }
      if (ms + span < fromMs) return true;
      if (excluded.has(ms) || overrides.has(ms)) return true;
      const end = endFor(series, ms);
      if (match(ms, end)) {
        if (items.length >= limit) {
          truncated = true;
          stop.at = ms;
          return false;
        }
        items.push({
          originalStart: new Date(ms),
          startsAt: new Date(ms),
          endsAt: new Date(end),
          override: null,
        });
      }
      return true;
    },
    opts.budget,
  );
  if (!completed) truncated = true;

  // Changed occurrences are placed by their own times, which may sit outside
  // the generated order. Only ones the series still produces count (an
  // override left behind by a shortened rule is ignored), and an exdate wins.
  // Ones past the point the walk stopped are checked with ONE more walk.
  const stoppedAt = stop.at;
  const pending =
    stoppedAt === null
      ? []
      : [...overrides.keys()].filter(
          (key) => !generatedOverrides.has(key) && !excluded.has(key) && key >= stoppedAt,
        );
  if (pending.length > 0) {
    const last = Math.max(...pending);
    const resumed = walk(
      series,
      (ms) => {
        if (overrides.has(ms)) generatedOverrides.add(ms);
        return ms < last;
      },
      opts.budget,
    );
    if (!resumed) truncated = true;
  }
  for (const o of overrides.values()) {
    const key = o.originalStart.getTime();
    if (excluded.has(key) || !generatedOverrides.has(key)) continue;
    if (!match(o.startsAt.getTime(), o.endsAt.getTime())) continue;
    if (items.length >= limit) {
      truncated = true;
      break;
    }
    items.push({
      originalStart: o.originalStart,
      startsAt: o.startsAt,
      endsAt: o.endsAt,
      override: o,
    });
  }
  items.sort(
    (a, b) =>
      a.startsAt.getTime() - b.startsAt.getTime() ||
      a.originalStart.getTime() - b.originalStart.getTime(),
  );
  return { items, truncated };
}

/** True when the series generates an occurrence starting at `originalStart` (exdates ignored). */
export function isOccurrenceStart(series: SeriesShape, originalStart: Date): boolean {
  const target = originalStart.getTime();
  let found = false;
  walk(series, (ms) => {
    if (ms === target) found = true;
    return ms < target;
  });
  return found;
}

/** The live occurrence (not exdated) whose series start is `originalStart`, or null. */
export function occurrenceAt(series: SeriesShape, originalStart: Date): Occurrence | null {
  const key = originalStart.getTime();
  if (series.exdates.some((d) => d.getTime() === key)) return null;
  if (!isOccurrenceStart(series, originalStart)) return null;
  const override = series.rrule
    ? (series.overrides.find((o) => o.originalStart.getTime() === key) ?? null)
    : null;
  if (override)
    return { originalStart, startsAt: override.startsAt, endsAt: override.endsAt, override };
  return {
    originalStart,
    startsAt: originalStart,
    endsAt: new Date(endFor(series, key)),
    override: null,
  };
}

/**
 * The first live occurrence (exdates and changed occurrences applied) that
 * starts after `afterMs`, or null. A changed occurrence counts by its own
 * start, and only when the series still generates its original start.
 */
export function nextOccurrenceAfter(series: SeriesShape, afterMs: number): Occurrence | null {
  if (!series.rrule) {
    return series.startsAt.getTime() > afterMs
      ? {
          originalStart: series.startsAt,
          startsAt: series.startsAt,
          endsAt: series.endsAt,
          override: null,
        }
      : null;
  }
  const excluded = new Set(series.exdates.map((d) => d.getTime()));
  const overrides = new Map(series.overrides.map((o) => [o.originalStart.getTime(), o] as const));
  // Changed occurrences that would start in time: walk far enough to know
  // the series still generates each of them.
  const wanted = [...overrides.values()].filter(
    (o) => o.startsAt.getTime() > afterMs && !excluded.has(o.originalStart.getTime()),
  );
  const walkUntil =
    wanted.length > 0 ? Math.max(...wanted.map((o) => o.originalStart.getTime())) : -Infinity;
  const generated = new Set<number>();
  let plain: number | null = null;
  walk(series, (ms) => {
    if (overrides.has(ms)) generated.add(ms);
    else if (plain === null && ms > afterMs && !excluded.has(ms)) plain = ms;
    return plain === null || ms < walkUntil;
  });
  let best: Occurrence | null = null;
  if (plain !== null) {
    const ms: number = plain;
    best = {
      originalStart: new Date(ms),
      startsAt: new Date(ms),
      endsAt: new Date(endFor(series, ms)),
      override: null,
    };
  }
  for (const o of wanted) {
    if (!generated.has(o.originalStart.getTime())) continue;
    if (!best || o.startsAt.getTime() < best.startsAt.getTime()) {
      best = {
        originalStart: o.originalStart,
        startsAt: o.startsAt,
        endsAt: o.endsAt,
        override: o,
      };
    }
  }
  return best;
}

export type RebaseResult =
  | { kind: 'unchanged' }
  | { kind: 'rebased'; startsAt: Date; endsAt: Date }
  | { kind: 'too-long' };

/** Iterations (cheap, no zone math) the import may spend fast-forwarding one old series. */
const REBASE_MAX_ITERATIONS = 400_000;
const REBASE_MAX_MS = 200;

/**
 * For an imported series without COUNT that started before `notBeforeMs`:
 * its first occurrence on or after that instant, so stored series never
 * start decades back (every walk starts at the series start and is capped).
 * `unchanged` when nothing needs moving (or the series ended in a short
 * walk), `too-long` when the series cannot be read within the bounds.
 * `budget` (ms) is shared across one import.
 */
export function rebaseSeries(
  series: Pick<SeriesShape, 'startsAt' | 'endsAt' | 'allDay' | 'timeZone' | 'rrule'>,
  notBeforeMs: number,
  budget: { ms: number },
): RebaseResult {
  if (!series.rrule || series.startsAt.getTime() >= notBeforeMs) return { kind: 'unchanged' };
  const rule = parseRule(series.rrule, series.timeZone);
  if (rule.count !== null) return { kind: 'unchanged' };
  const target = utcToWall(notBeforeMs, series.timeZone);
  // Floating wall time one day early: zone offsets never move a wall time by
  // more than that, and the exact check below runs on instants.
  const early = ICAL.Time.fromData({
    year: target.year,
    month: target.month,
    day: target.day,
    hour: 0,
    minute: 0,
    second: 0,
  });
  early.adjust(-1, 0, 0, 0);
  let lateUntil: IcalTime | null = null;
  if (rule.untilMs !== null) {
    const u = utcToWall(rule.untilMs, series.timeZone);
    lateUntil = ICAL.Time.fromData({
      year: u.year,
      month: u.month,
      day: u.day,
      hour: 0,
      minute: 0,
      second: 0,
    });
    lateUntil.adjust(2, 0, 0, 0);
  }
  const ended = (i: number): RebaseResult =>
    i <= MAX_ITERATIONS ? { kind: 'unchanged' } : { kind: 'too-long' };
  const iterator = rule.recur.iterator(startTime(series));
  const startedAt = Date.now();
  const limitMs = Math.min(REBASE_MAX_MS, budget.ms);
  try {
    for (let i = 0; i < REBASE_MAX_ITERATIONS; i += 1) {
      if ((i & 1023) === 1023 && Date.now() - startedAt > limitMs) return { kind: 'too-long' };
      const next = iterator.next() as IcalTime | null;
      if (!next || (lateUntil && next.compare(lateUntil) > 0)) return ended(i);
      if (next.compare(early) < 0) continue;
      const w = wallOf(next);
      const ms = wallToUtc(
        series.allDay ? { ...w, hour: 0, minute: 0, second: 0 } : w,
        series.timeZone,
      );
      if (rule.untilMs !== null && ms > rule.untilMs) return ended(i);
      if (ms < notBeforeMs) continue;
      if (i === 0) return { kind: 'unchanged' };
      return { kind: 'rebased', startsAt: new Date(ms), endsAt: new Date(endFor(series, ms)) };
    }
    return { kind: 'too-long' };
  } finally {
    budget.ms = Math.max(0, budget.ms - (Date.now() - startedAt));
  }
}

/** How many occurrences the rule generates before `before` (exdated ones included, as COUNT counts them). */
export function countOccurrencesBefore(series: SeriesShape, before: Date): number {
  const limit = before.getTime();
  let n = 0;
  walk(series, (ms) => {
    if (ms >= limit) return false;
    n += 1;
    return true;
  });
  return n;
}

/**
 * End of the last occurrence (overrides included), or null for a series that
 * never ends (or one too long to walk, which range queries then treat as
 * open-ended).
 */
export function computeLastEndsAt(series: SeriesShape): Date | null {
  if (!series.rrule) return series.endsAt;
  const rule = parseRule(series.rrule, series.timeZone);
  if (rule.untilMs === null && rule.count === null) return null;
  const excluded = new Set(series.exdates.map((d) => d.getTime()));
  const overridden = new Map(series.overrides.map((o) => [o.originalStart.getTime(), o] as const));
  let last = -Infinity;
  const completed = walk(series, (ms) => {
    if (excluded.has(ms)) return true;
    const o = overridden.get(ms);
    last = Math.max(last, o ? o.endsAt.getTime() : endFor(series, ms));
    return true;
  });
  if (!completed) return null;
  return new Date(Number.isFinite(last) ? last : series.endsAt.getTime());
}

// ------------------------------------------------------------ rule text

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function utcStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function localDateStamp(ms: number, timeZone: string): string {
  const w = utcToWall(ms, timeZone);
  return `${w.year}${pad(w.month)}${pad(w.day)}`;
}

/** UNTIL for "the last occurrence starts at or before `untilMs`". */
function untilPart(untilMs: number, allDay: boolean, timeZone: string): string {
  return `UNTIL=${allDay ? localDateStamp(untilMs, timeZone) : utcStamp(untilMs)}`;
}

/**
 * The stored RRULE for an app recurrence. `until` means "through that local
 * day": occurrences starting on the until date are kept.
 */
export function buildRrule(rec: MeetingRecurrence, allDay: boolean, timeZone: string): string {
  const parts = [`FREQ=${rec.freq}`];
  if (rec.interval > 1) parts.push(`INTERVAL=${rec.interval}`);
  if (rec.freq === 'WEEKLY' && rec.byDay && rec.byDay.length > 0) {
    const order = new Map(WEEKDAYS.map((d, i) => [d, (i + 6) % 7] as const));
    const days = [...new Set(rec.byDay)].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    parts.push(`BYDAY=${days.join(',')}`);
  }
  if (rec.count !== undefined) parts.push(`COUNT=${rec.count}`);
  if (rec.until !== undefined) {
    const endOfDay = addLocalDays(rec.until.getTime(), 1, timeZone) - 1000;
    parts.push(untilPart(endOfDay, allDay, timeZone));
  }
  const rrule = parts.join(';');
  parseRuleString(rrule);
  return rrule;
}

/** The app's editable recurrence for a stored rule, or null when it is richer than the editor. */
export function ruleToRecurrence(rrule: string | null, timeZone: string): MeetingRecurrence | null {
  if (!rrule) return null;
  let rule: ParsedRule;
  try {
    rule = parseRule(rrule, timeZone);
  } catch {
    return null;
  }
  const { recur } = rule;
  const partNames = Object.keys(recur.parts);
  const byDayRaw = (recur.parts.BYDAY ?? []) as unknown[];
  if (partNames.some((p) => p !== 'BYDAY')) return null;
  if (byDayRaw.length > 0 && recur.freq !== 'WEEKLY') return null;
  const byDay: MeetingWeekday[] = [];
  for (const d of byDayRaw) {
    if (typeof d !== 'string' || !WEEKDAYS.includes(d as MeetingWeekday)) return null;
    byDay.push(d as MeetingWeekday);
  }
  if (rule.count !== null && rule.count > 1000) return null;
  const out: MeetingRecurrence = {
    freq: recur.freq as MeetingRecurrence['freq'],
    interval: recur.interval,
  };
  if (byDay.length > 0) out.byDay = byDay;
  if (rule.count !== null) out.count = rule.count;
  if (rule.untilMs !== null) out.until = new Date(rule.untilMs);
  return out;
}

/** The rule with every occurrence from `before` on removed (COUNT becomes an UNTIL). */
export function truncateRule(
  rrule: string,
  before: Date,
  allDay: boolean,
  timeZone: string,
): string {
  const recur = parseRuleString(rrule);
  recur.until = null;
  recur.count = null;
  const lastAllowed = allDay
    ? addLocalDays(before.getTime(), -1, timeZone)
    : before.getTime() - 1000;
  const base = recur.toString();
  return `${base};${untilPart(lastAllowed, allDay, timeZone)}`;
}

/** The rule with COUNT replaced (for the second half of a split series). */
export function withCount(rrule: string, count: number): string {
  const recur = parseRuleString(rrule);
  recur.count = count;
  return recur.toString();
}

/** Weekday code of an instant in a zone. */
export function weekdayIn(ms: number, timeZone: string): MeetingWeekday {
  const w = utcToWall(ms, timeZone);
  const day = new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();
  return WEEKDAYS[day] ?? 'MO';
}
