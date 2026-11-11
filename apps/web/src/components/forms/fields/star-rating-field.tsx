'use client';

import { Star } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';

import { cn } from '@/lib/utils';

import type { FieldProps } from './types';

/** Star rating with radiogroup semantics and arrow-key support. Value: integer 1..max. */
export function StarRatingField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'star_rating'>) {
  const current = typeof value === 'number' ? value : 0;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function move(next: number) {
    const n = Math.min(field.max, Math.max(1, next));
    onChange(n);
    refs.current[n - 1]?.focus();
  }
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(current + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(current === 0 ? 1 : current - 1);
    }
  }

  return (
    <div
      role="radiogroup"
      id={inputId}
      aria-label={field.label}
      aria-describedby={describedBy}
      aria-required={field.required || undefined}
      aria-invalid={error ? true : undefined}
      onKeyDown={onKeyDown}
      className="flex flex-wrap gap-1"
    >
      {Array.from({ length: field.max }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          ref={(el) => {
            refs.current[n - 1] = el;
          }}
          type="button"
          role="radio"
          aria-checked={current === n}
          aria-label={`${n} of ${field.max} stars`}
          tabIndex={current === n || (current === 0 && n === 1) ? 0 : -1}
          disabled={ctx.disabled}
          onClick={() => onChange(current === n ? undefined : n)}
          className="focus-visible:shadow-focus flex h-11 w-11 items-center justify-center rounded-md focus-visible:outline-none disabled:opacity-50"
        >
          <Star
            aria-hidden
            className={cn(
              'h-7 w-7',
              n <= current ? 'fill-brand-purple text-brand-purple' : 'text-ink-disabled',
            )}
          />
        </button>
      ))}
    </div>
  );
}
