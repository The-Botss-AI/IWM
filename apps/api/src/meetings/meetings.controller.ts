import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  attendeeCandidatesQuerySchema,
  attendeeCandidatesResponseSchema,
  cancelMeetingSchema,
  createMeetingSchema,
  cuid,
  deleteMeetingQuerySchema,
  icsImportPreviewSchema,
  icsImportResultSchema,
  icsImportSelectionFieldSchema,
  listMeetingsQuerySchema,
  meetingFeedLinkSchema,
  meetingFeedStatusSchema,
  meetingListResponseSchema,
  meetingMutationResponseSchema,
  meetingOkSchema,
  meetingRemindersResponseSchema,
  meetingRsvpSchema,
  meetingSchema,
  meetingSnoozeResponseSchema,
  MEETING_ICS_MAX_BYTES,
  setMeetingRemindersSchema,
  updateMeetingSchema,
  type AttendeeCandidatesQuery,
  type AttendeeCandidatesResponse,
  type CancelMeetingInput,
  type CreateMeetingInput,
  type DeleteMeetingQuery,
  type IcsImportPreview,
  type IcsImportResult,
  type IcsImportSelection,
  type ListMeetingsQuery,
  type Meeting,
  type MeetingFeedLink,
  type MeetingFeedStatus,
  type MeetingListResponse,
  type MeetingMutationResponse,
  type MeetingRemindersResponse,
  type MeetingRsvpInput,
  type MeetingSnoozeResponse,
  type SetMeetingRemindersInput,
  type UpdateMeetingInput,
} from '@botss/shared-types';
import { RequireAddon } from '../addons/require-addon.decorator';
import { RequestUserScope, type UserScope } from '../common/decorators/user-scope.decorator';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import type { RequestExtensions } from '../common/guards/auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentMeetingActor, linkAccessFor } from './meeting-actor.decorator';
import { MeetingEditorService } from './meeting-editor.service';
import { MeetingFeedService } from './meeting-feed.service';
import { MeetingImportService, type UploadedIcsFile } from './meeting-import.service';
import type { MeetingActor } from './meeting-rules';
import { MeetingsService } from './meetings.service';

/** Multer limits for the .ics upload: one file, 2 MB, held in memory only. */
const ICS_UPLOAD = FileInterceptor('file', {
  limits: { fileSize: MEETING_ICS_MAX_BYTES, files: 1, fields: 4, fieldSize: 1_200_000, parts: 6 },
});

/**
 * Meetings. Authorization is per meeting, not role based: the services
 * answer only for the organizer and the people added (plus organization
 * isolation), so PermissionsGuard is skipped on purpose (a CASL subject
 * check has no meeting in hand and would only widen or duplicate that).
 * The whole controller belongs to the `meetings` add-on.
 *
 * Static routes are declared before `:id`.
 */
@Controller('meetings')
@RequireAddon('meetings')
@SkipPermissions()
export class MeetingsController {
  constructor(
    private readonly meetings: MeetingsService,
    private readonly editor: MeetingEditorService,
    private readonly imports: MeetingImportService,
    private readonly feed: MeetingFeedService,
  ) {}

  @Get()
  async list(
    @CurrentMeetingActor() actor: MeetingActor,
    @Query(new ZodValidationPipe(listMeetingsQuerySchema)) query: ListMeetingsQuery,
  ): Promise<MeetingListResponse> {
    return meetingListResponseSchema.parse(await this.meetings.list(actor, query));
  }

  @Post()
  async create(
    @CurrentMeetingActor() actor: MeetingActor,
    @Req() req: RequestExtensions,
    @RequestUserScope() scope: UserScope,
    @Body(new ZodValidationPipe(createMeetingSchema)) input: CreateMeetingInput,
  ): Promise<Meeting> {
    return meetingSchema.parse(await this.editor.create(actor, input, linkAccessFor(req, scope)));
  }

  @Get('attendee-candidates')
  async attendeeCandidates(
    @CurrentMeetingActor() actor: MeetingActor,
    @Query(new ZodValidationPipe(attendeeCandidatesQuerySchema)) query: AttendeeCandidatesQuery,
  ): Promise<AttendeeCandidatesResponse> {
    return attendeeCandidatesResponseSchema.parse(
      await this.meetings.attendeeCandidates(actor, query),
    );
  }

  @Post('import/preview')
  @UseInterceptors(ICS_UPLOAD)
  async importPreview(
    @CurrentMeetingActor() actor: MeetingActor,
    @UploadedFile() file: UploadedIcsFile | undefined,
  ): Promise<IcsImportPreview> {
    return icsImportPreviewSchema.parse(await this.imports.preview(actor, file));
  }

