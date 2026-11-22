'use client';

import { CheckCircle2, History } from 'lucide-react';
import { useEffect, useId, useMemo, useRef } from 'react';
import type { FormDefinition, SubmitFormInput, SubmitFormResponse } from '@botss/shared-types';

import { Button } from '@/components/ui/button';
import { Loader } from '@/components/ui/loader';
import { useFormFill, type FormFillMode, type FormUploader } from '@/hooks/use-form-fill';

import { FIELD_COMPONENTS } from '../fields/registry';
import type { FieldContext } from '../fields/types';
import { FieldShell } from './field-shell';
import { LayoutBlock } from './layout-block';
import { TurnstileWidget } from './turnstile-widget';

export interface FormRendererProps {
  title: string;
  description: string | null;
  definition: FormDefinition;
  version: number;
  mode: FormFillMode;
  submitLabel?: string | null;
  /** Link query parameters for hidden fields. */
  params?: Record<string, string | undefined>;
  submit?: (input: SubmitFormInput) => Promise<SubmitFormResponse>;
  /** Required outside preview. */
  uploader?: FormUploader;
  /** Public forms only, when Turnstile is configured. */
  turnstileSiteKey?: string | null;
  /** Lets the person send another response after a successful submit. */
  allowAnother?: boolean;
  /** Saves progress in this browser under this key (see lib/forms/fill-draft.ts). */
  draftKey?: string | null;
}

/** Preview never touches storage: file answers get a local placeholder id. */
const previewUploader: FormUploader = async () =>
  `preview_${Math.random().toString(36).slice(2, 12)}`;

/**
 * Renders a form for filling: preview in the builder, in-app fill and the
 * public page all use this one component. State and rules live in
 * `useFormFill`; this only lays it out and moves focus.
 */
