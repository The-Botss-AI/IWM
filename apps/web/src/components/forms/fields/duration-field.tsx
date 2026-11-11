'use client';

import { Input } from '@/components/ui/input';
import { minutesToParts, partsToMinutes } from '@/lib/forms/duration';

import type { FieldProps } from './types';

/** Hours and minutes inputs. Value: total minutes (integer). */
export function DurationField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'duration'>) {
  const { hours, minutes } = minutesToParts(value);

  function update(h: string, m: string) {
    onChange(partsToMinutes(h, m));
  }

  return (
    <div
      role="group"
      aria-label={field.label}
      aria-describedby={describedBy}
      className="grid grid-cols-2 gap-3"
    >
      <div className="space-y-1">
        <label htmlFor={inputId} className="text-ink-muted text-xs">
          Hours
        </label>
        <Input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={0}
          max={field.maxMinutes ? Math.floor(field.maxMinutes / 60) : undefined}
          step={1}
          placeholder="0"
          value={hours}
          disabled={ctx.disabled}
          aria-invalid={error ? true : undefined}
          onChange={(e) => update(e.target.value, minutes)}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${inputId}-min`} className="text-ink-muted text-xs">
          Minutes
        </label>
        <Input
          id={`${inputId}-min`}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          placeholder="0"
          value={minutes}
          disabled={ctx.disabled}
          aria-invalid={error ? true : undefined}
          onChange={(e) => update(hours, e.target.value)}
        />
      </div>
    </div>
  );
}
