import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Ip,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  addFormAccessSchema,
  createFormSchema,
  createFormUploadSchema,
  cuid,
  fillableFormSchema,
  formAccessEntrySchema,
  formAccessParamSchema,
  formDetailSchema,
  formListResponseSchema,
  formSubmissionListResponseSchema,
  formSubmissionParamSchema,
  formSubmissionSchema,
  formUploadParamSchema,
  formUploadTicketSchema,
  formUploadUrlSchema,
  listFormsQuerySchema,
  listFormSubmissionsQuerySchema,
  setFormPublicLinkSchema,
  submitFormResponseSchema,
  submitFormSchema,
  updateFormSchema,
  type AddFormAccessInput,
  type CreateFormInput,
  type CreateFormUploadInput,
  type ListFormsQuery,
  type ListFormSubmissionsQuery,
  type SetFormPublicLinkInput,
  type SubmitFormInput,
  type UpdateFormInput,
} from '@botss/shared-types';
import type { Response } from 'express';
import { z } from 'zod';

import { CurrentWorkspaceId } from '../common/decorators/current-workspace.decorator';
import { CurrentSalesActor, type SalesActor } from '../common/decorators/sales-actor.decorator';
import { RequireAbility } from '../common/decorators/required-ability.decorator';
import { RequestUserScope, type UserScope } from '../common/decorators/user-scope.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { FormFillService } from './form-fill.service';
import { FormResponsesService } from './form-responses.service';
import { FormsService } from './forms.service';

const okSchema = z.object({ ok: z.literal(true) });
const exportQuerySchema = listFormSubmissionsQuerySchema.pick({
  source: true,
  from: true,
  to: true,
});

/**
 * Workspace form builder. Every route needs the workspace header; the
 * services return 404 for forms the caller may not see or manage. Mounted
 * at `/form-builder` because `/forms/*` belongs to the project Task Forms.
 */
@Controller('form-builder')
export class FormsController {
  private readonly logger = new Logger(FormsController.name);

  constructor(
    private readonly forms: FormsService,
    private readonly fill: FormFillService,
    private readonly responses: FormResponsesService,
  ) {}

  @Get()
  @RequireAbility('read', 'Form')
  async list(
    @RequestUserScope() scope: UserScope,
    @CurrentWorkspaceId() workspaceId: string,
    @Query(new ZodValidationPipe(listFormsQuerySchema)) q: ListFormsQuery,
  ) {
    return formListResponseSchema.parse(await this.forms.list(scope, workspaceId, q));
  }

