import { withSentryConfig } from '@sentry/nextjs/config';
import type { NextConfig } from 'next';

// Static security headers applied to every response. The Content-Security-Policy
// is NOT set here - it's minted per-request with a fresh nonce in
// `src/middleware.ts` (strict nonce-based script-src). These are the headers
// that don't need a per-request value.
const SECURITY_HEADERS = [
  // Clickjacking: legacy header alongside the CSP `frame-ancestors 'none'`
  // that middleware sets, for older browsers.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

// Brand images and notification sounds change rarely and are not hashed, so a
// week of caching with background revalidation is safe. The service worker
// must always revalidate so a new deploy's worker is picked up immediately.
const STATIC_ASSET_CACHE = 'public, max-age=604800, stale-while-revalidate=86400';

const config: NextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework/version in an X-Powered-By header.
  poweredByHeader: false,
  experimental: {
    // Reuse client router cache entries for back/forward and repeat visits
    // instead of refetching every RSC payload on each navigation.
    staleTimes: { dynamic: 30, static: 180 },
  },
  async headers() {
    return [
      { source: '/:path*', headers: SECURITY_HEADERS },
      {
        source: '/branding/:path*',
        headers: [{ key: 'Cache-Control', value: STATIC_ASSET_CACHE }],
      },
      { source: '/sounds/:path*', headers: [{ key: 'Cache-Control', value: STATIC_ASSET_CACHE }] },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    ];
  },
  // Workspace packages publish dual-resolution: `main` → dist/index.js (CJS, used
  // by NestJS), `module` / `import` condition → src/index.ts (TS source, used by
  // bundlers). `transpilePackages` tells Next's SWC pipeline to compile that TS
  // source so React Refresh works correctly in dev.
  transpilePackages: ['@botss/api-client', '@botss/auth', '@botss/forms', '@botss/shared-types'],
  // The TS source uses NodeNext-style `import { x } from './foo.js'` paths.
  // Webpack needs to know that `.js` import specifiers should resolve to `.ts`
  // files when running through Next's transpilation pipeline.
  webpack(config) {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.js', '.ts', '.tsx'],
      '.mjs': ['.mjs', '.mts'],
    };
    return config;
  },
};

// Sentry's build plugin is applied only when a DSN is configured, so builds
// without NEXT_PUBLIC_SENTRY_DSN are byte-for-byte what they were before.
// Source maps are NOT uploaded unless SENTRY_AUTH_TOKEN (+ SENTRY_ORG and
// SENTRY_PROJECT) are present at build time.
const sentryOn = Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN?.trim());
const uploadMaps = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
);

export default sentryOn
  ? withSentryConfig(config, {
      silent: true,
      telemetry: false,
      sourcemaps: { disable: !uploadMaps, deleteSourcemapsAfterUpload: true },
    })
  : config;
