'use client';

import { isSafePattern } from '@botss/forms';
import type { FormFieldOf, FormPatternPreset } from '@botss/shared-types';

import type { FieldPatch } from '@/lib/forms/builder-ops';

import { NumberProp, SelectProp, TextProp } from './props-ui';

type PatchFn = (patch: FieldPatch) => void;

export function LengthBounds({
  field,
  onPatch,
}: {
  field: FormFieldOf<'short_text'> | FormFieldOf<'long_text'>;
  onPatch: PatchFn;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <NumberProp
        label="Min length"
        integer
        min={0}
        value={field.minLength}
        onChange={(minLength) => onPatch({ minLength })}
      />
      <NumberProp
        label="Max length"
        integer
        min={1}
        value={field.maxLength}
        onChange={(maxLength) => onPatch({ maxLength })}
      />
    </div>
  );
}

const PRESET_OPTIONS: { value: FormPatternPreset | 'none'; label: string }[] = [
  { value: 'none', label: 'Any text' },
  { value: 'letters', label: 'Letters only' },
  { value: 'digits', label: 'Digits only' },
  { value: 'alphanumeric', label: 'Letters and digits' },
  { value: 'custom', label: 'Custom pattern (regex)' },
];

/** Answer format for short text: a preset or a custom regular expression. */
export function PatternEditor({
  field,
  onPatch,
}: {
  field: FormFieldOf<'short_text'>;
  onPatch: PatchFn;
}) {
  const pattern = field.pattern;
  const regex = pattern?.regex ?? '';
  const unsafe = pattern?.preset === 'custom' && (regex === '' || !isSafePattern(regex));

  return (
    <div className="space-y-3">
      <SelectProp
        label="Answer format"
        value={pattern?.preset ?? 'none'}
        options={PRESET_OPTIONS}
        onChange={(preset) => {
          if (preset === 'none') return onPatch({ pattern: undefined });
          const message = pattern?.message;
          onPatch({
            pattern: {
              preset,
              ...(preset === 'custom' ? { regex: regex || '^[A-Za-z]+$' } : {}),
              ...(message ? { message } : {}),
            },
          });
        }}
      />
      {pattern?.preset === 'custom' ? (
        <div className="space-y-1.5">
          <TextProp
            label="Regular expression"
            value={regex}
            maxLength={200}
            hint="Matched against the whole answer."
            optional={false}
            onChange={(next) => onPatch({ pattern: { ...pattern, regex: next ?? '' } })}
          />
          {unsafe ? (
            <p role="alert" className="text-state-error text-xs">
              {regex === ''
                ? 'Enter a pattern.'
                : 'This pattern is invalid or could be slow on some answers. Use a simpler one; the form cannot be published with it.'}
            </p>
          ) : null}
        </div>
      ) : null}
      {pattern ? (
        <TextProp
          label="Message when it does not match"
          value={pattern.message}
          maxLength={200}
          onChange={(message) => onPatch({ pattern: { ...pattern, message } })}
        />
      ) : null}
    </div>
  );
}

export function NumberBounds({
  field,
  onPatch,
  withDecimals = true,
}: {
  field: FormFieldOf<'number'> | FormFieldOf<'percentage'> | FormFieldOf<'currency'>;
  onPatch: PatchFn;
  withDecimals?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <NumberProp label="Minimum" value={field.min} onChange={(min) => onPatch({ min })} />
      <NumberProp label="Maximum" value={field.max} onChange={(max) => onPatch({ max })} />
      {withDecimals && 'decimals' in field ? (
        <NumberProp
          label="Decimal places"
          integer
          min={0}
          max={6}
          value={field.decimals}
          hint="0 to 6"
          onChange={(decimals) => onPatch({ decimals })}
        />
      ) : null}
    </div>
  );
}
