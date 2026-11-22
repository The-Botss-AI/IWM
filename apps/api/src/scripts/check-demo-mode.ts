/**
 * Public demo mode (DEMO_MODE=true), no database, SMTP, S3 or push service
 * needed:
 *
 *  1. Every abuse prone action in DEMO_BLOCKED_ROUTES answers an RFC 7807
 *     403 with code `demo-mode` and a detail without dashes (it is shown in
 *     a toast), through the real guard and exception filter.
 *  2. Ordinary work (tasks, chat, documents, invoices, meetings with
 *     colleagues, profile time zone) is not blocked.
 *  3. With DEMO_MODE off nothing is blocked.
 *  4. Outgoing calls are no-ops: system mail (send, sendVia, withSession),
 *     mailbox sending, push to devices, cPanel never reach their transports.
 *  5. Uploads above 1 MB and past the storage cap are refused.
 *
 * Run: pnpm --filter @botss/api test.
 */
import 'reflect-metadata';

import assert from 'node:assert/strict';

import { type ArgumentsHost, type ExecutionContext, Logger } from '@nestjs/common';
import { DEMO_MODE_PROBLEM_CODE } from '@botss/shared-types';

import { CpanelService } from '../cpanel/cpanel.service';
import { DEMO_BLOCKED_ROUTES, DEMO_MAX_UPLOAD_BYTES, demoBlockReason } from '../common/demo-mode';
import { ProblemDetailsExceptionFilter } from '../common/filters/problem-details.filter';
import { DemoModeGuard } from '../common/guards/demo-mode.guard';
import { MailSender } from '../email/mail.sender';
import { FilesService } from '../files/files.service';
import { MailSendService } from '../mail/mail-send.service';
import { NotificationsPushService } from '../notifications/notifications-push.service';
import type { RealtimeEventsService } from '../notifications/realtime-events.service';
import type { PrismaService } from '../prisma/prisma.service';

Logger.overrideLogger(false);
const realLog = console.log;
console.log = () => {}; // MailSender logs skipped mail with console.log

const ID = 'cm0000000000000000000000a';
const guard = new DemoModeGuard();
const filter = new ProblemDetailsExceptionFilter();

interface Problem {
  status: number;
  title: string;
  detail?: string;
  code?: string;
}

function request(method: string, path: string, body: unknown = {}): Problem | null {
  const req = { method, path, originalUrl: path, body, headers: {} };
  const ctx = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  try {
    guard.canActivate(ctx);
    return null;
  } catch (err) {
    let sent: Problem | undefined;
    const res = {
      status: () => res,
      type: () => res,
      json: (b: Problem) => {
        sent = b;
        return res;
      },
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
    } as unknown as ArgumentsHost;
    filter.catch(err, host);
    return sent ?? null;
  }
}

const BLOCKED: [string, string, unknown?][] = [
  ['POST', '/api/v1/admin/users'],
  ['POST', '/api/v1/admin/users/import'],
  ['PATCH', `/api/v1/admin/users/${ID}`, { password: 'new-password-1' }],
  ['PATCH', `/api/v1/admin/users/${ID}`, { systemRole: 'EMPLOYEE' }],
  ['DELETE', `/api/v1/admin/users/${ID}`],
  ['POST', `/api/v1/admin/users/${ID}/revoke-sessions`],
  ['PATCH', '/api/v1/users/me', { name: 'Someone else' }],
  ['PATCH', '/api/v1/users/me', { image: 'https://example.com/x.png' }],
  ['POST', '/api/v1/users/me/sessions/revoke-others'],
  ['DELETE', `/api/v1/users/me/sessions/${ID}`],
  ['POST', '/api/v1/portal/me/password'],
  ['PUT', `/api/v1/roles/users/${ID}/company-role`],
  ['PUT', `/api/v1/roles/users/${ID}/overrides`],
  ['POST', '/api/v1/workspaces/current/members'],
  ['POST', `/api/v1/workspaces/current/members/${ID}/resend-invite`],
  ['DELETE', `/api/v1/workspaces/current/members/${ID}`],
  ['DELETE', `/api/v1/workspaces/${ID}`],
  ['POST', `/api/v1/clients/${ID}/portal-contacts`],
  ['POST', `/api/v1/clients/${ID}/portal-contacts/${ID}/resend`],
  ['POST', `/api/v1/clients/${ID}/portal-contacts/${ID}/password-reset`],
  ['POST', '/api/v1/organizations'],
  ['POST', '/api/v1/org-signup'],
  ['DELETE', `/api/v1/organizations/${ID}`],
  ['DELETE', `/api/v1/organizations/${ID}/hard`],
  ['POST', `/api/v1/organizations/${ID}/invite-owner`],
  ['POST', '/api/v1/meetings', { attendees: { userIds: [], emails: ['guest@example.com'] } }],
  ['PATCH', `/api/v1/meetings/${ID}`, { attendees: { userIds: [], emails: ['g@example.com'] } }],
  ['POST', '/api/v1/meetings/feed-token'],
  ['POST', '/api/v1/mail/accounts'],
  ['POST', '/api/v1/mail/accounts/self-setup'],
  ['PATCH', `/api/v1/mail/accounts/${ID}`],
  ['POST', `/api/v1/mail/accounts/${ID}/test`],
  ['POST', '/api/v1/mail/messages/send'],
  ['POST', '/api/v1/admin/email/test'],
  ['PUT', '/api/v1/addons/polar'],
  ['PUT', '/api/v1/org/mail-config'],
  ['POST', '/api/v1/org/domains'],
  ['POST', `/api/v1/org/domains/${ID}/verify`],
  ['DELETE', `/api/v1/org/domains/${ID}`],
  ['POST', '/api/v1/support/grants'],
  ['POST', '/api/v1/support/sessions'],
  ['POST', `/api/v1/documents/${ID}/share`],
  ['POST', `/api/v1/form-builder/${ID}/public-link`],
  ['POST', `/api/v1/form-builder/${ID}/public-link/rotate`],
];

