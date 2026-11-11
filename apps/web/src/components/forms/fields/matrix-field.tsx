'use client';

import { cn } from '@/lib/utils';

import type { FieldProps } from './types';

type Cells = Record<string, string | string[]>;

/** Rows x columns. Single: radio per row. Multiple: checkbox per cell. */
export function MatrixField({
  field,
  value,
  onChange,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'matrix'>) {
  const cells: Cells =
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Cells) : {};

  function has(rowId: string, colId: string): boolean {
    const cell = cells[rowId];
    return Array.isArray(cell) ? cell.includes(colId) : cell === colId;
  }

  function set(rowId: string, colId: string) {
    const next: Cells = { ...cells };
    if (field.multiple) {
      const cur = Array.isArray(next[rowId]) ? (next[rowId] as string[]) : [];
      const list = cur.includes(colId) ? cur.filter((c) => c !== colId) : [...cur, colId];
      if (list.length > 0) next[rowId] = list;
      else delete next[rowId];
    } else {
      next[rowId] = colId;
    }
    onChange(Object.keys(next).length > 0 ? next : undefined);
  }

  const type = field.multiple ? 'checkbox' : 'radio';
  const control = (suffix: string, rowId: string, colId: string, label: string) => (
    <input
      type={type}
      name={`${inputId}-${suffix}-${rowId}`}
      checked={has(rowId, colId)}
      disabled={ctx.disabled}
      aria-label={label}
      onChange={() => set(rowId, colId)}
      className="accent-brand-purple h-4 w-4"
    />
  );

  return (
    <div id={inputId} role="group" aria-label={field.label} aria-describedby={describedBy}>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <td />
              {field.columns.map((c) => (
                <th key={c.id} scope="col" className="text-ink px-2 py-2 text-center font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {field.rows.map((r, i) => (
              <tr key={r.id} className={cn(i % 2 === 0 && 'bg-bg-subtle')}>
                <th scope="row" className="text-ink px-2 py-2 text-left font-normal">
                  {r.label}
                </th>
                {field.columns.map((c) => (
                  <td key={c.id} className="px-2 py-2 text-center">
                    {control('t', r.id, c.id, `${r.label}: ${c.label}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 sm:hidden">
        {field.rows.map((r) => (
          <fieldset key={r.id} className="border-line rounded-lg border p-3">
            <legend className="text-ink px-1 text-sm font-medium">{r.label}</legend>
            <div className="space-y-1.5">
              {field.columns.map((c) => (
                <label key={c.id} className="text-ink flex items-center gap-3 py-1 text-sm">
                  {control('c', r.id, c.id, `${r.label}: ${c.label}`)}
                  {c.label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </div>
  );
}
