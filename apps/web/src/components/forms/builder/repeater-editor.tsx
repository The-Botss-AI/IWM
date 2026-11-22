'use client';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useId } from 'react';
import {
  FORM_LIMITS,
  FORM_REPEATER_CHILD_TYPES,
  type FormFieldOf,
  type FormFieldType,
  type FormRepeaterChild,
} from '@botss/shared-types';

import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { addToList, reorderList, type ChildPatch, type FieldPatch } from '@/lib/forms/builder-ops';
import { CATALOG_BY_TYPE } from '@/lib/forms/field-catalog';

import { OptionsEditor } from './options-editor';
import { NumberProp, TextProp, ToggleProp } from './props-ui';

interface RepeaterEditorProps {
  field: FormFieldOf<'repeater'>;
  onPatch: (patch: FieldPatch) => void;
  onAddChild: (type: FormFieldType) => void;
  onUpdateChild: (childId: string, patch: ChildPatch) => void;
  onRemoveChild: (childId: string) => void;
  onMoveChild: (from: number, to: number) => void;
  onChildOptions: (
    childId: string,
    fn: (options: { id: string; label: string }[]) => { id: string; label: string }[],
  ) => void;
}

/** Repeating group: its questions plus how many rows people may add. */
export function RepeaterEditor({
  field,
  onPatch,
  onAddChild,
  onUpdateChild,
  onRemoveChild,
  onMoveChild,
  onChildOptions,
}: RepeaterEditorProps) {
  const addId = useId();
  return (
    <div className="space-y-3">
      <TextProp
        label="Add button label"
        value={field.addLabel}
        maxLength={60}
        placeholder="Add another"
        onChange={(addLabel) => onPatch({ addLabel })}
      />
      <div className="grid grid-cols-2 gap-2">
        <NumberProp
          label="Minimum rows"
          integer
          min={0}
          value={field.minItems}
          onChange={(minItems) => onPatch({ minItems })}
        />
        <NumberProp
          label="Maximum rows"
          integer
          min={1}
          max={FORM_LIMITS.maxRepeaterItems}
          value={field.maxItems}
          onChange={(maxItems) => onPatch({ maxItems: maxItems ?? 10 })}
        />
      </div>
      <div className="space-y-2">
        <span className="text-ink text-[13px] font-medium">Questions in each row</span>
        <ul className="space-y-2" role="list">
          {field.fields.map((child, i) => (
            <ChildCard
              key={child.id}
              child={child}
              index={i}
              count={field.fields.length}
              onUpdate={(patch) => onUpdateChild(child.id, patch)}
              onRemove={() => onRemoveChild(child.id)}
              onMove={(dir) => onMoveChild(i, i + dir)}
              onOptions={(fn) => onChildOptions(child.id, fn)}
            />
          ))}
        </ul>
        <label htmlFor={addId} className="sr-only">
          Add a question to each row
        </label>
        <Select
          value=""
          onValueChange={(v) => onAddChild(v as FormFieldType)}
          disabled={field.fields.length >= FORM_LIMITS.maxRepeaterFields}
        >
          <SelectTrigger id={addId}>
            <SelectValue placeholder="Add a question" />
          </SelectTrigger>
          <SelectContent>
            {FORM_REPEATER_CHILD_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {CATALOG_BY_TYPE.get(t)?.label ?? t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function ChildCard({
  child,
  index,
  count,
  onUpdate,
  onRemove,
  onMove,
  onOptions,
}: {
  child: FormRepeaterChild;
  index: number;
  count: number;
  onUpdate: (patch: ChildPatch) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onOptions: (
    fn: (options: { id: string; label: string }[]) => { id: string; label: string }[],
  ) => void;
}) {
  const Icon = CATALOG_BY_TYPE.get(child.type)?.icon;
  const n = index + 1;
  return (
    <li className="border-line bg-bg-subtle/40 space-y-2 rounded-md border p-2">
      <div className="flex items-center gap-1.5">
        <Badge tone="outline">
          {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
          {CATALOG_BY_TYPE.get(child.type)?.label ?? child.type}
        </Badge>
        <span className="flex-1" />
        <button
          type="button"
          aria-label={`Move question ${n} up`}
          disabled={index === 0}
          onClick={() => onMove(-1)}
          className="text-ink-muted focus-visible:shadow-focus rounded p-1 hover:bg-white focus-visible:outline-none disabled:opacity-40"
        >
          <ArrowUp className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={`Move question ${n} down`}
          disabled={index === count - 1}
          onClick={() => onMove(1)}
          className="text-ink-muted focus-visible:shadow-focus rounded p-1 hover:bg-white focus-visible:outline-none disabled:opacity-40"
        >
          <ArrowDown className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={`Remove question ${n}`}
          disabled={count <= 1}
          onClick={onRemove}
          className="text-ink-muted hover:text-state-error focus-visible:shadow-focus rounded p-1 hover:bg-white focus-visible:outline-none disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <TextProp
        label="Label"
        value={child.label}
        optional={false}
        maxLength={300}
        onChange={(label) => onUpdate({ label: label ?? '' })}
      />
      <ToggleProp
        label="Required"
        checked={child.required}
        onChange={(required) => onUpdate({ required })}
      />
      {child.type === 'number' || child.type === 'percentage' ? (
        <div className="grid grid-cols-2 gap-2">
          <NumberProp label="Minimum" value={child.min} onChange={(min) => onUpdate({ min })} />
          <NumberProp label="Maximum" value={child.max} onChange={(max) => onUpdate({ max })} />
        </div>
      ) : null}
      {child.type === 'star_rating' ? (
        <NumberProp
          label="Stars"
          integer
          min={3}
          max={10}
          value={child.max}
          onChange={(max) => onUpdate({ max: max ?? 5 })}
        />
      ) : null}
      {'options' in child ? (
        <OptionsEditor
          title="Options"
          noun="option"
          items={child.options}
          max={FORM_LIMITS.maxOptions}
          onAdd={() => onOptions((list) => addToList(list, 'options'))}
          onRename={(id, label) =>
            onOptions((list) => list.map((o) => (o.id === id ? { ...o, label } : o)))
          }
          onRemove={(id) => onOptions((list) => list.filter((o) => o.id !== id))}
          onReorder={(from, to) => onOptions((list) => reorderList(list, from, to))}
        />
      ) : null}
    </li>
  );
}
