'use client';

import { cn } from '@/lib/utils';

import type { FieldProps } from './types';
import { useRadioKeys } from './use-radio-keys';

/** Numbered scale buttons from min to max with optional end labels. */
export function LinearScaleField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'linear_scale'>) {
  const points = Array.from({ length: field.max - field.min + 1 }, (_, i) => field.min + i);
  const keys = useRadioKeys({
    count: points.length,
    current: typeof value === 'number' ? points.indexOf(value) : -1,
    select: (i) => onChange(points[i]),
  });
  return (
    <div className="space-y-1.5">
      <div
        role="radiogroup"
        id={inputId}
        aria-label={field.label}
        aria-describedby={describedBy}
        aria-required={field.required || undefined}
        aria-invalid={error ? true : undefined}
        onKeyDown={keys.onKeyDown}
        className="flex flex-wrap gap-2"
      >
        {points.map((n, i) => {
          const checked = value === n;
          return (
            <button
              key={n}
              ref={keys.setRef(i)}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={keys.tabIndexFor(i)}
              disabled={ctx.disabled}
              onClick={() => onChange(checked ? undefined : n)}
              className={cn(
                'border-line text-ink flex h-11 min-w-[44px] flex-1 items-center justify-center rounded-lg border px-2 text-sm font-medium transition-colors',
                'focus-visible:shadow-focus focus-visible:outline-none disabled:opacity-50',
                checked ? 'border-brand-purple bg-brand-50' : 'hover:bg-bg-subtle',
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
      {field.minLabel || field.maxLabel ? (
        <div className="text-ink-muted flex justify-between gap-4 text-xs">
          <span>{field.minLabel}</span>
          <span className="text-right">{field.maxLabel}</span>
        </div>
      ) : null}
    </div>
  );
}
