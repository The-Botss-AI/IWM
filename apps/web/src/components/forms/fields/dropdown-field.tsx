'use client';

import { OTHER_PREFIX } from '@botss/forms';

import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { FieldProps } from './types';

const OTHER_KEY = '__other__';

/** Searchable combobox for long lists, plain select otherwise. Value: option id or `other:<text>`. */
export function DropdownField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'dropdown'>) {
  const current = typeof value === 'string' ? value : '';
  const isOther = current.startsWith(OTHER_PREFIX);
  const selected = isOther ? OTHER_KEY : current;
  const placeholder = field.placeholder ?? 'Select…';

  function pick(next: string | null) {
    if (!next) return onChange(undefined);
    onChange(next === OTHER_KEY ? OTHER_PREFIX : next);
  }

  const items = field.options.map((o) => ({ value: o.id, label: o.label }));
  if (field.allowOther) items.push({ value: OTHER_KEY, label: 'Other' });

  return (
    <div className="space-y-2">
      {items.length > 7 ? (
        <Combobox
          id={inputId}
          describedBy={describedBy}
          options={items}
          value={selected || null}
          onChange={pick}
          placeholder={placeholder}
          disabled={ctx.disabled}
          clearable={!field.required}
          triggerClassName={error ? 'border-state-error' : undefined}
        />
      ) : (
        <Select value={selected} disabled={ctx.disabled} onValueChange={pick}>
          <SelectTrigger
            id={inputId}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {items.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {isOther ? (
        <Input
          autoFocus
          aria-label="Other answer"
          maxLength={300}
          value={current.slice(OTHER_PREFIX.length)}
          disabled={ctx.disabled}
          onChange={(e) => onChange(OTHER_PREFIX + e.target.value)}
        />
      ) : null}
    </div>
  );
}
