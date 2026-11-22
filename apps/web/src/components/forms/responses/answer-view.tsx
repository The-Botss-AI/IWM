'use client';

import { answerToText } from '@botss/forms';
import { Download } from 'lucide-react';
import {
  isFormUploadType,
  type FormSubmission,
  type FormSubmissionUpload,
} from '@botss/shared-types';

import { Loader } from '@/components/ui/loader';
import { useDownloadSubmissionFile, useSubmissionFileUrl } from '@/hooks/use-forms';
import { answerTextOptions, matrixLines, type InputField } from '@/lib/forms/responses';

interface Ctx {
  formId: string;
  submission: FormSubmission;
  crmLabels: Record<string, string>;
}

const EMPTY = <span className="text-ink-disabled">No answer</span>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

type RepeaterChild = Extract<InputField, { type: 'repeater' }>['fields'][number];

/** One answer, rendered for reading: files inline, repeaters and matrices as lists. */
export function AnswerView({
  field,
  value,
  ctx,
}: {
  field: InputField | RepeaterChild;
  value: unknown;
  ctx: Ctx;
}) {
  if (value === undefined || value === null || value === '') return EMPTY;

  if (isFormUploadType(field.type)) {
    const ids = (Array.isArray(value) ? value : [value]).map(String);
    return (
      <div className="space-y-2">
        {ids.map((id) => {
          const upload = ctx.submission.uploads.find((u) => u.id === id);
          return upload ? (
            <FileAnswer key={id} fieldType={field.type} upload={upload} ctx={ctx} />
          ) : (
            <span key={id} className="text-ink-muted">
              File no longer available
            </span>
          );
        })}
      </div>
    );
  }

  if (field.type === 'repeater' && Array.isArray(value)) {
    if (value.length === 0) return EMPTY;
    return (
      <ol className="space-y-2">
        {value.map((item, i) => {
          const row = isRecord(item) ? item : {};
          return (
            <li key={i} className="border-line space-y-1.5 rounded-md border p-2.5">
              <p className="text-ink-muted text-xs font-medium">Item {i + 1}</p>
              {field.fields.map((child) => (
                <div key={child.id}>
                  <p className="text-ink-muted text-xs">{child.label}</p>
                  <div className="text-ink text-sm">
                    <AnswerView field={child} value={row[child.id]} ctx={ctx} />
                  </div>
                </div>
              ))}
            </li>
          );
        })}
      </ol>
    );
  }

  if (field.type === 'matrix') {
    const lines = matrixLines(field, value);
    if (lines.length === 0) return EMPTY;
    return (
      <ul className="space-y-0.5">
        {lines.map((line) => (
          <li key={line.rowId}>
            {line.label}: {line.answers.map((a) => a.label).join(', ')}
          </li>
        ))}
      </ul>
    );
  }

  const text =
    field.type === 'repeater'
      ? ''
      : answerToText(field, value, answerTextOptions(ctx.submission, ctx.crmLabels));
  if (!text) return EMPTY;
  return <span className="whitespace-pre-wrap break-words">{text}</span>;
}

function FileAnswer({
  fieldType,
  upload,
  ctx,
}: {
  fieldType: string;
  upload: FormSubmissionUpload;
  ctx: Ctx;
}) {
  const link = useSubmissionFileUrl(ctx.formId, ctx.submission.id, upload.id, true);
  const url = link.data?.url;
  const download = useDownloadSubmissionFile();
  const mime = upload.mimeType;
  const isImage =
    fieldType === 'signature' || fieldType === 'image_upload' || mime.startsWith('image/');
  const isAudio = fieldType === 'audio_recording' || mime.startsWith('audio/');
  const isVideo = fieldType === 'video_recording' || mime.startsWith('video/');

  if (link.isLoading) return <Loader size="sm" />;
  if (!url) return <span className="text-ink-muted">{upload.fileName} (preview unavailable)</span>;

  if (isImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed storage URL, not optimisable
      <img
        src={url}
        alt={upload.fileName}
        className="border-line max-h-64 max-w-full rounded-md border bg-white object-contain"
      />
    );
  }
  if (isAudio) return <audio controls src={url} className="w-full" />;
  if (isVideo) return <video controls src={url} className="max-h-64 w-full rounded-md bg-black" />;
  return (
    <button
      type="button"
      disabled={download.isPending}
      onClick={() => download.mutate({ url, fileName: upload.fileName })}
      className="text-brand-700 focus-visible:shadow-focus inline-flex items-center gap-1.5 text-left hover:underline focus-visible:outline-none disabled:opacity-60"
    >
      {download.isPending ? <Loader size="xs" /> : <Download className="h-3.5 w-3.5" aria-hidden />}{' '}
      {upload.fileName}
    </button>
  );
}
