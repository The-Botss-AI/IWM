import { parsePhoneNumberFromString } from 'libphonenumber-js';

import {
  FORM_LIMITS,
  isFormInputType,
  type FormAnswers,
  type FormDefinition,
  type FormField,
  type FormLayoutType,
  type FormRepeaterChild,
} from '@botss/shared-types';

import { evaluateExpression, ExpressionError, parseExpression, roundTo } from './expression.js';
import { answerIsEmpty, numericValue, walkVisible, type AnswerMap } from './logic.js';
import { compilePattern, isCountryCode, isTimeZone, patternMessage } from './reference.js';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type InputField = Exclude<FormField, { type: FormLayoutType }>;
type Validatable = Exclude<InputField, { type: 'hidden' | 'calculated' }> | FormRepeaterChild;

/** Choice answers that are free text start with this prefix (option ids never contain ":"). */
export const OTHER_PREFIX = 'other:';

export type ValidateMode = 'public' | 'internal';

export interface ValidateOptions {
  /** Public fills drop CRM pickers. */
  mode: ValidateMode;
}

export interface UploadRef {
  fieldId: string;
  uploadIds: string[];
}

export interface CrmRef {
  fieldId: string;
  entity: 'member' | 'client' | 'project' | 'lead';
  ids: string[];
}

export type ValidateResult =
  | { ok: true; answers: FormAnswers; uploads: UploadRef[]; crm: CrmRef[] }
  | { ok: false; errors: Record<string, string> };

type Outcome =
  | { kind: 'value'; value: JsonValue }
  | { kind: 'error'; error: string }
  | { kind: 'empty' };

const REQUIRED = 'This field is required';
const value = (v: JsonValue): Outcome => ({ kind: 'value', value: v });
const EMPTY: Outcome = { kind: 'empty' };
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

function err(field: Validatable, fallback: string): Outcome {
  return { kind: 'error', error: field.errorMessage?.trim() || fallback };
}

function str(raw: unknown): string | null {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return null;
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

/** Own property only: answer objects come from JSON, so inherited names never count. */
function own(obj: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

/** Hard caps on the raw shape of one answer, checked before any per-type work. */
const MAX_DEPTH = 12;
const MAX_ARRAY = 1000;
const MAX_NODES = 20000;
const MAX_STRING = 100000;

/**
 * True when an answer is small enough to validate: bounded nesting, array
 * lengths, string lengths and total node count. Stops at the first breach,
 * so a hostile payload costs at most MAX_NODES steps.
 */
function withinBounds(value: unknown): boolean {
  let nodes = 0;
  const walk = (v: unknown, depth: number): boolean => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) return false;
    if (typeof v === 'string') return v.length <= MAX_STRING;
    if (Array.isArray(v)) {
      if (v.length > MAX_ARRAY) return false;
      for (const item of v) if (!walk(item, depth + 1)) return false;
      return true;
    }
    if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      if (keys.length > MAX_ARRAY) return false;
      for (const k of keys) if (!walk((v as Record<string, unknown>)[k], depth + 1)) return false;
    }
    return true;
  };
  return walk(value, 0);
}

function validDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function textLength(
  field: Validatable & { minLength?: number | undefined; maxLength?: number | undefined },
  s: string,
  cap: number,
): Outcome | null {
  const max = Math.min(field.maxLength ?? cap, cap);
  if (s.length > max) return err(field, `Use at most ${max} characters`);
  if (field.minLength !== undefined && s.length < field.minLength) {
    return err(field, `Use at least ${field.minLength} characters`);
  }
  return null;
}

function numberIn(
  field: Validatable,
  raw: unknown,
  min?: number,
  max?: number,
  decimals?: number,
): Outcome {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw)
        : Number.NaN;
  if (!Number.isFinite(n)) return err(field, 'Enter a number');
  const v = decimals === undefined ? n : roundTo(n, decimals);
  if (min !== undefined && v < min) return err(field, `Enter ${min} or more`);
  if (max !== undefined && v > max) return err(field, `Enter ${max} or less`);
  return value(v);
}

