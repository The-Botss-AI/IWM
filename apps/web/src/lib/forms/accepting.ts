import type { FormStatus } from '@botss/shared-types';

import { fromDateTimeLocal, toDateTimeLocal } from './datetime';

/** Response limit text -> number, null when empty; `invalid` when not a whole number of 1 or more. */
export function parseResponseLimit(text: string): { value: number | null; invalid: boolean } {
  if (text.trim() === '') return { value: null, invalid: false };
  const n = Number(text);
  const invalid = !Number.isInteger(n) || n < 1;
  return { value: invalid ? null : n, invalid };
}

interface AcceptingSaved {
  closesAt: Date | null;
  responseLimit: number | null;
}

/** What the accepting-responses form would save, and whether it differs from the saved form. */
export function acceptingDraft(
  closesAtText: string,
  limitText: string,
  saved: AcceptingSaved,
): { closesAt: Date | null; responseLimit: number | null; limitInvalid: boolean; dirty: boolean } {
  const limit = parseResponseLimit(limitText);
  const dirty =
    closesAtText !== toDateTimeLocal(saved.closesAt) ||
    (limit.invalid ? true : limit.value !== (saved.responseLimit ?? null));
  return {
    closesAt: fromDateTimeLocal(closesAtText),
    responseLimit: limit.value,
    limitInvalid: limit.invalid,
    dirty,
  };
}

/** Status shown to people: a live form past its close date or at its response limit is closed. */
export function effectiveFormStatus(
  form: {
    status: FormStatus;
    closesAt: Date | null;
    responseLimit: number | null;
    submissionCount: number | null;
  },
  now: Date = new Date(),
): FormStatus {
  if (form.status !== 'PUBLISHED') return form.status;
  if (form.closesAt && form.closesAt.getTime() <= now.getTime()) return 'CLOSED';
  if (
    form.responseLimit !== null &&
    form.submissionCount !== null &&
    form.submissionCount >= form.responseLimit
  )
    return 'CLOSED';
  return 'PUBLISHED';
}
