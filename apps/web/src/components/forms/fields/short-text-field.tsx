'use client';

import { Input } from '@/components/ui/input';

import type { FieldProps } from './types';

/** Reference field: a controlled single-line text input. */
export function ShortTextField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'short_text'>) {
  return (
    <Input
      id={inputId}
      value={typeof value === 'string' ? value : ''}
      placeholder={field.placeholder}
      maxLength={field.maxLength ?? (field.pattern ? 500 : 1000)}
      disabled={ctx.disabled}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
      aria-required={field.required || undefined}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
    />
  );
}
