import { describe, expect, it } from 'vitest';

import {
  formDefinitionSchema,
  type FormDefinition,
  type FormFieldInput,
} from '@botss/shared-types';

import {
  answerToText,
  checkDefinition,
  computeCalculated,
  csvCell,
  evaluateExpression,
  initialAnswers,
  isSafePattern,
  parseExpression,
  splitPages,
  validateAnswers,
  visibleFieldIds,
} from './index.js';

const def = (fields: FormFieldInput[]): FormDefinition => formDefinitionSchema.parse({ fields });
const opts = (o: { label: string; id: string }[]) => o;
const ABC = opts([
  { id: 'a', label: 'Apple' },
  { id: 'b', label: 'Banana' },
  { id: 'c', label: 'Cherry' },
]);

function accept(
  fields: FormFieldInput[],
  answers: Record<string, unknown>,
  mode: 'public' | 'internal' = 'public',
) {
  const r = validateAnswers(def(fields), answers, { mode });
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.errors)}`);
  return r;
}
function reject(
  fields: FormFieldInput[],
  answers: Record<string, unknown>,
  mode: 'public' | 'internal' = 'public',
) {
  const r = validateAnswers(def(fields), answers, { mode });
  if (r.ok) throw new Error(`expected errors, got ${JSON.stringify(r.answers)}`);
  return r.errors;
}

describe('validateAnswers: text', () => {
  it('trims short text and enforces length, required and presets', () => {
    const f: FormFieldInput = {
      id: 'q',
      type: 'short_text',
      label: 'Q',
      required: true,
      maxLength: 5,
    };
    expect(accept([f], { q: '  hi  ' }).answers.q).toBe('hi');
    expect(reject([f], { q: '   ' }).q).toBe('This field is required');
    expect(reject([f], { q: 'toolong' }).q).toMatch(/at most 5/);
    const digits: FormFieldInput = {
      id: 'd',
      type: 'short_text',
      label: 'D',
      pattern: { preset: 'digits' },
    };
    expect(reject([digits], { d: '12a' }).d).toBe('Use digits only');
    expect(accept([digits], { d: '123' }).answers.d).toBe('123');
  });

  it('caps pattern-checked input at 500 characters', () => {
    const f: FormFieldInput = {
      id: 'q',
      type: 'short_text',
      label: 'Q',
      pattern: { preset: 'letters' },
    };
    expect(reject([f], { q: 'a'.repeat(501) }).q).toMatch(/at most 500/);
  });

  it('applies a safe custom pattern and the custom message', () => {
    const f: FormFieldInput = {
      id: 'q',
      type: 'short_text',
      label: 'Q',
      pattern: { preset: 'custom', regex: '[A-Z]{2}-\\d{3}', message: 'Like AB-123' },
    };
    expect(accept([f], { q: 'AB-123' }).answers.q).toBe('AB-123');
    expect(reject([f], { q: 'AB-1234' }).q).toBe('Like AB-123');
  });

  it('validates email, phone (to E.164) and url (adds https)', () => {
    const fields: FormFieldInput[] = [
      { id: 'e', type: 'email', label: 'E' },
      { id: 'p', type: 'phone', label: 'P' },
      { id: 'u', type: 'url', label: 'U' },
    ];
    const r = accept(fields, { e: 'a@b.co', p: '+92 300 1234567', u: 'example.com/x' });
    expect(r.answers).toEqual({ e: 'a@b.co', p: '+923001234567', u: 'https://example.com/x' });
    const errs = reject(fields, { e: 'nope', p: '123', u: 'javascript:alert(1)' });
    expect(Object.keys(errs).sort()).toEqual(['e', 'p', 'u']);
  });

  it('accepts allowed rich text and rejects unknown nodes or bad links', () => {
    const f: FormFieldInput = { id: 'r', type: 'rich_text', label: 'R', required: true };
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hi', marks: [{ type: 'bold' }] }] },
      ],
    };
    expect(accept([f], { r: doc }).answers.r).toEqual(doc);
    expect(reject([f], { r: { type: 'doc', content: [{ type: 'iframe' }] } }).r).toMatch(
      /formatting/,
    );
    const badLink = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      ],
    };
    expect(reject([f], { r: badLink }).r).toMatch(/formatting/);
    expect(reject([f], { r: { type: 'doc', content: [{ type: 'paragraph' }] } }).r).toBe(
      'This field is required',
    );
  });
});

describe('validateAnswers: numbers', () => {
  it('rounds to decimals and enforces bounds', () => {
    const f: FormFieldInput = { id: 'n', type: 'number', label: 'N', min: 0, max: 10, decimals: 1 };
    expect(accept([f], { n: 3.14 }).answers.n).toBe(3.1);
    expect(accept([f], { n: '7' }).answers.n).toBe(7);
    expect(reject([f], { n: 11 }).n).toMatch(/10 or less/);
    expect(reject([f], { n: 'abc' }).n).toBe('Enter a number');
  });

  it('keeps 0 as an answer', () => {
    const f: FormFieldInput = { id: 'n', type: 'number', label: 'N', required: true };
    expect(accept([f], { n: 0 }).answers.n).toBe(0);
  });

  it('validates currency against its list', () => {
    const f: FormFieldInput = { id: 'c', type: 'currency', label: 'C', currencies: ['PKR', 'AED'] };
    expect(accept([f], { c: { amount: 10.555, currency: 'AED' } }).answers.c).toEqual({
      amount: 10.56,
      currency: 'AED',
    });
    expect(reject([f], { c: { amount: 1, currency: 'USD' } }).c).toBe('Pick a currency');
  });

  it('checks slider steps, scales and duration', () => {
    const fields: FormFieldInput[] = [
      { id: 's', type: 'slider', label: 'S', min: 0, max: 10, step: 2 },
      { id: 'st', type: 'star_rating', label: 'St' },
      { id: 'em', type: 'emoji_rating', label: 'Em', scale: 3 },
      { id: 'ls', type: 'linear_scale', label: 'Ls', min: 0, max: 10 },
      { id: 'du', type: 'duration', label: 'Du', maxMinutes: 120 },
    ];
    expect(accept(fields, { s: 4, st: 5, em: 3, ls: 0, du: 90 }).answers).toEqual({
      s: 4,
      st: 5,
      em: 3,
      ls: 0,
      du: 90,
    });
    const errs = reject(fields, { s: 3, st: 6, em: 4, ls: 11, du: 121 });
    expect(Object.keys(errs).sort()).toEqual(['du', 'em', 'ls', 's', 'st']);
  });
});

describe('validateAnswers: choices', () => {
  it('handles single choice with Other', () => {
    const f: FormFieldInput = {
      id: 'r',
      type: 'radio',
      label: 'R',
      options: ABC,
      allowOther: true,
    };
    expect(accept([f], { r: 'b' }).answers.r).toBe('b');
    expect(accept([f], { r: 'other: Mango ' }).answers.r).toBe('other:Mango');
    expect(reject([f], { r: 'z' }).r).toBe('Pick one of the options');
    const noOther: FormFieldInput = { id: 'd', type: 'dropdown', label: 'D', options: ABC };
    expect(reject([noOther], { d: 'other:x' }).d).toBe('Pick one of the options');
  });

  it('dedupes multi choice and enforces min/max', () => {
    const f: FormFieldInput = {
      id: 'm',
      type: 'checkboxes',
      label: 'M',
      options: ABC,
      minSelected: 2,
      maxSelected: 2,
    };
    expect(accept([f], { m: ['a', 'b', 'a'] }).answers.m).toEqual(['a', 'b']);
    expect(reject([f], { m: ['a'] }).m).toMatch(/at least 2/);
    expect(reject([f], { m: ['a', 'b', 'c'] }).m).toMatch(/at most 2/);
  });

  it('handles picture choice, yes/no, consent and tags', () => {
    const pics = ABC.map((o) => ({ ...o, imageUrl: `https://x.test/${o.id}.png` }));
    const fields: FormFieldInput[] = [
      { id: 'p', type: 'picture_choice', label: 'P', options: pics, multiple: true },
      { id: 'y', type: 'yes_no', label: 'Y', required: true },
      { id: 'c', type: 'consent', label: 'C', text: 'I agree', required: true },
      { id: 't', type: 'tags', label: 'T', maxTags: 2 },
    ];
    expect(accept(fields, { p: ['a'], y: false, c: true, t: ['x', 'X', 'y'] }).answers).toEqual({
      p: ['a'],
      y: false,
      c: true,
      t: ['x', 'y'],
    });
    const errs = reject(fields, { y: 'yes', c: false, t: ['1', '2', '3'] });
    expect(errs).toMatchObject({
      y: 'Choose yes or no',
      c: 'This field is required',
      t: 'Add at most 2 tags',
    });
  });

  it('requires a full permutation for ranking', () => {
    const f: FormFieldInput = { id: 'k', type: 'ranking', label: 'K', options: ABC };
    expect(accept([f], { k: ['c', 'a', 'b'] }).answers.k).toEqual(['c', 'a', 'b']);
    expect(reject([f], { k: ['c', 'a'] }).k).toMatch(/every option/);
  });

  it('validates matrix rows and columns', () => {
    const f: FormFieldInput = {
      id: 'x',
      type: 'matrix',
      label: 'X',
      required: true,
      rows: opts([
        { id: 'r1', label: 'Speed' },
        { id: 'r2', label: 'Price' },
      ]),
      columns: opts([
        { id: 'good', label: 'Good' },
        { id: 'bad', label: 'Bad' },
      ]),
    };
    expect(accept([f], { x: { r1: 'good', r2: 'bad' } }).answers.x).toEqual({
      r1: 'good',
      r2: 'bad',
    });
    expect(reject([f], { x: { r1: 'good' } }).x).toBe('Answer every row');
    expect(reject([f], { x: { r1: 'meh', r2: 'bad' } }).x).toBe('Pick from the columns');
  });
});

