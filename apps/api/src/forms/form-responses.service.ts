import { Injectable, Optional } from '@nestjs/common';
import type { Prisma } from '@botss/database';
import { answerToText, csvCell } from '@botss/forms';
import {
  formAnswersSchema,
  formDefinitionSchema,
  isFormInputType,
  type FormDefinition,
  type FormField,
  type FormSubmission,
  type FormSubmissionListResponse,
  type FormUploadUrl,
  type FormVersion,
  type ListFormSubmissionsQuery,
} from '@botss/shared-types';

import { AuditLogService } from '../audit-log/audit-log.service';
import type { UserScope } from '../common/decorators/user-scope.decorator';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { SecurityAlertsService } from '../security-alerts/security-alerts.service';
import { FormsService, notFound } from './forms.service';

/** Per-row columns. Definitions are NOT joined per row: they are loaded once per version. */
const SUBMISSION_ROW = {
  submittedBy: { select: { id: true, name: true, email: true, image: true } },
  version: { select: { id: true, version: true, publishedAt: true } },
  uploads: {
    where: { status: 'ATTACHED' },
    select: { id: true, fieldId: true, fileName: true, mimeType: true, sizeBytes: true },
  },
} as const;

type SubmissionRow = Prisma.FormSubmissionGetPayload<{ include: typeof SUBMISSION_ROW }>;

const EXPORT_BATCH = 500;
/** Larger exports are cut here; the file name says so. Narrow the dates to export the rest. */
export const EXPORT_MAX_ROWS = 20000;

type Filters = Pick<ListFormSubmissionsQuery, 'source' | 'from' | 'to'>;

function toSubmission(row: SubmissionRow): FormSubmission {
  return {
    id: row.id,
    formId: row.formId,
    versionId: row.versionId,
    version: row.version.version,
    source: row.source,
    submittedBy: row.submittedBy,
    answers: formAnswersSchema.parse(row.answers),
    uploads: row.uploads.map((u) => ({ ...u, sizeBytes: u.sizeBytes.toString() })),
    createdAt: row.createdAt,
  };
}

/** Input questions only (no layout), in form order. */
function inputFields(def: FormDefinition): FormField[] {
  return def.fields.filter((f) => isFormInputType(f.type));
}

export interface CsvExport {
  filename: string;
  /** CSV text in pieces, header first; stream them to the response. */
  chunks: AsyncGenerator<string>;
}

