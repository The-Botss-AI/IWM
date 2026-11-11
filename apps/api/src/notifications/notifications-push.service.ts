import { randomUUID, timingSafeEqual } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  type DesktopPushPayload,
  isAllowedPushEndpoint,
  parseStoredUserPreferences,
  type RegisterPushDeviceInput,
  type SubscribePushInput,
} from '@botss/shared-types';
import { Expo, type ExpoPushMessage } from 'expo-server-sdk';
import * as webpush from 'web-push';

import { PrismaService } from '../prisma/prisma.service';
import { RealtimeEventsService } from './realtime-events.service';

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function ownedElsewhere(): ConflictException {
  return new ConflictException({
    title: 'Registered to another account',
    status: 409,
    detail:
      'This device is still registered for another account. Sign that account out on the device first.',
    code: 'push-target-owned',
  });
}

/**
 * Native OS Web Push integration. Stores per-device subscriptions
 * (FCM/APNS/Mozilla endpoints) and fans pushes out via VAPID-signed
 * `webpush.sendNotification`. Every send also goes to the native mobile
 * devices (Expo) and, live, to the users' connected sockets
 * (`RealtimeEventsService.publishPush` -> `os_notification`, which the
 * desktop app banners from). Those two legs never depend on VAPID.
 *
 * Auto-prune contract: any push that returns 404 or 410 is treated as
 * a permanent endpoint death (browser uninstalled, push service
 * deprovisioned) and the offending row is dropped from the DB so we
 * never retry against a dead subscription.
 *
 * Operational requirements (env):
 *   VAPID_SUBJECT       - `mailto:` URL the push services use to
 *                         contact your team if abuse is reported.
 *   VAPID_PUBLIC_KEY    - base64-url-encoded public half of the keypair.
 *   VAPID_PRIVATE_KEY   - base64-url-encoded private half. Never leaves
 *                         the API process.
 *
 * If any of these are missing at boot, the service still constructs (so
 * tests / dev environments without push enabled aren't blocked) but
 * the Web Push leg of `sendDesktopNotification` becomes a no-op + warns once.
 */
@Injectable()
export class NotificationsPushService {
  private readonly logger = new Logger(NotificationsPushService.name);
  private readonly enabled: boolean;
  private warnedDisabledOnce = false;
  // Native push (Expo -> FCM/APNs). No server credential needed to send;
  // EXPO_ACCESS_TOKEN only raises rate limits. The project's FCM/APNs creds
  // live in EAS, not here. Reaches a fully closed app, unlike Web Push.
  private readonly expo = new Expo(
    process.env.EXPO_ACCESS_TOKEN ? { accessToken: process.env.EXPO_ACCESS_TOKEN } : undefined,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeEventsService,
  ) {
    const subject = process.env.VAPID_SUBJECT;
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;

    if (subject && publicKey && privateKey) {
      try {
        webpush.setVapidDetails(subject, publicKey, privateKey);
        this.enabled = true;
        this.logger.log('Web Push enabled (VAPID configured).');
      } catch (err) {
        this.enabled = false;
        this.logger.error(
          `Web Push disabled - VAPID configuration rejected: ${(err as Error)?.message ?? 'unknown'}`,
        );
      }
    } else {
      this.enabled = false;
      this.logger.warn(
        'Web Push disabled - VAPID_SUBJECT / VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not all set.',
      );
    }
  }

