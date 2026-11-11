/* eslint-disable no-console */
import assert from 'node:assert/strict';

import {
  initSentry,
  isSentryEnabled,
  scrubBreadcrumb,
  scrubEvent,
  scrubString,
} from '../observability/sentry';

// Without a DSN, init is skipped entirely (no SDK init, no network).
assert.equal(initSentry({} as NodeJS.ProcessEnv), false);
assert.equal(initSentry({ SENTRY_DSN: '  ' } as NodeJS.ProcessEnv), false);
assert.equal(isSentryEnabled(), false);

const event = scrubEvent({
  message: 'failed for jane.doe@example.com with Bearer abcdefghijkl1234',
  request: {
    method: 'POST',
    url: 'https://app.example.com/api/v1/mail/send?st=SECRETTOKEN',
    headers: { authorization: 'Bearer abc', cookie: 'sid=1', 'x-api-key': 'k' },
    cookies: { sid: '1' },
    data: { subject: 'hi', html: '<p>private</p>', password: 'hunter2' },
    query_string: 'st=SECRETTOKEN',
  },
  user: { id: 'cuid123', email: 'jane.doe@example.com', ip_address: '1.2.3.4', username: 'jane' },
  exception: { values: [{ value: 'SMTP rejected bob@corp.io' }] },
  extra: { password: 'hunter2', note: 'mail to a@b.co', nested: { token: 'xyz', ok: 'fine' } },
  breadcrumbs: [
    {
      category: 'http',
      message: 'GET /x?st=SECRET',
      data: { url: '/x?st=SECRET', method: 'GET', 'http.request.header.cookie': 'c' },
    },
  ],
});

const dump = JSON.stringify(event);
for (const secret of [
  'jane.doe@example.com',
  'bob@corp.io',
  'a@b.co',
  'abcdefghijkl1234',
  'SECRETTOKEN',
  'SECRET',
  'hunter2',
  'private',
  'sid=1',
  'xyz',
  '1.2.3.4',
]) {
  assert.ok(!dump.includes(secret), `leaked: ${secret}`);
}
assert.deepEqual(event.user, { id: 'cuid123' });
assert.equal(event.request.method, 'POST');
assert.equal(event.request.headers, undefined);
assert.equal(event.request.cookies, undefined);
assert.equal(event.request.data, undefined);
assert.equal(event.extra.nested.ok, 'fine');

const crumb = scrubBreadcrumb({
  message: 'to x@y.com',
  data: { body: 'secret body', method: 'GET' },
});
assert.ok(
  crumb &&
    !JSON.stringify(crumb).includes('x@y.com') &&
    !JSON.stringify(crumb).includes('secret body'),
);
assert.equal(scrubString('plain text'), 'plain text');
assert.equal(scrubString('Is it ok? yes'), 'Is it ok? yes');
assert.equal(scrubString('GET /api/v1/x?st=SECRET failed'), 'GET /api/v1/x failed');
assert.equal(scrubString('https://a.io/p?q=1#h'), 'https://a.io/p#h');

// Console breadcrumbs are dropped entirely.
assert.equal(scrubBreadcrumb({ category: 'console', message: 'user typed x' }), null);
const dropped = scrubEvent({
  breadcrumbs: [
    { category: 'console', message: 'm' },
    { category: 'http', message: 'ok' },
  ],
});
assert.equal(dropped.breadcrumbs.length, 1);

// Exception values keep only a scrubbed, bounded first line (no Prisma arg dumps).
const exc = scrubEvent({
  exception: {
    values: [
      { value: `Invalid invocation for a@b.co\n  where: { email: 'x' }\n${'z'.repeat(400)}` },
    ],
  },
});
assert.equal(exc.exception.values[0]!.value, 'Invalid invocation for [email]');
const longExc = scrubEvent({ exception: { values: [{ value: 'y'.repeat(500) }] } });
assert.equal(longExc.exception.values[0]!.value.length, 200);

// Transactions: names scrubbed, span data cleared.
const tx = scrubEvent({
  transaction: 'GET /api/v1/mail?token=SECRETTX',
  spans: [{ description: 'GET /x?k=SECRETSPAN', data: { 'http.query': '?k=SECRETDATA' } }],
});
assert.equal(tx.transaction, 'GET /api/v1/mail');
assert.equal(tx.spans[0]!.data, undefined);
assert.ok(!JSON.stringify(tx).includes('SECRET'));

console.log('check-sentry-scrub: ok');
