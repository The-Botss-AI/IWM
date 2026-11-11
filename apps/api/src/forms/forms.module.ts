import { Module } from '@nestjs/common';

import { FilesModule } from '../files/files.module';
import { FormFillService } from './form-fill.service';
import { FormResponsesService } from './form-responses.service';
import { FormUploadsSweeper } from './form-uploads.sweeper';
import { FormsController } from './forms.controller';
import { FormsService } from './forms.service';
import { PublicFormsController } from './public-forms.controller';
import { TurnstileClient } from './turnstile.client';

/** Workspace form builder (see forms.controller.ts). Not the project Task Forms. */
@Module({
  imports: [FilesModule],
  controllers: [FormsController, PublicFormsController],
  providers: [
    FormsService,
    FormFillService,
    FormResponsesService,
    FormUploadsSweeper,
    TurnstileClient,
  ],
})
export class FormsModule {}
