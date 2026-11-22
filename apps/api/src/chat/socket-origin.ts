import type { IncomingMessage } from 'node:http';

/**
 * Origin gate for the `/chat` Socket.IO server.
 *
 * Socket.IO's `cors` option only shapes the response headers of HTTP
 * long-polling. It does not apply to a WebSocket handshake at all, and the
 * session cookie is `SameSite=None` over HTTPS, so without this check any
 * website a signed-in user visits could open an authenticated `/chat` socket
 * in their name and read or send their messages (cross-site WebSocket
 * hijacking). engine.io runs `allowRequest` for every new connection, polling
 * and WebSocket alike, before any session exists.
 *
 * Browsers always send `Origin` on a WebSocket handshake and on a cross-origin
 * XHR, and a page cannot forge or remove it. Requests without the header
 * (native clients, same-origin polling, server-to-server) stay allowed; the
 * session cookie check in `handleConnection` still applies to them.
 */
export function isAllowedSocketOrigin(
  origin: string | undefined,
  allowed: ReadonlySet<string>,
): boolean {
  if (origin === undefined || origin === '') return true;
  return allowed.has(origin);
}

/** engine.io `allowRequest` hook built on {@link isAllowedSocketOrigin}. */
export function socketOriginGate(allowed: ReadonlySet<string>) {
  return (
    req: IncomingMessage,
    callback: (err: string | null | undefined, success: boolean) => void,
  ): void => {
    const origin = req.headers.origin;
    const ok = isAllowedSocketOrigin(Array.isArray(origin) ? origin[0] : origin, allowed);
    callback(ok ? null : 'Origin not allowed', ok);
  };
}
