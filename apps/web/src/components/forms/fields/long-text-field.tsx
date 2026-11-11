'use client';

import { Textarea } from '@/components/ui/textarea';

import type { FieldProps } from './types';

/** Multi-line text. */
export function LongTextField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'long_text'>) {
  return (
    <Textarea
      id={inputId}
      rows={5}
      value={typeof value === 'string' ? value : ''}
      placeholder={field.placeholder}
      maxLength={field.maxLength ?? 10000}
      disabled={ctx.disabled}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
      aria-required={field.required || undefined}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
    />
  );
}
