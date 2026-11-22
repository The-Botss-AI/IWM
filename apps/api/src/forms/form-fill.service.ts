import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Prisma } from '@botss/database';
import { validateAnswers, type CrmRef, type UploadRef, type ValidateMode } from '@botss/forms';
import {
  formDefinitionSchema,
  formSettingsSchema,
  type CreateFormUploadInput,
  type FillableForm,
  type FormDefinition,
  type FormUploadTicket,
  type SubmitFormInput,
  type SubmitFormResponse,
} from '@botss/shared-types';

import { clientVisibleWhere } from '../clients/client-visibility';
import type { SalesActor } from '../common/decorators/sales-actor.decorator';
import type { UserScope } from '../common/decorators/user-scope.decorator';
import { projectAccessWhere } from '../common/project-access';
import { EmailService } from '../email/email.service';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  CLOSED_MESSAGES,
  formOpenState,
  formUploadKey,
  formUploadPrefix,
  ipRateKey,
  uploadPolicy,
} from './form-rules';
import { notFound } from './forms.service';
import { TurnstileClient } from './turnstile.client';

/** The columns fill and submit need. */
export interface FillTarget {
  id: string;
  workspaceId: string;
  createdById: string;
  title: string;
  description: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  publishedVersion: number;
  closesAt: Date | null;
  responseLimit: number | null;
  settings: Prisma.JsonValue;
  workspace: { organizationId: string };
}

export interface FillContext {
  mode: ValidateMode;
  /** Null for public fills. */
  scope: UserScope | null;
  /** In-app fills: lead / client row access for CRM pickers. */
  sales: SalesActor | null;
  ip: string;
  userAgent: string | null;
}

/** Public submits faster than this (browser-measured) are asked to wait. */
const MIN_FILL_MS = 2500;
const LIMITS = {
  /** Per form, per IP (/64 for IPv6), per hour. Raised when Turnstile guards the form. */
  publicSubmit: 20,
  publicSubmitWithCaptcha: 200,
  /** Per form, per member, per hour. */
  internalSubmit: 60,
  /** Upload tickets per hour: per IP (public), per member (in app) and per form. */
  publicUploads: 30,
  internalUploads: 200,
  formUploads: 300,
  /** Unclaimed upload bytes a single form may hold at once. */
  pendingBytesPerForm: 2 * 1024 * 1024 * 1024,
};

function fieldErrors(errors: Record<string, string>): BadRequestException {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(errors)) out[k] = [v];
  return new BadRequestException({
    title: 'Check your answers',
    status: 400,
    detail: Object.values(errors)[0] ?? 'Some answers need attention.',
    code: 'form_answers_invalid',
    errors: out,
  });
}

function closed(reason: keyof typeof CLOSED_MESSAGES): ConflictException {
  return new ConflictException({
    title: 'This form is closed',
    status: 409,
    detail: CLOSED_MESSAGES[reason],
    code: 'form_closed',
  });
}

