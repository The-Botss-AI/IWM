import { answerToText } from '@botss/forms';
import {
  isFormInputType,
  type FormDefinition,
  type FormField,
  type FormLayoutType,
  type FormSubmission,
  type FormSubmissionListResponse,
  type FormVersion,
} from '@botss/shared-types';

export type InputField = Exclude<FormField, { type: FormLayoutType }>;

/** Questions that collect an answer (layout fields excluded), in form order. */
export function inputFields(definition: FormDefinition): InputField[] {
  return definition.fields.filter((f): f is InputField => isFormInputType(f.type));
}

/** Version rows for a page of submissions, newest first. */
export function newestVersion(versions: readonly FormVersion[]): FormVersion | undefined {
  return [...versions].sort((a, b) => b.version - a.version)[0];
}

export function versionOf(
  versions: readonly FormVersion[],
  submission: FormSubmission,
): FormVersion | undefined {
  return (
    versions.find((v) => v.id === submission.versionId) ??
    versions.find((v) => v.version === submission.version)
  );
}

/** Resolvers for ids stored in answers: uploads -> file names, CRM ids -> names. */
export function answerTextOptions(submission: FormSubmission, crmLabels: Record<string, string>) {
  const names = new Map(submission.uploads.map((u) => [u.id, u.fileName] as const));
  return {
    uploadName: (id: string) => names.get(id),
    crmName: (_entity: string, id: string) => crmLabels[id],
  };
}

export function fieldAnswerText(
  field: InputField,
  submission: FormSubmission,
  crmLabels: Record<string, string>,
): string {
  const value = submission.answers[field.id];
  if (value === undefined || value === null) return '';
  return answerToText(field, value, answerTextOptions(submission, crmLabels));
}

export const MAX_TABLE_QUESTIONS = 5;

export interface ResponseRow {
  id: string;
  submission: FormSubmission;
  submittedAt: Date;
  source: 'INTERNAL' | 'PUBLIC';
  by: string;
  cells: string[];
}

export interface ResponseTable {
  columns: Array<{ id: string; label: string }>;
  rows: ResponseRow[];
}

/** Table model: fixed columns plus the first questions of the newest version. */
export function buildResponseTable(data: FormSubmissionListResponse): ResponseTable {
  const latest = newestVersion(data.versions);
  const questions = latest ? inputFields(latest.definition).slice(0, MAX_TABLE_QUESTIONS) : [];
  return {
    columns: questions.map((q) => ({ id: q.id, label: q.label })),
    rows: data.items.map((s) => ({
      id: s.id,
      submission: s,
      submittedAt: s.createdAt,
      source: s.source,
      by: s.submittedBy ? s.submittedBy.name || s.submittedBy.email : 'Public link',
      cells: questions.map((q) => fieldAnswerText(q, s, data.crmLabels)),
    })),
  };
}

export interface MatrixLine {
  rowId: string;
  label: string;
  answers: { id: string; label: string }[];
}

/** A matrix answer as one line per answered row, in row order. */
export function matrixLines(
  field: Extract<InputField, { type: 'matrix' }>,
  value: unknown,
): MatrixLine[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const lines: MatrixLine[] = [];
  for (const row of field.rows) {
    const cell = record[row.id];
    if (cell === undefined || cell === null || cell === '') continue;
    const ids = (Array.isArray(cell) ? cell : [cell]).map(String);
    lines.push({
      rowId: row.id,
      label: row.label,
      answers: ids.map((id) => ({
        id,
        label: field.columns.find((c) => c.id === id)?.label ?? id,
      })),
    });
  }
  return lines;
}
