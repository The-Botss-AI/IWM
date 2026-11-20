'use client';

import { useMemo, useState } from 'react';
import { formSettingsSchema, type FormDetail, type UpdateFormInput } from '@botss/shared-types';

import { useUpdateForm } from '@/hooks/use-forms';

/** Local edit state for the form settings tab, validated with the shared schema. */
export function useFormSettingsDraft(form: FormDetail) {
  const update = useUpdateForm(form.id);
  const [title, setTitle] = useState(form.title);
  const [description, setDescription] = useState(form.description ?? '');
  const [confirmationMessage, setConfirmationMessage] = useState(
    form.settings.confirmationMessage ?? '',
  );
  const [redirectUrl, setRedirectUrl] = useState(form.settings.redirectUrl ?? '');
  const [submitLabel, setSubmitLabel] = useState(form.settings.submitLabel ?? '');
  const [notifyOnSubmit, setNotifyOnSubmit] = useState(form.settings.notifyOnSubmit);

  const settings = useMemo(() => {
    const candidate = {
      notifyOnSubmit,
      ...(confirmationMessage.trim() ? { confirmationMessage: confirmationMessage.trim() } : {}),
      ...(redirectUrl.trim() ? { redirectUrl: redirectUrl.trim() } : {}),
      ...(submitLabel.trim() ? { submitLabel: submitLabel.trim() } : {}),
    };
    return formSettingsSchema.safeParse(candidate);
  }, [notifyOnSubmit, confirmationMessage, redirectUrl, submitLabel]);

  const redirectError =
    redirectUrl.trim() &&
    !settings.success &&
    settings.error.issues.some((i) => i.path[0] === 'redirectUrl')
      ? 'Enter a full address starting with http:// or https://'
      : null;
  const valid = settings.success && title.trim().length > 0;

  const save = () => {
    if (!settings.success || !title.trim()) return;
    const input: UpdateFormInput = {
      title: title.trim(),
      description: description.trim() ? description.trim() : null,
      settings: settings.data,
    };
    update.mutate(input);
  };

  return {
    title,
    setTitle,
    description,
    setDescription,
    confirmationMessage,
    setConfirmationMessage,
    redirectUrl,
    setRedirectUrl,
    submitLabel,
    setSubmitLabel,
    notifyOnSubmit,
    setNotifyOnSubmit,
    redirectError,
    valid,
    save,
    saving: update.isPending,
  };
}
