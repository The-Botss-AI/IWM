import { ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { MeetingRsvpAnswer, PublicMeetingRsvp } from '@botss/shared-types';

import { AddonsService } from '../addons/addons.service';
import { hashLinkToken } from '../common/access-code';
import { PrismaService } from '../prisma/prisma.service';
import { MeetingNotifier } from './meeting-notifier.service';

function linkNotFound(): NotFoundException {
  return new NotFoundException({
    title: 'Link not valid',
    status: 404,
    detail:
      'This invitation link is not valid any more. Use the link in the latest invitation email.',
    code: 'meeting_rsvp_not_found',
  });
}

/**
 * Login-free RSVP for external guests. The token in the link (from the
 * newest invitation email) is matched by its sha256; it reveals that one
 * meeting's title and time and the guest's own answer, nothing else (no
 * organizer, attendees, location, link or organization). Rate limited per IP
 * in main.ts.
 */
@Injectable()
export class MeetingRsvpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: MeetingNotifier,
    @Optional() private readonly addons?: AddonsService,
  ) {}

  private async load(rawToken: string) {
    const row = await this.prisma.client.meetingAttendee.findUnique({
      where: { rsvpTokenHash: hashLinkToken(rawToken) },
      select: {
        id: true,
        userId: true,
        email: true,
        name: true,
        response: true,
        meeting: {
          select: {
            id: true,
            organizationId: true,
            organizerId: true,
            title: true,
            startsAt: true,
            endsAt: true,
            allDay: true,
            timeZone: true,
            rrule: true,
            status: true,
            deletedAt: true,
            organization: { select: { isActive: true, deletedAt: true } },
          },
        },
      },
    });
    // External guests only; a deleted meeting or a closed organization is gone.
    if (!row || row.userId !== null || row.meeting.deletedAt) throw linkNotFound();
    if (!row.meeting.organization.isActive || row.meeting.organization.deletedAt)
      throw linkNotFound();
    if (this.addons && !(await this.addons.isEnabled(row.meeting.organizationId, 'meetings')))
      throw linkNotFound();
    return row;
  }

  private view(
    row: Awaited<ReturnType<MeetingRsvpService['load']>>,
    response = row.response,
  ): PublicMeetingRsvp {
    const m = row.meeting;
    return {
      title: m.title,
      startsAt: m.startsAt,
      endsAt: m.endsAt,
      allDay: m.allDay,
      timeZone: m.timeZone,
      recurring: m.rrule !== null,
      cancelled: m.status === 'CANCELLED',
      response,
    };
  }

  async get(rawToken: string): Promise<PublicMeetingRsvp> {
    return this.view(await this.load(rawToken));
  }

  async answer(rawToken: string, response: MeetingRsvpAnswer): Promise<PublicMeetingRsvp> {
    const row = await this.load(rawToken);
    if (row.meeting.status === 'CANCELLED') {
      throw new ConflictException({
        title: 'Meeting cancelled',
        status: 409,
        detail: 'This meeting was cancelled.',
        code: 'meeting_cancelled',
      });
    }
    if (row.response !== response) {
      await this.prisma.client.meetingAttendee.update({
        where: { id: row.id },
        data: { response, respondedAt: new Date() },
      });
      await this.notifier.notifyRsvp(
        { id: row.meeting.id, title: row.meeting.title, organizerId: row.meeting.organizerId },
        { userId: null, name: row.name ?? row.email },
        response,
      );
    }
    return this.view(row, response);
  }
}
