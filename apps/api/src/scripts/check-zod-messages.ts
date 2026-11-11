/**
 * Default validation messages (no database): the global zod config in
 * shared-types keeps the zod 3 texts clients saw, and messages written on a
 * schema still win.
 *
 * Run: pnpm --filter @botss/api test
 */
import assert from 'node:assert/strict';

import '@botss/shared-types';
import { z } from 'zod';

function msg(schema: z.ZodType, input: unknown): string {
  const r = schema.safeParse(input);
  assert.ok(!r.success, 'expected failure');
  return r.error.issues[0]?.message ?? '';
}

assert.equal(msg(z.number(), Number.NaN), 'Expected number, received nan');
assert.equal(msg(z.number(), Infinity), 'Number must be finite');
assert.equal(msg(z.number(), 'x'), 'Expected number, received string');
assert.equal(msg(z.int(), 1.5), 'Expected integer, received float');
assert.equal(msg(z.date(), new Date('nope')), 'Invalid date');
assert.equal(msg(z.string(), undefined), 'Required');
assert.equal(msg(z.enum(['a', 'b']), undefined), 'Required');
assert.equal(msg(z.enum(['a', 'b']), 'c'), "Invalid enum value. Expected 'a' | 'b', received 'c'");
assert.equal(msg(z.string().regex(/^a+$/), 'b'), 'Invalid');
assert.equal(msg(z.string().startsWith('ab'), 'x'), 'Invalid input: must start with "ab"');
assert.equal(msg(z.string().endsWith('ab'), 'x'), 'Invalid input: must end with "ab"');
assert.equal(msg(z.string().includes('ab'), 'x'), 'Invalid input: must include "ab"');
assert.equal(msg(z.string().length(3), 'ab'), 'String must contain exactly 3 character(s)');
assert.equal(msg(z.string().length(3), 'abcd'), 'String must contain exactly 3 character(s)');
assert.equal(msg(z.array(z.string()).length(2), ['a']), 'Array must contain exactly 2 element(s)');
assert.equal(
  msg(z.array(z.string()).length(2), ['a', 'b', 'c']),
  'Array must contain exactly 2 element(s)',
);
assert.equal(msg(z.string().min(2), 'a'), 'String must contain at least 2 character(s)');
assert.equal(
  msg(z.object({ a: z.string() }).strict(), { a: 'x', b: 1, c: 2 }),
  "Unrecognized key(s) in object: 'b', 'c'",
);
assert.equal(msg(z.string({ error: 'Custom' }), 5), 'Custom');
assert.equal(msg(z.string().min(5, 'Too short'), 'a'), 'Too short');

console.log('check-zod-messages: ok');
