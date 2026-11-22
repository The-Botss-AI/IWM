import { Body, Controller, Get, Headers, Ip, Param, Post } from '@nestjs/common';
import {
  createFormUploadSchema,
  fillableFormSchema,
  formPublicTokenSchema,
  formUploadTicketSchema,
  submitFormResponseSchema,
  submitFormSchema,
  type CreateFormUploadInput,
  type SubmitFormInput,
} from '@botss/shared-types';

import { Public } from '../common/decorators/public.decorator';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { FormFillService } from './form-fill.service';

/**
 * Anonymous filling through a form's public link. `@Public()` skips
 * AuthGuard and `@SkipPermissions()` keeps CASL off a request with no user.
 * Mounted under `/public/forms`, which `main.ts` puts behind the public
 * content rate limiter; the service adds per-IP Redis caps, a honeypot, a
 * minimum fill time and (when configured) Turnstile.
 */
@Public()
@SkipPermissions()
@Controller('public/forms')
export class PublicFormsController {
  constructor(private readonly fill: FormFillService) {}

  @Get(':token')
  async get(@Param('token', new ZodValidationPipe(formPublicTokenSchema)) token: string) {
    const form = await this.fill.findPublic(token);
    return fillableFormSchema.parse(await this.fill.fillable(form, 'public'));
  }

  @Post(':token/uploads')
  async createUpload(
    @Param('token', new ZodValidationPipe(formPublicTokenSchema)) token: string,
    @Body(new ZodValidationPipe(createFormUploadSchema)) input: CreateFormUploadInput,
    @Ip() ip: string,
  ) {
    const form = await this.fill.findPublic(token);
    return formUploadTicketSchema.parse(
      await this.fill.createUpload(form, input, {
        mode: 'public',
        scope: null,
        sales: null,
        ip,
        userAgent: null,
      }),
    );
  }

  @Post(':token/submit')
  async submit(
    @Param('token', new ZodValidationPipe(formPublicTokenSchema)) token: string,
    @Body(new ZodValidationPipe(submitFormSchema)) input: SubmitFormInput,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ) {
    const form = await this.fill.findPublic(token);
    return submitFormResponseSchema.parse(
      await this.fill.submit(form, input, {
        mode: 'public',
        scope: null,
        sales: null,
        ip,
        userAgent: userAgent ?? null,
      }),
    );
  }
}
