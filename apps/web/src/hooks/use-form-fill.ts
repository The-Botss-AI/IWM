'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '@botss/api-client';
import {
  computeCalculated,
  initialAnswers,
  splitPages,
  validateAnswers,
  visibleFieldIds,
} from '@botss/forms';
import type {
  FormDefinition,
  FormField,
  SubmitFormInput,
  SubmitFormResponse,
} from '@botss/shared-types';

import { clearDraft, readDraft, restoreDraft, writeDraft } from '@/lib/forms/fill-draft';
import { describeError } from '@/lib/toast';

/** Where a fill happens. `preview` never sends anything. */
export type FormFillMode = 'preview' | 'internal' | 'public';

/** Sends one file answer to storage and returns its upload id. */
export type FormUploader = (args: {
  fieldId: string;
  file: Blob;
  fileName: string;
}) => Promise<string>;

export interface UseFormFillOptions {
  definition: FormDefinition;
  version: number;
  mode: FormFillMode;
  /** Link query parameters, for hidden fields (`?utm_source=...`). */
  params?: Record<string, string | undefined>;
  /** Not called in preview. */
  submit?: (input: SubmitFormInput) => Promise<SubmitFormResponse>;
  /**
   * Where this person's progress is kept in the browser (unique per form and
   * signed-in user). Null or absent: progress is not saved (preview).
   */
  draftKey?: string | null;
}

/** Errors are keyed by field id; repeater rows use `fieldId.index.childId`. */
function fieldOfKey(key: string): string {
  return key.split('.')[0]!;
}

const DRAFT_SAVE_DELAY_MS = 500;

/** A monotonic clock, so the bot check never depends on the device's date. */
function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * All state for filling one form: answers, conditional logic, pages,
 * per-page validation (same engine as the server), saved progress and
 * submit. The renderer and the field components only display what this
 * returns.
 */
