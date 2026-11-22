'use client';

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { FieldProps } from './types';

function Row({
  id,
  label,
  index,
  last,
  disabled,
  onMove,
}: {
  id: string;
  label: string;
  index: number;
  last: boolean;
  disabled: boolean;
  onMove: (from: number, to: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'border-line flex items-center gap-2 rounded-lg border bg-white px-2 py-2 text-sm',
        isDragging && 'relative z-10 shadow-md',
      )}
    >
      <button
        type="button"
        aria-label={`Drag ${label}`}
        disabled={disabled}
        className="text-ink-muted flex h-11 w-11 cursor-grab touch-none items-center justify-center rounded sm:h-8 sm:w-8"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="text-ink-muted w-5 text-xs">{index + 1}</span>
      <span className="text-ink min-w-0 flex-1">{label}</span>
      <button
        type="button"
        aria-label={`Move ${label} up`}
        disabled={disabled || index === 0}
        onClick={() => onMove(index, index - 1)}
        className="text-ink-muted hover:bg-bg-subtle flex h-11 w-11 items-center justify-center rounded disabled:opacity-30 sm:h-8 sm:w-8"
      >
        <ArrowUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label={`Move ${label} down`}
        disabled={disabled || last}
        onClick={() => onMove(index, index + 1)}
        className="text-ink-muted hover:bg-bg-subtle flex h-11 w-11 items-center justify-center rounded disabled:opacity-30 sm:h-8 sm:w-8"
      >
        <ArrowDown className="h-4 w-4" />
      </button>
    </li>
  );
}

/**
 * Sortable list. The value stays undefined until the person moves something
 * or presses "Keep this order", so an untouched ranking is not an answer.
 */
export function RankingField({
  field,
  value,
  onChange,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'ranking'>) {
  const known = field.options.map((o) => o.id);
  const stored = Array.isArray(value) ? (value as string[]).filter((id) => known.includes(id)) : [];
  const answered = stored.length === known.length;
  // Local order only matters until the answer is committed.
  const [draft, setDraft] = useState<string[]>(known);
  const order = answered ? stored : draft;
  const labels = new Map(field.options.map((o) => [o.id, o.label]));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length) return;
    const next = arrayMove(order, from, to);
    setDraft(next);
    onChange(next);
  }

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    move(order.indexOf(String(e.active.id)), order.indexOf(String(e.over.id)));
  }

  return (
    <div
      id={inputId}
      role="group"
      aria-label={field.label}
      aria-describedby={describedBy}
      className="space-y-2"
    >
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2">
            {order.map((id, i) => (
              <Row
                key={id}
                id={id}
                label={labels.get(id) ?? id}
                index={i}
                last={i === order.length - 1}
                disabled={ctx.disabled}
                onMove={move}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      {answered ? null : (
        <div className="flex items-center gap-3">
          <p className="text-ink-muted text-xs">Drag to order</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={ctx.disabled}
            onClick={() => onChange(order)}
          >
            Keep this order
          </Button>
        </div>
      )}
    </div>
  );
}
