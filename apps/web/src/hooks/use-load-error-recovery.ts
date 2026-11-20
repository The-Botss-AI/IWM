'use client';

import { useCallback, useEffect, useState } from 'react';

import { canAutoReload, isLoadError, recordAutoReload } from '@/lib/load-error';

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Recovery for error boundaries. For network or stale-chunk errors it waits
 * for connectivity, then reloads the page (at most twice per minute; after
 * that `gaveUp` is true and the UI offers a manual Reload).
 */
export function useLoadErrorRecovery(error: unknown): {
  isLoad: boolean;
  gaveUp: boolean;
  reload: () => void;
} {
  const isLoad = isLoadError(error);
  const [gaveUp, setGaveUp] = useState(false);

  const reload = useCallback(() => window.location.reload(), []);

  useEffect(() => {
    // A new error starts recovery fresh.
    setGaveUp(false);
    if (!isLoad) return;
    let done = false;
    const attempt = (): void => {
      if (done) return;
      const store = sessionStore();
      if (!canAutoReload(store, Date.now())) {
        setGaveUp(true);
        return;
      }
      done = true;
      recordAutoReload(store, Date.now());
      window.location.reload();
    };
    if (navigator.onLine === false) {
      window.addEventListener('online', attempt);
      return () => window.removeEventListener('online', attempt);
    }
    // Online but the fetch failed (flaky link or just woke): short pause first.
    const timer = window.setTimeout(attempt, 1500);
    return () => window.clearTimeout(timer);
  }, [error, isLoad]);

  return { isLoad, gaveUp, reload };
}
