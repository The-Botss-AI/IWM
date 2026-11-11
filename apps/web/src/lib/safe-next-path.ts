/**
 * Base used to resolve `?next=` when there is no `window` (server render,
 * scripts). Only the same-origin comparison matters, so any fixed origin works.
 */
const FALLBACK_ORIGIN = 'http://localhost';

/**
 * Accept only a same-origin path for `?next=` and return it as
 * `pathname + search + hash`. Rejects control characters and backslashes
 * outright (browsers strip tabs/newlines and read `\` as `/`, which turns
 * `/\t/evil.com` or `/\evil.com` into a protocol-relative URL), then resolves
 * the value against the current origin and requires the origin to stay put.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/')) return null;
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\u0000-\u001F\\]/.test(next)) return null;
  try {
    const origin = typeof window === 'undefined' ? FALLBACK_ORIGIN : window.location.origin;
    const url = new URL(next, origin);
    if (url.origin !== origin) return null;
    // Dot segments can normalize to `//host` (`/..//x`), which a browser
    // reads as protocol-relative, so the resolved path must not start that way.
    if (url.pathname.startsWith('//')) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