  /**
   * Upsert by endpoint so re-subscriptions from the same device dedupe.
   *
   * An endpoint already registered to ANOTHER user is only moved to the
   * caller when the request carries that subscription's own keys (the same
   * browser, now signed in as someone else). Knowing an endpoint URL alone
   * must not let anyone redirect another person's notifications to their
   * own account or silence that person's device.
   */
  async subscribe(userId: string, input: SubscribePushInput): Promise<{ ok: true }> {
    if (!isAllowedPushEndpoint(input.endpoint)) {
      throw new BadRequestException({
        title: 'Unsupported push endpoint',
        status: 400,
        detail: 'Push subscriptions must use a known Web Push service over https.',
      });
    }
    const existing = await this.prisma.client.userNotificationSubscription.findUnique({
      where: { endpoint: input.endpoint },
      select: { id: true, userId: true, auth: true, p256dh: true },
    });
    if (existing && existing.userId !== userId) {
      const sameSubscription =
        safeEqual(existing.auth, input.auth) && safeEqual(existing.p256dh, input.p256dh);
      if (!sameSubscription) throw ownedElsewhere();
    }
    await this.prisma.client.userNotificationSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        userId,
        endpoint: input.endpoint,
        auth: input.auth,
        p256dh: input.p256dh,
        userAgent: input.userAgent ?? null,
      },
      update: {
        userId,
        auth: input.auth,
        p256dh: input.p256dh,
        userAgent: input.userAgent ?? null,
      },
    });
    return { ok: true };
  }

  /** Remove a subscription explicitly (sign-out / device cleanup). */
  async unsubscribe(userId: string, endpoint: string): Promise<{ ok: true }> {
    await this.prisma.client.userNotificationSubscription.deleteMany({
      where: { userId, endpoint },
    });
    return { ok: true };
  }

  /**
   * Fan-out a notification to every device the user has registered.
   * Parallel sends, independent error handling per device - one dead
   * endpoint never blocks the others. Returns the count of *successful*
   * deliveries so callers can log without crawling individual results.
   */
  async sendDesktopNotification(
    userId: string,
    payload: DesktopPushPayload,
  ): Promise<{ sent: number; dropped: number }> {
    return this.sendDesktopNotificationToUsers([userId], payload);
  }

  /**
   * The same notification to several users at once (chat fan-out): ONE
   * subscription lookup and ONE device lookup for all of them, and the
   * native pushes go out as one chunked Expo request instead of one per
   * user. Per-device behaviour (TTL, 404/410 and DeviceNotRegistered
   * pruning, error isolation) is exactly `sendDesktopNotification`'s - that
   * method is this one with a single user.
   */
  async sendDesktopNotificationToUsers(
    userIds: readonly string[],
    payload: DesktopPushPayload,
  ): Promise<{ sent: number; dropped: number }> {
    const ids = Array.from(new Set(userIds));
    if (ids.length === 0) return { sent: 0, dropped: 0 };
    const who = ids.length === 1 ? `userId=${ids[0]}` : `users=${ids.length}`;
    // Live leg: the same payload to the users' connected sockets, which is
    // how the desktop app raises its banners (Electron has no push service).
    // Published here so it fires for exactly the events phones get a push
    // for, and before the VAPID check so it never depends on push config.
    // Isolated so a socket problem can never cost the phones their push.
    try {
      this.realtime.publishPush({ userIds: ids, payload: { ...payload, pushId: randomUUID() } });
    } catch (err) {
      this.logger.warn(`live push fan-out failed ${who}: ${(err as Error)?.message ?? 'unknown'}`);
    }
    // Do Not Disturb silences every push leg (phones and browsers) except
    // calls, which still arrive as a silent "Call from <name>" notification.
    // The live socket leg above stays unfiltered: the client applies DND to
    // its own banners and sounds.
    const silenced = await this.doNotDisturbUserIds(ids);
    const isCall = payload.type === 'call';
    const loud = ids.filter((id) => !silenced.has(id));
    const quiet = isCall ? ids.filter((id) => silenced.has(id)) : [];
    const targets = [...loud, ...quiet];
    const silentPayload = isCall ? this.silentCallPayload(payload) : payload;
    // Native mobile push is independent of Web Push/VAPID and reaches a fully
    // closed app, so always attempt it - even when VAPID isn't configured.
    // Fire-and-forget: a native failure must not affect the web-push result.
    for (const [group, groupPayload] of [
      [loud, payload],
      [quiet, silentPayload],
    ] as const) {
      void this.sendNativePush(group, groupPayload).catch((err) => {
        this.logger.warn(
          `native push fan-out failed ${who}: ${(err as Error)?.message ?? 'unknown'}`,
        );
      });
    }

    if (!this.enabled) {
      if (!this.warnedDisabledOnce) {
        this.warnedDisabledOnce = true;
        this.logger.warn('sendDesktopNotification called but Web Push is disabled - skipping.');
      }
      return { sent: 0, dropped: 0 };
    }

    if (targets.length === 0) return { sent: 0, dropped: 0 };
    const subs = await this.prisma.client.userNotificationSubscription.findMany({
      where: { userId: { in: targets } },
      select: { id: true, userId: true, endpoint: true, auth: true, p256dh: true },
    });
    if (subs.length === 0) return { sent: 0, dropped: 0 };

    const quietSet = new Set(quiet);
    const loudBody = JSON.stringify(payload);
    const quietBody = JSON.stringify(silentPayload);
    let sent = 0;
    let dropped = 0;

    await Promise.all(
      subs.map(async (sub) => {
        // Re-check before the server makes the request: rows stored before
        // the allowlist existed may point anywhere (SSRF). Drop them.
        if (!isAllowedPushEndpoint(sub.endpoint)) {
          dropped += 1;
          this.logger.warn(`Dropping push subscription with a disallowed endpoint id=${sub.id}`);
          await this.prisma.client.userNotificationSubscription
            .delete({ where: { id: sub.id } })
            .catch(() => undefined);
          return;
        }
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { auth: sub.auth, p256dh: sub.p256dh },
            },
            quietSet.has(sub.userId) ? quietBody : loudBody,
            { TTL: payload.type === 'call' ? 30 : 120 },
          );
          sent += 1;
        } catch (err) {
          const statusCode = (err as { statusCode?: number })?.statusCode;
          // 404 = endpoint not found, 410 = endpoint gone - both terminal.
          if (statusCode === 404 || statusCode === 410) {
            dropped += 1;
            await this.prisma.client.userNotificationSubscription
              .delete({ where: { id: sub.id } })
              .catch((cleanupErr) => {
                this.logger.warn(
                  `Failed to prune dead push endpoint id=${sub.id}: ${(cleanupErr as Error)?.message ?? 'unknown'}`,
                );
              });
          } else {
            this.logger.warn(
              `Push send failed userId=${sub.userId} subId=${sub.id} status=${statusCode ?? 'unknown'} message=${(err as Error)?.message ?? 'unknown'}`,
            );
          }
        }
      }),
    );

    return { sent, dropped };
  }

  /** Register/refresh a native device token. Upsert by token so the same
   *  device reattaching dedupes in place. A token still registered to
   *  ANOTHER user is refused (409): the token is not a secret, and
   *  rebinding it would let anyone take over that person's device
   *  notifications. The mobile shell unregisters on sign-out, which frees
   *  the token for the next account on the device. */
  async registerDevice(userId: string, input: RegisterPushDeviceInput): Promise<{ ok: true }> {
    const existing = await this.prisma.client.userPushDevice.findUnique({
      where: { token: input.token },
      select: { userId: true },
    });
    if (existing && existing.userId !== userId) throw ownedElsewhere();
    await this.prisma.client.userPushDevice.upsert({
      where: { token: input.token },
      create: {
        userId,
        token: input.token,
        platform: input.platform,
        userAgent: input.userAgent ?? null,
      },
      update: {
        userId,
        platform: input.platform,
        userAgent: input.userAgent ?? null,
        lastSeenAt: new Date(),
      },
    });
    return { ok: true };
  }

  /** Drop a native device token (sign-out / permission revoked). */
  async unregisterDevice(userId: string, token: string): Promise<{ ok: true }> {
    await this.prisma.client.userPushDevice.deleteMany({
      where: { userId, token },
    });
    return { ok: true };
  }

  /** The call push a Do Not Disturb user gets: same target, no sound. */
  private silentCallPayload(payload: DesktopPushPayload): DesktopPushPayload {
    const name = payload.data?.callerName;
    const title =
      typeof name === 'string' && name.trim().length > 0
        ? `Call from ${name.trim()}`.slice(0, 120)
        : payload.title.replace(/^Incoming call from /, 'Call from ');
    return { ...payload, title, body: 'Answer or decline.', silent: true };
  }

  /**
   * Users who turned on Do Not Disturb (server copy of their preferences).
   * Fails open: if the lookup errors, nobody is treated as silenced so a push
   * is never lost to a preferences problem.
   */
  private async doNotDisturbUserIds(userIds: readonly string[]): Promise<Set<string>> {
    try {
      const rows = await this.prisma.client.userPreferences.findMany({
        where: { userId: { in: [...userIds] } },
        select: { userId: true, data: true },
      });
      const out = new Set<string>();
      for (const row of rows) {
        if (parseStoredUserPreferences(row.data).notifications?.doNotDisturb === true) {
          out.add(row.userId);
        }
      }
      return out;
    } catch (err) {
      this.logger.warn(
        `DND lookup failed, sending anyway: ${(err as Error)?.message ?? 'unknown'}`,
      );
      return new Set();
    }
  }

  /**
   * Fan out a notification to the users' native devices via the Expo push API
   * (Expo routes to FCM/APNs). Delivered even when the app is fully closed.
   * Tokens Expo reports as DeviceNotRegistered are pruned, mirroring the
   * Web Push 404/410 contract. All users' devices share one chunked request.
   */
  private async sendNativePush(
    userIds: readonly string[],
    payload: DesktopPushPayload,
  ): Promise<void> {
    const who = userIds.length === 1 ? `userId=${userIds[0]}` : `users=${userIds.length}`;
    // `userIds` are already filtered for Do Not Disturb by the caller (calls
    // for DND users arrive here as the silent variant).
    const targets = [...userIds];
    if (targets.length === 0) return;
    const devices = await this.prisma.client.userPushDevice.findMany({
      where: targets.length === 1 ? { userId: targets[0] } : { userId: { in: targets } },
      select: { id: true, token: true },
    });
    const valid = devices.filter((d) => Expo.isExpoPushToken(d.token));
    if (valid.length === 0) return;

    const silent = payload.silent === true;
    const messages: ExpoPushMessage[] = valid.map((d) => ({
      to: d.token,
      title: payload.title,
      body: payload.body,
      // Silent calls (Do Not Disturb): no sound, the no-sound Android channel,
      // normal iOS interruption (not time sensitive). Answer and Decline come
      // from the `call` category registered by the mobile shell.
      sound: silent ? null : 'default',
      // Calls ring with high priority on a dedicated channel; everything else
      // uses the default channel. Channels are created by the mobile shell.
      priority: payload.type === 'call' ? 'high' : 'default',
      channelId: silent ? 'calls-silent' : payload.type === 'call' ? 'calls' : 'default',
      ...(silent ? { categoryId: 'call', interruptionLevel: 'active' as const } : {}),
      // A call push is worthless once the ring is over: drop it after 30s
      // instead of letting the push service deliver it late.
      ...(payload.type === 'call'
        ? { ttl: 30, expiration: Math.floor(Date.now() / 1000) + 30 }
        : {}),
      data: { url: payload.url, ...(payload.data ?? {}), ...(silent ? { silent: true } : {}) },
    }));

    const chunks = this.expo.chunkPushNotifications(messages);
    let cursor = 0;
    for (const chunk of chunks) {
      try {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk);
        for (let i = 0; i < tickets.length; i += 1) {
          const ticket = tickets[i];
          const device = valid[cursor + i];
          if (!ticket || !device) continue;
          if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
            await this.prisma.client.userPushDevice
              .delete({ where: { id: device.id } })
              .catch((cleanupErr) => {
                this.logger.warn(
                  `Failed to prune dead push token id=${device.id}: ${(cleanupErr as Error)?.message ?? 'unknown'}`,
                );
              });
          }
        }
      } catch (err) {
        this.logger.warn(`Expo push chunk failed ${who}:${(err as Error)?.message ?? 'unknown'}`);
      }
      cursor += chunk.length;
    }
  }
}
