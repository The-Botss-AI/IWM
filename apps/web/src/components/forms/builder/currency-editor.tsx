'use client';

import { Plus, X } from 'lucide-react';
import { useId, useState } from 'react';
import type { FormFieldOf } from '@botss/shared-types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CURRENCY_PRESETS, type FieldPatch } from '@/lib/forms/builder-ops';
import { cn } from '@/lib/utils';

import { SelectProp } from './props-ui';

const CODE_RE = /^[A-Z]{3}$/;

/** Currency list (quick picks plus any ISO code) and the default currency. */
export function CurrencyEditor({
  field,
  onPatch,
}: {
  field: FormFieldOf<'currency'>;
  onPatch: (patch: FieldPatch) => void;
}) {
  const entryId = useId();
  const [entry, setEntry] = useState('');
  const [entryError, setEntryError] = useState<string | null>(null);
  const selected = field.currencies;

  const setList = (currencies: string[]) => {
    const defaultCurrency =
      field.defaultCurrency && currencies.includes(field.defaultCurrency)
        ? field.defaultCurrency
        : undefined;
    onPatch({ currencies, defaultCurrency });
  };
  const toggle = (code: string) => {
    if (selected.includes(code)) {
      if (selected.length > 1) setList(selected.filter((c) => c !== code));
    } else {
      setList([...selected, code]);
    }
  };
  const addEntry = () => {
    const code = entry.trim().toUpperCase();
    if (!code) return;
    if (!CODE_RE.test(code)) {
      setEntryError('Use a 3 letter code, like CAD.');
      return;
    }
    setEntryError(null);
    setEntry('');
    if (!selected.includes(code)) setList([...selected, code]);
  };

  const custom = selected.filter((c) => !(CURRENCY_PRESETS as readonly string[]).includes(c));

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <span className="text-ink text-[13px] font-medium">Currencies people can pick</span>
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label="Currencies people can pick"
        >
          {[...CURRENCY_PRESETS, ...custom].map((code) => {
            const on = selected.includes(code);
            return (
              <button
                key={code}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(code)}
                className={cn(
                  'focus-visible:shadow-focus rounded-full border px-3 py-1 text-xs font-medium focus-visible:outline-none',
                  on
                    ? 'border-brand-purple bg-brand-purple/10 text-brand-purple'
                    : 'border-line text-ink-muted hover:bg-bg-subtle',
                )}
              >
                {code}
                {on && custom.includes(code) ? (
                  <X className="ml-1 inline h-3 w-3" aria-hidden />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={entryId}>Add another currency code</Label>
        <div className="flex gap-1.5">
          <Input
            id={entryId}
            value={entry}
            maxLength={3}
            placeholder="CAD"
            className="h-9"
            onChange={(e) => setEntry(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addEntry();
              }
            }}
          />
          <Button variant="outline" size="sm" aria-label="Add currency code" onClick={addEntry}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> Add
          </Button>
        </div>
        {entryError ? (
          <p role="alert" className="text-state-error text-xs">
            {entryError}
          </p>
        ) : null}
      </div>
      <SelectProp
        label="Default currency"
        value={field.defaultCurrency}
        options={selected.map((c) => ({ value: c, label: c }))}
        onChange={(defaultCurrency) => onPatch({ defaultCurrency })}
        placeholder="First in the list"
      />
    </div>
  );
}
