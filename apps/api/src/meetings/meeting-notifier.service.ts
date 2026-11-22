import { Injectable, Logger } from '@nestjs/common';
import type { MeetingResponse, NotificationType } from '@botss/shared-types';

import { newLinkToken } from '../common/access-code';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { buildCancelIcs, buildRequestIcs } from './ics-export';
import { toIcsMeeting, type MeetingAttendeeRow, type MeetingRow } from './meeting-mapper';
import { describeRule, formatWhen, meetingPath } from './meeting-rules';

export type GuestEmailVariant = 'invite' | 'update' | 'cancel';

export interface NotifyActor {
  userId: string;
  name: string;
}

/** Login-free RSVP page in the web app. The raw token is never logged. */
export function rsvpUrl(rawToken: string, response: 'accepted' | 'tentative' | 'declined'): string {
  const base = (process.env.PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}/meetings/rsvp/${rawToken}?response=${response}`;
}

const RSVP_VERB: Record<Exclude<MeetingResponse, 'NEEDS_ACTION'>, string> = {
  ACCEPTED: 'accepted',
  TENTATIVE: 'might attend',
  DECLINED: 'declined',
};

/**
 * Tells people about meeting changes: bell rows (and OS pushes) for internal
 * attendees, calendar emails (.ics REQUEST / CANCEL with RSVP links) for
 * external guests. Best effort: a failure here is logged and never undoes
 * or fails the change itself.
 *
 * Each email to a guest carries a fresh RSVP link (the token is stored only
 * as a hash, so it cannot be re-sent): the newest email's links are the ones
 * that work. The stored hash changes only once that email is queued, so a
 * guest whose email could not be sent keeps the link they already have.
 */
@Injectable()
export class MeetingNotifier {
  private readonly logger = new Logger(MeetingNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {}

  private when(m: MeetingRow, occurrence: { startsAt: Date; endsAt: Date } | null): string {
    return occurrence
      ? formatWhen(occurrence.startsAt, occurrence.endsAt, m.allDay, m.timeZone)
      : formatWhen(m.startsAt, m.endsAt, m.allDay, m.timeZone);
  }

  /** Bell rows + pushes to internal people (never the actor). */
  async notifyPeople(
    m: MeetingRow,
    userIds: readonly (string | null)[],
    kind: 'invite' | 'update' | 'cancel' | 'removed',
    actor: NotifyActor,
    occurrence: { startsAt: Date; endsAt: Date; originalStart: Date } | null = null,
  ): Promise<void> {
    const ids = [...new Set(userIds.filter((id): id is string => !!id && id !== actor.userId))];
    if (ids.length === 0) return;
    const type: NotificationType =
      kind === 'invite'
        ? 'MEETING_INVITE'
        : kind === 'update'
          ? 'MEETING_UPDATED'
          : 'MEETING_CANCELLED';
    const title =
      kind === 'invite'
        ? `${actor.name} invited you to ${m.title}`
        : kind === 'update'
          ? `${m.title} was updated`
          : kind === 'removed'
            ? `You were removed from ${m.title}`
            : occurrence
              ? `${m.title} on this date was cancelled`
              : `${m.title} was cancelled`;
    try {
      await this.notifications.emitMany(ids, {
        actorId: actor.userId,
        type,
        title: title.slice(0, 200),
        body: this.when(m, occurrence),
        entityType: 'meeting',
        entityId: m.id,
        url: meetingPath(m.id, occurrence?.originalStart ?? null),
      });
    } catch (err) {
      this.logger.warn(
        `meeting notification failed meetingId=${m.id}: ${(err as Error)?.message ?? 'unknown'}`,
      );
    }
  }

  /**
   * Calendar emails to external guests. `invite` / `update` send the whole
   * series (METHOD:REQUEST) with fresh RSVP links; `cancel` sends
   * METHOD:CANCEL for the meeting, or for one occurrence.
   */
  async emailGuests(
    m: MeetingRow,
    guests: readonly Pick<MeetingAttendeeRow, 'id' | 'email' | 'name' | 'userId'>[],
    variant: GuestEmailVariant,
    occurrence: { startsAt: Date; endsAt: Date; originalStart: Date } | null = null,
  ): Promise<void> {
    const external = guests.filter((g) => g.userId === null);
    if (external.length === 0) return;
    try {
      // No mail transport: nothing is sent, so nothing rotates either.
      if (await this.email.isStub(m.organizationId)) {
        this.logger.warn(`meeting emails not sent (no mail transport) meetingId=${m.id}`);
        return;
      }
      const ics = toIcsMeeting(m);
      const jobs = [];
      // Per job: the guest row and the hash its links carry (null for a cancel).
      const rotations: ({ attendeeId: string; hash: string } | null)[] = [];
      for (const g of external) {
        let rsvp: { accept: string; maybe: string; decline: string } | null = null;
        let rotation: { attendeeId: string; hash: string } | null = null;
        if (variant !== 'cancel') {
          const token = newLinkToken();
          rotation = { attendeeId: g.id, hash: token.hash };
          rsvp = {
            accept: rsvpUrl(token.raw, 'accepted'),
            maybe: rsvpUrl(token.raw, 'tentative'),
            decline: rsvpUrl(token.raw, 'declined'),
          };
        }
        rotations.push(rotation);
        jobs.push({
          variant,
          method: variant === 'cancel' ? ('CANCEL' as const) : ('REQUEST' as const),
          to: g.email,
          recipientName: g.name,
          organizerName: m.organizer.name,
          replyTo: m.organizer.email,
          title: m.title,
          whenLabel: this.when(m, occurrence),
          repeatLabel: occurrence ? null : describeRule(m.rrule),
          location: m.location,
          meetingUrl: m.meetingUrl,
          rsvp,
          ics:
            variant === 'cancel'
              ? buildCancelIcs(ics, g.email, occurrence?.originalStart ?? null)
              : buildRequestIcs(ics, g.email),
        });
      }
      const queued = await this.email.sendMeetingEmails(m.organizationId, jobs);
      for (let i = 0; i < rotations.length; i += 1) {
        const rotation = rotations[i];
        if (!rotation || !queued[i]) continue;
        try {
          // The attendee row may be gone since (removed in the meantime).
          await this.prisma.client.meetingAttendee.updateMany({
            where: { id: rotation.attendeeId, meetingId: m.id },
            data: { rsvpTokenHash: rotation.hash },
          });
        } catch (err) {
          this.logger.warn(
            `meeting RSVP link rotation failed meetingId=${m.id}: ${(err as Error)?.message ?? 'unknown'}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `meeting emails failed meetingId=${m.id}: ${(err as Error)?.message ?? 'unknown'}`,
      );
    }
  }

  /** Tell the organizer someone answered. */
  async notifyRsvp(
    m: Pick<MeetingRow, 'id' | 'title' | 'organizerId'>,
    responder: { userId: string | null; name: string },
    response: Exclude<MeetingResponse, 'NEEDS_ACTION'>,
  ): Promise<void> {
    if (responder.userId === m.organizerId) return;
    try {
      await this.notifications.emit({
        userId: m.organizerId,
        actorId: responder.userId,
        type: 'MEETING_RSVP',
        title: `${responder.name} ${RSVP_VERB[response]} ${m.title}`.slice(0, 200),
        body:
          response === 'DECLINED'
            ? 'They will not attend.'
            : response === 'TENTATIVE'
              ? 'They might attend.'
              : 'They will attend.',
        entityType: 'meeting',
        entityId: m.id,
        url: meetingPath(m.id),
      });
    } catch (err) {
      this.logger.warn(
        `meeting RSVP notification failed meetingId=${m.id}: ${(err as Error)?.message ?? 'unknown'}`,
      );
    }
  }
}
