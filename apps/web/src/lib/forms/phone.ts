import { COUNTRY_CODES } from '@botss/forms';
import {
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';

const KNOWN = new Set<string>(COUNTRY_CODES);

export function callingCode(country: string): string {
  try {
    return getCountryCallingCode(country as CountryCode);
  } catch {
    return '';
  }
}

/** E.164 when the number parses, else `+<code><digits>` so the server explains. */
export function buildPhoneValue(country: string, national: string): string | undefined {
  const digits = national.replace(/\D/g, '');
  if (!digits) return undefined;
  const parsed = parsePhoneNumberFromString(national, country as CountryCode);
  if (parsed) return parsed.number;
  return national.trim().startsWith('+') ? `+${digits}` : `+${callingCode(country)}${digits}`;
}

/** Region of a browser language tag ('en-AE' -> 'AE'), only when it is a known country. */
export function regionFromLanguage(language: string | undefined): string | undefined {
  const region = language?.split('-')[1]?.toUpperCase();
  return region && KNOWN.has(region) ? region : undefined;
}

/** Country to start on: the field's default, then the browser region, then Pakistan. */
export function defaultPhoneCountry(
  configured: string | undefined,
  language: string | undefined,
): string {
  return configured ?? regionFromLanguage(language) ?? 'PK';
}

/** For a number typed with a leading '+': the country and national part it names, if it parses. */
export function parseInternational(typed: string): { country: string; national: string } | null {
  if (!typed.trim().startsWith('+')) return null;
  const parsed = parsePhoneNumberFromString(typed);
  if (!parsed?.country || !KNOWN.has(parsed.country)) return null;
  return { country: parsed.country, national: parsed.nationalNumber };
}

/** Country and national number of a stored E.164 value. */
export function splitPhoneValue(value: unknown): { country: string | undefined; national: string } {
  const parsed = typeof value === 'string' ? parsePhoneNumberFromString(value) : undefined;
  return { country: parsed?.country, national: parsed?.nationalNumber ?? '' };
}
