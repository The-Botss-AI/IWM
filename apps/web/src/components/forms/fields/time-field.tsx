'use client';

import { Input } from '@/components/ui/input';

import type { FieldProps } from './types';

/** Native time input. Value: 'HH:mm'. */
export function TimeField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'time'>) {
  return (
    <Input
      id={inputId}
      type="time"
      min={field.minTime}
      max={field.maxTime}
      value={typeof value === 'string' ? value : ''}
      disabled={ctx.disabled}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
      aria-required={field.required || undefined}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
    />
  );
}