describe('validateAnswers: dates, places, media', () => {
  it('validates calendar dates, ranges, times, months and normalises datetimes to UTC', () => {
    const fields: FormFieldInput[] = [
      { id: 'd', type: 'date', label: 'D', minDate: '2026-01-01' },
      { id: 'r', type: 'date_range', label: 'R' },
      { id: 't', type: 'time', label: 'T' },
      { id: 'm', type: 'month', label: 'M' },
      { id: 'dt', type: 'datetime', label: 'Dt' },
      { id: 'tz', type: 'timezone', label: 'Tz' },
    ];
    const r = accept(fields, {
      d: '2026-02-28',
      r: { start: '2026-03-01', end: '2026-03-05' },
      t: '09:30',
      m: '2026-11',
      dt: '2026-11-09T10:00:00+05:00',
      tz: 'Asia/Karachi',
    });
    expect(r.answers.dt).toBe('2026-11-09T05:00:00.000Z');
    const errs = reject(fields, {
      d: '2026-02-30',
      r: { start: '2026-03-05', end: '2026-03-01' },
      t: '25:00',
      m: '2026-13',
      dt: 'tomorrow',
      tz: 'Mars/Olympus',
    });
    expect(Object.keys(errs).sort()).toEqual(['d', 'dt', 'm', 'r', 't', 'tz']);
  });

  it('validates name, address, country, location and colour', () => {
    const fields: FormFieldInput[] = [
      { id: 'n', type: 'full_name', label: 'N', required: true },
      { id: 'a', type: 'address', label: 'A', required: true },
      { id: 'c', type: 'country', label: 'C' },
      { id: 'l', type: 'location', label: 'L' },
      { id: 'k', type: 'color', label: 'K' },
    ];
    const r = accept(fields, {
      n: { first: 'Ali', last: 'Khan' },
      a: { line1: '1 Road', city: 'Dubai', country: 'AE' },
      c: 'TR',
      l: { lat: 24.8607, lng: 67.0011, label: 'Karachi' },
      k: '#FF8800',
    });
    expect(r.answers.k).toBe('#ff8800');
    expect(r.answers.a).toMatchObject({ line1: '1 Road', city: 'Dubai', country: 'AE' });
    const errs = reject(fields, {
      n: { first: 'Ali' },
      a: { line1: '1 Road', country: 'AE' },
      c: 'XX',
      l: { lat: 100, lng: 0 },
      k: 'orange',
    });
    expect(Object.keys(errs).sort()).toEqual(['a', 'c', 'k', 'l', 'n']);
  });

  it('returns upload refs and enforces file counts', () => {
    const fields: FormFieldInput[] = [
      { id: 'f', type: 'file_upload', label: 'F', maxFiles: 2 },
      { id: 's', type: 'signature', label: 'S' },
    ];
    const r = accept(fields, { f: ['up1', 'up2'], s: 'up3' });
    expect(r.uploads).toEqual([
      { fieldId: 'f', uploadIds: ['up1', 'up2'] },
      { fieldId: 's', uploadIds: ['up3'] },
    ]);
    expect(reject(fields, { f: ['a', 'b', 'c'] }).f).toMatch(/at most 2/);
    expect(reject(fields, { f: ['../../etc'] }).f).toBe('This answer is not valid');
  });
});

