'use client';

import { useState } from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import type { FieldProps } from './types';

const DEFAULT_PRESETS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Colour picker, hex box and preset swatches. Value: lowercase '#rrggbb'. */
export function ColorField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'color'>) {
  const current = typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : '';
  const [text, setText] = useState<string | null>(null);
  const presets = field.presets && field.presets.length > 0 ? field.presets : DEFAULT_PRESETS;

  function commit(hex: string) {
    setText(null);
    onChange(hex.toLowerCase());
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label="Pick a colour"
          value={current || '#000000'}
          disabled={ctx.disabled}
          onChange={(e) => commit(e.target.value)}
          className="border-line h-11 w-11 shrink-0 cursor-pointer rounded-md border bg-white p-1 disabled:opacity-50"
        />
        <Input
          id={inputId}
          maxLength={7}
          placeholder="#RRGGBB"
          autoComplete="off"
          spellCheck={false}
          value={text ?? current}
          disabled={ctx.disabled}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          aria-required={field.required || undefined}
          onChange={(e) => {
            const raw = e.target.value.trim();
            const withHash = raw && !raw.startsWith('#') ? `#${raw}` : raw;
            if (withHash === '') {
              setText(null);
              return onChange(undefined);
            }
            if (HEX.test(withHash)) return commit(withHash);
            setText(withHash);
          }}
          onBlur={() => setText(null)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            aria-label={`Use colour ${p}`}
            aria-pressed={current === p.toLowerCase()}
            disabled={ctx.disabled}
            onClick={() => commit(p)}
            style={{ backgroundColor: p }}
            className={cn(
              'border-line focus-visible:shadow-focus h-9 w-9 rounded-full border focus-visible:outline-none disabled:opacity-50',
              current === p.toLowerCase() && 'ring-brand-purple ring-2 ring-offset-2',
            )}
          />
        ))}
      </div>
    </div>
  );
}
