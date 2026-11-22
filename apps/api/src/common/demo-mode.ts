import { ForbiddenException, type Logger } from '@nestjs/common';
import { DEMO_MODE_PROBLEM_CODE } from '@botss/shared-types';

/**
 * Public live demo (`DEMO_MODE=true`). Never set on a real install.
 *
 * Visitors share the demo accounts, so in demo mode:
 *   - everything that reaches the outside world is a logged no-op: system
 *     mail, mailbox mail, push to phones and browsers, cPanel calls
 *     (see `demoSkip`);
 *   - actions that could lock other visitors out, spam people or host abuse
 *     answer an RFC 7807 403 with `code: 'demo-mode'` (DEMO_BLOCKED_ROUTES,
 *     enforced by DemoModeGuard, plus the upload limits in FilesService);
 *   - everything else (projects, tasks, chat, documents, invoices, meetings,
 *     leads, forms) works as usual. The data resets every night
 *     (`pnpm demo:reset`).
 *
 * The messages end up in toasts: plain sentences, no dashes.
 */
export function isDemoMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DEMO_MODE?.trim().toLowerCase() === 'true';
}

/** Largest single upload in the demo. */
export const DEMO_MAX_UPLOAD_BYTES = 1024 * 1024;
/** All uploaded files together, until the nightly reset. */
export const DEMO_MAX_STORAGE_BYTES = 200 * 1024 * 1024;
/** Redis counter of bytes reserved for uploads since the last reset. */
export const DEMO_UPLOAD_BYTES_KEY = 'demo:upload-bytes';

export function demoModeForbidden(detail: string): ForbiddenException {
  return new ForbiddenException({
    title: 'Not available in the live demo',
    status: 403,
    detail,
    code: DEMO_MODE_PROBLEM_CODE,
  });
}

/**
 * True (and logs why) when an outgoing call must be skipped because the
 * demo is on. `what` names the call, e.g. "email to 3 recipients".
 */
export function demoSkip(logger: Pick<Logger, 'log'>, what: string): boolean {
  if (!isDemoMode()) return false;
  logger.log(`Demo mode: ${what} skipped, outgoing calls are turned off (DEMO_MODE=true).`);
  return true;
}

type Body = Record<string, unknown> | undefined;

export interface DemoRule {
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Matched against the path after the API prefix, e.g. `/users/me`. */
  path: RegExp;
  detail: string;
  /** Only block when the body asks for this (defaults to always). */
  when?: (body: Body) => boolean;
}

const ID = '[^/]+';
// Express matches routes case-insensitively, so the guard must too.
const route = (pattern: string): RegExp => new RegExp(`^${pattern.replaceAll(':id', ID)}/?$`, 'i');
const has = (body: Body, key: string): boolean => body?.[key] !== undefined;

const PEOPLE = 'Adding or inviting people is turned off in the live demo.';
const SHARED_ACCOUNTS =
  'Everyone shares the demo accounts, so changing their password, email, role or sessions is turned off in the live demo.';
const MAIL = 'Mail accounts and sending mail are turned off in the live demo.';
const PUBLIC_LINKS = 'Public links are turned off in the live demo.';
const SIGNING = 'Sending documents for signature is turned off in the live demo.';
const SETTINGS = 'Add on, mail and domain settings are turned off in the live demo.';

