'use client';

import { checkDefinition } from '@botss/forms';
import { ApiError } from '@botss/api-client';
import {
  formDefinitionSchema,
  type FormDefinition,
  type FormDetail,
  type FormField,
  type FormFieldLogic,
  type FormFieldType,
  type FormLogicCondition,
} from '@botss/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { toastError, toastSuccess } from '@/lib/toast';
import { isPlaceholderMediaUrl } from '@/lib/forms/field-catalog';
import {
  addToList,
  cloneField,
  createField,
  createRepeaterChild,
  defaultCondition,
  describeSchemaProblem,
  earlierLogicFields,
  emptyLogic,
  insertField,
  mapField,
  moveFieldIndex,
  patchChild,
  patchFieldById,
  removeFieldById,
  reorderList,
  updateChildren,
  updateOptionList,
  type ChildPatch,
  type FieldPatch,
  type OptionListKey,
} from '@/lib/forms/builder-ops';

import { formKeys, usePublishForm, useUpdateForm } from './use-forms';

export type BuilderSaveState = 'saved' | 'saving' | 'error';

const AUTOSAVE_MS = 800;

/**
 * Draft editing state for the form builder: the working definition, the
 * selected field, every edit operation, debounced autosave and publish.
 * The draft is owned locally; server data never overwrites it.
 */
