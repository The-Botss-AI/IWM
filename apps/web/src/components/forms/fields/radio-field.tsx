'use client';

import { OTHER_PREFIX } from '@botss/forms';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import type { FieldProps } from './types';

/**
 * Reference field for choices: native radios (keyboard and screen reader
 * friendly), plus an optional "Other" with a text box. The value is an option
 * id, or `other:<text>`.
 */
export function RadioField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'radio'>) {
  const current = typeof value === 'string' ? value : '';
  const isOther = current.startsWith(OTHER_PREFIX);
  const name = `${inputId}-group`;
  return (
    <div
      role="radiogroup"
      aria-label={field.label}
      aria-describedby={describedBy}
      aria-required={field.required || undefined}
      aria-invalid={error ? true : undefined}
      className="space-y-2"
    >
      {field.options.map((opt) => (
        <label
          key={opt.id}
          className={cn(
            'border-line flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors',
            current === opt.id ? 'border-brand-purple bg-brand-50' : 'hover:bg-bg-subtle',
          )}
        >
          <input
            type="radio"
            name={name}
            value={opt.id}
            checked={current === opt.id}
            disabled={ctx.disabled}
            onChange={() => onChange(opt.id)}
            className="accent-brand-purple h-4 w-4"
          />
          <span className="text-ink">{opt.label}</span>
        </label>
      ))}
      {field.allowOther ? (
        <div
          className={cn(
            'border-line rounded-lg border px-3 py-2.5',
            isOther && 'border-brand-purple bg-brand-50',
          )}
        >
          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <input
              type="radio"
              name={name}
              checked={isOther}
              disabled={ctx.disabled}
              onChange={() => onChange(OTHER_PREFIX)}
              className="accent-brand-purple h-4 w-4"
            />
            <span className="text-ink">Other</span>
          </label>
          {isOther ? (
            <Input
              autoFocus
              className="mt-2"
              aria-label="Other answer"
              maxLength={300}
              value={current.slice(OTHER_PREFIX.length)}
              disabled={ctx.disabled}
              onChange={(e) => onChange(OTHER_PREFIX + e.target.value)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