function choiceOne(
  field: Validatable,
  raw: unknown,
  ids: ReadonlySet<string>,
  allowOther: boolean,
): Outcome {
  if (typeof raw !== 'string') return err(field, 'Pick one of the options');
  if (allowOther && raw.startsWith(OTHER_PREFIX)) {
    const text = raw.slice(OTHER_PREFIX.length).trim();
    if (!text) return EMPTY;
    if (text.length > 300) return err(field, 'Use at most 300 characters');
    return value(OTHER_PREFIX + text);
  }
  return ids.has(raw) ? value(raw) : err(field, 'Pick one of the options');
}

function choiceMany(
  field: Validatable,
  raw: unknown,
  ids: ReadonlySet<string>,
  allowOther: boolean,
  minSelected?: number,
  maxSelected?: number,
): Outcome {
  if (!Array.isArray(raw)) return err(field, 'Pick from the options');
  // Every real pick is a distinct option, plus at most one "Other".
  if (raw.length > ids.size + 1) return err(field, 'Pick from the options');
  const out = new Set<string>();
  let others = 0;
  for (const item of raw) {
    const one = choiceOne(field, item, ids, allowOther);
    if (one.kind === 'error') return one;
    if (one.kind === 'empty') continue;
    const v = one.value as string;
    if (v.startsWith(OTHER_PREFIX) && ++others > 1)
      return err(field, 'Only one "Other" answer is allowed');
    out.add(v);
  }
  if (out.size === 0) return EMPTY;
  if (minSelected !== undefined && out.size < minSelected)
    return err(field, `Pick at least ${minSelected}`);
  if (maxSelected !== undefined && out.size > maxSelected)
    return err(field, `Pick at most ${maxSelected}`);
  return value([...out]);
}

function idList(field: Validatable, raw: unknown, max: number): Outcome {
  const list = Array.isArray(raw) ? raw : [raw];
  if (list.length > max) return err(field, `Add at most ${max}`);
  const out = new Set<string>();
  for (const id of list) {
    if (typeof id !== 'string' || !ID_RE.test(id)) return err(field, 'This answer is not valid');
    out.add(id);
  }
  if (out.size === 0) return EMPTY;
  return value([...out]);
}

// ─── Rich text (Tiptap / ProseMirror JSON) ──────────────────────────────────

const RICH_NODES = new Set([
  'doc',
  'paragraph',
  'text',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'hardBreak',
  'blockquote',
]);
const RICH_MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'link']);
const RICH_KEYS = new Set(['type', 'content', 'text', 'marks', 'attrs']);

function primitiveAttrs(attrs: unknown): boolean {
  if (attrs === undefined || attrs === null) return true;
  if (!isRecord(attrs) || Object.keys(attrs).length > 8) return false;
  return Object.values(attrs).every(
    (v) =>
      v === null ||
      typeof v === 'boolean' ||
      typeof v === 'number' ||
      (typeof v === 'string' && v.length <= 2000),
  );
}

/** Returns the plain-text length, or -1 if the document is not allowed. */
function richTextLength(node: unknown, depth: number): number {
  if (depth > 30 || !isRecord(node)) return -1;
  if (Object.keys(node).some((k) => !RICH_KEYS.has(k))) return -1;
  if (typeof node.type !== 'string' || !RICH_NODES.has(node.type)) return -1;
  if (!primitiveAttrs(node.attrs)) return -1;
  let len = 0;
  if (node.type === 'text') {
    if (typeof node.text !== 'string') return -1;
    len += node.text.length;
  } else if (node.text !== undefined) {
    return -1;
  }
  if (node.marks !== undefined) {
    if (!Array.isArray(node.marks) || node.marks.length > 10) return -1;
    for (const mark of node.marks) {
      if (!isRecord(mark) || typeof mark.type !== 'string' || !RICH_MARKS.has(mark.type)) return -1;
      if (
        Object.keys(mark).some((k) => k !== 'type' && k !== 'attrs') ||
        !primitiveAttrs(mark.attrs)
      )
        return -1;
      if (mark.type === 'link') {
        const href = isRecord(mark.attrs) ? mark.attrs.href : undefined;
        if (typeof href !== 'string' || !/^(https?:\/\/|mailto:)/i.test(href)) return -1;
      }
    }
  }
  if (node.content !== undefined) {
    if (!Array.isArray(node.content)) return -1;
    for (const child of node.content) {
      const n = richTextLength(child, depth + 1);
      if (n < 0) return -1;
      len += n;
    }
  }
  return len;
}

// ─── Per type ───────────────────────────────────────────────────────────────

