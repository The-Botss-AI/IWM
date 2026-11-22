import { Module } from '@nestjs/common';

import { MeetingEditorService } from './meeting-editor.service';
import { MeetingFeedService } from './meeting-feed.service';
import { MeetingImportService } from './meeting-import.service';
import { MeetingNotifier } from './meeting-notifier.service';
import { MeetingReminderCronService } from './meeting-reminder-cron.service';
import { MeetingRemindersService } from './meeting-reminders.service';
import { MeetingRsvpService } from './meeting-rsvp.service';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { MeetingsFeedController, PublicMeetingsController } from './public-meetings.controller';

/**
 * Meetings: CRUD with recurrence, attendees (staff of the same organization
 * and external guests), RSVP, reminders (cron, worker role), .ics import,
 * invitations and the private calendar feed. The `meetings` add-on gates it.
 * EmailService, NotificationsService and AddonsService come from global modules.
 */
@Module({
  // The feed controller is registered before the main one so its two-segment
  // route is never shadowed.
  controllers: [MeetingsFeedController, PublicMeetingsController, MeetingsController],
  providers: [
    MeetingsService,
    MeetingEditorService,
    MeetingNotifier,
    MeetingImportService,
    MeetingFeedService,
    MeetingRsvpService,
    MeetingRemindersService,
    MeetingReminderCronService,
  ],
  exports: [MeetingsService],
})
export class MeetingsModule {}
