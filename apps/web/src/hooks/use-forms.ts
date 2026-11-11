'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddFormAccessInput,
  CreateFormInput,
  FormDetail,
  ListFormsQuery,
  ListFormSubmissionsQuery,
  SubmitFormInput,
  UpdateFormInput,
} from '@botss/shared-types';

import { getApi } from '@/lib/api';
import { saveFile } from '@/lib/save-file';

/**
 * Data hooks for the workspace form builder (`/form-builder`). Fill-side
 * state (answers, pages, logic) lives in `use-form-fill.ts`.
 */

export const formKeys = {
  all: ['forms'] as const,
  list: (q: Partial<ListFormsQuery>) => ['forms', 'list', q] as const,
  detail: (id: string) => ['forms', 'detail', id] as const,
  access: (id: string) => ['forms', 'access', id] as const,
  fill: (id: string) => ['forms', 'fill', id] as const,
  publicFill: (token: string) => ['forms', 'public', token] as const,
  submissions: (id: string, q: Partial<ListFormSubmissionsQuery>) =>
    ['forms', 'submissions', id, q] as const,
};

export function useForms(q: Partial<ListFormsQuery>) {
  return useQuery({
    queryKey: formKeys.list(q),
    queryFn: () => getApi().forms.list(q),
    placeholderData: keepPreviousData,
  });
}

export function useForm(id: string | null) {
  return useQuery({
    queryKey: formKeys.detail(id ?? ''),
    queryFn: () => getApi().forms.get(id!),
    enabled: !!id,
    // The builder owns the draft while it is open; never let a refetch
    // overwrite fields the person is editing.
    refetchOnWindowFocus: false,
  });
}

function useDetailMutation<TVars>(
  fn: (vars: TVars) => Promise<FormDetail>,
  meta: { errorTitle: string; successMessage?: string },
) {
  const qc = useQueryClient();
  return useMutation({
    meta,
    mutationFn: fn,
    onSuccess: (form) => {
      qc.setQueryData(formKeys.detail(form.id), form);
      void qc.invalidateQueries({ queryKey: ['forms', 'list'] });
    },
  });
}

export function useCreateForm() {
  return useDetailMutation((input: CreateFormInput) => getApi().forms.create(input), {
    errorTitle: "Couldn't create the form",
  });
}

/** Autosave and settings. Silent on success; the builder shows "Saved". */
export function useUpdateForm(id: string) {
  return useDetailMutation((input: UpdateFormInput) => getApi().forms.update(id, input), {
    errorTitle: "Couldn't save the form",
  });
}

/** Publish problems arrive as an ApiError whose `fieldErrors` the builder shows inline. */
export function usePublishForm(id: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: () => getApi().forms.publish(id),
    onSuccess: (form) => {
      qc.setQueryData(formKeys.detail(form.id), form);
      void qc.invalidateQueries({ queryKey: ['forms', 'list'] });
      void qc.invalidateQueries({ queryKey: formKeys.fill(form.id) });
    },
  });
}

export function useSetFormOpen(id: string) {
  return useDetailMutation(
    (open: boolean) => (open ? getApi().forms.reopen(id) : getApi().forms.close(id)),
    { errorTitle: "Couldn't change whether the form is open" },
  );
}

export function useSetFormPublicLink(id: string) {
  return useDetailMutation((enabled: boolean) => getApi().forms.setPublicLink(id, enabled), {
    errorTitle: "Couldn't change the public link",
  });
}

export function useRotateFormLink(id: string) {
  return useDetailMutation(() => getApi().forms.rotatePublicLink(id), {
    errorTitle: "Couldn't make a new link",
    successMessage: 'New link created. The old link no longer works.',
  });
}

export function useDeleteForm() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't delete the form", successMessage: 'Form deleted' },
    mutationFn: (id: string) => getApi().forms.remove(id),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: formKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: ['forms', 'list'] });
    },
  });
}

// ─── Internal access ────────────────────────────────────────────────────────

export function useFormAccess(id: string, enabled = true) {
  return useQuery({
    queryKey: formKeys.access(id),
    queryFn: () => getApi().forms.listAccess(id),
    enabled,
  });
}

export function useAddFormAccess(id: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't share the form" },
    mutationFn: (input: AddFormAccessInput) => getApi().forms.addAccess(id, input),
    onSuccess: (rows) => qc.setQueryData(formKeys.access(id), rows),
  });
}

export function useRemoveFormAccess(id: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't remove the person" },
    mutationFn: (userId: string) => getApi().forms.removeAccess(id, userId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: formKeys.access(id) }),
  });
}

// ─── Filling ────────────────────────────────────────────────────────────────

export function useFillableForm(id: string) {
  return useQuery({
    queryKey: formKeys.fill(id),
    queryFn: () => getApi().forms.fillable(id),
    meta: { silentError: true },
  });
}

export function usePublicForm(token: string) {
  return useQuery({
    queryKey: formKeys.publicFill(token),
    queryFn: () => getApi().publicForms.get(token),
    retry: false,
    meta: { silentError: true },
  });
}

/** In-app submit. Errors are shown inline by the renderer (field errors). */
export function useSubmitForm(id: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silentError: true },
    mutationFn: (input: SubmitFormInput) => getApi().forms.submit(id, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['forms', 'submissions', id] }),
  });
}

export function useSubmitPublicForm(token: string) {
  return useMutation({
    meta: { silentError: true },
    mutationFn: (input: SubmitFormInput) => getApi().publicForms.submit(token, input),
  });
}

// ─── Responses ──────────────────────────────────────────────────────────────

export function useFormSubmissions(id: string, q: Partial<ListFormSubmissionsQuery>) {
  return useQuery({
    queryKey: formKeys.submissions(id, q),
    queryFn: () => getApi().forms.submissions(id, q),
    placeholderData: keepPreviousData,
  });
}

export function useDeleteSubmission(id: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorTitle: "Couldn't delete the response", successMessage: 'Response deleted' },
    mutationFn: (submissionId: string) => getApi().forms.removeSubmission(id, submissionId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['forms', 'submissions', id] });
      void qc.invalidateQueries({ queryKey: formKeys.detail(id) });
    },
  });
}

export function useExportFormCsv(id: string) {
  return useMutation({
    meta: { errorTitle: "Couldn't export the responses" },
    mutationFn: async (filters: Pick<ListFormSubmissionsQuery, 'source' | 'from' | 'to'>) => {
      const { blob, filename } = await getApi().forms.exportCsv(id, filters);
      await saveFile(blob, filename ?? 'responses.csv');
    },
  });
}

/** Short-lived link for one file answer, fetched when the person opens it. */
export function useSubmissionFileUrl(
  id: string,
  submissionId: string,
  uploadId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['forms', 'file', id, submissionId, uploadId],
    queryFn: () => getApi().forms.fileUrl(id, submissionId, uploadId),
    enabled,
    // The signed URL lives 5 minutes; refresh well before it expires.
    staleTime: 4 * 60 * 1000,
    gcTime: 4 * 60 * 1000,
  });
}

/** Saves one file answer to disk. Goes through `saveFile` so it also works in the desktop and mobile shells. */
export function useDownloadSubmissionFile() {
  return useMutation({
    meta: { errorTitle: "Couldn't download the file" },
    mutationFn: async (input: { url: string; fileName: string }) => {
      const blob = await getApi().files.fetchBytes(input.url);
      await saveFile(blob, input.fileName);
    },
  });
}
