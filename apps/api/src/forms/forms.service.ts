import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@botss/database';
import { checkDefinition } from '@botss/forms';
import {
  formDefinitionSchema,
  formSettingsSchema,
  type AddFormAccessInput,
  type CreateFormInput,
  type FormAccessEntry,
  type FormDetail,
  type FormListResponse,
  type FormSummary,
  type ListFormsQuery,
  type UpdateFormInput,
} from '@botss/shared-types';

import { AuditLogService } from '../audit-log/audit-log.service';
import type { UserScope } from '../common/decorators/user-scope.decorator';
import { invalidReference } from '../common/tenant-scope';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { canFillForm, canManageForm, isWorkspaceMember, newPublicToken } from './form-rules';

const PERSON = { select: { id: true, name: true, email: true, image: true } } as const;

const FORM_ROW = {
  createdBy: PERSON,
  workspace: { select: { organizationId: true } },
} as const;

type FormRow = Prisma.FormGetPayload<{ include: typeof FORM_ROW }>;

export function notFound(): NotFoundException {
  return new NotFoundException({ title: 'Form not found', status: 404, code: 'form_not_found' });
}

/** Stable comparison of two stored definitions (parsed, so key order is the schema's). */
function sameDefinition(a: unknown, b: unknown): boolean {
  const pa = formDefinitionSchema.safeParse(a);
  const pb = formDefinitionSchema.safeParse(b);
  return pa.success && pb.success && JSON.stringify(pa.data) === JSON.stringify(pb.data);
}

