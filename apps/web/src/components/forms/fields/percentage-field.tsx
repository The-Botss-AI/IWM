'use client';

import { Input } from '@/components/ui/input';

import type { FieldProps } from './types';

/** Number input with a "%" suffix inside the box. */
export function PercentageField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'percentage'>) {
  const step = field.decimals ? 10 ** -field.decimals : 1;
  return (
    <div className="relative">
      <Input
        id={inputId}
        type="number"
        inputMode={field.decimals ? 'decimal' : 'numeric'}
        min={field.min}
        max={field.max}
        step={step}
        className="pr-9"
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
      <span
        aria-hidden
        className="text-ink-muted pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm"
      >
        %
      </span>
    </div>
  );
}