describe('validateAnswers: advanced', () => {
  it('drops unknown keys, layout fields and CRM pickers on public fills', () => {
    const fields: FormFieldInput[] = [
      { id: 'h', type: 'heading', label: 'Hello' },
      { id: 'q', type: 'short_text', label: 'Q' },
      { id: 'p', type: 'crm_picker', label: 'Client', entity: 'client', required: true },
    ];
    const pub = accept(fields, { q: 'x', h: 'nope', zzz: 'injected', p: 'cl1' }, 'public');
    expect(pub.answers).toEqual({ q: 'x' });
    expect(pub.crm).toEqual([]);
    const internal = accept(fields, { q: 'x', p: 'cl1' }, 'internal');
    expect(internal.crm).toEqual([{ fieldId: 'p', entity: 'client', ids: ['cl1'] }]);
    expect(reject(fields, { q: 'x' }, 'internal').p).toBe('This field is required');
  });

  it('fills hidden fields from the answer or default, capped at 500', () => {
    const fields: FormFieldInput[] = [
      { id: 'h1', type: 'hidden', label: '', paramName: 'utm_source' },
      { id: 'h2', type: 'hidden', label: '', paramName: 'ref', defaultValue: 'site' },
    ];
    const r = accept(fields, { h1: 'x'.repeat(600) });
    expect((r.answers.h1 as string).length).toBe(500);
    expect(r.answers.h2).toBe('site');
  });

  it('recomputes calculated fields and ignores the client value', () => {
    const fields: FormFieldInput[] = [
      { id: 'price', type: 'number', label: 'Price' },
      { id: 'qty', type: 'number', label: 'Qty' },
      {
        id: 'total',
        type: 'calculated',
        label: 'Total',
        expression: '{price} * {qty} + 1',
        decimals: 2,
      },
    ];
    expect(accept(fields, { price: 2.5, qty: 4, total: 999 }).answers.total).toBe(11);
    expect(computeCalculated(def(fields), { price: 1, qty: 2 })).toEqual({ total: 3 });
  });

  it('validates repeater rows with keyed errors', () => {
    const f: FormFieldInput = {
      id: 'team',
      type: 'repeater',
      label: 'Team',
      required: true,
      maxItems: 2,
      fields: [
        { id: 'name', type: 'short_text', label: 'Name', required: true },
        { id: 'mail', type: 'email', label: 'Email' },
      ],
    };
    expect(accept([f], { team: [{ name: 'A', mail: 'a@b.co', extra: 1 }] }).answers.team).toEqual([
      { name: 'A', mail: 'a@b.co' },
    ]);
    const errs = reject([f], { team: [{ mail: 'bad' }] });
    expect(errs).toMatchObject({
      'team.0.name': 'This field is required',
      'team.0.mail': 'Enter a valid email address',
    });
    expect(reject([f], { team: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] }).team).toMatch(
      /at most 2/,
    );
    expect(reject([f], { team: [] }).team).toBe('This field is required');
  });

  it('uses the custom error message', () => {
    const f: FormFieldInput = {
      id: 'q',
      type: 'email',
      label: 'Q',
      required: true,
      errorMessage: 'Need your work email',
    };
    expect(reject([f], {}).q).toBe('Need your work email');
    expect(reject([f], { q: 'x' }).q).toBe('Need your work email');
  });
});

