import * as Sentry from '@sentry/nextjs';

import { sentryOptions } from '@/lib/sentry-scrub';

// Browser init. Complete no-op while NEXT_PUBLIC_SENTRY_DSN is unset.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
if (dsn) {
  Sentry.init({ ...sentryOptions(dsn), replaysSessionSampleRate: 0, replaysOnErrorSampleRate: 0 });
}

export const onRouterTransitionStart = dsn ? Sentry.captureRouterTransitionStart : undefined;
