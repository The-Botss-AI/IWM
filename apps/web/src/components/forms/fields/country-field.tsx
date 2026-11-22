'use client';

import { COUNTRY_CODES, countryName } from '@botss/forms';
import { useMemo } from 'react';

import { Combobox } from '@/components/ui/combobox';

import type { FieldProps } from './types';

/** Searchable country list. Value: ISO 3166-1 alpha-2 code. */
export function CountryField({
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'country'>) {
  const options = useMemo(
    () =>
      COUNTRY_CODES.map((code) => ({ value: code, label: countryName(code) })).sort((a, b) =>
        a.label.localeCompare(b.label),
      ),
    [],
  );
  return (
    <Combobox
      id={inputId}
      describedBy={describedBy}
      options={options}
      value={typeof value === 'string' ? value : null}
      onChange={(v) => onChange(v ?? undefined)}
      placeholder="Select a country…"
      searchPlaceholder="Search countries…"
      disabled={ctx.disabled}
      triggerClassName={error ? 'border-state-error' : undefined}
    />
  );
}