describe('hostile input', () => {
  it('rejects huge arrays fast instead of looping over them', () => {
    const big = Array.from({ length: 100000 }, (_, i) => `id${i}`);
    const fields: FormFieldInput[] = [
      { id: 't', type: 'tags', label: 'T' },
      { id: 'f', type: 'file_upload', label: 'F', maxFiles: 3 },
      { id: 'c', type: 'checkboxes', label: 'C', options: ABC },
    ];
    for (const id of ['t', 'f', 'c']) {
      const started = performance.now();
      const r = validateAnswers(def(fields), { [id]: big }, { mode: 'public' });
      expect(performance.now() - started).toBeLessThan(200);
      expect(r.ok).toBe(false);
    }
  });

  it('rejects deep nesting without overflowing the stack', () => {
    let deep: unknown = 'x';
    for (let i = 0; i < 100000; i++) deep = { a: deep };
    const r = validateAnswers(
      def([{ id: 'n', type: 'full_name', label: 'N' }]),
      { n: deep },
      { mode: 'public' },
    );
    expect(r.ok).toBe(false);
  });

  it('ignores inherited keys on answers and refuses reserved ids', () => {
    const fields: FormFieldInput[] = [{ id: 'q', type: 'short_text', label: 'Q' }];
    const answers = Object.create({ q: 'inherited' }) as Record<string, unknown>;
    expect(accept(fields, answers).answers).toEqual({});
    for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(formDefinitionSchema.safeParse({ fields: [{ id, type: 'divider' }] }).success).toBe(
        false,
      );
      expect(
        formDefinitionSchema.safeParse({ fields: [{ id: 'h', type: 'hidden', paramName: id }] })
          .success,
      ).toBe(false);
    }
  });

  it('refuses inherited names as formula functions', () => {
    expect(() => parseExpression('constructor(1)')).toThrow(/Unknown function/);
    expect(() => parseExpression('toString(1)')).toThrow(/Unknown function/);
  });
});

