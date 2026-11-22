/**
 * Detection and reload-loop guarding for errors caused by the network or by
 * stale code (a route chunk that failed to download, offline, or a hash that
 * no longer exists after a deploy). A full page reload fixes these; the
 * boundary's `reset()` does not, because it never refetches the chunk.
 */

const LOAD_ERROR_MESSAGE =
  /Loading (CSS )?chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|NetworkError|Failed to fetch|Load failed/i;

export function isLoadError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === 'ChunkLoadError') return true;
  return typeof message === 'string' && LOAD_ERROR_MESSAGE.test(message);
}

export const RELOAD_STORAGE_KEY = 'botss:load-error-reloads';
export const MAX_AUTO_RELOADS = 2;
export const RELOAD_WINDOW_MS = 60_000;

export interface ReloadStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function readStamps(storage: ReloadStorage | null, now: number): number[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(RELOAD_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is number => typeof t === 'number' && now - t >= 0 && now - t < RELOAD_WINDOW_MS,
    );
  } catch {
    return [];
  }
}

/** True while another automatic reload is allowed within the window. */
export function canAutoReload(storage: ReloadStorage | null, now: number): boolean {
  if (!storage) return false;
  return readStamps(storage, now).length < MAX_AUTO_RELOADS;
}

/** Record an automatic reload about to happen. */
export function recordAutoReload(storage: ReloadStorage | null, now: number): void {
  if (!storage) return;
  try {
    storage.setItem(RELOAD_STORAGE_KEY, JSON.stringify([...readStamps(storage, now), now]));
  } catch {
    // Storage can be blocked; without it the guard cannot count, so callers
    // treat a null storage as "no automatic reload" (see canAutoReload).
  }
}
