/**
 * Privacy scrubbing for Sentry events (client, server and edge). Only the
 * user id may leave the browser/host: no cookies, headers, request bodies,
 * query strings or email addresses. Kept import-free so every runtime can use it.
 */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const REDACTED = '[redacted]';
const SENSITIVE_KEY =
  /pass(word|wd)?|token|secret|cookie|authorization|api[-_]?key|session|signature|credential|otp|code$|body|content|subject|message|html|text|email|address/i;
// Query strings only inside URL-like strings (absolute or path), so prose such as
// "Is it ok? yes" is untouched. The URL part is kept.
const QUERY = /((?:https?:\/\/|\/)[^\s?]*)\?[^\s"'#]*/g;

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

// Sentry's event/breadcrumb types are wide and differ per runtime.
type Loose = Record<string, any>; // any: open-ended SDK shape

export function scrubBreadcrumb<T extends Loose>(crumb: T): T | null {
  const c = crumb as Loose;
  if (c.category === 'console') return null;
  if (typeof c.message === 'string') c.message = scrubString(c.message);
  if (c.data) {
    const d = c.data as Loose;
    c.data = {
      method: d.method,
      status_code: d.status_code,
      url: typeof d.url === 'string' ? scrubString(d.url) : undefined,
    };
  }
  return crumb;
}

export function scrubEvent<T extends Loose>(event: T): T {
  const e = event as Loose;
  if (e.request) {
    e.request = {
      method: e.request.method,
      url: typeof e.request.url === 'string' ? scrubString(e.request.url) : undefined,
    };
  }
  if (e.user) e.user = e.user.id !== undefined ? { id: String(e.user.id) } : undefined;
  if (typeof e.message === 'string') e.message = scrubString(e.message);
  for (const v of e.exception?.values ?? []) {
    // First line only: drops Prisma argument dumps that follow the headline.
    if (typeof v.value === 'string') v.value = scrubString(v.value).split('\n')[0]!.slice(0, 200);
  }
  if (typeof e.transaction === 'string') e.transaction = scrubString(e.transaction);
  if (Array.isArray(e.spans)) {
    for (const s of e.spans) {
      delete s.data;
      if (typeof s.description === 'string') s.description = scrubString(s.description);
    }
  }
  if (e.extra) e.extra = scrubValue(e.extra);
  if (e.contexts) {
    delete e.contexts.request;
    e.contexts = scrubValue(e.contexts);
  }
  delete e.server_name;
  if (Array.isArray(e.breadcrumbs)) {
    e.breadcrumbs = e.breadcrumbs
      .map((b: Loose) => scrubBreadcrumb(b))
      .filter((b: Loose | null) => b !== null);
  }
  return event;
}

/** Shared init options (DSN gating happens at the call site). */
export function sentryOptions(dsn: string) {
  const rate = Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0);
  return {
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined,
    tracesSampleRate: Number.isFinite(rate) ? Math.min(Math.max(rate, 0), 1) : 0,
    sendDefaultPii: false,
    maxBreadcrumbs: 20,
    // any: SDK event type differs per runtime
    beforeSend: (event: any) => scrubEvent(event),
    // any: SDK transaction event type differs per runtime
    beforeSendTransaction: (event: any) => scrubEvent(event),
    // any: SDK breadcrumb type differs per runtime
    beforeBreadcrumb: (crumb: any) => scrubBreadcrumb(crumb),
  };
}