export function useFormFill({
  definition,
  version,
  mode,
  params,
  submit,
  draftKey = null,
}: UseFormFillOptions) {
  const [answers, setAnswers] = useState<Record<string, unknown>>(() =>
    initialAnswers(definition, params),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pageIndex, setPageIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitFormResponse | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState('');
  const [turnstileToken, setTurnstileTokenState] = useState<string | null>(null);
  /** Bumped after every submit attempt so the (single-use) Turnstile widget renders a fresh check. */
  const [turnstileKey, setTurnstileKey] = useState(0);
  const [uploadsInFlight, setUploadsInFlight] = useState(0);
  /** Set when saved progress was restored; drives the "We restored your answers" banner. */
  const [restored, setRestored] = useState<{ droppedFiles: boolean } | null>(null);
  /** Bumped whenever new errors should take focus (the renderer focuses the first one). */
  const [errorFocusTick, setErrorFocusTick] = useState(0);
  const startedAt = useRef(nowMs());
  /** No draft is written until the person changes something. */
  const touched = useRef(false);

  const calculated = useMemo(() => computeCalculated(definition, answers), [definition, answers]);
  const effective = useMemo(() => ({ ...answers, ...calculated }), [answers, calculated]);
  const visible = useMemo(() => visibleFieldIds(definition, effective), [definition, effective]);

  /** Pages that currently show; a hidden page break skips its page. */
  const pages = useMemo(() => {
    return splitPages(definition.fields).filter((page) => {
      const first = page[0];
      return !first || first.type !== 'page_break' || visible.has(first.id);
    });
  }, [definition, visible]);

  const safeIndex = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const page: FormField[] = (pages[safeIndex] ?? []).filter(
    (f) => visible.has(f.id) && f.type !== 'page_break',
  );
  const pageBreak = pages[safeIndex]?.[0]?.type === 'page_break' ? pages[safeIndex]![0] : null;
  const isLast = safeIndex >= pages.length - 1;
  /** The break that starts the next page; its `nextLabel` names the Next button. */
  const upcoming = pages[safeIndex + 1]?.[0];
  const nextLabel = upcoming?.type === 'page_break' ? (upcoming.nextLabel ?? null) : null;

  // The Turnstile widget lives on the last page only. Leaving it drops its
  // token, so coming back never enables Submit on a stale one.
  useEffect(() => {
    if (!isLast) setTurnstileTokenState(null);
  }, [isLast]);

  // ─── Saved progress ─────────────────────────────────────────────────────

  // Restore once per form, after mount (storage is browser only). A refetch
  // of the form must not restore again over what the person just typed.
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!draftKey || mode === 'preview' || restoredFor.current === draftKey) return;
    restoredFor.current = draftKey;
    const draft = readDraft(draftKey);
    if (!draft) return;
    const back = restoreDraft(definition, draft);
    if (Object.keys(back.answers).length === 0) return;
    setAnswers({ ...initialAnswers(definition, params), ...back.answers });
    setPageIndex(back.pageIndex);
    setRestored({ droppedFiles: back.droppedFiles });
    // Restoring is not an edit, but the restored state is worth keeping.
    touched.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore once per form; later param changes must not wipe typed answers
  }, [draftKey, definition]);

  // Save while typing (debounced); never after a successful submit.
  useEffect(() => {
    if (!draftKey || mode === 'preview' || !touched.current || result) return;
    const t = setTimeout(
      () => writeDraft(draftKey, definition, answers, safeIndex),
      DRAFT_SAVE_DELAY_MS,
    );
    return () => clearTimeout(t);
  }, [draftKey, mode, definition, answers, safeIndex, result]);

  // ─── Editing ────────────────────────────────────────────────────────────

  const setAnswer = useCallback((fieldId: string, value: unknown) => {
    touched.current = true;
    setAnswers((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[fieldId];
      else next[fieldId] = value;
      return next;
    });
    setErrors((prev) => {
      if (!Object.keys(prev).some((k) => fieldOfKey(k) === fieldId)) return prev;
      return Object.fromEntries(Object.entries(prev).filter(([k]) => fieldOfKey(k) !== fieldId));
    });
  }, []);

  /** Wraps an upload so submit waits for it and the button shows progress. */
  const trackUpload = useCallback(async <T>(work: Promise<T>): Promise<T> => {
    setUploadsInFlight((n) => n + 1);
    try {
      return await work;
    } finally {
      setUploadsInFlight((n) => n - 1);
    }
  }, []);

  const setTurnstileToken = useCallback(
    (token: string | null) => setTurnstileTokenState(token),
    [],
  );

  const validationMode = mode === 'public' ? 'public' : 'internal';

  /** Errors for the given fields only, using the server's rules. */
  const errorsFor = useCallback(
    (fieldIds: ReadonlySet<string>): Record<string, string> => {
      const res = validateAnswers(definition, effective, { mode: validationMode });
      if (res.ok) return {};
      return Object.fromEntries(
        Object.entries(res.errors).filter(([k]) => fieldIds.has(fieldOfKey(k))),
      );
    },
    [definition, effective, validationMode],
  );

  const next = useCallback((): boolean => {
    const found = errorsFor(new Set(page.map((f) => f.id)));
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setErrorFocusTick((n) => n + 1);
      return false;
    }
    setPageIndex(Math.min(safeIndex + 1, pages.length - 1));
    return true;
  }, [errorsFor, page, safeIndex, pages.length]);

  const back = useCallback(() => {
    setErrors({});
    setPageIndex(Math.max(0, safeIndex - 1));
  }, [safeIndex]);

  /** Shows errors and jumps to the first page that holds one of them. */
  const showErrors = useCallback(
    (found: Record<string, string>) => {
      setErrors(found);
      const ids = new Set(Object.keys(found).map(fieldOfKey));
      const at = pages.findIndex((p) => p.some((f) => ids.has(f.id)));
      if (at >= 0) setPageIndex(at);
      setErrorFocusTick((n) => n + 1);
    },
    [pages],
  );

  const submitAll = useCallback(async (): Promise<void> => {
    if (submitting || uploadsInFlight > 0) return;
    setFormError(null);
    const all = errorsFor(new Set(definition.fields.map((f) => f.id)));
    if (Object.keys(all).length > 0) {
      showErrors(all);
      return;
    }
    if (mode === 'preview' || !submit) {
      setResult({
        ok: true,
        confirmationMessage: 'Preview only. Nothing was saved.',
        redirectUrl: null,
      });
      return;
    }
    setSubmitting(true);
    try {
      const input: SubmitFormInput = {
        version,
        answers: Object.fromEntries(Object.entries(answers).filter(([, v]) => v !== undefined)),
        fillMs: Math.max(0, Math.round(nowMs() - startedAt.current)),
        ...(honeypot ? { website: honeypot } : {}),
        ...(turnstileToken ? { turnstileToken } : {}),
      };
      const res = await submit(input);
      if (draftKey) clearDraft(draftKey);
      setRestored(null);
      setResult(res);
      if (res.redirectUrl && /^https?:\/\//i.test(res.redirectUrl))
        window.location.assign(res.redirectUrl);
    } catch (err) {
      const fieldErrors = err instanceof ApiError ? err.fieldErrors : undefined;
      if (fieldErrors && Object.keys(fieldErrors).length > 0) {
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(fieldErrors)) if (v[0]) flat[k] = v[0];
        if (flat.form) setFormError(flat.form);
        showErrors(flat);
      } else {
        setFormError(describeError(err, "Couldn't send your answers. Try again."));
      }
    } finally {
      setSubmitting(false);
      // A Turnstile token is spent by any server check; get a fresh one for a retry.
      setTurnstileTokenState(null);
      setTurnstileKey((k) => k + 1);
    }
  }, [
    submitting,
    uploadsInFlight,
    errorsFor,
    definition,
    mode,
    submit,
    version,
    answers,
    honeypot,
    turnstileToken,
    showErrors,
    draftKey,
  ]);

  /** Back to an empty form; also forgets saved progress ("Start over"). */
  const reset = useCallback(() => {
    if (draftKey) clearDraft(draftKey);
    touched.current = false;
    setAnswers(initialAnswers(definition, params));
    setErrors({});
    setPageIndex(0);
    setResult(null);
    setFormError(null);
    setRestored(null);
    setTurnstileTokenState(null);
    setTurnstileKey((k) => k + 1);
    startedAt.current = nowMs();
  }, [definition, params, draftKey]);

  const dismissRestored = useCallback(() => setRestored(null), []);

  return {
    answers: effective,
    setAnswer,
    calculated,
    visible,
    errors,
    errorFocusTick,
    page,
    pageBreak,
    nextLabel,
    pageIndex: safeIndex,
    pageCount: pages.length,
    isFirst: safeIndex === 0,
    isLast,
    next,
    back,
    submitAll,
    submitting,
    result,
    formError,
    reset,
    restored,
    dismissRestored,
    honeypot,
    setHoneypot,
    turnstileToken,
    turnstileKey,
    setTurnstileToken,
    uploadsInFlight,
    trackUpload,
  };
}

export type FormFillState = ReturnType<typeof useFormFill>;
