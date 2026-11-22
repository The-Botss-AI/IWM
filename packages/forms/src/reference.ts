import { getCountries } from 'libphonenumber-js';
import { RE2JS } from 're2js';

import type { FormPattern } from '@botss/shared-types';

// ─── Patterns ───────────────────────────────────────────────────────────────

/** Anything that can check a whole answer against a pattern. */
export interface PatternTester {
  test(input: string): boolean;
}

/** Fixed, linear presets (no nested or overlapping quantifiers). */
const PRESETS: Record<Exclude<FormPattern['preset'], 'custom'>, PatternTester> = {
  letters: /^[\p{L}\p{M}\s'.-]*$/u,
  digits: /^\d*$/,
  alphanumeric: /^[\p{L}\p{M}\p{N}\s]*$/u,
};

const PRESET_MESSAGES: Record<FormPattern['preset'], string> = {
  letters: 'Use letters only',
  digits: 'Use digits only',
  alphanumeric: 'Use letters and digits only',
  custom: 'This answer is not in the expected format',
};

/**
 * Custom patterns are written by form owners and run on anonymous input, so
 * they never touch V8's backtracking engine: RE2 matches in linear time
 * whatever the pattern (no lookaround or backreferences, which RE2 rejects).
 * `matches` is a whole-string match, like an HTML `pattern` attribute.
 */
function compileCustom(source: string): PatternTester | null {
  try {
    const re = RE2JS.compile(source);
    return { test: (input: string) => re.matches(input) };
  } catch {
    return null;
  }
}

/** A custom pattern is usable when it is 1 to 200 characters and RE2 accepts it. */
export function isSafePattern(source: string): boolean {
  if (source.length === 0 || source.length > 200) return false;
  return compileCustom(source) !== null;
}

/** The whole-answer tester for a pattern, or null if a custom one is unusable. */
export function compilePattern(pattern: FormPattern): PatternTester | null {
  if (pattern.preset !== 'custom') return PRESETS[pattern.preset];
  if (!pattern.regex || !isSafePattern(pattern.regex)) return null;
  return compileCustom(pattern.regex);
}

export function patternMessage(pattern: FormPattern): string {
  return pattern.message?.trim() || PRESET_MESSAGES[pattern.preset];
}

// ─── Countries and time zones ───────────────────────────────────────────────

/** ISO 3166-1 alpha-2 codes known to the phone metadata (about 245). */
export const COUNTRY_CODES: readonly string[] = [...getCountries()].sort();
const COUNTRY_SET = new Set<string>(COUNTRY_CODES);

export function isCountryCode(code: string): boolean {
  return COUNTRY_SET.has(code);
}

/** Localised country name, falling back to the code. */
export function countryName(code: string, locale = 'en'): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

let zones: Set<string> | null = null;

/** IANA time zones the runtime knows, plus UTC. */
export function timeZoneIds(): string[] {
  return [...timeZoneSet()];
}

function timeZoneSet(): Set<string> {
  if (!zones) {
    const list =
      typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
    zones = new Set(['UTC', ...list]);
  }
  return zones;
}

export function isTimeZone(id: string): boolean {
  if (timeZoneSet().has(id)) return true;
  // Older runtimes list fewer zones; accept anything the formatter accepts.
  try {
    new Intl.DateTimeFormat('en', { timeZone: id });
    return /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(id);
  } catch {
    return false;
  }
}
