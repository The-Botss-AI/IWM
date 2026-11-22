import { FORM_UPLOAD_TYPES, isFormInputType, type FormDefinition } from '@botss/shared-types';

/**
 * "Save my progress" for form fills: answers kept in this browser while the
 * person types, restored when they open the same form again, cleared after a
 * successful submit or "Start over". Per device and browser only; nothing is
 * sent to the server until submit.
 */

const PREFIX = 'botss.formDraft.';
const VERSION = 1;
/** Drafts older than this are dropped. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Uploaded files nobody submitted are swept from storage a day after they
 * were uploaded, so a file answer older than this would point at nothing:
 * it is dropped and the person is asked to attach it again. Measured per
 * file from when it first appeared in the draft (not from the last save,
 * which moves on every keystroke).
 */
const FILES_KEEP_MS = 20 * 60 * 60 * 1000;

export interface FillDraft {
  v: typeof VERSION;
  savedAt: number;
  pageIndex: number;
  answers: Record<string, unknown>;
  /** Upload id -> when it first appeared in this draft (about its upload time). */
  fileSeen: Record<string, number>;
}

export interface RestoredDraft {
  answers: Record<string, unknown>;
  pageIndex: number;
  /** True when file answers were too old to keep. */
  droppedFiles: boolean;
}

const UPLOAD_TYPES = new Set<string>(FORM_UPLOAD_TYPES);

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Blocked storage (private mode, policies): drafts are simply off.
    return null;
  }
}

export function readDraft(key: string, now = Date.now()): FillDraft | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FillDraft>;
    if (
      parsed.v !== VERSION ||
      typeof parsed.savedAt !== 'number' ||
      now - parsed.savedAt > MAX_AGE_MS ||
      !parsed.answers ||
      typeof parsed.answers !== 'object' ||
      Array.isArray(parsed.answers)
    ) {
      store.removeItem(PREFIX + key);
      return null;
    }
    const fileSeen: Record<string, number> = {};
    if (parsed.fileSeen && typeof parsed.fileSeen === 'object') {
      for (const [id, at] of Object.entries(parsed.fileSeen))
        if (typeof at === 'number') fileSeen[id] = at;
    }
    // Any file answer without its own time counts from this draft's last save.
    for (const value of Object.values(parsed.answers)) {
      for (const id of Array.isArray(value) ? value : [value]) {
        if (typeof id === 'string' && !Object.hasOwn(fileSeen, id)) fileSeen[id] = parsed.savedAt;
      }
    }
    return {
      v: VERSION,
      savedAt: parsed.savedAt,
      pageIndex: typeof parsed.pageIndex === 'number' ? parsed.pageIndex : 0,
      answers: parsed.answers,
      fileSeen,
    };
  } catch {
    return null;
  }
}

/** Upload ids held by the file questions of this form. */
function uploadIds(def: FormDefinition, answers: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const f of def.fields) {
    if (!UPLOAD_TYPES.has(f.type) || !Object.hasOwn(answers, f.id)) continue;
    const v = answers[f.id];
    for (const id of Array.isArray(v) ? v : [v]) if (typeof id === 'string') out.push(id);
  }
  return out;
}

export function writeDraft(
  key: string,
  def: FormDefinition,
  answers: Record<string, unknown>,
  pageIndex: number,
  now = Date.now(),
): void {
  const store = storage();
  if (!store) return;
  try {
    const before = readDraft(key, now)?.fileSeen ?? {};
    const fileSeen: Record<string, number> = {};
    for (const id of uploadIds(def, answers)) fileSeen[id] = before[id] ?? now;
    const draft: FillDraft = { v: VERSION, savedAt: now, pageIndex, answers, fileSeen };
    store.setItem(PREFIX + key, JSON.stringify(draft));
  } catch {
    // Quota full or storage blocked: progress is not saved, the form still works.
  }
}

export function clearDraft(key: string): void {
  try {
    storage()?.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}

/**
 * The answers of a saved draft that still fit the form as it is now: only
 * questions that still exist (the owner may have changed the form since),
 * never hidden or calculated values (the link and the form provide those),
 * and file answers only while their uploads are still kept.
 */
export function restoreDraft(
  def: FormDefinition,
  draft: FillDraft,
  now = Date.now(),
): RestoredDraft {
  /** A file is kept while it is younger than FILES_KEEP_MS (unknown age counts from the last save). */
  const fresh = (id: string): boolean =>
    now - (draft.fileSeen[id] ?? draft.savedAt) <= FILES_KEEP_MS;
  let droppedFiles = false;
  const answers: Record<string, unknown> = {};
  for (const f of def.fields) {
    if (!isFormInputType(f.type) || f.type === 'hidden' || f.type === 'calculated') continue;
    if (!Object.hasOwn(draft.answers, f.id)) continue;
    const value = draft.answers[f.id];
    if (value === undefined || value === null) continue;
    if (UPLOAD_TYPES.has(f.type)) {
      const ids = (Array.isArray(value) ? value : [value]).filter(
        (id): id is string => typeof id === 'string',
      );
      const kept = ids.filter(fresh);
      if (kept.length < ids.length) droppedFiles = true;
      if (kept.length === 0) continue;
      answers[f.id] = Array.isArray(value) ? kept : kept[0];
      continue;
    }
    answers[f.id] = value;
  }
  return { answers, pageIndex: Math.max(0, Math.floor(draft.pageIndex)), droppedFiles };
}
