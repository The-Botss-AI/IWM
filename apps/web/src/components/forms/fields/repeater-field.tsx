'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { FieldShell } from '../renderer/field-shell';
import { FIELD_COMPONENTS } from './registry';
import type { FieldProps } from './types';

type Row = Record<string, unknown>;

const newKey = (): string => Math.random().toString(36).slice(2, 10);

/** Repeating group: rows of child fields rendered with the registry's components. */
export function RepeaterField({
  field,
  value,
  onChange,
  errors,
  ctx,
  inputId,
}: FieldProps<'repeater'>) {
  // Read at render time: the registry imports this file.
  const components = FIELD_COMPONENTS;
  const rows: Row[] = Array.isArray(value)
    ? (value as unknown[]).map((r) => (r && typeof r === 'object' ? (r as Row) : {}))
    : [];

  // Stable keys per row so stateful children follow their row after a delete.
  // They live in component state only, never in the answer.
  const [keys, setKeys] = useState<string[]>(() => rows.map(newKey));
  let rowKeys = keys;
  if (keys.length !== rows.length) {
    rowKeys = rows.map((_, i) => keys[i] ?? newKey());
    setKeys(rowKeys);
  }

  function removeRow(i: number) {
    setKeys(rowKeys.filter((_, idx) => idx !== i));
    commit(rows.filter((_, idx) => idx !== i));
  }

  function addRow() {
    setKeys([...rowKeys, newKey()]);
    commit([...rows, {}]);
  }

  function commit(next: Row[]) {
    onChange(next.length > 0 ? next : undefined);
  }

  function setChild(i: number, childId: string, v: unknown) {
    commit(
      rows.map((row, idx) => {
        if (idx !== i) return row;
        const next = { ...row };
        if (v === undefined) delete next[childId];
        else next[childId] = v;
        return next;
      }),
    );
  }

  return (
    <div id={inputId} className="space-y-3">
      {rows.map((row, i) => (
        <div key={rowKeys[i]} className="border-line space-y-3 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <span className="text-ink-muted text-xs font-medium">#{i + 1}</span>
            <button
              type="button"
              aria-label={`Remove row ${i + 1}`}
              disabled={ctx.disabled}
              onClick={() => removeRow(i)}
              className="text-ink-muted hover:bg-bg-subtle hover:text-state-error flex h-11 w-11 items-center justify-center rounded sm:h-7 sm:w-7"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          {field.fields.map((child) => {
            const entry = components[child.type];
            const Component = entry.component;
            const childInputId = `${inputId}-${i}-${child.id}`;
            const childError = errors[`${field.id}.${i}.${child.id}`];
            const childDescribedBy =
              [
                child.helpText ? `${childInputId}-help` : null,
                childError ? `${childInputId}-error` : null,
              ]
                .filter(Boolean)
                .join(' ') || undefined;
            return (
              <FieldShell
                key={child.id}
                inputId={childInputId}
                label={child.label}
                required={child.required}
                helpText={child.helpText}
                error={childError}
                as={entry.group ? 'fieldset' : 'div'}
              >
                <Component
                  field={child}
                  value={row[child.id]}
                  onChange={(v: unknown) => setChild(i, child.id, v)}
                  error={childError}
                  errors={errors}
                  ctx={ctx}
                  inputId={childInputId}
                  describedBy={childDescribedBy}
                />
              </FieldShell>
            );
          })}
        </div>
      ))}
      {rows.length < field.maxItems ? (
        <Button type="button" variant="outline" disabled={ctx.disabled} onClick={addRow}>
          <Plus className="h-4 w-4" /> {field.addLabel ?? 'Add another'}
        </Button>
      ) : null}
    </div>
  );
}
