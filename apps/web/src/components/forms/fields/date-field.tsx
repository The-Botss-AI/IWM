'use client';

import { Input } from '@/components/ui/input';

import type { FieldProps } from './types';

/** Native date input. Value: 'YYYY-MM-DD'. */
export function DateField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'date'>) {
  return (
    <Input
      id={inputId}
      type="date"
      min={field.minDate}
      max={field.maxDate}
      value={typeof value === 'string' ? value : ''}
      disabled={ctx.disabled}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
      aria-required={field.required || undefined}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
    />
  );
}
