'use client';

import type { FieldProps } from './types';

/** Read-only display of a server-computed value. */
export function CalculatedField({ field, ctx, inputId, describedBy }: FieldProps<'calculated'>) {
  const n = ctx.calculated[field.id];
  const formatted =
    typeof n === 'number' && Number.isFinite(n)
      ? `${field.prefix ?? ''}${n.toLocaleString(undefined, {
          minimumFractionDigits: field.decimals,
          maximumFractionDigits: field.decimals,
        })}${field.suffix ?? ''}`
      : null;
  return (
    <output
      id={inputId}
      aria-describedby={describedBy}
      className="border-line bg-bg-subtle text-ink flex min-h-10 w-full items-center rounded-md border px-3.5 py-2.5 text-sm"
    >
      {formatted ?? <span className="text-ink-muted">Not calculated yet</span>}
    </output>
  );
}
