'use client';

import { useDraggable } from '@dnd-kit/core';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { FormFieldType } from '@botss/shared-types';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PALETTE_DRAG_PREFIX } from '@/lib/forms/builder-ops';
import { FIELD_CATALOG, FIELD_GROUPS, type FieldCatalogEntry } from '@/lib/forms/field-catalog';
import { cn } from '@/lib/utils';

interface FieldPaletteProps {
  onAdd: (type: FormFieldType) => void;
  /** Dragging into the canvas only works when both are on screen. */
  draggable: boolean;
}

/** Grouped list of field types. Click adds after the selected field; drag drops into the canvas. */
export function FieldPalette({ onAdd, draggable }: FieldPaletteProps) {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FIELD_GROUPS.map((group) => ({
      group,
      items: FIELD_CATALOG.filter(
        (e) =>
          e.group === group &&
          (!q || e.label.toLowerCase().includes(q) || e.hint.toLowerCase().includes(q)),
      ),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="form-palette-search" className="sr-only">
          Search field types
        </Label>
        <div className="relative">
          <Search
            className="text-ink-muted pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            id="form-palette-search"
            type="search"
            placeholder="Search field types"
            className="pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      {groups.length === 0 ? <p className="text-ink-muted text-sm">No field types match.</p> : null}
      {groups.map(({ group, items }) => (
        <section key={group} aria-label={group}>
          <h3 className="text-ink-muted mb-1.5 text-xs font-semibold uppercase tracking-wide">
            {group}
          </h3>
          <ul className="grid grid-cols-2 gap-1.5 lg:grid-cols-1 xl:grid-cols-2" role="list">
            {items.map((entry) => (
              <li key={entry.type}>
                <PaletteItem entry={entry} onAdd={onAdd} draggable={draggable} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function PaletteItem({
  entry,
  onAdd,
  draggable,
}: {
  entry: FieldCatalogEntry;
  onAdd: (type: FormFieldType) => void;
  draggable: boolean;
}) {
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: `${PALETTE_DRAG_PREFIX}${entry.type}`,
    disabled: !draggable,
  });
  // Keyboard users click (Enter or Space adds the field); only pointer drags start here.
  const { onKeyDown: _keyboard, ...pointer } = (listeners ?? {}) as Record<string, unknown>;
  const Icon = entry.icon;
  return (
    <button
      ref={setNodeRef}
      type="button"
      title={entry.hint}
      aria-label={`Add ${entry.label}. ${entry.hint}`}
      onClick={() => onAdd(entry.type)}
      className={cn(
        'border-line text-ink flex min-h-[44px] w-full items-center gap-2 rounded-md border bg-white px-2.5 py-2 text-left text-sm',
        'hover:border-brand-purple/50 hover:bg-bg-subtle focus-visible:shadow-focus transition-colors focus-visible:outline-none',
        draggable && 'cursor-grab touch-none',
        isDragging && 'opacity-50',
      )}
      {...pointer}
    >
      <Icon className="text-ink-muted h-4 w-4 shrink-0" aria-hidden />
      <span className="truncate">{entry.label}</span>
    </button>
  );
}
