import { z } from 'zod';

/**
 * Keeps the default validation messages clients saw under zod 3 (problem
 * details `errors` and form field errors). Zod 4 words them differently
 * ("Invalid input: expected string, received undefined"). Messages written
 * on a schema win; this only changes the defaults. Return undefined to fall
 * through to zod's own text.
 */
z.config({
  customError: (iss) => {
    switch (iss.code) {
      case 'invalid_type':
        if (iss.input === undefined) return 'Required';
        if (iss.expected === 'int') return 'Expected integer, received float';
        if (iss.expected === 'date' && iss.input instanceof Date) return 'Invalid date';
        if (
          iss.expected === 'number' &&
          typeof iss.input === 'number' &&
          !Number.isNaN(iss.input)
        ) {
          return 'Number must be finite';
        }
        return `Expected ${iss.expected}, received ${typeOf(iss.input)}`;
      case 'too_small': {
        const n = String(iss.minimum);
        if (iss.exact && iss.origin === 'string') {
          return `String must contain exactly ${n} character(s)`;
        }
        if (iss.exact && iss.origin === 'array') {
          return `Array must contain exactly ${n} element(s)`;
        }
        if (iss.origin === 'string') {
          return `String must contain ${iss.inclusive ? 'at least' : 'over'} ${n} character(s)`;
        }
        if (iss.origin === 'array') {
          return `Array must contain ${iss.inclusive ? 'at least' : 'more than'} ${n} element(s)`;
        }
        if (iss.origin === 'number' || iss.origin === 'int') {
          return `Number must be ${iss.inclusive ? 'greater than or equal to' : 'greater than'} ${n}`;
        }
        return undefined;
      }
      case 'too_big': {
        const n = String(iss.maximum);
        if (iss.exact && iss.origin === 'string') {
          return `String must contain exactly ${n} character(s)`;
        }
        if (iss.exact && iss.origin === 'array') {
          return `Array must contain exactly ${n} element(s)`;
        }
        if (iss.origin === 'string') {
          return `String must contain ${iss.inclusive ? 'at most' : 'under'} ${n} character(s)`;
        }
        if (iss.origin === 'array') {
          return `Array must contain ${iss.inclusive ? 'at most' : 'fewer than'} ${n} element(s)`;
        }
        if (iss.origin === 'number' || iss.origin === 'int') {
          return `Number must be ${iss.inclusive ? 'less than or equal to' : 'less than'} ${n}`;
        }
        return undefined;
      }
      case 'invalid_format':
        if (iss.format === 'email') return 'Invalid email';
        if (iss.format === 'url') return 'Invalid url';
        if (iss.format === 'uuid') return 'Invalid uuid';
        if (iss.format === 'datetime') return 'Invalid datetime';
        if (iss.format === 'regex') return 'Invalid';
        if (iss.format === 'starts_with') {
          return `Invalid input: must start with "${String((iss as { prefix?: string }).prefix)}"`;
        }
        if (iss.format === 'ends_with') {
          return `Invalid input: must end with "${String((iss as { suffix?: string }).suffix)}"`;
        }
        if (iss.format === 'includes') {
          return `Invalid input: must include "${String((iss as { includes?: string }).includes)}"`;
        }
        return undefined;
      case 'unrecognized_keys':
        return `Unrecognized key(s) in object: ${iss.keys.map((k) => `'${k}'`).join(', ')}`;
      case 'invalid_value': {
        if (iss.input === undefined) return 'Required';
        const opts = iss.values.map((v) => JSON.stringify(v)).join(' | ');
        return iss.values.length === 1
          ? `Invalid literal value, expected ${opts}`
          : `Invalid enum value. Expected ${opts.replace(/"/g, "'")}, received '${String(iss.input)}'`;
      }
      default:
        return undefined;
    }
  },
});

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number' && Number.isNaN(v)) return 'nan';
  return typeof v;
}
