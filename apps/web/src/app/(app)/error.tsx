'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Loader } from '@/components/ui/loader';
import { useLoadErrorRecovery } from '@/hooks/use-load-error-recovery';
import { reportClientError } from '@/lib/report-client-error';

/**
 * Segment-level error boundary for the authenticated app. Catches render /
 * data-fetch errors thrown anywhere under `(app)/*` so a single broken page
 * shows a branded, recoverable state instead of Next's raw error screen.
 * `reset()` re-renders the segment without a full reload. Network and stale
 * chunk errors get a calm reconnecting state and a full reload instead.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void reportClientError(error, { boundary: 'app', digest: error.digest });
  }, [error]);

  const { isLoad, gaveUp, reload } = useLoadErrorRecovery(error);

  if (isLoad) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        {gaveUp ? null : <Loader size="lg" label="Reconnecting" />}
        <h1 className="text-ink mt-4 text-lg font-semibold">Reconnecting</h1>
        <p className="text-ink-muted mt-1 max-w-md text-sm">
          {gaveUp
            ? 'We could not load this page. Check your connection and reload.'
            : 'Getting the latest version of the app. This only takes a moment.'}
        </p>
        {gaveUp ? (
          <div className="mt-6">
            <Button onClick={reload}>Reload</Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="bg-bg-subtle text-state-error flex h-12 w-12 items-center justify-center rounded-full">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </div>
      <h1 className="text-ink mt-4 text-lg font-semibold">Something went wrong</h1>
      <p className="text-ink-muted mt-1 max-w-md text-sm">
        This page hit an unexpected error. You can try again, or head back to your dashboard.
      </p>
      {error.digest ? (
        <p className="text-ink-disabled mt-2 text-xs">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-6 flex items-center gap-2">
        <Button onClick={() => reset()}>Try again</Button>
        <Button variant="secondary" asChild>
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
