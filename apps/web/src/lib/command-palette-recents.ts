/**
 * The command palette's "Recent" list: the last few destinations opened from
 * it (task, document and mail titles), kept in localStorage on this device.
 * Cleared whenever a different person signs in here (see
 * `claimInAppNotificationsFor`), so one person's recent titles never show in
 * the next person's palette.
 */
import type { SearchResult } from '@botss/shared-types';

export interface RecentItem {
  kind: SearchResult['kind'] | 'nav';
  title: string;
  context?: string | null;
  href: string;
}

const RECENT_KEY = 'botss:command-palette:recent';

export function loadRecent(): RecentItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as RecentItem[]) : [];
  } catch {
    return [];
  }
}

export function pushRecent(item: RecentItem): void {
  if (typeof window === 'undefined') return;
  const curr = loadRecent().filter((r) => r.href !== item.href);
  const next = [item, ...curr].slice(0, 5);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* localStorage may be unavailable; silently drop */
  }
}

export function clearRecent(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(RECENT_KEY);
  } catch {
    /* localStorage may be unavailable; nothing to clear */
  }
}