function tooMany(detail: string): HttpException {
  return new HttpException(
    { title: 'Too many attempts', status: 429, detail, code: 'form_rate_limited' },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/** Removes CRM pickers from what a public visitor sees (they never apply there). */
function publicView(def: FormDefinition): FormDefinition {
  return { fields: def.fields.filter((f) => f.type !== 'crm_picker') };
}

@Injectable()
export class FormFillService {
  private readonly logger = new Logger(FormFillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly turnstile: TurnstileClient,
  ) {}

  // ─── Lookup ───────────────────────────────────────────────────────────────

  /** A form reachable by its public link, or 404 (revoked, deleted or suspended tenant). */
  async findPublic(token: string): Promise<FillTarget> {
    const form = await this.prisma.client.form.findFirst({
      where: {
        publicToken: token,
        publicEnabled: true,
        // Relation filters are not covered by the soft-delete extension.
        workspace: {
          deletedAt: null,
          isActive: true,
          organization: { deletedAt: null, isActive: true },
        },
      },
      include: { workspace: { select: { organizationId: true } } },
    });
    if (!form || form.status === 'DRAFT' || form.publishedVersion < 1) throw notFound();
    return form;
  }

  /**
   * The CURRENT published version only. Once the owner republishes, answers
   * (and upload tickets) for older versions are refused, so a tightened file
   * rule or a removed question takes effect at once.
   */
  private async version(
    form: FillTarget,
    version: number,
  ): Promise<{ id: string; definition: FormDefinition }> {
    if (version !== form.publishedVersion) {
      throw new ConflictException({
        title: 'This form has changed',
        status: 409,
        detail: 'The form was updated. Reload the page; your answers are kept.',
        code: 'form_version_stale',
      });
    }
    const row = await this.prisma.client.formVersion.findUnique({
      where: { formId_version: { formId: form.id, version } },
      select: { id: true, definition: true },
    });
    if (!row) throw notFound();
    return { id: row.id, definition: formDefinitionSchema.parse(row.definition) };
  }

  private async openState(form: FillTarget) {
    const count = await this.prisma.client.formSubmission.count({ where: { formId: form.id } });
    return formOpenState(form, count, new Date());
  }

  async fillable(form: FillTarget, mode: ValidateMode): Promise<FillableForm> {
    const { definition } = await this.version(form, form.publishedVersion);
    const settings = formSettingsSchema.parse(form.settings);
    const state = await this.openState(form);
    return {
      title: form.title,
      description: form.description,
      version: form.publishedVersion,
      definition: mode === 'public' ? publicView(definition) : definition,
      submitLabel: settings.submitLabel ?? null,
      open: state.open,
    };
  }

  // ─── Rate limits ──────────────────────────────────────────────────────────

  /** Windowed counter. Fails open on a Redis problem; the express limiter is the outer bound. */
  private async limit(key: string, max: number, windowSec: number, detail: string): Promise<void> {
    let count = 0;
    try {
      const res = await this.redis.client.multi().incr(key).expire(key, windowSec, 'NX').exec();
      count = Number(res?.[0]?.[1] ?? 0);
    } catch (err) {
      this.logger.warn(`Form rate limit unavailable: ${(err as Error)?.name ?? 'unknown'}`);
      return;
    }
    if (count > max) throw tooMany(detail);
  }

  // ─── Uploads ──────────────────────────────────────────────────────────────

  async createUpload(
    form: FillTarget,
    input: CreateFormUploadInput,
    ctx: FillContext,
  ): Promise<FormUploadTicket> {
    const userId = ctx.scope?.userId ?? null;
    const later = 'Too many uploads. Try again in an hour.';
    await this.limit(
      userId ? `form:upload:u:${userId}` : `form:upload:ip:${ipRateKey(ctx.ip)}`,
      userId ? LIMITS.internalUploads : LIMITS.publicUploads,
      3600,
      later,
    );
    await this.limit(
      `form:upload:form:${form.id}`,
      LIMITS.formUploads,
      3600,
      'This form is receiving too many uploads right now. Try again later.',
    );
    const state = await this.openState(form);
    if (!state.open) throw closed(state.reason);

    const { definition } = await this.version(form, input.version);
    const field = definition.fields.find((f) => f.id === input.fieldId);
    const policy = field ? uploadPolicy(field, this.files.maxUploadBytes) : null;
    if (!field || !policy) {
      throw new BadRequestException({
        title: 'Not a file question',
        status: 400,
        detail: 'That question does not take files.',
        code: 'form_upload_bad_field',
      });
    }
    if (!policy.accepts(input.mimeType, input.fileName)) {
      throw new BadRequestException({
        title: 'File type not allowed',
        status: 400,
        detail: 'This question does not accept that type of file.',
        code: 'form_upload_bad_type',
        errors: { [field.id]: ['This question does not accept that type of file.'] },
      });
    }
    if (input.sizeBytes > policy.maxBytes) {
      throw new PayloadTooLargeException({
        title: 'File too large',
        status: 413,
        detail: `Files for this question must be ${Math.floor(policy.maxBytes / (1024 * 1024))} MB or smaller.`,
        code: 'form_upload_too_large',
      });
    }
    // Unclaimed files are swept after a day; until then they take real disk.
    const pending = await this.prisma.client.formUpload.aggregate({
      where: { formId: form.id, status: 'PENDING' },
      _sum: { sizeBytes: true },
    });
    if (Number(pending._sum.sizeBytes ?? 0n) + input.sizeBytes > LIMITS.pendingBytesPerForm) {
      throw tooMany('This form is receiving too many uploads right now. Try again later.');
    }

    const bucket = this.files.formsBucket;
    const objectKey = formUploadKey(
      form.workspaceId,
      form.id,
      this.files.safeObjectName(input.fileName),
    );
    const ticket = await this.files.presignObjectUpload({
      bucket,
      objectKey,
      filename: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    });
    const row = await this.prisma.client.formUpload.create({
      data: {
        workspaceId: form.workspaceId,
        formId: form.id,
        fieldId: field.id,
        uploadedById: userId,
        objectKey,
        fileName: input.fileName.slice(0, 200),
        mimeType: input.mimeType.slice(0, 120),
        sizeBytes: BigInt(input.sizeBytes),
      },
      select: { id: true },
    });
    return { uploadId: row.id, ...ticket };
  }

  /**
   * Every referenced upload must be this form's, for this question, still
   * PENDING, uploaded by the same person (null for public fills), present in
   * storage under the form's prefix and within the question's limits.
   */
  private async verifyUploads(
    form: FillTarget,
    definition: FormDefinition,
    refs: UploadRef[],
    userId: string | null,
  ): Promise<{
    ids: string[];
    sizes: Map<string, { sizeBytes: number; mimeType: string | null }>;
  }> {
    const ids = refs.flatMap((r) => r.uploadIds);
    const sizes = new Map<string, { sizeBytes: number; mimeType: string | null }>();
    if (ids.length === 0) return { ids, sizes };
    const rows = await this.prisma.client.formUpload.findMany({
      where: { id: { in: ids }, formId: form.id, status: 'PENDING', uploadedById: userId },
      select: { id: true, fieldId: true, objectKey: true, mimeType: true, fileName: true },
    });
    const errors: Record<string, string> = {};
    const prefix = formUploadPrefix(form.workspaceId, form.id);
    const bucket = this.files.formsBucket;
    for (const ref of refs) {
      const field = definition.fields.find((f) => f.id === ref.fieldId);
      const policy = field ? uploadPolicy(field, this.files.maxUploadBytes) : null;
      for (const id of ref.uploadIds) {
        const row = rows.find((r) => r.id === id);
        if (!row || row.fieldId !== ref.fieldId || !row.objectKey.startsWith(prefix) || !policy) {
          errors[ref.fieldId] = 'Upload the file again.';
          continue;
        }
        const head = await this.files.headObject(bucket, row.objectKey);
        if (!head) {
          errors[ref.fieldId] = 'The upload did not finish. Upload the file again.';
        } else if (
          head.sizeBytes > policy.maxBytes ||
          !policy.accepts(head.mimeType ?? row.mimeType, row.fileName)
        ) {
          errors[ref.fieldId] = 'This file is not allowed for this question.';
        } else {
          sizes.set(id, head);
        }
      }
    }
    if (Object.keys(errors).length > 0) throw fieldErrors(errors);
    return { ids, sizes };
  }

  /**
   * CRM picks must be records the person filling could pick themselves: staff
   * members of the form's workspace in its org, projects they can reach, and
   * leads / clients within their sales access.
   */
  private async verifyCrm(form: FillTarget, refs: CrmRef[], ctx: FillContext): Promise<void> {
    const errors: Record<string, string> = {};
    for (const ref of refs) {
      const ids = { in: ref.ids };
      let found = 0;
      switch (ref.entity) {
        case 'member':
          found = await this.prisma.client.workspaceMembership.count({
            where: {
              workspaceId: form.workspaceId,
              userId: ids,
              user: {
                accountType: 'STAFF',
                deletedAt: null,
                organizationId: form.workspace.organizationId,
              },
            },
          });
          break;
        case 'client':
          found = ctx.sales
            ? await this.prisma.client.client.count({
                where: {
                  AND: [{ id: ids, workspaceId: form.workspaceId }, clientVisibleWhere(ctx.sales)],
                },
              })
            : 0;
          break;
        case 'lead':
          found = ctx.sales
            ? await this.prisma.client.lead.count({
                where: {
                  id: ids,
                  workspaceId: form.workspaceId,
                  ...(ctx.sales.fullLeads ? {} : { assigneeId: ctx.sales.userId }),
                },
              })
            : 0;
          break;
        case 'project':
          found = ctx.scope
            ? await this.prisma.client.project.count({
                where: {
                  AND: [{ id: ids, workspaceId: form.workspaceId }, projectAccessWhere(ctx.scope)],
                },
              })
            : 0;
          break;
      }
      if (found !== ref.ids.length) errors[ref.fieldId] = 'Pick again from the list.';
    }
    if (Object.keys(errors).length > 0) throw fieldErrors(errors);
  }

  // ─── Submit ───────────────────────────────────────────────────────────────

  async submit(
    form: FillTarget,
    input: SubmitFormInput,
    ctx: FillContext,
  ): Promise<SubmitFormResponse> {
    const settings = formSettingsSchema.parse(form.settings);
    const success: SubmitFormResponse = {
      ok: true,
      confirmationMessage: settings.confirmationMessage ?? null,
      redirectUrl: settings.redirectUrl ?? null,
    };
    const userId = ctx.scope?.userId ?? null;

    if (ctx.mode === 'public') {
      await this.limit(
        `form:submit:${form.id}:${ipRateKey(ctx.ip)}`,
        this.turnstile.enabled ? LIMITS.publicSubmitWithCaptcha : LIMITS.publicSubmit,
        3600,
        'Too many responses from this connection. Try again in an hour.',
      );
      // A filled honeypot gets a normal-looking success and nothing is
      // stored: a bot learns nothing. People never see that input.
      if (input.website?.trim()) return success;
      if (input.fillMs === undefined) {
        throw new BadRequestException({
          title: 'Reload the form',
          status: 400,
          detail: 'Reload the page and fill the form again.',
          code: 'form_reload',
        });
      }
      if (input.fillMs < MIN_FILL_MS) {
        throw new BadRequestException({
          title: 'Not so fast',
          status: 400,
          detail: 'Take a moment to check your answers, then submit again.',
          code: 'form_too_fast',
        });
      }
    } else if (userId) {
      await this.limit(
        `form:submit:u:${userId}:${form.id}`,
        LIMITS.internalSubmit,
        3600,
        'You sent this form many times in the last hour. Try again later.',
      );
    }

    const state = await this.openState(form);
    if (!state.open) throw closed(state.reason);

    const version = await this.version(form, input.version);
    const result = validateAnswers(version.definition, input.answers, { mode: ctx.mode });
    if (!result.ok) throw fieldErrors(result.errors);
    const uploads = await this.verifyUploads(form, version.definition, result.uploads, userId);
    if (ctx.mode === 'internal') await this.verifyCrm(form, result.crm, ctx);

    // Turnstile tokens are single use: spend one only once everything cheap passed.
    if (ctx.mode === 'public' && !(await this.turnstile.verify(input.turnstileToken, ctx.ip))) {
      throw new BadRequestException({
        title: 'Verification failed',
        status: 400,
        detail: 'We could not confirm you are a person. Complete the check and submit again.',
        code: 'form_captcha_failed',
      });
    }

    const submission = await this.prisma.client.$transaction(async (tx) => {
      // Serialise submits per form so the response limit cannot be overshot.
      await tx.$queryRaw`SELECT "id" FROM "Form" WHERE "id" = ${form.id} FOR UPDATE`;
      if (form.responseLimit !== null) {
        const count = await tx.formSubmission.count({ where: { formId: form.id } });
        if (count >= form.responseLimit) throw closed('limit_reached');
      }
      const created = await tx.formSubmission.create({
        data: {
          workspaceId: form.workspaceId,
          formId: form.id,
          versionId: version.id,
          submittedById: userId,
          source: ctx.mode === 'public' ? 'PUBLIC' : 'INTERNAL',
          answers: result.answers as unknown as Prisma.InputJsonValue,
          ip: ctx.ip.slice(0, 64),
          userAgent: ctx.userAgent?.slice(0, 500) ?? null,
        },
        select: { id: true, createdAt: true },
      });
      for (const id of uploads.ids) {
        const head = uploads.sizes.get(id);
        const claimed = await tx.formUpload.updateMany({
          where: { id, status: 'PENDING' },
          data: {
            status: 'ATTACHED',
            submissionId: created.id,
            ...(head ? { sizeBytes: BigInt(head.sizeBytes) } : {}),
          },
        });
        if (claimed.count !== 1)
          throw fieldErrors({ form: 'A file was already used. Upload it again.' });
      }
      return created;
    });

    if (settings.notifyOnSubmit && userId !== form.createdById) {
      void this.notifyOwner(form, userId).catch((err: unknown) => {
        this.logger.warn(`Form submit notification failed: ${(err as Error)?.name ?? 'unknown'}`);
      });
    }
    this.logger.log(
      `Form response stored form=${form.id} submission=${submission.id} source=${ctx.mode}`,
    );
    return success;
  }

  /**
   * Tells the owner a response arrived: a bell row and a short email with a
   * link. Only while the owner is still a staff member of the form's
   * workspace, the same rule that lets them read responses. The email never
   * carries answers: for tenants without their own mail server it is sent
   * through the platform mailbox, which must not hold tenant data.
   */
  private async notifyOwner(form: FillTarget, submitterId: string | null): Promise<void> {
    const [membership, submitter] = await Promise.all([
      this.prisma.client.workspaceMembership.findFirst({
        where: {
          workspaceId: form.workspaceId,
          userId: form.createdById,
          user: {
            deletedAt: null,
            accountType: 'STAFF',
            organizationId: form.workspace.organizationId,
          },
        },
        select: { user: { select: { id: true, email: true } } },
      }),
      submitterId
        ? this.prisma.client.user.findFirst({ where: { id: submitterId }, select: { name: true } })
        : Promise.resolve(null),
    ]);
    if (!membership) return;
    const owner = membership.user;
    const who = submitter?.name ?? 'Someone using the public link';
    const url = `/form-builder/${form.id}?tab=responses`;
    await this.notifications.emit({
      userId: owner.id,
      actorId: submitterId,
      type: 'FORM_SUBMITTED',
      title: `New response to ${form.title}`,
      body: who,
      entityType: 'form',
      entityId: form.id,
      url,
    });
    const base = (process.env.PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
    await this.email.sendFormSubmission(form.workspace.organizationId, {
      to: owner.email,
      formTitle: form.title,
      submittedBy: who,
      url: `${base}${url}`,
    });
  }
}