  @Post()
  @RequireAbility('create', 'Form')
  async create(
    @RequestUserScope() scope: UserScope,
    @CurrentWorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(createFormSchema)) input: CreateFormInput,
  ) {
    return formDetailSchema.parse(await this.forms.create(scope, workspaceId, input));
  }

  @Get(':id')
  @RequireAbility('read', 'Form')
  async get(
    @RequestUserScope() scope: UserScope,
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id', new ZodValidationPipe(cuid)) id: string,
  ) {
    return formDetailSchema.parse(await this.forms.get(scope, workspaceId, id));
  }

  @Patch(':id')
  @RequireAbility('update', 'Form')
  async update(
    @RequestUserScope() scope: UserScope,
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id', new ZodValidationPipe(cuid)) id: string,
    @Body(new ZodValidationPipe(updateFormSchema)) input: UpdateFormInput,
  ) {
    return formDetailSchema.parse(await this.forms.update(scope, workspaceId, id, input));
  }

  @Delete(':id')
  @RequireAbility('delete', 'Form')
  async remove(
    @RequestUserScope() scope: UserScope,
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id', new ZodValidationPipe(cuid)) id: string,
  ) {
    return okSchema.parse(await this.forms.remove(scope, workspaceId, id));
  }

  @Post(':id/publish')
  @RequireAbility('update', 'Form')
  async publish(
    @RequestUserScope() scope: UserScope,
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id', new ZodValidationPipe(cuid)) id: string,
  ) {
    return formDetailSchema.parse(await this.forms.publish(scope, workspaceId, id));
  }

  @Post(':id/close')
  @RequireAbility('update', 'Form')
  async close(
    @RequestUserScope() scope: UserScope,
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id', new ZodValidationPipe(cuid)) id: string,
  ) {
    return formDetailSchema.parse(await this.forms.setOpen(scope, workspaceId, id, false));
  }

  @Post(':id/reopen')
  @RequireAbility('update', 'Form')
  async reopen(
    @RequestUserScope() scope: UserScope,
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id', new ZodValidationPipe(cuid)) id: string,
  ) {
    return formDetailSchema.parse(await this.forms.setOpen(scope, workspaceId, id, true));
  }

  @Post(':id/public-link')
  @RequireAbility('update', 'Form')
  async setPublicLink(
    @RequestUserScope() scope: UserScope,
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id', new ZodValidationPipe(cuid)) id: string,
    @Body(new ZodValidationPipe(setFormPublicLinkSchema)) input: SetFormPublicLinkInput,
  ) {
    return formDetailSchema.parse(
      await this.forms.setPublicLink(scope, workspaceId, id, input.enabled),
    );
  }

  @Post(':id/public-link/rotate')
  @RequireAbility('update', 'Form')
  async rotatePublicLink(
    @RequestUserScope() scope: UserScope,
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id', new ZodValidationPipe(cuid)) id: string,
  ) {
    return formDetailSchema.parse(await this.forms.rotatePublicLink(scope, workspaceId, id));
  }

  // ─── Internal access ──────────────────────────────────────────────────────

  @Get(':id/access')
  @RequireAbility('read', 'Form')
  async listAccess(
    @RequestUserScope() scope: UserScope,
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id', new ZodValidationPipe(cuid)) id: string,
  ) {
    return z
      .array(formAccessEntrySchema)
      .parse(await this.forms.listAccess(scope, workspaceId, id));
  }

  @Post(':id/access')
  @RequireAbility('update', 'Form')
  async addAccess(
    @RequestUserScope() scope: UserScope,
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id', new ZodValidationPipe(cuid)) id: string,
    @Body(new ZodValidationPipe(addFormAccessSchema)) input: AddFormAccessInput,
  ) {
    return z
      .array(formAccessEntrySchema)
      .parse(await this.forms.addAccess(scope, workspaceId, id, input));
  }

  @Delete(':id/access/:userId')
  @RequireAbility('update', 'Form')
  async removeAccess(
    @RequestUserScope() scope: UserScope,
    @CurrentWorkspaceId() workspaceId: string,
    @Param(new ZodValidationPipe(formAccessParamSchema)) params: { id: string; userId: string },
  ) {
    return okSchema.parse(
      await this.forms.removeAccess(scope, workspaceId, params.id, params.userId),
    );
  }

  // ─── Filling in the app ───────────────────────────────────────────────────

  @Get(':id/fill')
  @RequireAbility('read', 'Form')
  async fillable(
    @RequestUserScope() scope: UserScope,
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id', new ZodValidationPipe(cuid)) id: string,
  ) {
    const form = await this.forms.loadFillable(scope, workspaceId, id);
    return fillableFormSchema.parse(await this.fill.fillable(form, 'internal'));
  }

  @Post(':id/uploads')
  @RequireAbility('read', 'Form')
  async createUpload(
    @RequestUserScope() scope: UserScope,
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id', new ZodValidationPipe(cuid)) id: string,
    @Body(new ZodValidationPipe(createFormUploadSchema)) input: CreateFormUploadInput,
    @Ip() ip: string,
  ) {
    const form = await this.forms.loadFillable(scope, workspaceId, id);
    return formUploadTicketSchema.parse(
      await this.fill.createUpload(form, input, {
        mode: 'internal',
        scope,
        sales: null,
        ip,
        userAgent: null,
      }),
    );
  }

  @Post(':id/submit')
  @RequireAbility('read', 'Form')
  async submit(
    @RequestUserScope() scope: UserScope,
    @CurrentSalesActor() sales: SalesActor,
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id', new ZodValidationPipe(cuid)) id: string,
    @Body(new ZodValidationPipe(submitFormSchema)) input: SubmitFormInput,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ) {
    const form = await this.forms.loadFillable(scope, workspaceId, id);
    return submitFormResponseSchema.parse(
      await this.fill.submit(form, input, {
        mode: 'internal',
        scope,
        sales,
        ip,
        userAgent: userAgent ?? null,
      }),
    );
  }

  // ─── Responses (owner and admins) ─────────────────────────────────────────

  @Get(':id/submissions')
  @RequireAbility('read', 'Form')
  async listSubmissions(
    @RequestUserScope() scope: UserScope,
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id', new ZodValidationPipe(cuid)) id: string,
    @Query(new ZodValidationPipe(listFormSubmissionsQuerySchema)) q: ListFormSubmissionsQuery,
  ) {
    return formSubmissionListResponseSchema.parse(
      await this.responses.list(scope, workspaceId, id, q),
    );
  }

  // Declared before `:submissionId` so "export.csv" is never read as an id.
  @Get(':id/submissions/export.csv')
  @RequireAbility('read', 'Form')
  async exportSubmissions(
    @RequestUserScope() scope: UserScope,
    @CurrentWorkspaceId() workspaceId: string,
    @Param('id', new ZodValidationPipe(cuid)) id: string,
    @Query(new ZodValidationPipe(exportQuerySchema))
    q: Pick<ListFormSubmissionsQuery, 'source' | 'from' | 'to'>,
    @Res() res: Response,
  ): Promise<void> {
    // Access, filters and the row count are checked before the first byte,
    // so those failures still answer as problems.
    const file = await this.responses.exportCsv(scope, workspaceId, id, q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    try {
      for await (const chunk of file.chunks) {
        if (res.destroyed) break;
        if (!res.write(chunk)) {
          // Wait for the buffer to empty, or for the client to leave.
          await new Promise<void>((resolve) => {
            const done = () => {
              res.off('drain', done);
              res.off('close', done);
              resolve();
            };
            res.once('drain', done);
            res.once('close', done);
          });
          // `break` also ends the generator, so no more batches are read.
          if (res.destroyed || res.writableEnded) break;
        }
      }
      if (!res.destroyed) res.end();
    } catch (err) {
      // Headers are gone: cut the download so the file is visibly incomplete.
      this.logger.error(
        `Form CSV export failed form=${id}: ${(err as Error)?.message ?? 'unknown'}`,
      );
      res.destroy();
    }
  }

  @Get(':id/submissions/:submissionId')
  @RequireAbility('read', 'Form')
  async getSubmission(
    @RequestUserScope() scope: UserScope,
    @CurrentWorkspaceId() workspaceId: string,
    @Param(new ZodValidationPipe(formSubmissionParamSchema))
    params: { id: string; submissionId: string },
  ) {
    return formSubmissionSchema.parse(
      await this.responses.get(scope, workspaceId, params.id, params.submissionId),
    );
  }

  @Delete(':id/submissions/:submissionId')
  @RequireAbility('update', 'Form')
  async removeSubmission(
    @RequestUserScope() scope: UserScope,
    @CurrentWorkspaceId() workspaceId: string,
    @Param(new ZodValidationPipe(formSubmissionParamSchema))
    params: { id: string; submissionId: string },
  ) {
    return okSchema.parse(
      await this.responses.remove(scope, workspaceId, params.id, params.submissionId),
    );
  }

  @Get(':id/submissions/:submissionId/files/:uploadId')
  @RequireAbility('read', 'Form')
  async fileUrl(
    @RequestUserScope() scope: UserScope,
    @CurrentWorkspaceId() workspaceId: string,
    @Param(new ZodValidationPipe(formUploadParamSchema))
    params: { id: string; submissionId: string; uploadId: string },
  ) {
    return formUploadUrlSchema.parse(
      await this.responses.fileUrl(
        scope,
        workspaceId,
        params.id,
        params.submissionId,
        params.uploadId,
      ),
    );
  }
}
