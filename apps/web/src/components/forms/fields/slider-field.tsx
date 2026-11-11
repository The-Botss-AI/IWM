'use client';

import type { KeyboardEvent } from 'react';

import { cn } from '@/lib/utils';

import type { FieldProps } from './types';

const ADJUST_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

/** Native range slider. Stays unanswered until the person touches it. */
export function SliderField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'slider'>) {
  const answered = typeof value === 'number' && Number.isFinite(value);
  const resting = field.min + Math.round((field.max - field.min) / 2 / field.step) * field.step;
  const shown = answered ? value : resting;
  const text = answered ? `${value}${field.unit ? ` ${field.unit}` : ''}` : 'Not answered';
  const touch = () => {
    if (!answered) onChange(resting);
  };
  // Tab and other keys only move focus; they must not count as an answer.
  const touchOnAdjust = (e: KeyboardEvent<HTMLInputElement>) => {
    if (ADJUST_KEYS.has(e.key)) touch();
  };
  return (
    <div className="space-y-1.5">
      <input
        id={inputId}
        type="range"
        min={field.min}
        max={field.max}
        step={field.step}
        value={shown}
        disabled={ctx.disabled}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        aria-valuetext={text}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerDown={touch}
        onKeyDown={touchOnAdjust}
        className={cn('accent-brand-purple h-11 w-full', !answered && 'opacity-60')}
      />
      <div className="text-ink-muted flex items-center justify-between text-xs">
        <span>{field.min}</span>
        <span className="text-ink text-sm font-medium">{text}</span>
        <span>{field.max}</span>
      </div>
    </div>
  );
}
