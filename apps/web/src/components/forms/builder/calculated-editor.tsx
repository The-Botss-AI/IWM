'use client';

import { useId, useMemo, useRef } from 'react';
import type { FormField, FormFieldOf } from '@botss/shared-types';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  expressionProblem,
  expressionUnknownRefs,
  fieldDisplayName,
  type FieldPatch,
} from '@/lib/forms/builder-ops';

import { NumberProp, TextProp } from './props-ui';

/** Formula for a calculated field, with an insert menu of earlier numeric fields. */
export function CalculatedEditor({
  field,
  earlierNumeric,
  allFields,
  onPatch,
}: {
  field: FormFieldOf<'calculated'>;
  earlierNumeric: readonly FormField[];
  allFields: readonly FormField[];
  onPatch: (patch: FieldPatch) => void;
}) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const allowed = useMemo(() => new Set(earlierNumeric.map((f) => f.id)), [earlierNumeric]);
  const problem = expressionProblem(field.expression);
  const unknown = problem ? [] : expressionUnknownRefs(field.expression, allowed);

  const insert = (fieldId: string) => {
    const token = `{${fieldId}}`;
    const el = ref.current;
    const src = field.expression;
    const start = el?.selectionStart ?? src.length;
    const end = el?.selectionEnd ?? src.length;
    const next = src.slice(0, start) + token + src.slice(end);
    onPatch({ expression: next });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={id}>Formula</Label>
        <Textarea
          id={id}
          ref={ref}
          rows={3}
          maxLength={500}
          className="font-mono text-xs"
          value={field.expression}
          aria-invalid={problem ? true : undefined}
          onChange={(e) => onPatch({ expression: e.target.value })}
        />
        {problem ? (
          <p role="alert" className="text-state-error text-xs">
            {problem}
          </p>
        ) : unknown.length > 0 ? (
          <p role="alert" className="text-state-error text-xs">
            The formula uses fields that are missing, below this one or not numbers:{' '}
            {unknown.join(', ')}.
          </p>
        ) : (
          <p className="text-ink-muted text-xs">
            Use + - * / and brackets. Example: {'{price}'} * {'{qty}'} + 5
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label>Insert a field</Label>
        <Select value="" onValueChange={insert}>
          <SelectTrigger
            aria-label="Insert a field into the formula"
            disabled={earlierNumeric.length === 0}
          >
            <SelectValue
              placeholder={
                earlierNumeric.length === 0 ? 'No number fields above' : 'Choose a number field'
              }
            />
          </SelectTrigger>
          <SelectContent>
            {earlierNumeric.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {fieldDisplayName(
                  f,
                  allFields.findIndex((x) => x.id === f.id),
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <NumberProp
          label="Decimals"
          integer
          min={0}
          max={6}
          value={field.decimals}
          onChange={(decimals) => onPatch({ decimals: decimals ?? 2 })}
        />
        <TextProp
          label="Prefix"
          value={field.prefix}
          maxLength={10}
          onChange={(prefix) => onPatch({ prefix })}
        />
        <TextProp
          label="Suffix"
          value={field.suffix}
          maxLength={10}
          onChange={(suffix) => onPatch({ suffix })}
        />
      </div>
    </div>
  );
}