const ALLOWED: [string, string, unknown?][] = [
  ['POST', '/api/v1/tasks', { title: 'x' }],
  ['PATCH', `/api/v1/tasks/${ID}`, { status: 'DONE' }],
  ['POST', `/api/v1/chat/rooms/${ID}/messages`, { content: 'hi' }],
  ['POST', '/api/v1/documents', { title: 'Notes' }],
  ['POST', '/api/v1/invoices', {}],
  ['POST', `/api/v1/invoices/${ID}/pdf`],
  ['POST', '/api/v1/leads', {}],
  ['POST', '/api/v1/meetings', { attendees: { userIds: [ID], emails: [] } }],
  ['PATCH', `/api/v1/meetings/${ID}`, { title: 'Renamed' }],
  ['PATCH', '/api/v1/users/me', { timezone: 'Europe/Berlin' }],
  ['PATCH', `/api/v1/admin/users/${ID}`, { phone: '+1 555 0100' }],
  ['POST', '/api/v1/files/presign', { sizeBytes: 10 }],
  ['GET', '/api/v1/admin/users'],
  ['GET', '/api/v1/addons'],
];

async function main(): Promise<void> {
  // 3. Off: nothing is blocked.
  delete process.env.DEMO_MODE;
  for (const [method, path, body] of BLOCKED) {
    assert.equal(request(method, path, body), null, `${method} ${path} blocked with DEMO_MODE off`);
  }

  process.env.DEMO_MODE = 'true';

  // 1. Blocked routes answer 403 demo-mode.
  for (const [method, path, body] of BLOCKED) {
    const problem = request(method, path, body);
    assert.ok(problem, `${method} ${path} should be blocked in demo mode`);
    assert.equal(problem.status, 403, `${method} ${path}`);
    assert.equal(problem.code, DEMO_MODE_PROBLEM_CODE, `${method} ${path}`);
    assert.ok(problem.detail && problem.detail.length > 10, `${method} ${path} has a detail`);
    assert.doesNotMatch(problem.detail, /[—–]| - /, `${method} ${path} detail has a dash`);
  }
  // Every rule is exercised by at least one blocked request above.
  for (const rule of DEMO_BLOCKED_ROUTES) {
    assert.ok(
      BLOCKED.some(([m, p, b]) => m === rule.method && demoBlockReason(m, p, b) === rule.detail),
      `rule ${rule.method} ${rule.path} has no case in BLOCKED`,
    );
  }

  // 2. Ordinary work goes through.
  for (const [method, path, body] of ALLOWED) {
    assert.equal(request(method, path, body), null, `${method} ${path} must stay usable`);
  }

  // 4a. System mail never reaches SMTP.
  const sender = new MailSender({ SMTP_HOST: 'smtp.invalid', MAIL_FROM: 'no-reply@example.com' });
  let smtpCalls = 0;
  (sender as unknown as { transporter: { sendMail: () => never } }).transporter = {
    sendMail: () => {
      smtpCalls += 1;
      throw new Error('SMTP must not be called in demo mode');
    },
  };
  const mail = { to: 'someone@example.com', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' };
  const outcome = await sender.send(mail);
  assert.deepEqual(outcome.accepted, ['someone@example.com']);
  await sender.sendVia(
    { host: 'smtp.invalid', port: 587, secure: false, user: 'u', pass: 'p', from: 'a@example.com' },
    mail,
  );
  let sessionSends = 0;
  await sender.withSession(
    { host: 'smtp.invalid', port: 587, secure: false, user: 'u', pass: 'p' },
    async (send) => {
      await send({ ...mail, from: { name: 'HR', address: 'hr@example.com' } });
      sessionSends += 1;
    },
  );
  assert.equal(sessionSends, 1);
  assert.equal((await sender.verify()).ok, false);
  assert.equal(smtpCalls, 0, 'SMTP transport was called');

  // 4b. Mailbox sending is refused and the worker skips queued rows.
  await assert.rejects(
    MailSendService.prototype.enqueue.call({}, 'user', {} as never),
    (err: { getResponse?: () => { code?: string } }) =>
      err.getResponse?.().code === DEMO_MODE_PROBLEM_CODE,
  );
  let outboxReads = 0;
  const mailSendThis = {
    logger: new Logger('check'),
    prisma: {
      client: {
        mailOutbox: {
          findUnique: () => {
            outboxReads += 1;
            return null;
          },
        },
      },
    },
  };
  await MailSendService.prototype.processSend.call(mailSendThis, 'outbox_1');
  assert.equal(outboxReads, 0, 'processSend must stop before loading the outbox row');

  // 4c. Push: the in-app leg runs, phones and browsers are never contacted.
  let published = 0;
  let deviceLookups = 0;
  const pushPrisma = {
    client: {
      userPushDevice: {
        findMany: async () => {
          deviceLookups += 1;
          return [];
        },
      },
      userNotificationSubscription: {
        findMany: async () => {
          deviceLookups += 1;
          return [];
        },
      },
      userPreferences: { findMany: async () => [] },
    },
  } as unknown as PrismaService;
  const realtime = {
    publishPush: () => {
      published += 1;
    },
  } as unknown as RealtimeEventsService;
  const push = new NotificationsPushService(pushPrisma, realtime);
  const result = await push.sendDesktopNotificationToUsers([ID], {
    title: 'New message',
    body: 'Hi',
    url: '/chat',
  } as never);
  assert.deepEqual(result, { sent: 0, dropped: 0 });
  assert.equal(published, 1, 'the in-app socket leg still runs');
  assert.equal(deviceLookups, 0, 'device push must be skipped');

  // 4d. cPanel is off and never fetched.
  Object.assign(process.env, {
    CPANEL_HOST: 'cpanel.invalid',
    CPANEL_USER: 'u',
    CPANEL_API_TOKEN: 't',
    CPANEL_DOMAIN: 'example.com',
  });
  const realFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    throw new Error('fetch must not be called');
  }) as typeof fetch;
  const cpanel = new CpanelService();
  assert.equal(cpanel.isEnabled(), false);
  await cpanel.setPassword('someone@example.com', 'x');
  assert.equal(fetches, 0, 'cPanel was called');
  globalThis.fetch = realFetch;

  // 5. Upload limits.
  let used = 0n;
  const filesPrisma = {
    client: {
      fileObject: { aggregate: async () => ({ _sum: { sizeBytes: used } }) },
      formUpload: { aggregate: async () => ({ _sum: { sizeBytes: 0n } }) },
    },
  } as unknown as PrismaService;
  const files = new FilesService(filesPrisma);
  const isDemoRefusal = (err: { getResponse?: () => { code?: string } }) =>
    err.getResponse?.().code === DEMO_MODE_PROBLEM_CODE;
  await assert.rejects(
    files.presign('ws_check', {
      filename: 'big.pdf',
      mimeType: 'application/pdf',
      sizeBytes: DEMO_MAX_UPLOAD_BYTES + 1,
    }),
    isDemoRefusal,
  );
  used = 300n * 1024n * 1024n;
  await assert.rejects(
    files.presign('ws_check', { filename: 'a.png', mimeType: 'image/png', sizeBytes: 1000 }),
    isDemoRefusal,
  );
  used = 0n;
  const ok = await files.presign('ws_check', {
    filename: 'a.png',
    mimeType: 'image/png',
    sizeBytes: 1000,
  });
  assert.ok(ok.uploadUrl, 'a small upload is still allowed');

  delete process.env.DEMO_MODE;
  console.log = realLog;
  console.log(
    `check-demo-mode: ok (${BLOCKED.length} blocked, ${ALLOWED.length} allowed, outbound skipped)`,
  );
}

main().catch((err) => {
  console.log = realLog;
  console.error(err);
  process.exit(1);
});
