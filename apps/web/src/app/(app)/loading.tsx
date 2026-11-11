import { ContentSkeleton } from '@/components/shell/app-shell-skeleton';

/**
 * Default loading state for any (app) route that doesn't ship its own
 * `loading.tsx`. Renders inside the chrome, so only the content area shows a
 * skeleton while the top bar / rail stays put.
 */
export default function AppRouteLoading() {
  return <ContentSkeleton />;
}
