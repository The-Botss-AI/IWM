'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Copy,
  GitBranch,
  GripVertical,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { isFormInputType, type FormDefinition, type FormField } from '@botss/shared-types';

import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CANVAS_END_ID, countLogicReferences } from '@/lib/forms/builder-ops';
import { CATALOG_BY_TYPE } from '@/lib/forms/field-catalog';
import { cn } from '@/lib/utils';

import { FieldPreview } from './field-preview';

interface FieldCanvasProps {
  draft: FormDefinition;
  selectedId: string | null;
  problems: ReadonlyMap<string, string[]>;
  onSelect: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onNudge: (id: string, direction: -1 | 1) => void;
  /** Opens the properties sheet; only shown on phones. */
  onEdit: (id: string) => void;
}

/** Sortable list of field cards. Drag from the palette or from a card's handle. */
export function FieldCanvas({
  draft,
  selectedId,
  problems,
  onSelect,
  onDuplicate,
  onRemove,
  onNudge,
  onEdit,
}: FieldCanvasProps) {
  const { setNodeRef, isOver } = useDroppable({ id: CANVAS_END_ID });
  const count = draft.fields.length;
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const confirmUses = confirmId ? countLogicReferences(draft, confirmId) : 0;
  const requestRemove = (id: string) => {
    if (countLogicReferences(draft, id) > 0) setConfirmId(id);
    else onRemove(id);
  };
  return (
    <SortableContext items={draft.fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
      <ul className="space-y-2" role="list" aria-label="Form fields">
        {draft.fields.map((field, i) => (
          <FieldCard
            key={field.id}
            field={field}
            index={i}
            isFirst={i === 0}
            isLast={i === count - 1}
            selected={field.id === selectedId}
            problems={problems.get(field.id) ?? []}
            onSelect={onSelect}
            onDuplicate={onDuplicate}
            onRemove={requestRemove}
            onNudge={onNudge}
            onEdit={onEdit}
          />
        ))}
      </ul>
      <div
        ref={setNodeRef}
        className={cn(
          'border-line text-ink-muted mt-3 rounded-lg border border-dashed p-6 text-center text-sm transition-colors',
          isOver && 'border-brand-purple bg-brand-purple/5',
        )}
      >
        {count === 0
          ? 'Click a field type on the left, or drag one here.'
          : 'Drop here to add at the end.'}
      </div>
      <ConfirmDialog
        open={confirmId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmId(null);
        }}
        title="Delete this question?"
        description={`${confirmUses} ${confirmUses === 1 ? 'rule uses' : 'rules use'} this question. Those conditions will be removed too.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (confirmId) onRemove(confirmId);
          setConfirmId(null);
        }}
      />
    </SortableContext>
  );
}

function FieldCard({
  field,
  index,
  isFirst,
  isLast,
  selected,
  problems,
  onSelect,
  onDuplicate,
  onRemove,
  onNudge,
  onEdit,
}: {
  field: FormField;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  selected: boolean;
  problems: string[];
  onSelect: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onNudge: (id: string, direction: -1 | 1) => void;
  onEdit: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
  });
  const entry = CATALOG_BY_TYPE.get(field.type);
  const Icon = entry?.icon;
  const name = field.label.trim() || entry?.label || field.type;
  const n = index + 1;
  const required = 'required' in field && field.required;
  const showLabelLine =
    field.type !== 'heading' && field.type !== 'divider' && field.type !== 'paragraph';

  const iconButton =
    'inline-flex h-11 w-11 items-center justify-center rounded text-ink-muted sm:h-8 sm:w-8 hover:bg-bg-subtle hover:text-ink focus-visible:outline-none focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-40';

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className={cn(
        'shadow-soft rounded-lg border bg-white p-2',
        selected ? 'border-brand-purple ring-brand-purple/20 ring-2' : 'border-line',
        problems.length > 0 && !selected && 'border-state-error/50',
      )}
    >
      <div className="flex flex-wrap items-start gap-1.5 sm:flex-nowrap">
        <button
          type="button"
          className={cn(iconButton, 'mt-0.5 cursor-grab touch-none')}
          aria-label={`Drag ${name} to reorder. With the keyboard press space, then the arrow keys.`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>
        {/* Mouse convenience only: the Select button inside is the keyboard and screen reader path. */}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div
          onClick={() => onSelect(field.id)}
          className="min-w-0 flex-1 basis-0 cursor-pointer space-y-2 rounded-md p-1"
        >
          <button
            type="button"
            aria-pressed={selected}
            aria-label={`Select ${name}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(field.id);
            }}
            className="focus-visible:shadow-focus flex min-h-[44px] w-full flex-wrap items-center gap-1.5 rounded-md text-left focus-visible:outline-none sm:min-h-0"
          >
            {showLabelLine ? (
              <span className="text-ink min-w-0 truncate text-sm font-medium">
                {field.label.trim() || <span className="text-ink-muted">Untitled question</span>}
                {required ? (
                  <span className="text-state-error ml-0.5" aria-label="required">
                    *
                  </span>
                ) : null}
              </span>
            ) : null}
            <Badge tone="outline">
              {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
              {entry?.label ?? field.type}
            </Badge>
            {field.logic ? (
              <Badge tone="info">
                <GitBranch className="h-3 w-3" aria-hidden /> Logic
              </Badge>
            ) : null}
            {problems.length > 0 ? (
              <Badge tone="danger">
                <AlertTriangle className="h-3 w-3" aria-hidden /> {problems.length}{' '}
                {problems.length === 1 ? 'issue' : 'issues'}
              </Badge>
            ) : null}
          </button>
          {field.helpText && isFormInputType(field.type) ? (
            <p className="text-ink-muted truncate text-xs">{field.helpText}</p>
          ) : null}
          <div>
            <FieldPreview field={field} />
          </div>
        </div>
        <div className="flex w-full shrink-0 items-center justify-end sm:w-auto">
          <button
            type="button"
            className={cn(iconButton, 'lg:hidden')}
            aria-label={`Edit properties of ${name}`}
            onClick={() => onEdit(field.id)}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            className={iconButton}
            aria-label={`Move ${name} up (position ${n})`}
            disabled={isFirst}
            onClick={() => onNudge(field.id, -1)}
          >
            <ArrowUp className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            className={iconButton}
            aria-label={`Move ${name} down (position ${n})`}
            disabled={isLast}
            onClick={() => onNudge(field.id, 1)}
          >
            <ArrowDown className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            className={iconButton}
            aria-label={`Duplicate ${name}`}
            onClick={() => onDuplicate(field.id)}
          >
            <Copy className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            className={cn(iconButton, 'hover:text-state-error')}
            aria-label={`Delete ${name}`}
            onClick={() => onRemove(field.id)}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
      {problems.length > 0 ? (
        <ul className="text-state-error mt-1.5 space-y-0.5 pl-9 text-xs" role="list">
          {problems.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
