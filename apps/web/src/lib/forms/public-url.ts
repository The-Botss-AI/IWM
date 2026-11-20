import { env } from '@/lib/env';

/**
 * Public "anyone with the link" URL for a form. In the browser this uses the
 * site the admin is on, so the link is right on every deployment even when
 * NEXT_PUBLIC_WEB_URL was not set at build time (it defaults to localhost).
 * Callers render it only after the form loads client-side, so server and
 * client markup never disagree.
 */
export function publicFormUrl(token: string): string {
  const base = typeof window === 'undefined' ? env.webUrl : window.location.origin;
  return `${base.replace(/\/+$/, '')}/f/${token}`;
}
