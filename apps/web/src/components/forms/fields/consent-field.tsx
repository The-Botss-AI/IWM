'use client';

import { Checkbox } from '@/components/ui/checkbox';

import type { FieldProps } from './types';

/** Renders its own label: a checkbox, the statement, an optional link and the required mark. */
export function ConsentField({
  field,
  value,
  onChange,
  error,
  ctx,
  inputId,
  describedBy,
}: FieldProps<'consent'>) {
  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id={inputId}
        className="mt-0.5 h-5 w-5"
        checked={value === true}
        disabled={ctx.disabled}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        aria-required={field.required || undefined}
        onCheckedChange={(c) => onChange(c === true ? true : undefined)}
      />
      <label htmlFor={inputId} className="text-ink cursor-pointer text-sm">
        {field.text}
        {field.linkUrl ? (
          <>
            {' '}
            <a
              href={field.linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-purple underline"
              onClick={(e) => e.stopPropagation()}
            >
              {field.linkLabel ?? 'Read more'}
            </a>
          </>
        ) : null}
        {field.required ? (
          <span className="text-state-error ml-0.5" aria-hidden>
            *
          </span>
        ) : null}
      </label>
    </div>
  );
}