  @Post('import')
  @UseInterceptors(ICS_UPLOAD)
  async import(
    @CurrentMeetingActor() actor: MeetingActor,
    @UploadedFile() file: UploadedIcsFile | undefined,
    @Body('selection', new ZodValidationPipe(icsImportSelectionFieldSchema))
    selection: IcsImportSelection,
  ): Promise<IcsImportResult> {
    return icsImportResultSchema.parse(await this.imports.import(actor, file, selection));
  }

  @Get('feed-token')
  async feedStatus(@CurrentMeetingActor() actor: MeetingActor): Promise<MeetingFeedStatus> {
    this.meetings.requireOrg(actor);
    return meetingFeedStatusSchema.parse(await this.feed.status(actor.userId));
  }

  @Post('feed-token')
  async feedRegenerate(@CurrentMeetingActor() actor: MeetingActor): Promise<MeetingFeedLink> {
    this.meetings.requireOrg(actor);
    return meetingFeedLinkSchema.parse(await this.feed.regenerate(actor.userId));
  }

  @Delete('feed-token')
  async feedRevoke(@CurrentMeetingActor() actor: MeetingActor): Promise<{ ok: true }> {
    return meetingOkSchema.parse(await this.feed.revoke(actor.userId));
  }

  @Post('reminder-deliveries/:deliveryId/snooze')
  async snooze(
    @CurrentMeetingActor() actor: MeetingActor,
    @Param('deliveryId', new ZodValidationPipe(cuid)) deliveryId: string,
  ): Promise<MeetingSnoozeResponse> {
    return meetingSnoozeResponseSchema.parse(await this.meetings.snooze(actor, deliveryId));
  }

  @Get(':id')
  async get(
    @CurrentMeetingActor() actor: MeetingActor,
    @Req() req: RequestExtensions,
    @RequestUserScope() scope: UserScope,
    @Param('id', new ZodValidationPipe(cuid)) id: string,
  ): Promise<Meeting> {
    return meetingSchema.parse(await this.meetings.get(actor, id, linkAccessFor(req, scope)));
  }

  @Patch(':id')
  async update(
    @CurrentMeetingActor() actor: MeetingActor,
    @Req() req: RequestExtensions,
    @RequestUserScope() scope: UserScope,
    @Param('id', new ZodValidationPipe(cuid)) id: string,
    @Body(new ZodValidationPipe(updateMeetingSchema)) input: UpdateMeetingInput,
  ): Promise<MeetingMutationResponse> {
    return meetingMutationResponseSchema.parse(
      await this.editor.update(actor, id, input, linkAccessFor(req, scope)),
    );
  }

  @Post(':id/cancel')
  async cancel(
    @CurrentMeetingActor() actor: MeetingActor,
    @Req() req: RequestExtensions,
    @RequestUserScope() scope: UserScope,
    @Param('id', new ZodValidationPipe(cuid)) id: string,
    @Body(new ZodValidationPipe(cancelMeetingSchema)) input: CancelMeetingInput,
  ): Promise<MeetingMutationResponse> {
    return meetingMutationResponseSchema.parse(
      await this.editor.cancel(actor, id, input, linkAccessFor(req, scope)),
    );
  }

  @Delete(':id')
  async remove(
    @CurrentMeetingActor() actor: MeetingActor,
    @Param('id', new ZodValidationPipe(cuid)) id: string,
    @Query(new ZodValidationPipe(deleteMeetingQuerySchema)) query: DeleteMeetingQuery,
  ): Promise<{ ok: true }> {
    return meetingOkSchema.parse(await this.editor.remove(actor, id, query.notifyAttendees));
  }

  @Post(':id/rsvp')
  async rsvp(
    @CurrentMeetingActor() actor: MeetingActor,
    @Req() req: RequestExtensions,
    @RequestUserScope() scope: UserScope,
    @Param('id', new ZodValidationPipe(cuid)) id: string,
    @Body(new ZodValidationPipe(meetingRsvpSchema)) input: MeetingRsvpInput,
  ): Promise<Meeting> {
    return meetingSchema.parse(
      await this.meetings.rsvp(actor, id, input, linkAccessFor(req, scope)),
    );
  }

  @Put(':id/reminders')
  async setReminders(
    @CurrentMeetingActor() actor: MeetingActor,
    @Param('id', new ZodValidationPipe(cuid)) id: string,
    @Body(new ZodValidationPipe(setMeetingRemindersSchema)) input: SetMeetingRemindersInput,
  ): Promise<MeetingRemindersResponse> {
    return meetingRemindersResponseSchema.parse(
      await this.meetings.setReminders(actor, id, input.minutesBefore),
    );
  }
}
