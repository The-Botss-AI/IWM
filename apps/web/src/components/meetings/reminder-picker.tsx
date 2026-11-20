'use client';

import {
  MAX_MEETING_REMINDERS,
  MEETING_REMINDER_MAX_MINUTES,
  MEETING_REMINDER_PRESETS,
} from '@botss/shared-types';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  customToMinutes,
  isPresetReminder,
  normalizeReminders,
  reminderLabel,
  type CustomUnit,
} from '@/lib/meetings/meeting-reminders';
import { cn } from '@/lib/utils';

/** Reminder lead times: preset chips, custom values, at most five. */
export function ReminderPicker({
  value,
  onChange,
  disabled,
}: {
  value: readonly number[];
  onChange: (next: number[]) => void;
  disabled?: boolean;
}) {
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<CustomUnit>('minutes');
  const [error, setError] = useState<string | null>(null);
  const full = value.length >= MAX_MEETING_REMINDERS;
  const customs = value.filter((m) => !isPresetReminder(m));

  function toggle(minutes: number): void {
    setError(null);
    if (value.includes(minutes)) {
      onChange(value.filter((m) => m !== minutes));
      return;
    }
    if (full) {
      setError(`At most ${MAX_MEETING_REMINDERS} reminders`);
      return;
    }
    onChange(normalizeReminders([...value, minutes]));
  }

  function addCustom(): void {
    const n = Number(amount);
    const minutes = customToMinutes(n, unit);
    if (!Number.isFinite(n) || n <= 0 || minutes < 1 || minutes > MEETING_REMINDER_MAX_MINUTES) {
      setError('Use a time from 1 minute to 28 days');
      return;
    }
    if (value.includes(minutes)) {
      setError('That reminder is already set');
      return;
    }
    if (full) {
      setError(`At most ${MAX_MEETING_REMINDERS} reminders`);
      return;
    }
    setError(null);
    setAmount('');
    onChange(normalizeReminders([...value, minutes]));
  }

  return (
    <div className="space-y-2">
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label="Reminders before the meeting"
      >
        {MEETING_REMINDER_PRESETS.map((m) => {
          const on = value.includes(m);
          return (
            <button
              key={m}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => toggle(m)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50',
                on
                  ? 'bg-brand-gradient border-transparent text-white'
                  : 'border-line text-ink hover:bg-bg-subtle bg-white',
              )}
            >
              {reminderLabel(m)}
            </button>
          );
        })}
        {customs.map((m) => (
          <span
            key={m}
            className="bg-brand-gradient inline-flex items-center gap-1 rounded-full py-1 pl-3 pr-1.5 text-xs text-white"
          >
            {reminderLabel(m)}
            <button
              type="button"
              disabled={disabled}
              aria-label={`Remove the ${reminderLabel(m)} reminder`}
              onClick={() => toggle(m)}
              className="rounded-full p-0.5 hover:bg-white/20"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          value={amount}
          disabled={disabled}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder="Custom"
          aria-label="Custom reminder amount"
          className="h-9 w-24"
        />
        <Select value={unit} onValueChange={(v) => setUnit(v as CustomUnit)} disabled={disabled}>
          <SelectTrigger className="h-9 w-28" aria-label="Custom reminder unit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="minutes">minutes</SelectItem>
            <SelectItem value="hours">hours</SelectItem>
            <SelectItem value="days">days</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={disabled || !amount}
          onClick={addCustom}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add
        </Button>
        <span className="text-ink-muted text-[11px]">
          {value.length} of {MAX_MEETING_REMINDERS}
        </span>
      </div>
      {error ? (
        <p role="alert" className="text-state-error text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