@Injectable()
export class FormsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditLogService,
  ) {}

  // ─── Loading and access ───────────────────────────────────────────────────

  /** A live form in the caller's active workspace, or 404. */
  async loadForm(scope: UserScope, workspaceId: string, id: string): Promise<FormRow> {
    const form = await this.prisma.client.form.findFirst({
      where: { id, workspaceId },
      include: FORM_ROW,
    });
    if (!form || scope.currentWorkspaceId !== workspaceId) throw notFound();
    return form;
  }

  /** The form, if the caller may manage it; a 404 otherwise (never reveals it exists). */
  async loadManaged(scope: UserScope, workspaceId: string, id: string): Promise<FormRow> {
    const form = await this.loadForm(scope, workspaceId, id);
    if (!canManageForm(scope, form)) throw notFound();
    return form;
  }

  async hasAccessRow(formId: string, userId: string): Promise<boolean> {
    const row = await this.prisma.client.formAccess.findUnique({
      where: { formId_userId: { formId, userId } },
      select: { id: true },
    });
    return row !== null;
  }

  /** The form, if the caller may fill it in the app; a 404 otherwise. */
  async loadFillable(scope: UserScope, workspaceId: string, id: string): Promise<FormRow> {
    const form = await this.loadForm(scope, workspaceId, id);
    const access =
      form.internalAccess === 'SELECTED' ? await this.hasAccessRow(form.id, scope.userId) : false;
    if (!canFillForm(scope, form, access)) throw notFound();
    return form;
  }

  private async liveCount(formId: string): Promise<number> {
    return this.prisma.client.formSubmission.count({ where: { formId } });
  }

  private async toSummary(
    scope: UserScope,
    form: FormRow,
    extras?: { count?: number; hasAccess?: boolean },
  ): Promise<FormSummary> {
    const manage = canManageForm(scope, form);
    const hasAccess =
      extras?.hasAccess ??
      (form.internalAccess === 'SELECTED' ? await this.hasAccessRow(form.id, scope.userId) : false);
    return {
      id: form.id,
      workspaceId: form.workspaceId,
      title: form.title,
      description: form.description,
      status: form.status,
      publishedVersion: form.publishedVersion,
      internalAccess: form.internalAccess,
      publicEnabled: form.publicEnabled,
      closesAt: form.closesAt,
      responseLimit: form.responseLimit,
      createdBy: form.createdBy,
      createdAt: form.createdAt,
      updatedAt: form.updatedAt,
      canManage: manage,
      submissionCount: manage ? (extras?.count ?? (await this.liveCount(form.id))) : null,
      canFill: canFillForm(scope, form, hasAccess),
    };
  }

  private async toDetail(scope: UserScope, form: FormRow): Promise<FormDetail> {
    const latest =
      form.publishedVersion > 0
        ? await this.prisma.client.formVersion.findUnique({
            where: { formId_version: { formId: form.id, version: form.publishedVersion } },
            select: { definition: true },
          })
        : null;
    return {
      ...(await this.toSummary(scope, form)),
      draft: formDefinitionSchema.parse(form.draft),
      settings: formSettingsSchema.parse(form.settings),
      publicToken: form.publicToken,
      hasUnpublishedChanges: latest ? !sameDefinition(form.draft, latest.definition) : true,
    };
  }

  // ─── Queries ──────────────────────────────────────────────────────────────

  async list(scope: UserScope, workspaceId: string, q: ListFormsQuery): Promise<FormListResponse> {
    if (scope.currentWorkspaceId !== workspaceId) throw notFound();
    const member = isWorkspaceMember(scope, workspaceId);
    let where: Prisma.FormWhereInput;
    switch (q.scope) {
      case 'mine':
        where = { workspaceId, createdById: scope.userId };
        break;
      case 'shared':
        if (!member)
          return {
            items: [],
            pagination: { page: q.page, pageSize: q.pageSize, total: 0, totalPages: 1 },
          };
        where = {
          workspaceId,
          createdById: { not: scope.userId },
          status: { not: 'DRAFT' },
          publishedVersion: { gt: 0 },
          OR: [
            { internalAccess: 'WORKSPACE' },
            { internalAccess: 'SELECTED', access: { some: { userId: scope.userId } } },
          ],
        };
        break;
      case 'all':
        if (!scope.seesEveryProject) {
          throw new ForbiddenException({
            title: 'Admins only',
            status: 403,
            detail: 'Only workspace and organization admins can list every form.',
            code: 'forms_admin_only',
          });
        }
        where = { workspaceId };
        break;
    }
    if (q.q) where = { AND: [where, { title: { contains: q.q, mode: 'insensitive' } }] };

    const [rows, total] = await Promise.all([
      this.prisma.client.form.findMany({
        where,
        include: {
          ...FORM_ROW,
          access: { where: { userId: scope.userId }, select: { id: true } },
          _count: { select: { submissions: { where: { deletedAt: null } } } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.client.form.count({ where }),
    ]);
    const items = await Promise.all(
      rows.map((r) =>
        this.toSummary(scope, r, { count: r._count.submissions, hasAccess: r.access.length > 0 }),
      ),
    );
    return {
      items,
      pagination: {
        page: q.page,
        pageSize: q.pageSize,
        total,
        totalPages: Math.ceil(total / q.pageSize) || 1,
      },
    };
  }

  async get(scope: UserScope, workspaceId: string, id: string): Promise<FormDetail> {
    return this.toDetail(scope, await this.loadManaged(scope, workspaceId, id));
  }

  // ─── Mutations ────────────────────────────────────────────────────────────

  async create(scope: UserScope, workspaceId: string, input: CreateFormInput): Promise<FormDetail> {
    if (
      scope.currentWorkspaceId !== workspaceId ||
      (!isWorkspaceMember(scope, workspaceId) && !scope.seesEveryProject)
    ) {
      throw notFound();
    }
    const form = await this.prisma.client.form.create({
      data: {
        workspaceId,
        createdById: scope.userId,
        title: input.title,
        description: input.description ?? null,
        draft: { fields: [] },
        settings: formSettingsSchema.parse({}) as unknown as Prisma.InputJsonValue,
      },
      include: FORM_ROW,
    });
    return this.toDetail(scope, form);
  }

  async update(
    scope: UserScope,
    workspaceId: string,
    id: string,
    input: UpdateFormInput,
  ): Promise<FormDetail> {
    await this.loadManaged(scope, workspaceId, id);
    const data: Prisma.FormUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.draft !== undefined) data.draft = input.draft as unknown as Prisma.InputJsonValue;
    if (input.settings !== undefined)
      data.settings = input.settings as unknown as Prisma.InputJsonValue;
    if (input.internalAccess !== undefined) data.internalAccess = input.internalAccess;
    if (input.closesAt !== undefined) data.closesAt = input.closesAt;
    if (input.responseLimit !== undefined) data.responseLimit = input.responseLimit;
    const form = await this.prisma.client.form.update({ where: { id }, data, include: FORM_ROW });
    return this.toDetail(scope, form);
  }

  async remove(scope: UserScope, workspaceId: string, id: string): Promise<{ ok: true }> {
    const form = await this.loadManaged(scope, workspaceId, id);
    // Soft delete (Form is in SOFT_DELETE_MODELS): the public link stops at once.
    await this.prisma.client.form.delete({ where: { id } });
    void this.audit.emit({
      organizationId: form.workspace.organizationId,
      actorUserId: scope.userId,
      action: 'form.deleted',
      target: `form:${id}`,
      metadata: { title: form.title },
    });
    return { ok: true };
  }

  /** Snapshots the draft as the next version. 422 with `errors` when it is not ready. */
  async publish(scope: UserScope, workspaceId: string, id: string): Promise<FormDetail> {
    const form = await this.loadManaged(scope, workspaceId, id);
    const def = formDefinitionSchema.parse(form.draft);
    const issues = checkDefinition(def);
    if (issues.length > 0) {
      const errors: Record<string, string[]> = {};
      for (const issue of issues) (errors[issue.fieldId ?? 'form'] ??= []).push(issue.message);
      throw new UnprocessableEntityException({
        title: 'The form is not ready to publish',
        status: 422,
        detail: issues[0]!.message,
        code: 'form_not_ready',
        errors,
      });
    }
    const next = form.publishedVersion + 1;
    try {
      const updated = await this.prisma.client.$transaction(async (tx) => {
        await tx.formVersion.create({
          data: {
            formId: id,
            version: next,
            definition: def as unknown as Prisma.InputJsonValue,
            publishedById: scope.userId,
          },
        });
        // Optimistic guard: a concurrent publish moved the version on.
        const moved = await tx.form.updateMany({
          where: { id, publishedVersion: form.publishedVersion },
          data: {
            publishedVersion: next,
            ...(form.status === 'DRAFT' ? { status: 'PUBLISHED' } : {}),
          },
        });
        if (moved.count !== 1) {
          throw new ConflictException({
            title: 'Someone else just published this form',
            status: 409,
            detail: 'Reload the form to see the latest version.',
            code: 'form_publish_conflict',
          });
        }
        return tx.form.findUniqueOrThrow({ where: { id }, include: FORM_ROW });
      });
      void this.audit.emit({
        organizationId: form.workspace.organizationId,
        actorUserId: scope.userId,
        action: 'form.published',
        target: `form:${id}`,
        metadata: { version: next },
      });
      return this.toDetail(scope, updated);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          title: 'Someone else just published this form',
          status: 409,
          detail: 'Reload the form to see the latest version.',
          code: 'form_publish_conflict',
        });
      }
      throw e;
    }
  }

  async setOpen(
    scope: UserScope,
    workspaceId: string,
    id: string,
    open: boolean,
  ): Promise<FormDetail> {
    const form = await this.loadManaged(scope, workspaceId, id);
    if (open && form.publishedVersion < 1) {
      throw new BadRequestException({
        title: 'Publish the form first',
        status: 400,
        detail: 'A form has to be published before it can accept answers.',
        code: 'form_not_published',
      });
    }
    const updated = await this.prisma.client.form.update({
      where: { id },
      data: { status: open ? 'PUBLISHED' : 'CLOSED' },
      include: FORM_ROW,
    });
    return this.toDetail(scope, updated);
  }

  async setPublicLink(
    scope: UserScope,
    workspaceId: string,
    id: string,
    enabled: boolean,
  ): Promise<FormDetail> {
    const form = await this.loadManaged(scope, workspaceId, id);
    const updated = await this.prisma.client.form.update({
      where: { id },
      // Turning the link off keeps the token, so turning it back on restores
      // the same link. Rotate to invalidate a leaked one.
      data: {
        publicEnabled: enabled,
        ...(enabled && !form.publicToken ? { publicToken: newPublicToken() } : {}),
      },
      include: FORM_ROW,
    });
    if (enabled !== form.publicEnabled) {
      void this.audit.emit({
        organizationId: form.workspace.organizationId,
        actorUserId: scope.userId,
        action: enabled ? 'form.public_link_enabled' : 'form.public_link_disabled',
        target: `form:${id}`,
      });
    }
    return this.toDetail(scope, updated);
  }

  async rotatePublicLink(scope: UserScope, workspaceId: string, id: string): Promise<FormDetail> {
    const form = await this.loadManaged(scope, workspaceId, id);
    const updated = await this.prisma.client.form.update({
      where: { id },
      data: { publicToken: newPublicToken() },
      include: FORM_ROW,
    });
    void this.audit.emit({
      organizationId: form.workspace.organizationId,
      actorUserId: scope.userId,
      action: 'form.public_link_rotated',
      target: `form:${id}`,
    });
    return this.toDetail(scope, updated);
  }

  // ─── Internal access (selected members) ───────────────────────────────────

  async listAccess(scope: UserScope, workspaceId: string, id: string): Promise<FormAccessEntry[]> {
    await this.loadManaged(scope, workspaceId, id);
    const rows = await this.prisma.client.formAccess.findMany({
      where: { formId: id, user: { deletedAt: null } },
      include: { user: PERSON },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    return rows.map((r) => ({ user: r.user, createdAt: r.createdAt }));
  }

  async addAccess(
    scope: UserScope,
    workspaceId: string,
    id: string,
    input: AddFormAccessInput,
  ): Promise<FormAccessEntry[]> {
    const form = await this.loadManaged(scope, workspaceId, id);
    const userIds = [...new Set(input.userIds)];
    // Only staff members of this workspace, in the workspace's own org.
    const members = await this.prisma.client.workspaceMembership.findMany({
      where: {
        workspaceId,
        userId: { in: userIds },
        user: {
          accountType: 'STAFF',
          deletedAt: null,
          organizationId: form.workspace.organizationId,
        },
      },
      select: { userId: true },
    });
    if (members.length !== userIds.length)
      throw invalidReference('member', 'form_access_invalid_member');

    const existing = await this.prisma.client.formAccess.findMany({
      where: { formId: id, userId: { in: userIds } },
      select: { userId: true },
    });
    const added = userIds.filter((u) => !existing.some((e) => e.userId === u));
    if (added.length > 0) {
      await this.prisma.client.formAccess.createMany({
        data: added.map((userId) => ({ formId: id, userId, grantedById: scope.userId })),
        skipDuplicates: true,
      });
    }
    // Only point people at a form they can open right now.
    const fillable =
      form.internalAccess === 'SELECTED' && form.publishedVersion > 0 && form.status !== 'DRAFT';
    if (added.length > 0 && fillable) {
      void this.notifications
        .emitMany(
          added.filter((u) => u !== scope.userId),
          {
            actorId: scope.userId,
            type: 'FORM_SHARED',
            title: 'A form was shared with you',
            body: form.title,
            entityType: 'form',
            entityId: id,
            url: `/form-builder/${id}/fill`,
          },
        )
        .catch(() => {});
    }
    return this.listAccess(scope, workspaceId, id);
  }

  async removeAccess(
    scope: UserScope,
    workspaceId: string,
    id: string,
    userId: string,
  ): Promise<{ ok: true }> {
    await this.loadManaged(scope, workspaceId, id);
    await this.prisma.client.formAccess.deleteMany({ where: { formId: id, userId } });
    return { ok: true };
  }
}
