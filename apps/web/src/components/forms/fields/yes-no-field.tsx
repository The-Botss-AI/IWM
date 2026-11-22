'use client';

import { cn } from '@/lib/utils';

import type { FieldProps } from './types';
import { useRadioKeys } from './use-radio-keys';

/** Two large toggle buttons. Value: boolean. */
export function YesNoField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'yes_no'>) {
  const options: { v: boolean; label: string }[] = [
    { v: true, label: field.yesLabel ?? 'Yes' },
    { v: false, label: field.noLabel ?? 'No' },
  ];
  const keys = useRadioKeys({
    count: options.length,
    current: options.findIndex((o) => o.v === value),
    select: (i) => onChange(options[i]?.v),
  });
  return (
    <div
      role="radiogroup"
      id={inputId}
      aria-label={field.label}
      aria-describedby={describedBy}
      aria-required={field.required || undefined}
      aria-invalid={error ? true : undefined}
      onKeyDown={keys.onKeyDown}
      className="grid grid-cols-2 gap-2"
    >
      {options.map((o, i) => {
        const checked = value === o.v;
        return (
          <button
            key={String(o.v)}
            ref={keys.setRef(i)}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={keys.tabIndexFor(i)}
            disabled={ctx.disabled}
            onClick={() => onChange(checked ? undefined : o.v)}
            className={cn(
              'border-line text-ink min-h-[44px] rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors',
              'focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
              checked ? 'border-brand-purple bg-brand-50' : 'hover:bg-bg-subtle',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