export const DEMO_BLOCKED_ROUTES: readonly DemoRule[] = [
  // People: no new accounts, no invitations to anyone outside the demo.
  { method: 'POST', path: route('/admin/users'), detail: PEOPLE },
  { method: 'POST', path: route('/admin/users/import'), detail: PEOPLE },
  { method: 'POST', path: route('/workspaces/current/members'), detail: PEOPLE },
  { method: 'POST', path: route('/workspaces/current/members/:id/resend-invite'), detail: PEOPLE },
  { method: 'POST', path: route('/clients/:id/portal-contacts'), detail: PEOPLE },
  { method: 'POST', path: route('/clients/:id/portal-contacts/:id/resend'), detail: PEOPLE },
  {
    method: 'POST',
    path: route('/clients/:id/portal-contacts/:id/password-reset'),
    detail: SHARED_ACCOUNTS,
  },
  { method: 'POST', path: route('/organizations/:id/invite-owner'), detail: PEOPLE },
  {
    method: 'POST',
    path: route('/meetings'),
    detail: 'Inviting guests from outside the demo is turned off in the live demo.',
    when: hasGuestEmails,
  },
  {
    method: 'PATCH',
    path: route('/meetings/:id'),
    detail: 'Inviting guests from outside the demo is turned off in the live demo.',
    when: hasGuestEmails,
  },

  // The shared demo accounts.
  {
    method: 'PATCH',
    path: route('/admin/users/:id'),
    detail: SHARED_ACCOUNTS,
    when: (b) => has(b, 'password') || has(b, 'systemRole') || has(b, 'name'),
  },
  {
    method: 'PATCH',
    path: route('/users/me'),
    detail:
      'Everyone shares the demo accounts, so editing the name and photo is turned off in the live demo.',
    when: (b) => has(b, 'name') || has(b, 'image'),
  },
  { method: 'POST', path: route('/portal/me/password'), detail: SHARED_ACCOUNTS },
  { method: 'POST', path: route('/admin/users/:id/revoke-sessions'), detail: SHARED_ACCOUNTS },
  { method: 'POST', path: route('/users/me/sessions/revoke-others'), detail: SHARED_ACCOUNTS },
  { method: 'DELETE', path: route('/users/me/sessions/:id'), detail: SHARED_ACCOUNTS },
  { method: 'PUT', path: route('/roles/users/:id/company-role'), detail: SHARED_ACCOUNTS },
  { method: 'PUT', path: route('/roles/users/:id/overrides'), detail: SHARED_ACCOUNTS },

  // Deleting the organization, workspaces or people.
  {
    method: 'DELETE',
    path: route('/admin/users/:id'),
    detail: 'Deleting people is turned off in the live demo.',
  },
  {
    method: 'DELETE',
    path: route('/workspaces/current/members/:id'),
    detail: 'Removing people is turned off in the live demo.',
  },
  {
    method: 'DELETE',
    path: route('/workspaces/:id'),
    detail: 'Deleting a workspace is turned off in the live demo.',
  },
  {
    method: 'POST',
    path: route('/organizations'),
    detail: 'Creating organizations is turned off in the live demo.',
  },
  {
    method: 'POST',
    path: route('/org-signup'),
    detail: 'Creating organizations is turned off in the live demo.',
  },
  {
    method: 'DELETE',
    path: route('/organizations/:id'),
    detail: 'Deleting the organization is turned off in the live demo.',
  },
  {
    method: 'DELETE',
    path: route('/organizations/:id/hard'),
    detail: 'Deleting the organization is turned off in the live demo.',
  },

  // Mail: no mailbox setup, no sending.
  { method: 'POST', path: route('/mail/accounts'), detail: MAIL },
  { method: 'POST', path: route('/mail/accounts/self-setup'), detail: MAIL },
  { method: 'PATCH', path: route('/mail/accounts/:id'), detail: MAIL },
  { method: 'POST', path: route('/mail/accounts/:id/test'), detail: MAIL },
  { method: 'POST', path: route('/mail/messages/send'), detail: MAIL },
  { method: 'POST', path: route('/admin/email/test'), detail: MAIL },

  // Settings that hold secrets or reach other servers.
  { method: 'PUT', path: route('/addons/:id'), detail: SETTINGS },
  { method: 'PUT', path: route('/org/mail-config'), detail: SETTINGS },
  { method: 'POST', path: route('/org/domains'), detail: SETTINGS },
  { method: 'POST', path: route('/org/domains/:id/verify'), detail: SETTINGS },
  { method: 'DELETE', path: route('/org/domains/:id'), detail: SETTINGS },

  // Support access and credentials.
  {
    method: 'POST',
    path: route('/support/grants'),
    detail: 'Support access is turned off in the live demo.',
  },
  {
    method: 'POST',
    path: route('/support/sessions'),
    detail: 'Support access is turned off in the live demo.',
  },
  {
    method: 'POST',
    path: route('/meetings/feed-token'),
    detail: 'Calendar feed links are turned off in the live demo.',
  },

  // Public links would let anyone host content on the demo's address.
  {
    method: 'POST',
    path: route('/documents/:id/share'),
    detail: 'Public links are turned off in the live demo.',
  },
  {
    method: 'POST',
    path: route('/form-builder/:id/public-link'),
    detail: 'Public links are turned off in the live demo.',
  },
  {
    method: 'POST',
    path: route('/form-builder/:id/public-link/rotate'),
    detail: 'Public links are turned off in the live demo.',
  },
  {
    method: 'POST',
    path: route('/projects/:id/forms'),
    detail: PUBLIC_LINKS,
    when: (b) => b?.isPublic === true,
  },
  {
    method: 'PATCH',
    path: route('/forms/:id'),
    detail: PUBLIC_LINKS,
    when: (b) => b?.isPublic === true,
  },

  // Signature requests mail people outside the demo.
  { method: 'POST', path: route('/signatures/:id/send'), detail: SIGNING },
  { method: 'POST', path: route('/signatures/:id/signers/:id/resend'), detail: SIGNING },
];

function hasGuestEmails(body: Body): boolean {
  const attendees = body?.attendees as { emails?: unknown } | undefined;
  return Array.isArray(attendees?.emails) && attendees.emails.length > 0;
}

/**
 * Why the demo refuses this request, or null. `path` is the request path
 * with or without the API prefix (`/api/v1`).
 */
export function demoBlockReason(
  method: string,
  path: string,
  body: unknown,
  apiPrefix = process.env.API_BASE_PATH ?? '/api/v1',
): string | null {
  // Lowercased: Express routes are case-insensitive, so `/API/V1/Users/Me`
  // reaches the same handler as `/api/v1/users/me`.
  const prefix = `/${apiPrefix.replace(/^\/+|\/+$/g, '')}`.toLowerCase();
  const lower = path.toLowerCase();
  const bare = lower.startsWith(`${prefix}/`) ? lower.slice(prefix.length) : lower;
  const verb = method.toUpperCase();
  const json = body && typeof body === 'object' ? (body as Record<string, unknown>) : undefined;
  for (const rule of DEMO_BLOCKED_ROUTES) {
    if (rule.method !== verb || !rule.path.test(bare)) continue;
    if (rule.when && !rule.when(json)) continue;
    return rule.detail;
  }
  return null;
}
