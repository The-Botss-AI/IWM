import { NextResponse, type NextRequest } from 'next/server';

/**
 * Strict, nonce-based Content-Security-Policy.
 *
 * A fresh nonce is minted per request and threaded two ways:
 *   1. onto the *request* headers as `x-nonce`, so server components (the
 *      root layout's inline theme script) can stamp the same nonce, and
 *   2. into the `script-src` directive of the CSP we return.
 *
 * `'strict-dynamic'` lets Next's own nonce-tagged bootstrap scripts load the
 * rest of the chunk graph without us having to allowlist every hashed file.
 *
 * Deliberate relaxations (documented so nobody "tightens" them and breaks prod):
 *   - `style-src 'unsafe-inline'`: next/font and Tailwind inject inline styles
 *     that can't all be nonced; style-injection XSS is low-severity, so this is
 *     the accepted trade-off.
 *   - `connect-src https: wss:`: the app calls the API over HTTPS and runs a
 *     Socket.IO (wss) connection for chat/presence; pinning exact origins here
 *     would break as soon as the API host changes.
 *   - `img-src data: blob: https:`: chat/editor previews use blob: and data:
 *     URLs and images come from object storage / CDN origins.
 *
 * NOTE: reading `x-nonce` via `headers()` in the layout opts every route into
 * dynamic rendering - that's the intended cost of a strict CSP.
 */
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https: https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    "media-src 'self' blob: https:",
    "frame-src 'self' blob: https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/**
 * Top-level segments of the authenticated `(app)` and `(workspace-bootstrap)`
 * route groups. Everything else (auth pages, /p, /sign, /f, /forms, /invitations,
 * /download, /portal, /design-system) stays public here and keeps its own
 * gate.
 */
const PROTECTED_SEGMENTS = new Set([
  'admin',
  'calendar',
  'chat',
  'clients',
  'dashboard',
  'documents',
  'financials',
  'form-builder',
  'home',
  'invoices',
  'leads',
  'mail',
  'projects',
  'search',
  'settings',
  'timesheets',
  'todo',
  'workspace',
  'select-workspace',
]);

/**
 * Build-time opt-in. The redirect reads the session cookie at the edge, which
 * only works when the cookie is visible to the web host (`AUTH_COOKIE_DOMAIN`
 * covering both hosts). Off by default: when web and API are on different
 * hosts without a shared AUTH_COOKIE_DOMAIN, the cookie never reaches this
 * middleware and every signed-in visit would bounce to /sign-in. When off, SessionGate alone
 * handles signed-out visits, as before.
 */
const EDGE_AUTH_REDIRECT = process.env.NEXT_PUBLIC_EDGE_AUTH_REDIRECT === '1';

/**
 * Better Auth names the cookie `<prefix>.session_token`, with an optional
 * `__Secure-` lead. The prefix must equal the API's `AUTH_COOKIE_PREFIX`
 * (set when a second install shares the parent domain), so only those two exact names count.
 */
const COOKIE_PREFIX = process.env.NEXT_PUBLIC_AUTH_COOKIE_PREFIX || 'better-auth';
const SESSION_COOKIE_NAMES = [
  `${COOKIE_PREFIX}.session_token`,
  `__Secure-${COOKIE_PREFIX}.session_token`,
];

function hasSessionCookie(request: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => Boolean(request.cookies.get(name)?.value));
}

/**
 * Presence-only session check so a signed-out visit redirects before the app
 * shell downloads. The cookie is never validated here; the API stays
 * authoritative and SessionGate still handles an expired session.
 */
function authRedirect(request: NextRequest): NextResponse | null {
  if (!EDGE_AUTH_REDIRECT) return null;
  const { pathname, search } = request.nextUrl;
  const signedIn = hasSessionCookie(request);
  if (pathname === '/') {
    return NextResponse.redirect(new URL(signedIn ? '/home' : '/sign-in', request.url));
  }
  const segment = pathname.split('/')[1] ?? '';
  if (!PROTECTED_SEGMENTS.has(segment) || signedIn) return null;
  const url = new URL('/sign-in', request.url);
  url.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export function middleware(request: NextRequest) {
  const redirect = authRedirect(request);
  if (redirect) return redirect;

  // base64 keeps the nonce header-safe; randomUUID is available in the edge runtime.
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Setting the CSP on the request headers too lets Next propagate the nonce
  // onto the scripts it injects itself.
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    // Run on every page request except Next's static assets, the image
    // optimizer, and favicon - those never carry inline scripts and skipping
    // them keeps static asset caching intact.
    {
      source: '/((?!_next/static|_next/image|favicon.ico|branding).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