export function useFormBuilder(form: FormDetail) {
  const formId = form.id;
  const [draft, setDraft] = useState<FormDefinition>(form.draft);
  const [selectedId, setSelectedId] = useState<string | null>(form.draft.fields[0]?.id ?? null);
  const [saveState, setSaveState] = useState<BuilderSaveState>('saved');
  const [problem, setProblem] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [publishErrors, setPublishErrors] = useState<Record<string, string[]>>({});

  const qc = useQueryClient();
  const update = useUpdateForm(formId);
  const publishMutation = usePublishForm(formId);
  const updateRef = useRef(update.mutateAsync);
  updateRef.current = update.mutateAsync;
  const publishRef = useRef(publishMutation.mutateAsync);
  publishRef.current = publishMutation.mutateAsync;

  const latest = useRef(draft);
  const rev = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(false);
  const dirty = useRef(false);
  const running = useRef<Promise<boolean> | null>(null);

  const runSave = useCallback((): Promise<boolean> => {
    if (running.current) {
      dirty.current = true;
      return running.current;
    }
    const loop = (async (): Promise<boolean> => {
      try {
        let again = true;
        while (again) {
          dirty.current = false;
          const savedRev = rev.current;
          const snapshot = latest.current;
          const parsed = formDefinitionSchema.safeParse(snapshot);
          if (!parsed.success) {
            const first = parsed.error.issues[0];
            setProblem(first ? describeSchemaProblem(snapshot, first) : 'The form has a problem.');
            setSaveState('error');
            return false;
          }
          setProblem(null);
          const saved = await updateRef.current({ draft: parsed.data });
          // Keep the cache on the latest saved draft so a remount starts from it.
          qc.setQueryData(formKeys.detail(formId), saved);
          if (rev.current !== savedRev) dirty.current = true;
          again = dirty.current;
        }
        pending.current = false;
        setSaveState('saved');
        return true;
      } catch {
        // The global mutation handler already toasted the reason.
        setSaveState('error');
        return false;
      } finally {
        running.current = null;
      }
    })();
    running.current = loop;
    return loop;
  }, [qc, formId]);

  const commit = useCallback(
    (next: FormDefinition) => {
      latest.current = next;
      rev.current += 1;
      pending.current = true;
      setDraft(next);
      setTouched(true);
      setPublishErrors((prev) => (Object.keys(prev).length ? {} : prev));
      setSaveState('saving');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void runSave();
      }, AUTOSAVE_MS);
    },
    [runSave],
  );

  /** Saves right now; resolves true when the server has the latest draft. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (running.current) {
      const ok = await running.current;
      if (!ok) return false;
    }
    while (pending.current) {
      if (!(await runSave())) return false;
    }
    return true;
  }, [runSave]);

  // Best effort: send unsaved edits when the builder closes, and warn on tab close.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      if (timer.current) clearTimeout(timer.current);
      if (pending.current) void runSave();
    };
  }, [runSave]);

  const edit = useCallback(
    (fn: (def: FormDefinition) => FormDefinition) => commit(fn(latest.current)),
    [commit],
  );

  // ─── Fields ──────────────────────────────────────────────────────────────

  const addField = useCallback(
    (type: FormFieldType, atIndex?: number): string => {
      const field = createField(type);
      edit((d) => insertField(d, field, atIndex));
      setSelectedId(field.id);
      return field.id;
    },
    [edit],
  );

  /** Palette click: adds after the selected field, or at the end. */
  const addFieldAfterSelected = useCallback(
    (type: FormFieldType): string => {
      const at = latest.current.fields.findIndex((f) => f.id === selectedId);
      return addField(type, at < 0 ? undefined : at + 1);
    },
    [addField, selectedId],
  );

  const duplicateField = useCallback(
    (id: string) => {
      const at = latest.current.fields.findIndex((f) => f.id === id);
      const source = latest.current.fields[at];
      if (!source) return;
      const copy = cloneField(source, latest.current.fields);
      edit((d) => insertField(d, copy, at + 1));
      setSelectedId(copy.id);
    },
    [edit],
  );

  const removeField = useCallback(
    (id: string) => {
      const fields = latest.current.fields;
      const at = fields.findIndex((f) => f.id === id);
      if (at < 0) return;
      const neighbour = fields[at + 1] ?? fields[at - 1];
      edit((d) => removeFieldById(d, id));
      setSelectedId((cur) => (cur === id ? (neighbour?.id ?? null) : cur));
    },
    [edit],
  );

  const moveField = useCallback(
    (from: number, to: number) => edit((d) => moveFieldIndex(d, from, to)),
    [edit],
  );

  const nudgeField = useCallback(
    (id: string, direction: -1 | 1) => {
      const from = latest.current.fields.findIndex((f) => f.id === id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= latest.current.fields.length) return;
      edit((d) => moveFieldIndex(d, from, to));
    },
    [edit],
  );

  const updateField = useCallback(
    (id: string, patch: FieldPatch) => edit((d) => patchFieldById(d, id, patch)),
    [edit],
  );

  // ─── Options, rows, columns ──────────────────────────────────────────────

  const addOption = useCallback(
    (fieldId: string, key: OptionListKey = 'options', label?: string) =>
      edit((d) => updateOptionList(d, fieldId, key, (list) => addToList(list, key, label))),
    [edit],
  );

  const renameOption = useCallback(
    (fieldId: string, key: OptionListKey, optionId: string, label: string) =>
      edit((d) =>
        updateOptionList(d, fieldId, key, (list) =>
          list.map((o) => (o.id === optionId ? { ...o, label } : o)),
        ),
      ),
    [edit],
  );

  const setOptionImage = useCallback(
    (fieldId: string, optionId: string, imageUrl: string | undefined) =>
      edit((d) =>
        updateOptionList(d, fieldId, 'options', (list) =>
          list.map((o) => {
            if (o.id !== optionId) return o;
            const { imageUrl: _drop, ...rest } = o;
            return imageUrl ? { ...rest, imageUrl } : rest;
          }),
        ),
      ),
    [edit],
  );

  const removeOption = useCallback(
    (fieldId: string, key: OptionListKey, optionId: string) =>
      edit((d) =>
        updateOptionList(d, fieldId, key, (list) => list.filter((o) => o.id !== optionId)),
      ),
    [edit],
  );

  const reorderOptions = useCallback(
    (fieldId: string, key: OptionListKey, from: number, to: number) =>
      edit((d) => updateOptionList(d, fieldId, key, (list) => reorderList(list, from, to))),
    [edit],
  );

  // ─── Repeater children ───────────────────────────────────────────────────

  const addChild = useCallback(
    (repeaterId: string, type: FormFieldType) => {
      const child = createRepeaterChild(type);
      if (!child) return;
      edit((d) => updateChildren(d, repeaterId, (list) => [...list, child]));
    },
    [edit],
  );

  const updateChild = useCallback(
    (repeaterId: string, childId: string, patch: ChildPatch) =>
      edit((d) => updateChildren(d, repeaterId, (list) => patchChild(list, childId, patch))),
    [edit],
  );

  const removeChild = useCallback(
    (repeaterId: string, childId: string) =>
      edit((d) => updateChildren(d, repeaterId, (list) => list.filter((c) => c.id !== childId))),
    [edit],
  );

  const moveChild = useCallback(
    (repeaterId: string, from: number, to: number) =>
      edit((d) => updateChildren(d, repeaterId, (list) => reorderList(list, from, to))),
    [edit],
  );

  /** Options of a repeater child (choice types), reusing the field helpers. */
  const updateChildOptions = useCallback(
    (
      repeaterId: string,
      childId: string,
      fn: (options: { id: string; label: string }[]) => { id: string; label: string }[],
    ) =>
      edit((d) =>
        updateChildren(d, repeaterId, (list) =>
          list.map((c) =>
            c.id === childId && 'options' in c ? { ...c, options: fn([...c.options]) } : c,
          ),
        ),
      ),
    [edit],
  );

  // ─── Logic ───────────────────────────────────────────────────────────────

  const setLogic = useCallback(
    (fieldId: string, logic: FormFieldLogic | undefined) =>
      edit((d) => patchFieldById(d, fieldId, { logic })),
    [edit],
  );

  const enableLogic = useCallback(
    (fieldId: string) => {
      const first = earlierLogicFields(latest.current, fieldId)[0];
      if (first) setLogic(fieldId, emptyLogic(first));
    },
    [setLogic],
  );

  const patchLogic = useCallback(
    (fieldId: string, patch: Partial<Pick<FormFieldLogic, 'action' | 'match'>>) =>
      edit((d) =>
        mapField(d, fieldId, (f) =>
          f.logic ? ({ ...f, logic: { ...f.logic, ...patch } } as FormField) : f,
        ),
      ),
    [edit],
  );

  const updateConditions = useCallback(
    (fieldId: string, fn: (list: FormLogicCondition[]) => FormLogicCondition[]) =>
      edit((d) =>
        mapField(d, fieldId, (f) => {
          if (!f.logic) return f;
          const conditions = fn([...f.logic.conditions]);
          if (conditions.length === 0) {
            const { logic: _removed, ...rest } = f;
            return rest as FormField;
          }
          return { ...f, logic: { ...f.logic, conditions } } as FormField;
        }),
      ),
    [edit],
  );

  const addCondition = useCallback(
    (fieldId: string) => {
      const first = earlierLogicFields(latest.current, fieldId)[0];
      if (!first) return;
      updateConditions(fieldId, (list) => [...list, defaultCondition(first)]);
    },
    [updateConditions],
  );

  // ─── Derived ─────────────────────────────────────────────────────────────

  const issues = useMemo(() => {
    const found = checkDefinition(draft);
    const unset = draft.fields.flatMap((f) =>
      f.type === 'media' && isPlaceholderMediaUrl(f.url)
        ? [{ fieldId: f.id, message: `Set the ${f.kind === 'image' ? 'image' : 'video'} link.` }]
        : [],
    );
    return [...found, ...unset];
  }, [draft]);
  const issuesByField = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const i of issues) {
      if (!i.fieldId) continue;
      map.set(i.fieldId, [...(map.get(i.fieldId) ?? []), i.message]);
    }
    return map;
  }, [issues]);

  const selectedIndex = draft.fields.findIndex((f) => f.id === selectedId);
  const selected = selectedIndex >= 0 ? (draft.fields[selectedIndex] ?? null) : null;
  const unpublished = form.hasUnpublishedChanges || touched;

  // ─── Publish ─────────────────────────────────────────────────────────────

  const publish = useCallback(async (): Promise<boolean> => {
    setPublishErrors({});
    const saved = await flush();
    if (!saved) return false;
    const startedAt = rev.current;
    try {
      await publishRef.current();
      toastSuccess('Form published');
      if (rev.current === startedAt) setTouched(false);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors && Object.keys(err.fieldErrors).length > 0) {
        setPublishErrors(err.fieldErrors);
      } else {
        toastError(err, "Couldn't publish the form");
      }
      return false;
    }
  }, [flush]);

  return {
    draft,
    selectedId,
    selected,
    selectedIndex,
    select: setSelectedId,
    saveState,
    problem,
    flush,
    issues,
    issuesByField,
    unpublished,
    publishErrors,
    publishing: publishMutation.isPending,
    publish,
    ops: {
      addField,
      addFieldAfterSelected,
      duplicateField,
      removeField,
      moveField,
      nudgeField,
      updateField,
      addOption,
      renameOption,
      setOptionImage,
      removeOption,
      reorderOptions,
      addChild,
      updateChild,
      removeChild,
      moveChild,
      updateChildOptions,
      setLogic,
      enableLogic,
      patchLogic,
      updateConditions,
      addCondition,
    },
  };
}

export type FormBuilderOps = ReturnType<typeof useFormBuilder>['ops'];
