'use client';

import { cn } from '@/lib/utils';

import type { FieldProps } from './types';
import { useRadioKeys } from './use-radio-keys';

const FACES_3 = [
  { emoji: '😞', label: 'Unhappy' },
  { emoji: '😐', label: 'Neutral' },
  { emoji: '😊', label: 'Happy' },
];
const FACES_5 = [
  { emoji: '😡', label: 'Very unhappy' },
  { emoji: '😞', label: 'Unhappy' },
  { emoji: '😐', label: 'Neutral' },
  { emoji: '🙂', label: 'Happy' },
  { emoji: '😍', label: 'Very happy' },
];

/** Face rating. Value: integer 1..scale. */
export function EmojiRatingField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'emoji_rating'>) {
  const faces = field.scale === 3 ? FACES_3 : FACES_5;
  const keys = useRadioKeys({
    count: faces.length,
    current: typeof value === 'number' ? value - 1 : -1,
    select: (i) => onChange(i + 1),
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
      className="flex flex-wrap gap-2"
    >
      {faces.map((f, i) => {
        const n = i + 1;
        const checked = value === n;
        return (
          <button
            key={n}
            ref={keys.setRef(i)}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={keys.tabIndexFor(i)}
            aria-label={f.label}
            title={f.label}
            disabled={ctx.disabled}
            onClick={() => onChange(checked ? undefined : n)}
            className={cn(
              'border-line flex h-12 w-12 items-center justify-center rounded-lg border text-2xl transition-all',
              'focus-visible:shadow-focus focus-visible:outline-none disabled:opacity-50',
              checked
                ? 'border-brand-purple bg-brand-50'
                : 'hover:bg-bg-subtle opacity-70 hover:opacity-100',
            )}
          >
            <span aria-hidden>{f.emoji}</span>
          </button>
        );
      })}
    </div>
  );
}
