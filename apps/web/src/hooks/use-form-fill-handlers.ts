'use client';

import { useCallback } from 'react';

import { useSubmitForm, useSubmitPublicForm } from '@/hooks/use-forms';
import type { FormUploader } from '@/hooks/use-form-fill';
import { getApi } from '@/lib/api';

/** Submit and upload handlers for filling a form inside the app. */
export function useInternalFillHandlers(formId: string, version: number) {
  const submit = useSubmitForm(formId);
  const uploader = useCallback<FormUploader>(
    ({ fieldId, file, fileName }) =>
      getApi().forms.uploadFile(formId, { version, fieldId, file, fileName }),
    [formId, version],
  );
  return { submit: submit.mutateAsync, uploader };
}

/** Submit and upload handlers for filling a form through a public link. */
export function usePublicFillHandlers(token: string, version: number) {
  const submit = useSubmitPublicForm(token);
  const uploader = useCallback<FormUploader>(
    ({ fieldId, file, fileName }) =>
      getApi().publicForms.uploadFile(token, { version, fieldId, file, fileName }),
    [token, version],
  );
  return { submit: submit.mutateAsync, uploader };
}
