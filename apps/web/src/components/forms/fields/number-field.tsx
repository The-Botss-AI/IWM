'use client';

import { Input } from '@/components/ui/input';

import type { FieldProps } from './types';

/** Numeric input; the value is a number, empty clears it. */
export function NumberField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'number'>) {
  const step = field.decimals ? 10 ** -field.decimals : 1;
  return (
    <Input
      id={inputId}
      type="number"
      inputMode={field.decimals ? 'decimal' : 'numeric'}
      min={field.min}
      max={field.max}
      step={step}
      value={typeof value === 'number' && Number.isFinite(value) ? value : ''}
      placeholder={field.placeholder}
      disabled={ctx.disabled}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
      aria-required={field.required || undefined}
      onChange={(e) => {
        if (e.target.value === '') return onChange(undefined);
        const n = Number(e.target.value);
        onChange(Number.isFinite(n) ? n : undefined);
      }}
    />
  );
}
