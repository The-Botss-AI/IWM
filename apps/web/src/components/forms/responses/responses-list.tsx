'use client';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsSmall } from '@/hooks/use-media-query';
import type { ResponseRow, ResponseTable } from '@/lib/forms/responses';
import { relativeTime } from '@/lib/time';

interface Props {
  table: ResponseTable | null;
  isLoading: boolean;
  hasFilters: boolean;
  onSelect: (id: string) => void;
}

const sourceLabel = (s: ResponseRow['source']) => (s === 'PUBLIC' ? 'Public link' : 'In app');

export function ResponsesList({ table, isLoading, hasFilters, onSelect }: Props) {
  const isSmall = useIsSmall();

  if (isLoading || !table) {
    return (
      <div className="space-y-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }

  if (table.rows.length === 0) {
    return (
      <div className="border-line rounded-lg border border-dashed bg-white p-10 text-center">
        <p className="text-ink text-sm font-medium">
          {hasFilters ? 'No responses match these filters' : 'No responses yet'}
        </p>
        <p className="text-ink-muted mt-1 text-sm">
          {hasFilters
            ? 'Try removing a filter.'
            : 'Share the form from the Share tab. Responses show up here as people send them.'}
        </p>
      </div>
    );
  }

  if (isSmall) {
    return (
      <ul className="divide-line border-line divide-y rounded-lg border bg-white">
        {table.rows.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onSelect(r.id)}
              className="hover:bg-bg-subtle focus-visible:bg-bg-subtle flex w-full flex-col gap-1.5 p-3 text-left focus-visible:outline-none"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink min-w-0 truncate text-sm font-medium">{r.by}</span>
                <Badge tone="outline">{sourceLabel(r.source)}</Badge>
              </div>
              {table.columns.slice(0, 2).map((c, i) => (
                <span key={c.id} className="text-ink-muted truncate text-xs">
                  {c.label}: {r.cells[i] || '-'}
                </span>
              ))}
              <span className="text-ink-disabled text-xs">{relativeTime(r.submittedAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="border-line overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-bg-subtle text-ink-muted text-left text-xs font-medium uppercase tracking-wide">
          <tr>
            <th className="px-3 py-2">Submitted</th>
            <th className="px-3 py-2">Source</th>
            <th className="px-3 py-2">By</th>
            {table.columns.map((c) => (
              <th key={c.id} className="max-w-[200px] truncate px-3 py-2">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r) => (
            <tr
              key={r.id}
              onClick={() => onSelect(r.id)}
              className="border-line hover:bg-bg-subtle focus-within:bg-bg-subtle cursor-pointer border-t"
            >
              <td className="whitespace-nowrap px-3 py-2">
                <button
                  type="button"
                  onClick={() => onSelect(r.id)}
                  aria-label={`Open response from ${r.submittedAt.toLocaleString()}`}
                  className="text-ink-muted hover:text-ink focus-visible:shadow-focus rounded text-left focus-visible:outline-none"
                >
                  {relativeTime(r.submittedAt)}
                </button>
              </td>
              <td className="px-3 py-2">
                <Badge tone="outline">{sourceLabel(r.source)}</Badge>
              </td>
              <td className="text-ink max-w-[180px] truncate px-3 py-2">{r.by}</td>
              {r.cells.map((cell, i) => (
                <td
                  key={table.columns[i]?.id ?? i}
                  className="text-ink max-w-[220px] truncate px-3 py-2"
                >
                  {cell || <span className="text-ink-disabled">-</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
