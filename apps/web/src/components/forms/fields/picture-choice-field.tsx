'use client';

import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { FieldProps } from './types';

/** Grid of image cards. Single: option id. Multiple: array of option ids. */
export function PictureChoiceField({
  field,
  value,
  onChange,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'picture_choice'>) {
  const selected: string[] = Array.isArray(value)
    ? (value as string[])
    : typeof value === 'string'
      ? [value]
      : [];

  function toggle(id: string) {
    if (field.multiple) {
      const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
      onChange(next.length > 0 ? next : undefined);
    } else {
      onChange(selected.includes(id) ? undefined : id);
    }
  }

  return (
    <div
      id={inputId}
      role="group"
      aria-label={field.label}
      aria-describedby={describedBy}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
    >
      {field.options.map((opt) => {
        const on = selected.includes(opt.id);
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={on}
            disabled={ctx.disabled}
            onClick={() => toggle(opt.id)}
            className={cn(
              'relative overflow-hidden rounded-lg border bg-white text-left transition-shadow',
              'focus-visible:shadow-focus focus-visible:outline-none disabled:opacity-60',
              on
                ? 'border-brand-purple ring-brand-purple ring-2'
                : 'border-line hover:border-ink-muted',
            )}
          >
            {opt.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- user-supplied remote URLs
              <img
                src={opt.imageUrl}
                alt=""
                loading="lazy"
                className="aspect-square w-full object-cover"
              />
            ) : (
              <div className="bg-bg-subtle aspect-square w-full" />
            )}
            <span className="text-ink block px-2.5 py-2 text-sm">{opt.label}</span>
            {on ? (
              <span className="bg-brand-purple absolute right-2 top-2 rounded-full p-1 text-white">
                <Check className="h-3 w-3" />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
