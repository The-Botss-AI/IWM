'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  FormField,
  FormFieldLogic,
  FormLogicCondition,
  FormLogicOperator,
} from '@botss/shared-types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  LOGIC_OPERATOR_LABELS,
  defaultCondition,
  defaultConditionValue,
  fieldDisplayName,
  operatorsFor,
  valueKindFor,
} from '@/lib/forms/builder-ops';
import { FORM_LIMITS } from '@botss/shared-types';

import { PropGroup, SelectProp } from './props-ui';

interface LogicEditorProps {
  field: FormField;
  /** Questions before this one that a rule may look at. */
  earlier: readonly FormField[];
  /** Index of each earlier field in the whole form, for the "Field 3" fallback label. */
  allFields: readonly FormField[];
  onEnable: () => void;
  onRemove: () => void;
  onPatch: (patch: Partial<Pick<FormFieldLogic, 'action' | 'match'>>) => void;
  onConditions: (fn: (list: FormLogicCondition[]) => FormLogicCondition[]) => void;
  onAddCondition: () => void;
}

/** "Show this question only if" / "Hide this question if" rules (a page break reads "step"). */
export function LogicEditor({
  field,
  earlier,
  allFields,
  onEnable,
  onRemove,
  onPatch,
  onConditions,
  onAddCondition,
}: LogicEditorProps) {
  const logic = field.logic;
  const isStep = field.type === 'page_break';
  const thing = isStep ? 'step' : 'question';

  if (!logic) {
    return (
      <PropGroup title="Logic">
        <p className="text-ink-muted text-xs">
          {earlier.length === 0
            ? `Add a question above this one to show or hide this ${thing} based on an answer.`
            : `Show or hide this ${thing} depending on earlier answers.`}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={onEnable}
          disabled={earlier.length === 0}
          aria-label="Add a logic rule"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add a rule
        </Button>
      </PropGroup>
    );
  }

  return (
    <PropGroup title="Logic">
      <SelectProp
        label="When"
        value={logic.action}
        options={[
          { value: 'show', label: `Show this ${thing} only if` },
          { value: 'hide', label: `Hide this ${thing} if` },
        ]}
        onChange={(action) => onPatch({ action })}
      />
      {logic.conditions.length > 1 ? (
        <SelectProp
          label="Match"
          value={logic.match}
          options={[
            { value: 'all', label: 'All of the rules' },
            { value: 'any', label: 'Any of the rules' },
          ]}
          onChange={(match) => onPatch({ match })}
        />
      ) : null}
      <ul className="space-y-2" role="list">
        {logic.conditions.map((c, i) => (
          <ConditionRow
            key={i}
            index={i}
            condition={c}
            earlier={earlier}
            allFields={allFields}
            onChange={(next) => onConditions((list) => list.map((x, j) => (j === i ? next : x)))}
            onRemove={() => onConditions((list) => list.filter((_, j) => j !== i))}
          />
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onAddCondition}
          disabled={
            logic.conditions.length >= FORM_LIMITS.maxLogicConditions || earlier.length === 0
          }
          aria-label="Add another rule"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add rule
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label={`Remove all logic from this ${thing}`}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove logic
        </Button>
      </div>
    </PropGroup>
  );
}

function ConditionRow({
  index,
  condition,
  earlier,
  allFields,
  onChange,
  onRemove,
}: {
  index: number;
  condition: FormLogicCondition;
  earlier: readonly FormField[];
  allFields: readonly FormField[];
  onChange: (next: FormLogicCondition) => void;
  onRemove: () => void;
}) {
  const target = earlier.find((f) => f.id === condition.fieldId);
  const operators = target ? operatorsFor(target) : [];
  const kind = target ? valueKindFor(target, condition.op) : 'none';
  const n = index + 1;

  const setField = (id: string) => {
    const next = earlier.find((f) => f.id === id);
    if (next) onChange(defaultCondition(next));
  };

  const setOp = (op: FormLogicOperator) => {
    if (!target) return;
    const keep = valueKindFor(target, op) === kind && kind !== 'none';
    const value = keep ? condition.value : defaultConditionValue(target, op);
    onChange(
      value === undefined
        ? { fieldId: condition.fieldId, op }
        : { fieldId: condition.fieldId, op, value },
    );
  };

  const setValue = (value: FormLogicCondition['value']) =>
    onChange(
      value === undefined
        ? { fieldId: condition.fieldId, op: condition.op }
        : { ...condition, value },
    );

  return (
    <li className="border-line bg-bg-subtle/40 space-y-1.5 rounded-md border p-2">
      <div className="flex items-center gap-1.5">
        <Select value={target ? condition.fieldId : ''} onValueChange={setField}>
          <SelectTrigger aria-label={`Rule ${n}: question`} className="h-9 min-w-0 flex-1">
            <SelectValue placeholder="Question is missing" />
          </SelectTrigger>
          <SelectContent>
            {earlier.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {fieldDisplayName(
                  f,
                  allFields.findIndex((x) => x.id === f.id),
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove rule ${n}`}
          className="text-ink-muted hover:text-state-error focus-visible:shadow-focus rounded p-1.5 hover:bg-white focus-visible:outline-none"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {target ? (
        <>
          <Select value={condition.op} onValueChange={(v) => setOp(v as FormLogicOperator)}>
            <SelectTrigger aria-label={`Rule ${n}: condition`} className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {operators.map((op) => (
                <SelectItem key={op} value={op}>
                  {LOGIC_OPERATOR_LABELS[op]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ValueInput
            target={target}
            kind={kind}
            condition={condition}
            label={`Rule ${n}: value`}
            onChange={setValue}
          />
        </>
      ) : (
        <p className="text-state-error text-xs">
          This rule points at a question that was removed or moved below. Pick another.
        </p>
      )}
    </li>
  );
}

function ValueInput({
  target,
  kind,
  condition,
  label,
  onChange,
}: {
  target: FormField;
  kind: ReturnType<typeof valueKindFor>;
  condition: FormLogicCondition;
  label: string;
  onChange: (value: FormLogicCondition['value']) => void;
}) {
  if (kind === 'none') return null;
  if (kind === 'option' && 'options' in target) {
    return (
      <Select
        value={typeof condition.value === 'string' ? condition.value : ''}
        onValueChange={onChange}
      >
        <SelectTrigger aria-label={label} className="h-9">
          <SelectValue placeholder="Choose an option" />
        </SelectTrigger>
        <SelectContent>
          {target.options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label || 'Untitled option'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (kind === 'boolean') {
    const yes =
      target.type === 'yes_no' && target.yesLabel
        ? target.yesLabel
        : target.type === 'consent'
          ? 'Ticked'
          : 'Yes';
    const no =
      target.type === 'yes_no' && target.noLabel
        ? target.noLabel
        : target.type === 'consent'
          ? 'Not ticked'
          : 'No';
    return (
      <Select
        value={condition.value === false ? 'no' : 'yes'}
        onValueChange={(v) => onChange(v === 'yes')}
      >
        <SelectTrigger aria-label={label} className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="yes">{yes}</SelectItem>
          <SelectItem value="no">{no}</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  if (kind === 'number') {
    return (
      <NumberValueInput
        label={label}
        value={typeof condition.value === 'number' ? condition.value : undefined}
        onChange={onChange}
      />
    );
  }
  const type =
    kind === 'date' ? 'date' : kind === 'time' ? 'time' : kind === 'month' ? 'month' : 'text';
  return (
    <Input
      type={type}
      aria-label={label}
      className="h-9"
      maxLength={300}
      value={typeof condition.value === 'string' ? condition.value : ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Number box that keeps what is typed ("" and "-" included) and only emits finite numbers. */
function NumberValueInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => {
    setText((cur) => {
      const parsed = cur.trim() === '' ? undefined : Number(cur);
      if (parsed === value) return cur;
      return value === undefined ? '' : String(value);
    });
  }, [value]);
  return (
    <Input
      type="number"
      aria-label={label}
      className="h-9"
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        if (raw.trim() === '') {
          onChange(undefined);
          return;
        }
        const n = Number(raw);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}