@Injectable()
export class FormResponsesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly forms: FormsService,
    private readonly files: FilesService,
    private readonly audit: AuditLogService,
    @Optional() private readonly alerts?: SecurityAlertsService,
  ) {}

  private where(formId: string, q: Filters): Prisma.FormSubmissionWhereInput {
    return {
      formId,
      ...(q.source ? { source: q.source } : {}),
      ...(q.from || q.to
        ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
        : {}),
    };
  }

  /** Each version's definition, parsed once. */
  private async definitions(
    formId: string,
    versionIds?: string[],
  ): Promise<Map<string, FormVersion>> {
    const rows = await this.prisma.client.formVersion.findMany({
      where: { formId, ...(versionIds ? { id: { in: versionIds } } : {}) },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, definition: true, publishedAt: true },
    });
    return new Map(
      rows.map((v) => [
        v.id,
        {
          id: v.id,
          version: v.version,
          definition: formDefinitionSchema.parse(v.definition),
          publishedAt: v.publishedAt,
        },
      ]),
    );
  }

  /** Names for CRM picker answers, resolved inside the form's workspace and org only. */
  private async crmLabels(
    workspaceId: string,
    organizationId: string,
    rows: SubmissionRow[],
    versions: Map<string, FormVersion>,
  ): Promise<Record<string, string>> {
    const want: Record<'member' | 'client' | 'project' | 'lead', Set<string>> = {
      member: new Set(),
      client: new Set(),
      project: new Set(),
      lead: new Set(),
    };
    for (const row of rows) {
      const def = versions.get(row.versionId)?.definition;
      if (!def) continue;
      const answers = row.answers as Record<string, unknown>;
      for (const f of def.fields) {
        if (f.type !== 'crm_picker' || !Object.hasOwn(answers, f.id)) continue;
        const v = answers[f.id];
        for (const id of Array.isArray(v) ? v : v ? [v] : [])
          if (typeof id === 'string') want[f.entity].add(id);
      }
    }
    const out: Record<string, string> = {};
    const [members, clients, projects, leads] = await Promise.all([
      want.member.size
        ? this.prisma.client.workspaceMembership.findMany({
            where: { workspaceId, userId: { in: [...want.member] }, user: { organizationId } },
            select: { user: { select: { id: true, name: true } } },
          })
        : [],
      want.client.size
        ? this.prisma.client.client.findMany({
            where: { workspaceId, id: { in: [...want.client] } },
            select: { id: true, name: true },
          })
        : [],
      want.project.size
        ? this.prisma.client.project.findMany({
            where: { workspaceId, id: { in: [...want.project] } },
            select: { id: true, name: true },
          })
        : [],
      want.lead.size
        ? this.prisma.client.lead.findMany({
            where: { workspaceId, id: { in: [...want.lead] } },
            select: { id: true, name: true },
          })
        : [],
    ]);
    for (const m of members) out[m.user.id] = m.user.name;
    for (const r of [...clients, ...projects, ...leads]) out[r.id] = r.name;
    return out;
  }

  async list(
    scope: UserScope,
    workspaceId: string,
    formId: string,
    q: ListFormSubmissionsQuery,
  ): Promise<FormSubmissionListResponse> {
    const form = await this.forms.loadManaged(scope, workspaceId, formId);
    const where = this.where(formId, q);
    const [rows, total] = await Promise.all([
      this.prisma.client.formSubmission.findMany({
        where,
        include: SUBMISSION_ROW,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.client.formSubmission.count({ where }),
    ]);
    const versions = await this.definitions(formId, [...new Set(rows.map((r) => r.versionId))]);
    return {
      items: rows.map(toSubmission),
      pagination: {
        page: q.page,
        pageSize: q.pageSize,
        total,
        totalPages: Math.ceil(total / q.pageSize) || 1,
      },
      versions: [...versions.values()],
      crmLabels: await this.crmLabels(workspaceId, form.workspace.organizationId, rows, versions),
    };
  }

  async get(
    scope: UserScope,
    workspaceId: string,
    formId: string,
    submissionId: string,
  ): Promise<FormSubmission> {
    await this.forms.loadManaged(scope, workspaceId, formId);
    const row = await this.prisma.client.formSubmission.findFirst({
      where: { id: submissionId, formId },
      include: SUBMISSION_ROW,
    });
    if (!row) throw notFound();
    return toSubmission(row);
  }

  async remove(
    scope: UserScope,
    workspaceId: string,
    formId: string,
    submissionId: string,
  ): Promise<{ ok: true }> {
    const form = await this.forms.loadManaged(scope, workspaceId, formId);
    const row = await this.prisma.client.formSubmission.findFirst({
      where: { id: submissionId, formId },
      select: { id: true },
    });
    if (!row) throw notFound();
    await this.prisma.client.formSubmission.delete({ where: { id: submissionId } });
    void this.audit.emit({
      organizationId: form.workspace.organizationId,
      actorUserId: scope.userId,
      action: 'form.response_deleted',
      target: `form:${formId}`,
      metadata: { submissionId },
    });
    return { ok: true };
  }

  /** Short-lived link to one file answer. */
  async fileUrl(
    scope: UserScope,
    workspaceId: string,
    formId: string,
    submissionId: string,
    uploadId: string,
  ): Promise<FormUploadUrl> {
    await this.forms.loadManaged(scope, workspaceId, formId);
    const upload = await this.prisma.client.formUpload.findFirst({
      where: {
        id: uploadId,
        formId,
        submissionId,
        status: 'ATTACHED',
        submission: { deletedAt: null },
      },
      select: { objectKey: true, fileName: true, mimeType: true },
    });
    if (!upload) throw notFound();
    return this.files.presignObjectDownload(
      this.files.formsBucket,
      upload.objectKey,
      upload.fileName,
      upload.mimeType,
    );
  }

  /**
   * CSV of the responses matching the filters, streamed in batches: one
   * column per question (newest version's order, then questions only older
   * versions had), cells made safe for spreadsheets. Access is checked and
   * the row count taken before the first byte, so errors still become
   * problems; the export is capped at EXPORT_MAX_ROWS and the file name says
   * when it was cut.
   */
  async exportCsv(
    scope: UserScope,
    workspaceId: string,
    formId: string,
    q: Filters,
  ): Promise<CsvExport> {
    const form = await this.forms.loadManaged(scope, workspaceId, formId);
    const where = this.where(formId, q);
    const total = await this.prisma.client.formSubmission.count({ where });
    const truncated = total > EXPORT_MAX_ROWS;
    const versions = await this.definitions(formId);

    const columns: FormField[] = [];
    const byVersion = new Map<string, Map<string, FormField>>();
    for (const v of versions.values()) {
      const fields = inputFields(v.definition);
      byVersion.set(v.id, new Map(fields.map((f) => [f.id, f])));
      for (const f of fields) if (!columns.some((c) => c.id === f.id)) columns.push(f);
    }

    const safeTitle =
      form.title
        .replace(/[^A-Za-z0-9 _-]+/g, '')
        .trim()
        .slice(0, 60) || 'form';
    const filename = truncated
      ? `${safeTitle} responses (first ${EXPORT_MAX_ROWS}).csv`
      : `${safeTitle} responses.csv`;

    const prisma = this.prisma;
    const crmLabels = this.crmLabels.bind(this);
    const audit = this.audit;
    const alerts = this.alerts;
    const organizationId = form.workspace.organizationId;

    async function* chunks(): AsyncGenerator<string> {
      // BOM so Excel opens UTF-8 (Urdu, Arabic, Turkish) correctly.
      const header = [
        'Submitted at (UTC)',
        'Source',
        'Submitted by',
        ...columns.map((c) => c.label || c.id),
      ];
      yield `﻿${header.map(csvCell).join(',')}\r\n`;
      let sent = 0;
      let cursor: string | undefined;
      while (sent < EXPORT_MAX_ROWS) {
        const batch = await prisma.client.formSubmission.findMany({
          where,
          include: SUBMISSION_ROW,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: Math.min(EXPORT_BATCH, EXPORT_MAX_ROWS - sent),
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (batch.length === 0) break;
        const labels = await crmLabels(workspaceId, organizationId, batch, versions);
        let text = '';
        for (const row of batch) {
          const answers = row.answers as Record<string, unknown>;
          const fieldsOfVersion = byVersion.get(row.versionId);
          const uploadNames = new Map(row.uploads.map((u) => [u.id, u.fileName]));
          const cells = [
            row.createdAt.toISOString(),
            row.source === 'PUBLIC' ? 'Public link' : 'In app',
            row.submittedBy ? `${row.submittedBy.name} <${row.submittedBy.email}>` : '',
            ...columns.map((c) =>
              Object.hasOwn(answers, c.id)
                ? answerToText(fieldsOfVersion?.get(c.id) ?? c, answers[c.id], {
                    uploadName: (id) => uploadNames.get(id),
                    crmName: (_entity, id) => labels[id],
                  })
                : '',
            ),
          ];
          text += `${cells.map(csvCell).join(',')}\r\n`;
        }
        sent += batch.length;
        yield text;
        if (batch.length < EXPORT_BATCH) break;
        cursor = batch[batch.length - 1]!.id;
      }
      void audit.emit({
        organizationId,
        actorUserId: scope.userId,
        action: 'form.responses_exported',
        target: `form:${formId}`,
        metadata: { rows: sent, truncated },
      });
      void alerts?.recordExport(scope.userId, sent);
    }

    return { filename, chunks: chunks() };
  }
}
