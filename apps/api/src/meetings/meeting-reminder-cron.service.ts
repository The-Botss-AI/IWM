import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { MeetingRemindersService } from './meeting-reminders.service';

/**
 * Every-minute sweep that fires meeting reminders (and snoozed ones), like
 * the lead follow-up cron. `@Cron` is off in the `api` role, so this runs in
 * the worker (or `all`); the per-occurrence delivery row keeps it to one
 * notification even if two processes ran it.
 */
@Injectable()
export class MeetingReminderCronService {
  private readonly logger = new Logger(MeetingReminderCronService.name);

  constructor(private readonly reminders: MeetingRemindersService) {}

  @Cron('* * * * *', { name: 'meeting-reminders' })
  async run(): Promise<void> {
    try {
      const fired = await this.reminders.sweep(new Date());
      if (fired > 0) {
        this.logger.log(`Fired ${fired} meeting reminder(s)`);
      }
    } catch (err) {
      this.logger.error(
        `Meeting reminder sweep failed message=${(err as Error)?.message ?? 'unknown'}`,
      );
    }
  }
}