describe('conditional logic', () => {
  const fields: FormFieldInput[] = [
    { id: 'kind', type: 'radio', label: 'Kind', options: ABC },
    {
      id: 'why',
      type: 'short_text',
      label: 'Why',
      required: true,
      logic: {
        action: 'show',
        match: 'all',
        conditions: [{ fieldId: 'kind', op: 'equals', value: 'b' }],
      },
    },
    {
      id: 'more',
      type: 'short_text',
      label: 'More',
      logic: { action: 'show', match: 'all', conditions: [{ fieldId: 'why', op: 'is_not_empty' }] },
    },
    {
      id: 'pb',
      type: 'page_break',
      label: '',
      logic: {
        action: 'hide',
        match: 'any',
        conditions: [{ fieldId: 'kind', op: 'equals', value: 'c' }],
      },
    },
    { id: 'last', type: 'short_text', label: 'Last', required: true },
  ];

  it('shows dependent fields and strips hidden answers', () => {
    expect([...visibleFieldIds(def(fields), { kind: 'a' })]).toEqual(['kind', 'pb', 'last']);
    const r = accept(fields, { kind: 'a', why: 'secret', more: 'x', last: 'l' });
    expect(r.answers).toEqual({ kind: 'a', last: 'l' });
    expect(reject(fields, { kind: 'b', last: 'l' }).why).toBe('This field is required');
  });

  it('cascades: a hidden field hides what depends on it', () => {
    const r = accept(fields, { kind: 'a', more: 'x', last: 'l' });
    expect(r.answers.more).toBeUndefined();
  });

  it('a hidden page break hides its whole page', () => {
    expect(visibleFieldIds(def(fields), { kind: 'c' }).has('last')).toBe(false);
    expect(accept(fields, { kind: 'c' }).answers).toEqual({ kind: 'c' });
  });

  it('compares numbers and dates with gt/lt', () => {
    const f: FormFieldInput[] = [
      { id: 'n', type: 'number', label: 'N' },
      {
        id: 'big',
        type: 'short_text',
        label: 'Big',
        logic: {
          action: 'show',
          match: 'all',
          conditions: [{ fieldId: 'n', op: 'gt', value: 10 }],
        },
      },
      { id: 'd', type: 'date', label: 'D' },
      {
        id: 'late',
        type: 'short_text',
        label: 'Late',
        logic: {
          action: 'show',
          match: 'all',
          conditions: [{ fieldId: 'd', op: 'lt', value: '2026-06-01' }],
        },
      },
    ];
    const v = visibleFieldIds(def(f), { n: 11, d: '2026-05-01' });
    expect(v.has('big') && v.has('late')).toBe(true);
    expect(visibleFieldIds(def(f), { n: 10, d: '2026-07-01' }).has('big')).toBe(false);
  });

  it('splits pages at page breaks', () => {
    expect(splitPages(def(fields).fields).map((p) => p.map((x) => x.id))).toEqual([
      ['kind', 'why', 'more'],
      ['pb', 'last'],
    ]);
  });
});

