'use client';

import { useState } from 'react';

import { Input } from '@/components/ui/input';

import type { FieldProps } from './types';

/** Start and end dates. Value `{ start, end }` is only set once both are present. */
export function DateRangeField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'date_range'>) {
  const committed =
    typeof value === 'object' && value !== null ? (value as { start?: string; end?: string }) : {};
  const [draft, setDraft] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const start = committed.start ?? draft.start;
  const end = committed.end ?? draft.end;

  function update(next: { start: string; end: string }) {
    setDraft(next);
    onChange(next.start && next.end ? { start: next.start, end: next.end } : undefined);
  }

  return (
    <div
      role="group"
      aria-label={field.label}
      aria-describedby={describedBy}
      className="grid gap-3 sm:grid-cols-2"
    >
      <div className="space-y-1">
        <label htmlFor={inputId} className="text-ink-muted text-xs">
          Start
        </label>
        <Input
          id={inputId}
          type="date"
          min={field.minDate}
          max={field.maxDate}
          disabled={ctx.disabled}
          aria-invalid={error ? true : undefined}
          value={start}
          onChange={(e) => update({ start: e.target.value, end })}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${inputId}-end`} className="text-ink-muted text-xs">
          End
        </label>
        <Input
          id={`${inputId}-end`}
          type="date"
          min={start || field.minDate}
          max={field.maxDate}
          disabled={ctx.disabled}
          aria-invalid={error ? true : undefined}
          value={end}
          onChange={(e) => update({ start, end: e.target.value })}
        />
      </div>
    </div>
  );
}
