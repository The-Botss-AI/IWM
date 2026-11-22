import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type { MeetingFeedLink, MeetingFeedStatus } from '@botss/shared-types';

import { AddonsService } from '../addons/addons.service';
import { hashLinkToken, newLinkToken } from '../common/access-code';
import { PrismaService } from '../prisma/prisma.service';
import { buildFeedIcs } from './ics-export';
import { MEETING_INCLUDE, toIcsMeeting } from './meeting-mapper';
import { meetingVisibleWhere } from './meeting-rules';

const DAY_MS = 86_400_000;
const FEED_PAST_DAYS = 30;
const FEED_FUTURE_DAYS = 365;
const FEED_MEETINGS_CAP = 2000;
/** `lastUsedAt` is written at most this often (calendar apps poll a lot). */
const LAST_USED_RESOLUTION_MS = 60 * 60_000;

/** Public base of the API (the feed URL is fetched by calendar apps, not the web app). */
export function apiPublicBase(): string {
  const origin = (process.env.BETTER_AUTH_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
  const prefix = (process.env.API_BASE_PATH ?? 'api/v1').replace(/^\/+|\/+$/g, '');
  return `${origin}/${prefix}`;
}

export function feedUrls(rawToken: string): { url: string; webcalUrl: string } {
  const url = `${apiPublicBase()}/meetings/feed/${rawToken}.ics`;
  return { url, webcalUrl: url.replace(/^https?:\/\//i, 'webcal://') };
}

function feedNotFound(): NotFoundException {
  return new NotFoundException({ title: 'Not found', status: 404 });
}

/**
 * The private calendar subscription: one secret link per person
 * (`/meetings/feed/<token>.ics`, the token stored only as a hash). The feed
 * is that person's own meetings (organized, or attending and not declined)
 * from 30 days back to a year ahead, with their reminders as alarms. Any
 * miss (unknown or revoked token, deleted account, suspended organization,
 * add-on off) is the same 404.
 */
@Injectable()
export class MeetingFeedService {
  private readonly logger = new Logger(MeetingFeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly addons?: AddonsService,
  ) {}

  async status(userId: string): Promise<MeetingFeedStatus> {
    const row = await this.prisma.client.meetingFeedToken.findUnique({
      where: { userId },
      select: { createdAt: true, lastUsedAt: true },
    });
    return {
      active: !!row,
      createdAt: row?.createdAt ?? null,
      lastUsedAt: row?.lastUsedAt ?? null,
    };
  }

  /** A new link; the previous one stops working at once. Returned only here. */
  async regenerate(userId: string): Promise<MeetingFeedLink> {
    const token = newLinkToken();
    const row = await this.prisma.client.meetingFeedToken.upsert({
      where: { userId },
      create: { userId, tokenHash: token.hash },
      update: { tokenHash: token.hash, createdAt: new Date(), lastUsedAt: null },
      select: { createdAt: true },
    });
    return { ...feedUrls(token.raw), createdAt: row.createdAt };
  }

  async revoke(userId: string): Promise<{ ok: true }> {
    await this.prisma.client.meetingFeedToken.deleteMany({ where: { userId } });
    return { ok: true };
  }

  async render(rawToken: string, now = new Date()): Promise<string> {
    const token = await this.prisma.client.meetingFeedToken.findUnique({
      where: { tokenHash: hashLinkToken(rawToken) },
      select: {
        id: true,
        userId: true,
        lastUsedAt: true,
        user: { select: { organizationId: true, deletedAt: true, accountType: true } },
      },
    });
    const user = token?.user;
    if (!token || !user || user.deletedAt || user.accountType !== 'STAFF' || !user.organizationId)
      throw feedNotFound();
    const organizationId = user.organizationId;
    const org = await this.prisma.client.organization.findFirst({
      where: { id: organizationId, isActive: true },
      select: { id: true },
    });
    if (!org) throw feedNotFound();
    if (this.addons && !(await this.addons.isEnabled(organizationId, 'meetings')))
      throw feedNotFound();

    if (!token.lastUsedAt || now.getTime() - token.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
      await this.prisma.client.meetingFeedToken
        .update({ where: { id: token.id }, data: { lastUsedAt: now } })
        .catch((err: unknown) =>
          this.logger.warn(`feed lastUsedAt not saved: ${(err as Error)?.message ?? 'unknown'}`),
        );
    }

    const userId = token.userId;
    const from = new Date(now.getTime() - FEED_PAST_DAYS * DAY_MS);
    const to = new Date(now.getTime() + FEED_FUTURE_DAYS * DAY_MS);
    const rows = await this.prisma.client.meeting.findMany({
      where: {
        AND: [
          meetingVisibleWhere({ userId, organizationId }),
          { status: { not: 'CANCELLED' } },
          // Organized, or attending and not declined.
          {
            OR: [
              { organizerId: userId },
              { attendees: { some: { userId, response: { not: 'DECLINED' } } } },
            ],
          },
          { startsAt: { lt: to } },
          { OR: [{ lastEndsAt: null }, { lastEndsAt: { gt: from } }] },
        ],
      },
      include: MEETING_INCLUDE,
      orderBy: { startsAt: 'asc' },
      take: FEED_MEETINGS_CAP,
    });
    const reminders = rows.length
      ? await this.prisma.client.meetingReminder.findMany({
          where: { userId, meetingId: { in: rows.map((r) => r.id) } },
          select: { meetingId: true, minutesBefore: true },
        })
      : [];
    const alarms = new Map<string, number[]>();
    for (const r of reminders)
      alarms.set(r.meetingId, [...(alarms.get(r.meetingId) ?? []), r.minutesBefore]);
    return buildFeedIcs(
      rows.map((row) => ({
        meeting: toIcsMeeting(row),
        alarms: (alarms.get(row.id) ?? []).sort((a, b) => a - b),
      })),
      'Meetings',
      now.getTime(),
    );
  }
}