describe('expressions', () => {
  const ev = (src: string, vals: Record<string, number> = {}) =>
    evaluateExpression(parseExpression(src), (id) => vals[id] ?? null);

  it('follows precedence, unary minus and functions', () => {
    expect(ev('1 + 2 * 3')).toBe(7);
    expect(ev('(1 + 2) * 3')).toBe(9);
    expect(ev('-{a} + 5', { a: 2 })).toBe(3);
    expect(ev('round(10 / 3, 2)')).toBe(3.33);
    expect(ev('max(1, {a}, 3)', { a: 9 })).toBe(9);
    expect(ev('{missing} + 1')).toBe(1);
  });

  it('returns null on divide by zero', () => {
    expect(ev('1 / 0')).toBeNull();
  });

  it('rejects code, unknown functions and runaway input', () => {
    expect(() => parseExpression('constructor.constructor("x")()')).toThrow();
    expect(() => parseExpression('alert(1)')).toThrow(/Unknown function/);
    expect(() => parseExpression('1 +')).toThrow();
    expect(() => parseExpression('1;2')).toThrow();
    expect(() => parseExpression('('.repeat(60) + '1' + ')'.repeat(60))).toThrow();
    expect(() => parseExpression('1+'.repeat(200) + '1')).toThrow(/too long/);
  });
});

