import { z } from 'zod';
import {
  fillableFormSchema,
  formAccessEntrySchema,
  formDetailSchema,
  formListResponseSchema,
  formSubmissionListResponseSchema,
  formSubmissionSchema,
  formUploadTicketSchema,
  formUploadUrlSchema,
  submitFormResponseSchema,
  type AddFormAccessInput,
  type CreateFormInput,
  type CreateFormUploadInput,
  type ListFormsQuery,
  type ListFormSubmissionsQuery,
  type SubmitFormInput,
  type UpdateFormInput,
} from '@botss/shared-types';

import type { HttpClient } from '../client.js';

const okSchema = z.object({ ok: z.literal(true) });
const accessListSchema = z.array(formAccessEntrySchema);

export interface FormFileUpload {
  version: number;
  fieldId: string;
  /** A picked file, or a recorded / drawn Blob. */
  file: Blob;
  fileName: string;
  signal?: AbortSignal;
}

type ExportFilters = Pick<ListFormSubmissionsQuery, 'source' | 'from' | 'to'>;

/** Workspace form builder (`/form-builder`). Not the project Task Forms. */
export class FormsResource {
  constructor(private readonly http: HttpClient) {}

  list(query: Partial<ListFormsQuery> = {}) {
    return this.http.get('/form-builder', formListResponseSchema, query);
  }
  get(id: string) {
    return this.http.get(`/form-builder/${id}`, formDetailSchema);
  }
  create(input: CreateFormInput) {
    return this.http.post('/form-builder', formDetailSchema, input);
  }
  update(id: string, input: UpdateFormInput) {
    return this.http.patch(`/form-builder/${id}`, formDetailSchema, input);
  }
  remove(id: string) {
    return this.http.delete(`/form-builder/${id}`, okSchema);
  }
  publish(id: string) {
    return this.http.post(`/form-builder/${id}/publish`, formDetailSchema, {});
  }
  close(id: string) {
    return this.http.post(`/form-builder/${id}/close`, formDetailSchema, {});
  }
  reopen(id: string) {
    return this.http.post(`/form-builder/${id}/reopen`, formDetailSchema, {});
  }
  setPublicLink(id: string, enabled: boolean) {
    return this.http.post(`/form-builder/${id}/public-link`, formDetailSchema, { enabled });
  }
  rotatePublicLink(id: string) {
    return this.http.post(`/form-builder/${id}/public-link/rotate`, formDetailSchema, {});
  }

  // Internal access (selected members)
  listAccess(id: string) {
    return this.http.get(`/form-builder/${id}/access`, accessListSchema);
  }
  addAccess(id: string, input: AddFormAccessInput) {
    return this.http.post(`/form-builder/${id}/access`, accessListSchema, input);
  }
  removeAccess(id: string, userId: string) {
    return this.http.delete(`/form-builder/${id}/access/${userId}`, okSchema);
  }

  // Filling in the app
  fillable(id: string) {
    return this.http.get(`/form-builder/${id}/fill`, fillableFormSchema);
  }
  createUpload(id: string, input: CreateFormUploadInput) {
    return this.http.post(`/form-builder/${id}/uploads`, formUploadTicketSchema, input);
  }
  /** Ticket, then the bytes straight to storage. Returns the upload id for the answer. */
  async uploadFile(id: string, upload: FormFileUpload): Promise<string> {
    const ticket = await this.createUpload(id, {
      version: upload.version,
      fieldId: upload.fieldId,
      fileName: upload.fileName,
      mimeType: upload.file.type || 'application/octet-stream',
      sizeBytes: upload.file.size,
    });
    await this.http.putPresigned(ticket.uploadUrl, upload.file, {
      headers: ticket.headers,
      signal: upload.signal,
    });
    return ticket.uploadId;
  }
  submit(id: string, input: SubmitFormInput) {
    return this.http.post(`/form-builder/${id}/submit`, submitFormResponseSchema, input);
  }

  // Responses (owner and admins)
  submissions(id: string, query: Partial<ListFormSubmissionsQuery> = {}) {
    return this.http.get(
      `/form-builder/${id}/submissions`,
      formSubmissionListResponseSchema,
      query,
    );
  }
  submission(id: string, submissionId: string) {
    return this.http.get(`/form-builder/${id}/submissions/${submissionId}`, formSubmissionSchema);
  }
  removeSubmission(id: string, submissionId: string) {
    return this.http.delete(`/form-builder/${id}/submissions/${submissionId}`, okSchema);
  }
  fileUrl(id: string, submissionId: string, uploadId: string) {
    return this.http.get(
      `/form-builder/${id}/submissions/${submissionId}/files/${uploadId}`,
      formUploadUrlSchema,
    );
  }
  /** CSV bytes (the API is another origin, so the page saves the blob itself). */
  exportCsv(id: string, filters: ExportFilters = {}) {
    return this.http.getBlob(`/form-builder/${id}/submissions/export.csv`, {
      ...(filters.source ? { source: filters.source } : {}),
      ...(filters.from ? { from: filters.from.toISOString() } : {}),
      ...(filters.to ? { to: filters.to.toISOString() } : {}),
    });
  }
}

/** Anonymous filling through a public link (`/public/forms/:token`). */
export class PublicFormsResource {
  constructor(private readonly http: HttpClient) {}

  get(token: string) {
    return this.http.get(`/public/forms/${encodeURIComponent(token)}`, fillableFormSchema);
  }
  createUpload(token: string, input: CreateFormUploadInput) {
    return this.http.post(
      `/public/forms/${encodeURIComponent(token)}/uploads`,
      formUploadTicketSchema,
      input,
    );
  }
  async uploadFile(token: string, upload: FormFileUpload): Promise<string> {
    const ticket = await this.createUpload(token, {
      version: upload.version,
      fieldId: upload.fieldId,
      fileName: upload.fileName,
      mimeType: upload.file.type || 'application/octet-stream',
      sizeBytes: upload.file.size,
    });
    await this.http.putPresigned(ticket.uploadUrl, upload.file, {
      headers: ticket.headers,
      signal: upload.signal,
    });
    return ticket.uploadId;
  }
  submit(token: string, input: SubmitFormInput) {
    return this.http.post(
      `/public/forms/${encodeURIComponent(token)}/submit`,
      submitFormResponseSchema,
      input,
    );
  }
}
