import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  meetingFeedFileSchema,
  meetingRsvpSchema,
  meetingRsvpToken,
  publicMeetingRsvpSchema,
  type MeetingRsvpInput,
  type PublicMeetingRsvp,
} from '@botss/shared-types';

import { Public } from '../common/decorators/public.decorator';
import { SkipPermissions } from '../common/decorators/skip-permissions.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { MeetingFeedService } from './meeting-feed.service';
import { MeetingRsvpService } from './meeting-rsvp.service';

/**
 * Login-free RSVP for external guests (`/public/meetings/rsvp/:token`).
 * Rate limited per IP in main.ts; reveals only that meeting's title and time.
 */
@Public()
@SkipPermissions()
@Controller('public/meetings')
export class PublicMeetingsController {
  constructor(private readonly rsvp: MeetingRsvpService) {}

  @Get('rsvp/:token')
  async view(
    @Param('token', new ZodValidationPipe(meetingRsvpToken)) token: string,
  ): Promise<PublicMeetingRsvp> {
    return publicMeetingRsvpSchema.parse(await this.rsvp.get(token));
  }

  @Post('rsvp/:token')
  async answer(
    @Param('token', new ZodValidationPipe(meetingRsvpToken)) token: string,
    @Body(new ZodValidationPipe(meetingRsvpSchema)) input: MeetingRsvpInput,
  ): Promise<PublicMeetingRsvp> {
    return publicMeetingRsvpSchema.parse(await this.rsvp.answer(token, input.response));
  }
}

/**
 * The private calendar feed (`/meetings/feed/<token>.ics`), fetched by
 * calendar apps without a session: the secret link is the credential. Rate
 * limited per IP in main.ts; every miss is a 404 (RFC 7807).
 */
@Public()
@SkipPermissions()
@Controller('meetings/feed')
export class MeetingsFeedController {
  constructor(private readonly feed: MeetingFeedService) {}

  @Get(':file')
  async ics(
    @Param('file', new ZodValidationPipe(meetingFeedFileSchema)) token: string,
    @Res() res: Response,
  ): Promise<void> {
    const body = await this.feed.render(token);
    res
      .status(200)
      .setHeader('Content-Type', 'text/calendar; charset=utf-8')
      .setHeader('Content-Disposition', 'inline; filename="meetings.ics"')
      .setHeader('Cache-Control', 'private, max-age=300')
      .setHeader('X-Robots-Tag', 'noindex')
      .send(body);
  }
}
