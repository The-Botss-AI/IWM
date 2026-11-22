'use client';

import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from 'cmdk';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import type { FieldProps } from './types';

/** Pick several options from a searchable popover; chosen ones show as removable chips. */
export function MultiSelectField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'multi_select'>) {
  const [open, setOpen] = useState(false);
  const ids = Array.isArray(value) ? (value as string[]) : [];
  const labelOf = (id: string) => field.options.find((o) => o.id === id)?.label ?? id;

  function set(next: string[]) {
    onChange(next.length === 0 ? undefined : next);
  }
  function toggle(id: string) {
    set(ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]);
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={inputId}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            disabled={ctx.disabled}
            className={cn(
              'h-10 w-full justify-between font-normal',
              ids.length === 0 && 'text-ink-disabled',
            )}
          >
            <span className="truncate">
              {ids.length === 0 ? (field.placeholder ?? 'Select…') : `${ids.length} selected`}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command className="max-h-72 overflow-hidden rounded-md" loop>
            <div className="border-line border-b px-2">
              <CommandInput
                placeholder="Search…"
                className="placeholder:text-ink-disabled flex h-10 w-full bg-transparent py-2 text-sm outline-none"
              />
            </div>
            <CommandList className="max-h-60 overflow-auto p-1">
              <CommandEmpty className="text-ink-muted px-2 py-3 text-center text-sm">
                No results.
              </CommandEmpty>
              <CommandGroup>
                {field.options.map((o) => (
                  <CommandItem
                    key={o.id}
                    value={`${o.label} ${o.id}`}
                    onSelect={() => toggle(o.id)}
                    className="aria-selected:bg-bg-subtle flex min-h-[44px] cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm"
                  >
                    <span className="text-ink flex-1">{o.label}</span>
                    <Check
                      className={cn(
                        'h-4 w-4 shrink-0',
                        ids.includes(o.id) ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {ids.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {ids.map((id) => (
            <li
              key={id}
              className="bg-bg-subtle text-ink inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
            >
              {labelOf(id)}
              <button
                type="button"
                aria-label={`Remove ${labelOf(id)}`}
                disabled={ctx.disabled}
                onClick={() => set(ids.filter((i) => i !== id))}
                className="text-ink-muted hover:text-ink focus-visible:shadow-focus flex h-11 w-11 items-center justify-center rounded focus-visible:outline-none sm:h-5 sm:w-5"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
