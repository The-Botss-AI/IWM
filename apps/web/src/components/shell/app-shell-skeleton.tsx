import { PageLoader } from '@/components/ui/loader';
import { Skeleton } from '@/components/ui/skeleton';
import { BOOT_MESSAGES } from '@/lib/loading-messages';

/** Placeholder for a page's content area while its route segment loads. */
export function ContentSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6"
    >
      <span className="sr-only">Loading</span>
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

/**
 * App boot placeholder shown while the session loads: a top-bar silhouette
 * over the loader ring with status lines that change each spin, so the shell
 * appears to load in place and the wait reads as progress.
 */
export function AppShellSkeleton() {
  return (
    <div className="bg-bg-app text-ink flex min-h-screen flex-col">
      <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6" aria-hidden="true">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="hidden h-10 w-[28rem] max-w-[50vw] rounded-full md:block" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-9 rounded-full" />
          <Skeleton className="h-9 w-9 rounded-full" />
        </div>
      </div>
      <PageLoader label="Opening the app" messages={BOOT_MESSAGES} className="flex-1" />
    </div>
  );
}
