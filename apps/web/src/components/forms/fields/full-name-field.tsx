'use client';

import { Input } from '@/components/ui/input';

import type { FieldProps } from './types';

type NameKey = 'first' | 'middle' | 'last';
type NameValue = Partial<Record<NameKey, string>>;

/** First, optional middle and last name inputs. Value: `{ first, middle?, last }`. */
export function FullNameField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'full_name'>) {
  const v: NameValue = typeof value === 'object' && value !== null ? (value as NameValue) : {};

  function update(key: NameKey, text: string) {
    const next: Record<NameKey, string> = {
      first: v.first ?? '',
      middle: v.middle ?? '',
      last: v.last ?? '',
    };
    next[key] = text;
    if (!next.first && !next.middle && !next.last) return onChange(undefined);
    onChange(field.includeMiddle ? next : { first: next.first, last: next.last });
  }

  const parts: { key: NameKey; label: string; auto: string }[] = [
    { key: 'first', label: 'First name', auto: 'given-name' },
    ...(field.includeMiddle
      ? [{ key: 'middle' as const, label: 'Middle name', auto: 'additional-name' }]
      : []),
    { key: 'last', label: 'Last name', auto: 'family-name' },
  ];

  return (
    <div
      role="group"
      aria-label={field.label}
      aria-describedby={describedBy}
      className={field.includeMiddle ? 'grid gap-3 sm:grid-cols-3' : 'grid gap-3 sm:grid-cols-2'}
    >
      {parts.map((p, i) => {
        const id = i === 0 ? inputId : `${inputId}-${p.key}`;
        return (
          <div key={p.key} className="space-y-1">
            <label htmlFor={id} className="text-ink-muted text-xs">
              {p.label}
            </label>
            <Input
              id={id}
              autoComplete={p.auto}
              maxLength={100}
              value={v[p.key] ?? ''}
              disabled={ctx.disabled}
              aria-invalid={error ? true : undefined}
              onChange={(e) => update(p.key, e.target.value)}
            />
          </div>
        );
      })}
    </div>
  );
}