function check(field: Validatable, raw: unknown, mode: ValidateMode): Outcome {
  if (field.type !== 'consent' && field.type !== 'yes_no' && answerIsEmpty(raw)) return EMPTY;

  switch (field.type) {
    case 'short_text': {
      const s = str(raw)?.trim();
      if (s === undefined) return err(field, 'Enter text');
      if (!s) return EMPTY;
      const cap = field.pattern ? FORM_LIMITS.maxPatternInputLength : FORM_LIMITS.maxShortText;
      const bad = textLength(field, s, cap);
      if (bad) return bad;
      if (field.pattern) {
        const re = compilePattern(field.pattern);
        if (re && !re.test(s)) return { kind: 'error', error: patternMessage(field.pattern) };
      }
      return value(s);
    }
    case 'long_text': {
      const s = str(raw)?.trim();
      if (s === undefined) return err(field, 'Enter text');
      if (!s) return EMPTY;
      return textLength(field, s, FORM_LIMITS.maxLongText) ?? value(s);
    }
    case 'email': {
      const s = str(raw)?.trim();
      if (!s || s.length > 320 || !EMAIL.test(s)) return err(field, 'Enter a valid email address');
      return value(s);
    }
    case 'phone': {
      const s = str(raw)?.trim();
      const phone = s && s.length <= 40 ? parsePhoneNumberFromString(s) : undefined;
      if (!phone || !phone.isValid())
        return err(field, 'Enter a valid phone number with its country code');
      return value(phone.number);
    }
    case 'number':
    case 'percentage':
      return numberIn(field, raw, field.min, field.max, field.decimals);
    case 'currency': {
      if (!isRecord(raw)) return err(field, 'Enter an amount');
      const rawAmount = own(raw, 'amount');
      if (rawAmount === undefined || rawAmount === null || rawAmount === '') return EMPTY;
      const amount = numberIn(field, rawAmount, field.min, field.max, 2);
      if (amount.kind !== 'value') return amount;
      const rawCurrency = own(raw, 'currency');
      const cur =
        typeof rawCurrency === 'string'
          ? rawCurrency
          : (field.defaultCurrency ?? field.currencies[0]);
      if (!cur || !field.currencies.includes(cur)) return err(field, 'Pick a currency');
      return value({ amount: amount.value, currency: cur });
    }
    case 'url': {
      let s = str(raw)?.trim();
      if (!s) return err(field, 'Enter a link');
      if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
      try {
        const u = new URL(s);
        if (
          (u.protocol !== 'http:' && u.protocol !== 'https:') ||
          !u.hostname.includes('.') ||
          s.length > 2000
        ) {
          return err(field, 'Enter a valid web link');
        }
        return value(u.toString());
      } catch {
        return err(field, 'Enter a valid web link');
      }
    }
    case 'dropdown':
    case 'radio':
      return choiceOne(
        field,
        raw,
        new Set(field.options.map((o) => o.id)),
        field.allowOther === true,
      );
    case 'multi_select':
      return choiceMany(
        field,
        raw,
        new Set(field.options.map((o) => o.id)),
        false,
        field.minSelected,
        field.maxSelected,
      );
    case 'checkboxes':
      return choiceMany(
        field,
        raw,
        new Set(field.options.map((o) => o.id)),
        field.allowOther === true,
        field.minSelected,
        field.maxSelected,
      );
    case 'picture_choice': {
      const ids = new Set(field.options.map((o) => o.id));
      return field.multiple
        ? choiceMany(field, raw, ids, false)
        : choiceOne(field, raw, ids, false);
    }
    case 'yes_no':
      if (raw === undefined || raw === null) return EMPTY;
      return typeof raw === 'boolean' ? value(raw) : err(field, 'Choose yes or no');
    case 'consent':
      if (raw === true) return value(true);
      if (raw === false || raw === undefined || raw === null) return EMPTY;
      return err(field, 'Tick the box to agree');
    case 'tags': {
      if (!Array.isArray(raw)) return err(field, 'Add tags');
      const max = field.maxTags ?? FORM_LIMITS.maxTags;
      if (raw.length > max * 2) return err(field, `Add at most ${max} tags`);
      const out: string[] = [];
      const seen = new Set<string>();
      for (const t of raw) {
        const s = str(t)?.trim();
        if (s === undefined) return err(field, 'Add tags as text');
        if (!s) continue;
        if (s.length > 100) return err(field, 'Keep each tag under 100 characters');
        const key = s.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(s);
      }
      if (out.length === 0) return EMPTY;
      return out.length > max ? err(field, `Add at most ${max} tags`) : value(out);
    }
    case 'date': {
      const s = str(raw);
      if (!s || !validDate(s)) return err(field, 'Enter a valid date');
      if (field.minDate && s < field.minDate) return err(field, `Pick ${field.minDate} or later`);
      if (field.maxDate && s > field.maxDate) return err(field, `Pick ${field.maxDate} or earlier`);
      return value(s);
    }
    case 'time': {
      const s = str(raw);
      if (!s || !ISO_TIME.test(s)) return err(field, 'Enter a valid time');
      if (field.minTime && s < field.minTime) return err(field, `Pick ${field.minTime} or later`);
      if (field.maxTime && s > field.maxTime) return err(field, `Pick ${field.maxTime} or earlier`);
      return value(s);
    }
    case 'datetime': {
      const s = str(raw);
      const d = s && ISO_DATETIME.test(s) ? new Date(s) : null;
      if (!d || Number.isNaN(d.getTime())) return err(field, 'Enter a valid date and time');
      return value(d.toISOString());
    }
    case 'date_range': {
      if (!isRecord(raw)) return err(field, 'Pick a start and end date');
      const start = str(own(raw, 'start'));
      const end = str(own(raw, 'end'));
      if (!start || !end || !validDate(start) || !validDate(end))
        return err(field, 'Pick a start and end date');
      if (end < start) return err(field, 'The end date must be on or after the start date');
      if (field.minDate && start < field.minDate)
        return err(field, `Pick ${field.minDate} or later`);
      if (field.maxDate && end > field.maxDate)
        return err(field, `Pick ${field.maxDate} or earlier`);
      return value({ start, end });
    }
    case 'month': {
      const s = str(raw);
      return s && ISO_MONTH.test(s) ? value(s) : err(field, 'Pick a month');
    }
    case 'duration': {
      const out = numberIn(field, raw, 0, field.maxMinutes ?? 100000);
      if (out.kind !== 'value') return out;
      return Number.isInteger(out.value) ? out : err(field, 'Enter whole minutes');
    }
    case 'timezone': {
      const s = str(raw);
      return s && s.length <= 64 && isTimeZone(s) ? value(s) : err(field, 'Pick a time zone');
    }
    case 'star_rating':
    case 'emoji_rating':
    case 'linear_scale': {
      const [min, max] =
        field.type === 'star_rating'
          ? [1, field.max]
          : field.type === 'emoji_rating'
            ? [1, field.scale]
            : [field.min, field.max];
      const out = numberIn(field, raw, min, max);
      if (out.kind !== 'value') return out;
      return Number.isInteger(out.value) ? out : err(field, 'Pick one of the points');
    }
    case 'slider': {
      const out = numberIn(field, raw, field.min, field.max);
      if (out.kind !== 'value') return out;
      const steps = ((out.value as number) - field.min) / field.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-6)
        return err(field, 'Pick a value on the slider');
      return out;
    }
    case 'matrix': {
      if (!isRecord(raw)) return err(field, 'Answer the rows');
      const rows = new Set(field.rows.map((r) => r.id));
      const cols = new Set(field.columns.map((c) => c.id));
      const out: Record<string, JsonValue> = {};
      for (const [rowId, cell] of Object.entries(raw)) {
        if (!rows.has(rowId)) return err(field, 'This answer is not valid');
        if (answerIsEmpty(cell)) continue;
        if (field.multiple) {
          if (!Array.isArray(cell) || cell.some((c) => typeof c !== 'string' || !cols.has(c))) {
            return err(field, 'Pick from the columns');
          }
          out[rowId] = [...new Set(cell as string[])];
        } else {
          if (typeof cell !== 'string' || !cols.has(cell))
            return err(field, 'Pick from the columns');
          out[rowId] = cell;
        }
      }
      if (Object.keys(out).length === 0) return EMPTY;
      if (field.required && Object.keys(out).length < rows.size)
        return err(field, 'Answer every row');
      return value(out);
    }
    case 'ranking': {
      if (!Array.isArray(raw)) return err(field, 'Put the options in order');
      const ids = field.options.map((o) => o.id);
      const ok =
        raw.length === ids.length &&
        new Set(raw).size === ids.length &&
        raw.every((r) => ids.includes(r as string));
      return ok ? value(raw as string[]) : err(field, 'Put every option in order');
    }
    case 'full_name': {
      if (!isRecord(raw)) return err(field, 'Enter a name');
      const part = (k: string): string => (str(own(raw, k)) ?? '').trim();
      const first = part('first');
      const middle = field.includeMiddle ? part('middle') : '';
      const last = part('last');
      if (![first, middle, last].every((p) => p.length <= 100))
        return err(field, 'Keep each part under 100 characters');
      if (!first && !middle && !last) return EMPTY;
      if (field.required && (!first || !last)) return err(field, 'Enter a first and last name');
      return value({ first, ...(field.includeMiddle ? { middle } : {}), last });
    }
    case 'address': {
      if (!isRecord(raw)) return err(field, 'Enter an address');
      const keys = ['line1', 'line2', 'city', 'state', 'postalCode', 'country'] as const;
      const out: Record<string, string> = {};
      for (const k of keys) {
        if (k === 'line2' && !field.includeLine2) continue;
        const s = (str(own(raw, k)) ?? '').trim();
        if (s.length > 200) return err(field, 'Keep each line under 200 characters');
        out[k] = s;
      }
      // A pre-filled country alone is not an answer.
      if (['line1', 'line2', 'city', 'state', 'postalCode'].every((k) => !out[k])) return EMPTY;
      if (out.country && !isCountryCode(out.country)) return err(field, 'Pick a country');
      if (field.required && (!out.line1 || !out.city || !out.country)) {
        return err(field, 'Enter the street, city and country');
      }
      return value(out);
    }
    case 'country': {
      const s = str(raw);
      return s && isCountryCode(s) ? value(s) : err(field, 'Pick a country');
    }
    case 'location': {
      if (!isRecord(raw)) return err(field, 'Pick a location');
      const lat = numericValue(own(raw, 'lat'));
      const lng = numericValue(own(raw, 'lng'));
      if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180)
        return err(field, 'Pick a location');
      const label = (str(own(raw, 'label')) ?? '').trim();
      if (label.length > 300) return err(field, 'Keep the place name under 300 characters');
      return value({ lat: roundTo(lat, 6), lng: roundTo(lng, 6), ...(label ? { label } : {}) });
    }
    case 'file_upload':
    case 'image_upload':
      return idList(field, raw, field.maxFiles);
    case 'signature':
    case 'audio_recording':
    case 'video_recording': {
      const out = idList(field, raw, 1);
      return out.kind === 'value' ? value((out.value as string[])[0]!) : out;
    }
    case 'color': {
      const s = str(raw);
      return s && HEX.test(s) ? value(s.toLowerCase()) : err(field, 'Pick a colour');
    }
    case 'rich_text': {
      if (!isRecord(raw) || raw.type !== 'doc') return err(field, 'This answer is not valid');
      if (JSON.stringify(raw).length > FORM_LIMITS.maxRichTextJsonBytes)
        return err(field, 'This answer is too long');
      const len = richTextLength(raw, 0);
      if (len < 0) return err(field, 'This answer contains formatting that is not allowed');
      if (len === 0) return EMPTY;
      const max = Math.min(field.maxLength ?? FORM_LIMITS.maxLongText, FORM_LIMITS.maxLongText);
      return len > max ? err(field, `Use at most ${max} characters`) : value(raw as JsonValue);
    }
    case 'crm_picker': {
      if (mode === 'public') return EMPTY;
      const out = idList(field, raw, field.multiple ? 50 : 1);
      if (out.kind !== 'value') return out;
      return field.multiple ? out : value((out.value as string[])[0]!);
    }
    case 'repeater':
      // Handled by validateRepeater (needs the error map).
      return err(field, 'This answer is not valid');
  }
}

