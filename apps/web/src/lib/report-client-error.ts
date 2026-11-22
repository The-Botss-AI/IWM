/**
 * Single sink for errors caught by the Next.js error boundaries. Logs the
 * error and its digest to the console so support can match a user's
 * "Reference" to a log line, and forwards it to Sentry when
 * NEXT_PUBLIC_SENTRY_DSN is set (otherwise captureException is a no-op).
 */
export async function reportClientError(
  error: unknown,
  ctx: { boundary: 'app' | 'portal' | 'global'; digest?: string },
): Promise<void> {
  // eslint-disable-next-line no-console
  console.error(`[${ctx.boundary}] route error`, { digest: ctx.digest }, error);
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  // Lazy: keeps the SDK out of client chunks when no DSN is configured.
  try {
    const Sentry = await import('@sentry/nextjs');
    Sentry.withScope((scope) => {
      scope.setTag('boundary', ctx.boundary);
      if (ctx.digest) scope.setTag('digest', ctx.digest);
      Sentry.captureException(error);
    });
  } catch {
    // Reporting must never throw: the chunk can fail to load offline.
  }
}
