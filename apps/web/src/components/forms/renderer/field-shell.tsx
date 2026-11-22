import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Label, required mark, help text and error line around one field control.
 * `as="fieldset"` for groups of inputs (radios, checkboxes, matrix) so the
 * label becomes a legend and screen readers announce the question.
 */
export function FieldShell({
  inputId,
  label,
  required,
  helpText,
  error,
  as = 'div',
  hideLabel = false,
  children,
}: {
  inputId: string;
  label: string;
  required: boolean;
  helpText?: string | undefined;
  error?: string | undefined;
  as?: 'div' | 'fieldset';
  hideLabel?: boolean;
  children: ReactNode;
}) {
  const helpId = helpText ? `${inputId}-help` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const Title = as === 'fieldset' ? 'legend' : 'label';
  const Wrapper = as;
  return (
    // Each control carries `aria-describedby` itself (FieldProps.describedBy);
    // on a wrapper div it would be ignored by assistive tech.
    <Wrapper className="min-w-0 space-y-2">
      {!hideLabel && label ? (
        <Title
          {...(Title === 'label' ? { htmlFor: inputId } : {})}
          className={cn('text-ink block text-sm font-medium', as === 'fieldset' && 'mb-2')}
        >
          {label}
          {required ? (
            <span className="text-state-error ml-0.5" aria-hidden="true">
              *
            </span>
          ) : null}
          {required ? <span className="sr-only"> (required)</span> : null}
        </Title>
      ) : null}
      {helpText ? (
        <p id={helpId} className="text-ink-muted whitespace-pre-line text-xs">
          {helpText}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={errorId} role="alert" className="text-state-error text-xs font-medium">
          {error}
        </p>
      ) : null}
    </Wrapper>
  );
}
