'use client';

import { Input } from '@/components/ui/input';

import type { FieldProps } from './types';

/** Native month input. Value: 'YYYY-MM'. */
export function MonthField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'month'>) {
  return (
    <Input
      id={inputId}
      type="month"
      value={typeof value === 'string' ? value : ''}
      disabled={ctx.disabled}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
      aria-required={field.required || undefined}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
    />
  );
}