type RepeaterField = Extract<InputField, { type: 'repeater' }>;

function validateRepeater(
  field: RepeaterField,
  raw: unknown,
  errors: Record<string, string>,
  mode: ValidateMode,
): Outcome {
  if (answerIsEmpty(raw)) return EMPTY;
  if (!Array.isArray(raw)) return err(field, 'This answer is not valid');
  if (raw.length > field.maxItems) return err(field, `Add at most ${field.maxItems}`);
  const items: Record<string, JsonValue>[] = [];
  let failed = false;
  raw.forEach((item, i) => {
    const row: Record<string, JsonValue> = {};
    const src = isRecord(item) ? item : {};
    for (const child of field.fields) {
      const out = check(child, own(src, child.id), mode);
      const key = `${field.id}.${i}.${child.id}`;
      if (out.kind === 'error') {
        errors[key] = out.error;
        failed = true;
      } else if (out.kind === 'empty') {
        if (child.required) {
          errors[key] = child.errorMessage?.trim() || REQUIRED;
          failed = true;
        }
      } else {
        row[child.id] = out.value;
      }
    }
    if (Object.keys(row).length > 0) items.push(row);
  });
  if (failed) return err(field, 'Check the entries below');
  const min = Math.max(field.minItems ?? 0, field.required ? 1 : 0);
  if (items.length === 0 && min === 0) return EMPTY;
  if (items.length < min) return err(field, `Add at least ${min}`);
  return value(items);
}

