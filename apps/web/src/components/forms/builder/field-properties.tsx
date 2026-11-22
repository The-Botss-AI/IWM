'use client';

import { AlertTriangle } from 'lucide-react';
import { isFormInputType, type FormDefinition, type FormField } from '@botss/shared-types';

import type { FormBuilderOps } from '@/hooks/use-form-builder';
import { earlierLogicFields } from '@/lib/forms/builder-ops';
import { CATALOG_BY_TYPE } from '@/lib/forms/field-catalog';

import { LogicEditor } from './logic-editor';
import { PropGroup, TextAreaProp, TextProp, ToggleProp } from './props-ui';
import { TypeSettings } from './type-settings';

/** Types where a placeholder (hint inside the empty control) makes sense. */
const PLACEHOLDER_TYPES = new Set<string>([
  'short_text',
  'long_text',
  'rich_text',
  'email',
  'phone',
  'number',
  'percentage',
  'currency',
  'url',
  'dropdown',
  'multi_select',
  'tags',
]);

interface FieldPropertiesProps {
  field: FormField;
  draft: FormDefinition;
  ops: FormBuilderOps;
  /** Problems for this field: live checks plus any publish errors. */
  problems: readonly string[];
}

/** Everything editable about the selected field. */
export function FieldProperties({ field, draft, ops, problems }: FieldPropertiesProps) {
  const entry = CATALOG_BY_TYPE.get(field.type);
  const Icon = entry?.icon;
  const isInput = isFormInputType(field.type);
  const patch = (p: Parameters<FormBuilderOps['updateField']>[1]) => ops.updateField(field.id, p);
  const labelName =
    field.type === 'heading'
      ? 'Heading text'
      : field.type === 'page_break'
        ? 'Step title'
        : field.type === 'hidden'
          ? 'Name'
          : 'Question';
  const showLabel =
    field.type !== 'divider' && field.type !== 'paragraph' && field.type !== 'media';

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2">
        {Icon ? <Icon className="text-ink-muted h-4 w-4" aria-hidden /> : null}
        <h2 className="text-ink text-sm font-semibold">{entry?.label ?? field.type}</h2>
      </header>

      {problems.length > 0 ? (
        <ul
          role="alert"
          className="bg-tint-error text-state-error space-y-1 rounded-md p-2.5 text-xs"
        >
          {problems.map((m, i) => (
            <li key={i} className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{m}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <PropGroup>
        {showLabel ? (
          <TextProp
            label={labelName}
            value={field.label}
            optional={false}
            maxLength={300}
            onChange={(label) => patch({ label: label ?? '' })}
          />
        ) : null}
        {field.type !== 'divider' && field.type !== 'page_break' ? (
          <TextAreaProp
            label="Help text"
            rows={2}
            value={field.helpText}
            maxLength={1000}
            onChange={(helpText) => patch({ helpText })}
          />
        ) : null}
        {PLACEHOLDER_TYPES.has(field.type) && 'placeholder' in field ? (
          <TextProp
            label="Placeholder"
            value={field.placeholder}
            maxLength={200}
            onChange={(placeholder) => patch({ placeholder })}
          />
        ) : null}
        {'required' in field ? (
          <ToggleProp
            label="Required"
            checked={field.required}
            onChange={(required) => patch({ required })}
          />
        ) : null}
        {isInput && 'errorMessage' in field ? (
          <TextProp
            label="Custom error message"
            value={field.errorMessage}
            maxLength={200}
            hint="Shown instead of the default message when the answer is missing or wrong."
            onChange={(errorMessage) => patch({ errorMessage })}
          />
        ) : null}
      </PropGroup>

      <TypeSettings field={field} allFields={draft.fields} ops={ops} />

      {field.type !== 'divider' ? (
        <LogicEditor
          field={field}
          earlier={earlierLogicFields(draft, field.id)}
          allFields={draft.fields}
          onEnable={() => ops.enableLogic(field.id)}
          onRemove={() => ops.setLogic(field.id, undefined)}
          onPatch={(p) => ops.patchLogic(field.id, p)}
          onConditions={(fn) => ops.updateConditions(field.id, fn)}
          onAddCondition={() => ops.addCondition(field.id)}
        />
      ) : null}
    </div>
  );
}
