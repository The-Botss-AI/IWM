'use client';

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { AlertTriangle, Check, Eye, EyeOff, Plus, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { FormDetail, FormFieldType } from '@botss/shared-types';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader } from '@/components/ui/loader';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useFormBuilder, type BuilderSaveState } from '@/hooks/use-form-builder';
import { useMediaQuery } from '@/hooks/use-media-query';
import {
  PALETTE_DRAG_PREFIX,
  fieldDisplayName,
  groupProblems,
  resolveDrop,
} from '@/lib/forms/builder-ops';
import { CATALOG_BY_TYPE, MEDIA_URL_INPUT_ID } from '@/lib/forms/field-catalog';
import { cn } from '@/lib/utils';

import { FormRenderer } from '../renderer/form-renderer';
import { FieldCanvas } from './field-canvas';
import { FieldPalette } from './field-palette';
import { FieldProperties } from './field-properties';

const SAVE_TEXT: Record<BuilderSaveState, string> = {
  saved: 'Saved',
  saving: 'Saving',
  error: 'Not saved',
};

/** Builder tab: palette, canvas and properties, with autosave, preview and publish. */
export function FormBuilderTab({ form }: { form: FormDetail }) {
  const b = useFormBuilder(form);
  const { draft, ops } = b;
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [preview, setPreview] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [propsOpen, setPropsOpen] = useState(false);
  const [dragType, setDragType] = useState<FormFieldType | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const grouped = useMemo(
    () => groupProblems(b.issues, b.publishErrors),
    [b.issues, b.publishErrors],
  );
  const issueCount =
    b.issues.length + Object.values(b.publishErrors).filter((m) => m.length > 0).length;

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    setDragType(
      id.startsWith(PALETTE_DRAG_PREFIX)
        ? (id.slice(PALETTE_DRAG_PREFIX.length) as FormFieldType)
        : null,
    );
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragType(null);
    const drop = resolveDrop(
      String(e.active.id),
      e.over ? String(e.over.id) : null,
      draft.fields.map((f) => f.id),
    );
    if (!drop) return;
    if (drop.kind === 'add') ops.addField(drop.type, drop.index);
    else ops.moveField(drop.from, drop.to);
  };

  const addFromPalette = (type: FormFieldType) => {
    ops.addFieldAfterSelected(type);
    setPaletteOpen(false);
    if (type === 'media') {
      // Open the properties and focus the link box so the person sets it straight away.
      setPropsOpen(true);
      window.setTimeout(() => document.getElementById(MEDIA_URL_INPUT_ID)?.focus(), 150);
    }
  };

  const properties = b.selected ? (
    <FieldProperties
      key={b.selected.id}
      field={b.selected}
      draft={draft}
      ops={ops}
      problems={grouped.byField.get(b.selected.id) ?? []}
    />
  ) : (
    <p className="text-ink-muted text-sm">Select a field to edit it.</p>
  );

  const dragEntry = dragType ? CATALOG_BY_TYPE.get(dragType) : null;

  return (
    <div className="space-y-3">
      {/* Top bar */}
      <div className="border-line flex flex-wrap items-center gap-2 rounded-lg border bg-white p-2">
        <SaveStatus state={b.saveState} onRetry={() => void b.flush()} />
        {b.unpublished ? <Badge tone="warning">Changes not published</Badge> : null}
        <span className="flex-1" />
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              aria-label={
                issueCount === 0
                  ? 'No issues'
                  : `${issueCount} ${issueCount === 1 ? 'issue' : 'issues'} to fix before publishing`
              }
            >
              {issueCount === 0 ? (
                <Check className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <AlertTriangle className="text-state-error h-3.5 w-3.5" aria-hidden />
              )}
              {issueCount === 0
                ? 'No issues'
                : `${issueCount} ${issueCount === 1 ? 'issue' : 'issues'}`}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-3">
            <IssuesList
              form={grouped.form}
              byField={grouped.byField}
              fields={draft.fields}
              onPick={(id) => {
                setPreview(false);
                b.select(id);
              }}
            />
          </PopoverContent>
        </Popover>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={preview}
          aria-label={preview ? 'Back to editing' : 'Preview the form'}
          onClick={() => setPreview((p) => !p)}
        >
          {preview ? (
            <EyeOff className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Eye className="h-3.5 w-3.5" aria-hidden />
          )}
          {preview ? 'Edit' : 'Preview'}
        </Button>
        <Button
          size="sm"
          disabled={b.publishing}
          aria-label="Publish the form"
          onClick={() => void b.publish()}
        >
          {b.publishing ? <Loader size="xs" label="Publishing" /> : null}
          Publish
        </Button>
      </div>

      {b.problem ? (
        <p role="alert" className="bg-tint-error text-state-error rounded-md px-3 py-2 text-sm">
          Not saved yet: {b.problem}. Your edits are kept here until this is fixed.
        </p>
      ) : null}
      {grouped.form.length > 0 ? (
        <ul
          role="alert"
          className="bg-tint-error text-state-error space-y-0.5 rounded-md px-3 py-2 text-sm"
        >
          {grouped.form.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      ) : null}

      {preview ? (
        <div className="border-line mx-auto w-full max-w-2xl rounded-lg border bg-white p-4 sm:p-6">
          <FormRenderer
            title={form.title}
            description={form.description}
            definition={draft}
            version={1}
            mode="preview"
          />
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDragType(null)}
        >
          {/* Phone toolbar */}
          <div className="flex gap-2 lg:hidden">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              aria-label="Add a field"
              onClick={() => setPaletteOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden /> Add field
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              disabled={!b.selected}
              aria-label="Edit the selected field"
              onClick={() => setPropsOpen(true)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> Edit field
            </Button>
          </div>

          <div className="grid gap-4 overflow-x-clip lg:grid-cols-[240px_minmax(0,1fr)_320px] xl:grid-cols-[280px_minmax(0,1fr)_360px]">
            {isDesktop ? (
              <aside
                aria-label="Field types"
                className="max-h-[calc(100dvh-11rem)] overflow-y-auto pr-1"
              >
                <FieldPalette onAdd={addFromPalette} draggable />
              </aside>
            ) : null}

            <main aria-label="Form canvas" className="min-w-0">
              <FieldCanvas
                draft={draft}
                selectedId={b.selectedId}
                problems={grouped.byField}
                onSelect={b.select}
                onDuplicate={ops.duplicateField}
                onRemove={ops.removeField}
                onNudge={ops.nudgeField}
                onEdit={(id) => {
                  b.select(id);
                  setPropsOpen(true);
                }}
              />
            </main>

            {isDesktop ? (
              <aside
                aria-label="Field properties"
                className="border-line max-h-[calc(100dvh-11rem)] overflow-y-auto rounded-lg border bg-white p-4"
              >
                {properties}
              </aside>
            ) : null}
          </div>

          <DragOverlay>
            {dragEntry ? (
              <div
                className={cn(
                  'border-brand-purple shadow-soft-lg flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm',
                )}
              >
                <dragEntry.icon className="h-4 w-4" aria-hidden />
                {dragEntry.label}
              </div>
            ) : null}
          </DragOverlay>

          {!isDesktop ? (
            <>
              <Sheet open={paletteOpen} onOpenChange={setPaletteOpen}>
                <SheetContent side="left">
                  <SheetHeader>
                    <SheetTitle>Add a field</SheetTitle>
                    <SheetDescription>It is added after the selected field.</SheetDescription>
                  </SheetHeader>
                  <SheetBody>
                    <FieldPalette onAdd={addFromPalette} draggable={false} />
                  </SheetBody>
                </SheetContent>
              </Sheet>
              <Sheet open={propsOpen} onOpenChange={setPropsOpen}>
                <SheetContent side="right">
                  <SheetHeader>
                    <SheetTitle>Field properties</SheetTitle>
                    <SheetDescription>Changes save automatically.</SheetDescription>
                  </SheetHeader>
                  <SheetBody>{properties}</SheetBody>
                </SheetContent>
              </Sheet>
            </>
          ) : null}
        </DndContext>
      )}
    </div>
  );
}

function SaveStatus({ state, onRetry }: { state: BuilderSaveState; onRetry: () => void }) {
  return (
    <span
      className="text-ink-muted flex items-center gap-1.5 text-sm"
      role="status"
      aria-live="polite"
    >
      {state === 'saving' ? <Loader size="xs" label="Saving" /> : null}
      <span className={cn(state === 'error' && 'text-state-error font-medium')}>
        {SAVE_TEXT[state]}
      </span>
      {state === 'error' ? (
        <Button variant="ghost" size="sm" aria-label="Try saving again" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </span>
  );
}

function IssuesList({
  form,
  byField,
  fields,
  onPick,
}: {
  form: string[];
  byField: ReadonlyMap<string, string[]>;
  fields: FormDetail['draft']['fields'];
  onPick: (id: string) => void;
}) {
  if (form.length === 0 && byField.size === 0)
    return <p className="text-ink-muted text-sm">Nothing to fix. The form is ready to publish.</p>;
  return (
    <div className="max-h-80 space-y-3 overflow-y-auto">
      {form.length > 0 ? (
        <ul className="text-state-error space-y-1 text-sm" role="list">
          {form.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      ) : null}
      {[...byField.entries()].map(([id, messages]) => {
        const index = fields.findIndex((f) => f.id === id);
        const field = fields[index];
        return (
          <div key={id} className="space-y-1">
            <button
              type="button"
              className="text-ink focus-visible:shadow-focus text-left text-sm font-medium underline-offset-2 hover:underline focus-visible:outline-none"
              aria-label={`Go to ${field ? fieldDisplayName(field, index) : 'field'}`}
              onClick={() => onPick(id)}
            >
              {field ? fieldDisplayName(field, index) : 'Removed field'}
            </button>
            <ul className="text-state-error space-y-0.5 text-xs" role="list">
              {messages.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
