'use client';

import { Input } from '@/components/ui/input';

import type { FieldProps } from './types';

/** Email address input. */
export function EmailField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'email'>) {
  return (
    <Input
      id={inputId}
      type="email"
      autoComplete="email"
      inputMode="email"
      value={typeof value === 'string' ? value : ''}
      placeholder={field.placeholder}
      maxLength={320}
      disabled={ctx.disabled}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
      aria-required={field.required || undefined}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
    />
  );
}
