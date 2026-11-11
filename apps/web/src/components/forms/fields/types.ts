import type { FormFieldOf, FormInputType, FormRepeaterChild } from '@botss/shared-types';

import type { FormFillMode, FormUploader } from '@/hooks/use-form-fill';

/** What every field component gets besides its own field and value. */
export interface FieldContext {
  mode: FormFillMode;
  /** Prefix for element ids, unique per rendered form. */
  idPrefix: string;
  /** Sends a file answer to storage; returns the upload id to store as the value. */
  uploader: FormUploader;
  /** Wrap uploads with this so submit waits for them. */
  trackUpload: <T>(work: Promise<T>) => Promise<T>;
  /** Live values of calculated fields. */
  calculated: Record<string, number>;
  disabled: boolean;
}

/**
 * Props of one field component. The component renders only the control:
 * label, help text and the error line come from `FieldShell` (unless the
 * registry marks the field `ownLabel`). Values follow the shapes the
 * server validator accepts (`@botss/forms` validateAnswers).
 */
export interface FieldProps<T extends FormInputType = FormInputType> {
  field: FormFieldOf<T>;
  value: unknown;
  onChange: (value: unknown) => void;
  /** This field's own error. */
  error: string | undefined;
  /** Every error on the form; repeaters read `fieldId.index.childId` keys. */
  errors: Record<string, string>;
  ctx: FieldContext;
  /** id for the main control, matched by the shell's <label htmlFor>. */
  inputId: string;
  /**
   * ids of the help text and error line. Put it on the main control as
   * `aria-describedby` so screen readers read both when it is focused.
   */
  describedBy: string | undefined;
}

/** Field types a repeater row can hold, with their props. */
export type RepeaterChildProps = Omit<FieldProps, 'field'> & { field: FormRepeaterChild };
