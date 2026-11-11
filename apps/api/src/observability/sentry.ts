import * as Sentry from '@sentry/node';

/**
 * Optional Sentry error reporting. Everything here is a complete no-op while
 * SENTRY_DSN is unset: no SDK init, no instrumentation, no network calls.
 *
 * Privacy: nothing user-authored may leave the host. Request bodies, cookies,
 * Authorization headers, query strings, mail/chat contents and email
 * addresses are stripped in `scrubEvent` / `scrubBreadcrumb`; only the user
 * id is kept.
 */

const REDACTED = '[redacted]';
const SENSITIVE_KEY =
  /pass(word|wd)?|token|secret|cookie|authorization|api[-_]?key|session|signature|credential|otp|code$|body|content|subject|message|html|text|email|address/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
// Query strings only inside URL-like strings (absolute or path), so prose such as
// "Is it ok? yes" is untouched. The URL part is kept.
const QUERY = /((?:https?:\/\/|\/)[^\s?]*)\?[^\s"'#]*/g;

let enabled = false;

export function isSentryEnabled(): boolean {
  return enabled;
}

/** Scrub one string: emails, bearer/basic credentials and query strings. */
export function scrubString(value: string): string {
  // Cap first: event strings are short, and this bounds the regex work.
  return value
    .slice(0, 2000)
    .replace(BEARER, '$1 [redacted]')
    .replace(EMAIL, '[email]')
    .replace(QUERY, '$1');
}

/** Deep scrub: redact sensitive keys and sanitize every string value. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > 8) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : scrubValue(v, depth + 1);
  }
  return out;
}

// Structural events: the SDK's own types are wide; we only touch known keys.
type AnyEvent = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Sentry event shape is open-ended

export function scrubEvent<T extends AnyEvent>(event: T): T {
  const e = event as AnyEvent;
  if (e.request) {
    const url = typeof e.request.url === 'string' ? scrubString(e.request.url) : undefined;
    e.request = { method: e.request.method, url };
  }
  if (e.user) {
    e.user = e.user.id !== undefined ? { id: String(e.user.id) } : undefined;
  }
  if (typeof e.message === 'string') e.message = scrubString(e.message);
  if (e.exception?.values) {
    for (const v of e.exception.values) {
      // First line only: drops Prisma argument dumps that follow the headline.
      if (typeof v.value === 'string') v.value = scrubString(v.value).split('\n')[0]!.slice(0, 200);
    }
  }
  if (typeof e.transaction === 'string') e.transaction = scrubString(e.transaction);
  if (Array.isArray(e.spans)) {
    for (const s of e.spans) {
      delete s.data;
      if (typeof s.description === 'string') s.description = scrubString(s.description);
    }
  }
  if (e.extra) e.extra = scrubValue(e.extra);
  if (e.contexts) e.contexts = scrubValue(e.contexts);
  if (e.breadcrumbs) {
    e.breadcrumbs = e.breadcrumbs
      .map((b: AnyEvent) => scrubBreadcrumb(b))
      .filter((b: AnyEvent | null) => b !== null);
  }
  delete e.server_name;
  return event;
}

export function scrubBreadcrumb<T extends AnyEvent>(crumb: T): T | null {
  const c = crumb as AnyEvent;
  if (c.category === 'console') return null;
  if (typeof c.message === 'string') c.message = scrubString(c.message);
  if (c.data) {
    // Keep method/status/path shape for http breadcrumbs; drop the rest.
    const d = c.data as AnyEvent;
    c.data = {
      method: d.method,
      status_code: d.status_code,
      url: typeof d.url === 'string' ? scrubString(d.url) : undefined,
    };
  }
  return crumb;
}

/** Initialise Sentry once. Returns false (and does nothing) without a DSN. */
export function initSentry(env: NodeJS.ProcessEnv = process.env): boolean {
  if (enabled) return true;
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return false;
  const rate = Number(env.SENTRY_TRACES_SAMPLE_RATE ?? 0);
  Sentry.init({
    dsn,
    environment: env.SENTRY_ENVIRONMENT?.trim() || env.NODE_ENV || 'production',
    release: env.SENTRY_RELEASE?.trim() || undefined,
    tracesSampleRate: Number.isFinite(rate) ? Math.min(Math.max(rate, 0), 1) : 0,
    maxBreadcrumbs: 20,
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  });
  const role = env.ROLE?.trim() || 'all';
  Sentry.setTag('role', role);
  enabled = true;
  return true;
}

/** Report a server fault (status >= 500). No-op without a DSN. */
export function captureServerError(
  exception: unknown,
  ctx: { requestId?: string; status: number; method?: string },
): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    scope.setTag('role', process.env.ROLE?.trim() || 'all');
    scope.setTag('http.status', String(ctx.status));
    if (ctx.method) scope.setTag('http.method', ctx.method);
    if (ctx.requestId) scope.setTag('request_id', ctx.requestId);
    Sentry.captureException(exception);
  });
}
