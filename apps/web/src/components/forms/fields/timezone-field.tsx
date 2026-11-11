'use client';

import { timeZoneIds } from '@botss/forms';
import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';

import type { FieldProps } from './types';

/** Searchable time zone list with the person's own zone as a quick pick. */
export function TimezoneField({
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'timezone'>) {
  const options = useMemo(
    () => timeZoneIds().map((z) => ({ value: z, label: z.replace(/_/g, ' ') })),
    [],
  );
  const guess = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const current = typeof value === 'string' ? value : null;
  return (
    <div className="space-y-2">
      <Combobox
        id={inputId}
        describedBy={describedBy}
        options={options}
        value={current}
        onChange={(v) => onChange(v ?? undefined)}
        placeholder="Select a time zone…"
        searchPlaceholder="Search time zones…"
        disabled={ctx.disabled}
        triggerClassName={error ? 'border-state-error' : undefined}
      />
      {guess && current !== guess ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={ctx.disabled}
          className="min-h-[44px] sm:min-h-0"
          onClick={() => onChange(guess)}
        >
          Use {guess.replace(/_/g, ' ')}
        </Button>
      ) : null}
    </div>
  );
}
