import * as Sentry from '@sentry/nextjs';

import { sentryOptions } from '@/lib/sentry-scrub';

/** Server + edge init. Complete no-op while NEXT_PUBLIC_SENTRY_DSN is unset. */
export async function register(): Promise<void> {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) return;
  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init(sentryOptions(dsn));
  }
}

export const onRequestError = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()
  ? Sentry.captureRequestError
  : undefined;