/** Recomputes a calculated field from the answers accepted so far. */
function calculate(
  field: Extract<InputField, { type: 'calculated' }>,
  answers: AnswerMap,
  visible: ReadonlySet<string>,
): number | null {
  try {
    const node = parseExpression(field.expression);
    const v = evaluateExpression(node, (id) =>
      visible.has(id) ? numericValue(answers[id]) : null,
    );
    return v === null ? null : roundTo(v, field.decimals);
  } catch (e) {
    if (e instanceof ExpressionError) return null;
    throw e;
  }
}

/**
 * The server's gate for a submission. Walks the form in order, keeps only
 * visible input fields, validates each answer, recomputes calculated fields
 * and returns the clean answer map plus the upload and CRM ids the caller must
 * verify. Unknown keys, hidden fields and layout fields are dropped.
 */
export function validateAnswers(
  def: FormDefinition,
  raw: Readonly<Record<string, unknown>>,
  opts: ValidateOptions,
): ValidateResult {
  const answers: Record<string, JsonValue> = {};
  const errors: Record<string, string> = {};
  const uploads: UploadRef[] = [];
  const crm: CrmRef[] = [];
  const visible = new Set<string>();

  walkVisible(def.fields, answers, visible, (field) => {
    if (!isFormInputType(field.type)) return;
    const f = field as InputField;
    if (f.type === 'calculated') {
      const v = calculate(f, answers, visible);
      if (v !== null) answers[f.id] = v;
      return;
    }
    if (f.type === 'hidden') {
      const s = (str(own(raw, f.id)) ?? f.defaultValue ?? '').trim().slice(0, 500);
      if (s) answers[f.id] = s;
      return;
    }
    if (f.type === 'crm_picker' && opts.mode === 'public') return;

    const input = own(raw, f.id);
    if (!withinBounds(input)) {
      errors[f.id] = 'This answer is too large.';
      return;
    }
    const out =
      f.type === 'repeater'
        ? validateRepeater(f, input, errors, opts.mode)
        : check(f, input, opts.mode);
    if (out.kind === 'error') {
      errors[f.id] = out.error;
      return;
    }
    if (out.kind === 'empty') {
      if (f.required) errors[f.id] = f.errorMessage?.trim() || REQUIRED;
      return;
    }
    answers[f.id] = out.value;
    if (f.type === 'file_upload' || f.type === 'image_upload') {
      uploads.push({ fieldId: f.id, uploadIds: out.value as string[] });
    } else if (
      f.type === 'signature' ||
      f.type === 'audio_recording' ||
      f.type === 'video_recording'
    ) {
      uploads.push({ fieldId: f.id, uploadIds: [out.value as string] });
    } else if (f.type === 'crm_picker') {
      crm.push({
        fieldId: f.id,
        entity: f.entity,
        ids: Array.isArray(out.value) ? (out.value as string[]) : [out.value as string],
      });
    }
  });

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, answers: answers as FormAnswers, uploads, crm };
}

/** Calculated values for live display while filling (same rules as the server). */
export function computeCalculated(def: FormDefinition, answers: AnswerMap): Record<string, number> {
  const working: Record<string, unknown> = { ...answers };
  const out: Record<string, number> = {};
  const visible = new Set<string>();
  walkVisible(def.fields, working, visible, (field) => {
    if (field.type !== 'calculated') return;
    const v = calculate(field, working, visible);
    if (v === null) delete working[field.id];
    else working[field.id] = out[field.id] = v;
  });
  return out;
}
