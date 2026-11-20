'use client';

import { useMemo } from 'react';

import { Input } from '@/components/ui/input';
import { isoToLocalInput, localInputToIso } from '@/lib/forms/datetime';

import type { FieldProps } from './types';

/** Native datetime-local input. Value: ISO UTC string. */
export function DatetimeField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'datetime'>) {
  const zone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  return (
    <div className="space-y-1">
      <Input
        id={inputId}
        type="datetime-local"
        value={isoToLocalInput(value)}
        disabled={ctx.disabled}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        aria-required={field.required || undefined}
        onChange={(e) => {
          onChange(localInputToIso(e.target.value));
        }}
      />
      <p className="text-ink-muted text-xs">Time zone: {zone}</p>
    </div>
  );
}
