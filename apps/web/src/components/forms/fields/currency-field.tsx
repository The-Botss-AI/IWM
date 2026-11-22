'use client';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { FieldProps } from './types';

/** Currency picker plus amount. The default currency shows until one is picked; clearing the amount clears the answer. */
export function CurrencyField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'currency'>) {
  const obj =
    typeof value === 'object' && value !== null
      ? (value as { amount?: unknown; currency?: unknown })
      : {};
  const fallback = field.defaultCurrency ?? field.currencies[0] ?? 'USD';
  const currency = typeof obj.currency === 'string' && obj.currency ? obj.currency : fallback;
  const amount =
    typeof obj.amount === 'number' && Number.isFinite(obj.amount) ? obj.amount : undefined;
  return (
    <div className="flex gap-2">
      <div className="w-28 shrink-0">
        <Select
          value={currency}
          disabled={ctx.disabled}
          onValueChange={(c) =>
            onChange(amount === undefined ? { currency: c } : { amount, currency: c })
          }
        >
          <SelectTrigger aria-label="Currency" aria-invalid={error ? true : undefined}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.currencies.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Input
        id={inputId}
        type="number"
        inputMode="decimal"
        min={field.min}
        max={field.max}
        step={0.01}
        value={amount ?? ''}
        placeholder={field.placeholder}
        disabled={ctx.disabled}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        aria-required={field.required || undefined}
        onChange={(e) => {
          const n = e.target.value === '' ? NaN : Number(e.target.value);
          onChange(Number.isFinite(n) ? { amount: n, currency } : undefined);
        }}
      />
    </div>
  );
}