export function FormRenderer({
  title,
  description,
  definition,
  version,
  mode,
  submitLabel,
  params,
  submit,
  uploader,
  turnstileSiteKey,
  allowAnother = false,
  draftKey = null,
}: FormRendererProps) {
  const fill = useFormFill({
    definition,
    version,
    mode,
    draftKey: mode === 'preview' ? null : draftKey,
    ...(params ? { params } : {}),
    ...(submit ? { submit } : {}),
  });
  const idPrefix = useId().replace(/:/g, '');
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const needsTurnstile = mode === 'public' && !!turnstileSiteKey;

  const ctx: FieldContext = useMemo(
    () => ({
      mode,
      idPrefix,
      uploader: mode === 'preview' || !uploader ? previewUploader : uploader,
      trackUpload: fill.trackUpload,
      calculated: fill.calculated,
      disabled: fill.submitting,
    }),
    [mode, idPrefix, uploader, fill.trackUpload, fill.calculated, fill.submitting],
  );

  // A new step starts at its top, with focus on its heading (not mid-page on a phone).
  const firstPage = useRef(true);
  useEffect(() => {
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    formRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    headingRef.current?.focus({ preventScroll: true });
  }, [fill.pageIndex]);

  // After a failed check, take the person to the first problem.
  useEffect(() => {
    if (fill.errorFocusTick === 0) return;
    const firstKey = Object.keys(fill.errors)[0];
    const form = formRef.current;
    if (!firstKey || !form) return;
    const byId = document.getElementById(`${idPrefix}-${firstKey.replace(/\./g, '-')}`);
    const target = byId ?? form.querySelector<HTMLElement>('[aria-invalid="true"]');
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a new failed check asks for focus
  }, [fill.errorFocusTick]);

  if (fill.result) {
    return (
      <div className="border-line bg-bg-surface flex flex-col items-center gap-4 rounded-2xl border px-6 py-12 text-center">
        <CheckCircle2 className="text-state-success h-10 w-10" aria-hidden="true" />
        <div className="space-y-1">
          <h2 className="text-ink text-lg font-semibold">Thank you</h2>
          <p className="text-ink-muted whitespace-pre-line text-sm">
            {fill.result.confirmationMessage || 'Your answers were sent.'}
          </p>
        </div>
        {allowAnother || mode === 'preview' ? (
          <Button type="button" variant="outline" onClick={fill.reset}>
            {mode === 'preview' ? 'Start the preview again' : 'Send another response'}
          </Button>
        ) : null}
      </div>
    );
  }

  const busy = fill.submitting || fill.uploadsInFlight > 0;
  const waitingForCheck = fill.isLast && needsTurnstile && !fill.turnstileToken;

  return (
    <form
      ref={formRef}
      noValidate
      className="scroll-mt-4 space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (fill.isLast) void fill.submitAll();
        else fill.next();
      }}
    >
      {fill.restored ? (
        <div
          role="status"
          className="border-line bg-bg-subtle flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-2.5">
            <History className="text-ink-muted mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p className="text-ink">
              We restored the answers you started earlier.
              {fill.restored.droppedFiles
                ? ' Files you added earlier need to be attached again.'
                : ''}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="ghost" onClick={fill.dismissRestored}>
              Keep going
            </Button>
            <Button type="button" variant="outline" onClick={fill.reset}>
              Start over
            </Button>
          </div>
        </div>
      ) : null}

      {fill.isFirst ? (
        <header className="space-y-2">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-ink text-2xl font-semibold outline-none"
          >
            {title}
          </h1>
          {description ? (
            <p className="text-ink-muted whitespace-pre-line text-sm">{description}</p>
          ) : null}
        </header>
      ) : (
        <header className="space-y-1">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-ink text-lg font-semibold outline-none"
          >
            {fill.pageBreak?.label || title}
          </h2>
          {fill.pageBreak?.helpText ? (
            <p className="text-ink-muted text-sm">{fill.pageBreak.helpText}</p>
          ) : null}
        </header>
      )}

      {fill.pageCount > 1 ? (
        <div className="space-y-1.5" aria-live="polite">
          <p className="text-ink-muted text-xs">
            Step {fill.pageIndex + 1} of {fill.pageCount}
          </p>
          <div className="bg-bg-subtle h-1.5 overflow-hidden rounded-full">
            <div
              className="bg-brand-gradient h-full rounded-full transition-all duration-300"
              style={{ width: `${((fill.pageIndex + 1) / fill.pageCount) * 100}%` }}
            />
          </div>
        </div>
      ) : null}

      {/* Honeypot: invisible to people and to autofill, tempting to bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Leave this empty
          <input
            type="text"
            name="bx_hp_field"
            tabIndex={-1}
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            value={fill.honeypot}
            onChange={(e) => fill.setHoneypot(e.target.value)}
          />
        </label>
      </div>

      <div className="space-y-6">
        {fill.page.map((field) => {
          if (field.type === 'hidden') return null;
          if (!(field.type in FIELD_COMPONENTS))
            return <LayoutBlock key={field.id} field={field} />;
          const entry = FIELD_COMPONENTS[field.type as keyof typeof FIELD_COMPONENTS];
          const Component = entry.component;
          const inputId = `${idPrefix}-${field.id}`;
          const error = fill.errors[field.id];
          const required = 'required' in field ? field.required : false;
          const describedBy =
            [field.helpText ? `${inputId}-help` : null, error ? `${inputId}-error` : null]
              .filter(Boolean)
              .join(' ') || undefined;
          return (
            <FieldShell
              key={field.id}
              inputId={inputId}
              label={field.label}
              required={required}
              helpText={field.helpText}
              error={error}
              as={entry.group ? 'fieldset' : 'div'}
              hideLabel={entry.ownLabel === true}
            >
              <Component
                field={field}
                value={fill.answers[field.id]}
                onChange={(v: unknown) => fill.setAnswer(field.id, v)}
                error={error}
                errors={fill.errors}
                ctx={ctx}
                inputId={inputId}
                describedBy={describedBy}
              />
            </FieldShell>
          );
        })}
      </div>

      {fill.isLast && needsTurnstile ? (
        <TurnstileWidget
          key={fill.turnstileKey}
          siteKey={turnstileSiteKey!}
          onToken={fill.setTurnstileToken}
        />
      ) : null}

      {fill.formError ? (
        <p role="alert" className="bg-tint-error text-state-error rounded-lg px-3 py-2 text-sm">
          {fill.formError}
        </p>
      ) : null}

      <div className="border-line flex items-center justify-between gap-3 border-t pt-4">
        {!fill.isFirst ? (
          <Button type="button" variant="ghost" onClick={fill.back} disabled={busy}>
            Back
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-col items-end gap-1">
          <Button type="submit" variant="gradient" disabled={busy || waitingForCheck}>
            {busy ? (
              <Loader size="xs" label={fill.uploadsInFlight > 0 ? 'Uploading' : 'Sending'} />
            ) : null}
            {fill.uploadsInFlight > 0
              ? 'Uploading'
              : fill.isLast
                ? fill.submitting
                  ? 'Sending'
                  : submitLabel || (mode === 'preview' ? 'Submit (preview)' : 'Submit')
                : fill.nextLabel || 'Next'}
          </Button>
          {waitingForCheck ? (
            <p className="text-ink-muted text-xs">Checking you are a person</p>
          ) : null}
        </div>
      </div>
    </form>
  );
}