describe('checkDefinition', () => {
  it('passes a sound form', () => {
    expect(checkDefinition(def([{ id: 'q', type: 'short_text', label: 'Name' }]))).toEqual([]);
  });

  it('flags forward or missing logic references and stale options', () => {
    const issues = checkDefinition(
      def([
        {
          id: 'a',
          type: 'short_text',
          label: 'A',
          logic: { action: 'show', match: 'all', conditions: [{ fieldId: 'b', op: 'is_empty' }] },
        },
        { id: 'b', type: 'radio', label: 'B', options: ABC },
        {
          id: 'c',
          type: 'short_text',
          label: 'C',
          logic: {
            action: 'show',
            match: 'all',
            conditions: [{ fieldId: 'b', op: 'equals', value: 'zz' }],
          },
        },
      ]),
    );
    expect(issues.map((i) => i.fieldId)).toEqual(['a', 'c']);
  });

  it('accepts RE2 patterns and refuses broken ones or lookaround', () => {
    expect(isSafePattern('[')).toBe(false);
    expect(isSafePattern('(?=a)a')).toBe(false);
    expect(isSafePattern('(a)\\1')).toBe(false);
    expect(isSafePattern('\\d{3}-\\d{4}')).toBe(true);
    // Nested quantifiers are fine under RE2: matching stays linear.
    expect(isSafePattern('(a+)+$')).toBe(true);
    const issues = checkDefinition(
      def([
        {
          id: 'q',
          type: 'short_text',
          label: 'Q',
          pattern: { preset: 'custom', regex: '(?<=x)y' },
        },
      ]),
    );
    expect(issues[0]?.message).toMatch(/invalid/);
  });

  it('runs catastrophic patterns in linear time', () => {
    for (const regex of ['\\d*\\d*\\d*\\d*\\d*\\d*', '(\\w|\\d)*', '(a|aa)*', '(a+)+']) {
      const f: FormFieldInput = {
        id: 'q',
        type: 'short_text',
        label: 'Q',
        pattern: { preset: 'custom', regex },
      };
      const started = performance.now();
      const r = validateAnswers(def([f]), { q: `${'1'.repeat(499)}!` }, { mode: 'public' });
      expect(performance.now() - started).toBeLessThan(200);
      expect(r.ok).toBe(false);
    }
  });

  it('flags formula problems, empty labels, page break placement and duplicate params', () => {
    const issues = checkDefinition(
      def([
        { id: 'pb0', type: 'page_break', label: '' },
        { id: 'n', type: 'short_text', label: '' },
        { id: 't', type: 'calculated', label: 'T', expression: '{n} * 2' },
        { id: 'bad', type: 'calculated', label: 'Bad', expression: '1 +' },
        { id: 'h1', type: 'hidden', label: '', paramName: 'x' },
        { id: 'h2', type: 'hidden', label: '', paramName: 'x' },
      ]),
    );
    const ids = issues.map((i) => i.fieldId);
    expect(ids).toEqual(expect.arrayContaining(['pb0', 'n', 't', 'bad', 'h2']));
  });

  it('only lets rules check whether a consent box is ticked', () => {
    const consent: FormFieldInput = { id: 'ok', type: 'consent', label: 'Agree', text: 'Yes' };
    const rule = (op: 'equals' | 'is_empty', value?: boolean): FormFieldInput => ({
      id: 'x',
      type: 'short_text',
      label: 'X',
      logic: {
        action: 'show',
        match: 'all',
        conditions: [{ fieldId: 'ok', op, ...(value === undefined ? {} : { value }) }],
      },
    });
    expect(checkDefinition(def([consent, rule('equals', true)]))).toEqual([]);
    expect(checkDefinition(def([consent, rule('is_empty')]))).toEqual([]);
    expect(checkDefinition(def([consent, rule('equals', false)])).map((i) => i.fieldId)).toEqual([
      'x',
    ]);
  });

  it('rejects duplicate field ids structurally', () => {
    expect(
      formDefinitionSchema.safeParse({
        fields: [
          { id: 'a', type: 'divider' },
          { id: 'a', type: 'divider' },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('display helpers', () => {
  it('renders answers as text', () => {
    const d = def([
      { id: 'r', type: 'checkboxes', label: 'R', options: ABC, allowOther: true },
      { id: 'c', type: 'currency', label: 'C', currencies: ['PKR'] },
      { id: 'y', type: 'yes_no', label: 'Y', yesLabel: 'Sure' },
      { id: 'f', type: 'file_upload', label: 'F' },
    ]);
    const [r, c, y, f] = d.fields;
    expect(answerToText(r!, ['a', 'other:Kiwi'])).toBe('Apple, Other: Kiwi');
    expect(answerToText(c!, { amount: 1500, currency: 'PKR' })).toBe('PKR 1500.00');
    expect(answerToText(y!, true)).toBe('Sure');
    expect(answerToText(f!, ['u1'], { uploadName: () => 'cv.pdf' })).toBe('cv.pdf');
  });

  it('neutralises spreadsheet formulas in CSV cells', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-1+2')).toBe(`"'-1+2"`);
    expect(csvCell('plain')).toBe('"plain"');
  });

  it('builds initial answers from defaults and link parameters', () => {
    const d = def([
      { id: 'h', type: 'hidden', label: '', paramName: 'utm_source' },
      { id: 'c', type: 'currency', label: 'C', currencies: ['AED', 'PKR'] },
      { id: 'n', type: 'number', label: 'N', defaultValue: 3 },
    ]);
    expect(initialAnswers(d, { utm_source: 'linkedin' })).toEqual({ h: 'linkedin', n: 3 });
    // Inherited names are never link parameters.
    const proto = def([{ id: 'h', type: 'hidden', label: '', paramName: 'utm_x' }]);
    expect(
      initialAnswers(proto, Object.create({ utm_x: 'inherited' }) as Record<string, string>),
    ).toEqual({});
  });
});
