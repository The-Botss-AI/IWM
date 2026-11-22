'use client';

import { OTHER_PREFIX } from '@botss/forms';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import type { FieldProps } from './types';

/** Native checkboxes plus an optional "Other" entry. Value: option ids, and one `other:<text>`. */
export function CheckboxesField({
  field,
  value,
  onChange,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'checkboxes'>) {
  const ids = Array.isArray(value) ? (value as string[]) : [];
  const otherEntry = ids.find((i) => i.startsWith(OTHER_PREFIX));

  function set(next: string[]) {
    onChange(next.length === 0 ? undefined : next);
  }
  function toggle(id: string) {
    set(ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]);
  }
  function toggleOther() {
    set(
      otherEntry !== undefined
        ? ids.filter((i) => !i.startsWith(OTHER_PREFIX))
        : [...ids, OTHER_PREFIX],
    );
  }

  return (
    <div role="group" aria-label={field.label} aria-describedby={describedBy} className="space-y-2">
      {field.options.map((opt, i) => (
        <label
          key={opt.id}
          className={cn(
            'border-line flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors',
            ids.includes(opt.id) ? 'border-brand-purple bg-brand-50' : 'hover:bg-bg-subtle',
          )}
        >
          <input
            id={i === 0 ? inputId : undefined}
            type="checkbox"
            checked={ids.includes(opt.id)}
            disabled={ctx.disabled}
            onChange={() => toggle(opt.id)}
            className="accent-brand-purple h-4 w-4"
          />
          <span className="text-ink">{opt.label}</span>
        </label>
      ))}
      {field.allowOther ? (
        <div
          className={cn(
            'border-line rounded-lg border px-3 py-2.5',
            otherEntry !== undefined && 'border-brand-purple bg-brand-50',
          )}
        >
          <label className="flex min-h-[28px] cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={otherEntry !== undefined}
              disabled={ctx.disabled}
              onChange={toggleOther}
              className="accent-brand-purple h-4 w-4"
            />
            <span className="text-ink">Other</span>
          </label>
          {otherEntry !== undefined ? (
            <Input
              autoFocus
              className="mt-2"
              aria-label="Other answer"
              maxLength={300}
              value={otherEntry.slice(OTHER_PREFIX.length)}
              disabled={ctx.disabled}
              onChange={(e) =>
                set(
                  ids.map((i) => (i.startsWith(OTHER_PREFIX) ? OTHER_PREFIX + e.target.value : i)),
                )
              }
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
