'use client';

import { COUNTRY_CODES, countryName } from '@botss/forms';
import { useMemo } from 'react';

import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import type { FieldProps } from './types';

type Key = 'line1' | 'line2' | 'city' | 'state' | 'postalCode' | 'country';
type AddressValue = Partial<Record<Key, string>>;

/** Postal address. Value: object with line1, line2, city, state, postalCode, country. */
export function AddressField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'address'>) {
  const v: AddressValue =
    typeof value === 'object' && value !== null ? (value as AddressValue) : {};
  const countries = useMemo(
    () =>
      COUNTRY_CODES.map((code) => ({ value: code, label: countryName(code) })).sort((a, b) =>
        a.label.localeCompare(b.label),
      ),
    [],
  );

  function update(key: Key, text: string) {
    const keys: Key[] = field.includeLine2
      ? ['line1', 'line2', 'city', 'state', 'postalCode', 'country']
      : ['line1', 'city', 'state', 'postalCode', 'country'];
    const next: AddressValue = {};
    for (const k of keys) next[k] = v[k] ?? '';
    next[key] = text;
    onChange(Object.values(next).every((x) => !x) ? undefined : next);
  }

  const idFor = (key: Key) => (key === 'line1' ? inputId : `${inputId}-${key}`);
  const text = (key: Key, label: string, auto: string, className?: string) => (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={idFor(key)} className="text-ink-muted text-xs">
        {label}
      </label>
      <Input
        id={idFor(key)}
        autoComplete={auto}
        maxLength={200}
        value={v[key] ?? ''}
        disabled={ctx.disabled}
        aria-invalid={error ? true : undefined}
        onChange={(e) => update(key, e.target.value)}
      />
    </div>
  );

  return (
    <div
      role="group"
      aria-label={field.label}
      aria-describedby={describedBy}
      className="grid gap-3 sm:grid-cols-2"
    >
      {text('line1', 'Street address', 'address-line1', 'sm:col-span-2')}
      {field.includeLine2
        ? text('line2', 'Apartment, suite, etc.', 'address-line2', 'sm:col-span-2')
        : null}
      {text('city', 'City', 'address-level2')}
      {text('state', 'State / province', 'address-level1')}
      {text('postalCode', 'Postal code', 'postal-code')}
      <div className="space-y-1">
        <label htmlFor={idFor('country')} className="text-ink-muted text-xs">
          Country
        </label>
        <Combobox
          id={idFor('country')}
          options={countries}
          value={v.country || null}
          onChange={(c) => update('country', c ?? '')}
          placeholder="Select a country…"
          searchPlaceholder="Search countries…"
          disabled={ctx.disabled}
          triggerClassName={error ? 'border-state-error' : undefined}
        />
      </div>
    </div>
  );
}
