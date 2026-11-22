'use client';

import { Input } from '@/components/ui/input';

import type { FieldProps } from './types';

/** Web link input. */
export function UrlField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'url'>) {
  return (
    <Input
      id={inputId}
      type="url"
      inputMode="url"
      autoComplete="url"
      value={typeof value === 'string' ? value : ''}
      placeholder={field.placeholder ?? 'https://'}
      maxLength={2000}
      disabled={ctx.disabled}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
      aria-required={field.required || undefined}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
    />
  );
}
