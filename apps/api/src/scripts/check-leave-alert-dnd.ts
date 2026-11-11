/**
 * Leave alert + Do Not Disturb self-checks (no database, no network).
 *  - a user filing their own PENDING leave notifies the users of the SAME
 *    organization who hold `hr.leave.approve`: not the requester, not another
 *    organization, not people without the permission (permissions are
 *    resolved per user, so custom roles and overrides count);
 *  - HR filing for someone else (pre-approved) alerts nobody;
 *  - Do Not Disturb stored in the user's preferences suppresses the phone
 *    push while the bell row is still written;
 *  - Web Push skips Do Not Disturb users as well (subscription lookup and send);
 *  - calls are the exception: a DND user gets a silent "Call from <name>" push
 *    on both legs (no sound, silent channel, silent flag), others ring as before;
 *  - call pushes expire after 30 seconds; a call is "ringing" only for a
 *    non-caller participant while it is unanswered;
 *  - users without Do Not Disturb still get the push, and a failed
 *    preferences lookup fails open.
 *
 * Run: pnpm --filter @botss/api test
 */
import 'reflect-metadata';

import assert from 'node:assert/strict';

import { rawPrisma } from '@botss/database';
import type { Request, Response } from 'express';

import { RequestContextMiddleware, setRequestAuth } from '../common/request-context';
import { ChatService } from '../chat/chat.service';
import { LeavesService } from '../hr/leaves.service';
import { NotificationsPushService } from '../notifications/notifications-push.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { RealtimeEventsService } from '../notifications/realtime-events.service';
import type { PrismaService } from '../prisma/prisma.service';

const ORG_A = 'cmorga000000000000000000a';
const ORG_B = 'cmorgb000000000000000000b';
const EMP = 'cmemp0000000000000000000a';
const HR_A = 'cmhra0000000000000000000a';
const ADMIN_A = 'cmadmina00000000000000000a';
const PEER_A = 'cmpeera0000000000000000a';
const HR_B = 'cmhrb0000000000000000000b';

type Role = 'EMPLOYEE' | 'HR' | 'ADMIN';
const USERS: Record<string, { organizationId: string; systemRole: Role; name: string }> = {
  [EMP]: { organizationId: ORG_A, systemRole: 'EMPLOYEE', name: 'Eve Employee' },
  [HR_A]: { organizationId: ORG_A, systemRole: 'HR', name: 'Hana HR' },
  [ADMIN_A]: { organizationId: ORG_A, systemRole: 'ADMIN', name: 'Adam Admin' },
  [PEER_A]: { organizationId: ORG_A, systemRole: 'EMPLOYEE', name: 'Pat Peer' },
  [HR_B]: { organizationId: ORG_B, systemRole: 'HR', name: 'Hugo Other' },
};

// loadEffectivePermissions reads through rawPrisma; answer from USERS.
const raw = rawPrisma as unknown as {
  user: { findUnique: (a: { where: { id: string } }) => Promise<unknown> };
  userPermissionOverride: { findMany: () => Promise<unknown[]> };
};
raw.user.findUnique = async (a) => {
  const u = USERS[a.where.id];
  return u
    ? { systemRole: u.systemRole, organizationId: u.organizationId, customRole: null }
    : null;
};
raw.userPermissionOverride.findMany = async () => [];

function leavesPrisma(): PrismaService {
  const client = {
    user: {
      findUnique: async (a: { where: { id: string } }) => {
        const u = USERS[a.where.id];
        return u ? { id: a.where.id, organizationId: u.organizationId } : null;
      },
      findMany: async (a: { where: { organizationId: string; id: { not: string } } }) =>
        Object.entries(USERS)
          .filter(([id, u]) => u.organizationId === a.where.organizationId && id !== a.where.id.not)
          .map(([id]) => ({ id })),
    },
    leave: {
      create: async (a: {
        data: { userId: string; startDate: Date; endDate: Date; type: string; status: string };
      }) => ({
        id: 'cmleave00000000000000000a',
        reason: null,
        approvedById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...a.data,
        user: {
          id: a.data.userId,
          name: USERS[a.data.userId]?.name ?? null,
          email: 'x@example.test',
          image: null,
        },
        approvedBy: null,
      }),
    },
  };
  return { client } as unknown as PrismaService;
}

interface Emitted {
  userIds: string[];
  type: string;
  title: string;
  body: string;
  url?: string | null;
}

/** Run `fn` as `userId`, the way AuthGuard leaves a request. */
function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    new RequestContextMiddleware().use({} as Request, {} as Response, () => {
      const u = USERS[userId];
      setRequestAuth({
        userId,
        systemRole: u?.systemRole ?? 'EMPLOYEE',
        organizationId: u?.organizationId ?? null,
        permissions: {
          company: u?.systemRole === 'EMPLOYEE' ? [] : ['hr.leave.approve'],
          workspace: [],
        },
      });
      fn().then(resolve, reject);
    });
  });
}

const tick = () => new Promise((r) => setTimeout(r, 30));

async function fileLeave(actor: string, userId?: string): Promise<Emitted[]> {
  const emitted: Emitted[] = [];
  const notifications = {
    emitMany: async (ids: string[], args: Omit<Emitted, 'userIds'>) => {
      emitted.push({ userIds: ids, ...args });
    },
    emit: async () => undefined,
  } as unknown as NotificationsService;
  const svc = new LeavesService(leavesPrisma(), notifications);
  await asUser(actor, () =>
    svc.create(actor, {
      ...(userId ? { userId } : {}),
      startDate: new Date('2026-11-02T00:00:00Z'),
      endDate: new Date('2026-11-04T00:00:00Z'),
      type: 'ANNUAL',
    } as Parameters<LeavesService['create']>[1]),
  );
  await tick();
  return emitted;
}

async function main(): Promise<void> {
  // Task 1: HR alert.
  const own = await fileLeave(EMP);
  assert.equal(own.length, 1, 'one alert batch for a self-filed request');
  const alert = own[0]!;
  assert.deepEqual([...alert.userIds].sort(), [ADMIN_A, HR_A].sort(), 'same-org approvers only');
  assert.ok(!alert.userIds.includes(EMP), 'requester not notified');
  assert.ok(!alert.userIds.includes(HR_B), 'other organization not notified');
  assert.ok(!alert.userIds.includes(PEER_A), 'user without hr.leave.approve not notified');
  assert.equal(alert.type, 'LEAVE_REQUESTED');
  assert.equal(alert.title, 'New leave request');
  assert.equal(alert.body, 'Eve Employee requested annual leave, 2026-11-02 to 2026-11-04');
  assert.equal(alert.url, '/admin/leaves');

  const onBehalf = await fileLeave(HR_A, EMP);
  assert.equal(onBehalf.length, 0, 'pre-approved leave filed by HR alerts nobody');

  // Task 2: Do Not Disturb on phones.
  const dnd = new Set<string>(['dnd-user']);
  let prefsFail = false;
  const created: string[] = [];
  const lookedUp: string[] = [];
  const webSentTo: string[] = [];
  const webBodies: Record<string, unknown>[] = [];
  const prisma = {
    client: {
      userPreferences: {
        findMany: async (a: { where: { userId: { in: string[] } } }) => {
          if (prefsFail) throw new Error('db down');
          return a.where.userId.in.map((userId) => ({
            userId,
            data: dnd.has(userId) ? { notifications: { doNotDisturb: true } } : {},
          }));
        },
      },
      userNotificationSubscription: {
        findMany: async (a: { where: { userId: { in: string[] } } }) => {
          lookedUp.push(...a.where.userId.in);
          return a.where.userId.in.map((userId) => ({
            id: `sub-${userId}`,
            userId,
            endpoint: `https://fcm.googleapis.com/fcm/send/${userId}`,
            auth: 'auth',
            p256dh: 'p256dh',
          }));
        },
        delete: async () => undefined,
      },
      userPushDevice: {
        findMany: async (a: { where: { userId: string | { in: string[] } } }) => {
          const ids = typeof a.where.userId === 'string' ? [a.where.userId] : a.where.userId.in;
          return ids.map((id) => ({ id: `dev-${id}`, token: `ExponentPushToken[${id}]` }));
        },
        delete: async () => undefined,
      },
      notification: {
        create: async (a: { data: { userId: string } }) => {
          created.push(a.data.userId);
          return {
            id: `n-${a.data.userId}`,
            type: 'LEAVE_REQUESTED',
            title: 't',
            body: 'b',
            url: '/',
            entityType: null,
            entityId: null,
            createdAt: new Date(),
            readAt: null,
            ...a.data,
          };
        },
      },
    },
  } as unknown as PrismaService;
  const realtime = {
    publishPush: () => undefined,
    publishNotification: () => undefined,
  } as unknown as RealtimeEventsService;
  const push = new NotificationsPushService(prisma, realtime);
  const sentTo: {
    to: string;
    channelId?: string;
    sound?: unknown;
    title?: string;
    categoryId?: string;
    ttl?: number;
    expiration?: number;
    data?: Record<string, unknown>;
  }[] = [];
  (push as unknown as { expo: unknown }).expo = {
    chunkPushNotifications: (m: unknown[]) => [m],
    sendPushNotificationsAsync: async (chunk: typeof sentTo) => {
      sentTo.push(...chunk);
      return chunk.map(() => ({ status: 'ok' }));
    },
  };
  const service = new NotificationsService(prisma, push, realtime);
  const reset = () => {
    lookedUp.length = 0;
    webSentTo.length = 0;
    webBodies.length = 0;
    sentTo.length = 0;
    created.length = 0;
  };

  await service.emit({ userId: 'dnd-user', type: 'LEAVE_REQUESTED', title: 'T', body: 'B' });
  await tick();
  assert.deepEqual(created, ['dnd-user'], 'bell row still written under Do Not Disturb');
  assert.equal(sentTo.length, 0, 'no phone push under Do Not Disturb');

  reset();
  await service.emit({ userId: 'plain-user', type: 'LEAVE_REQUESTED', title: 'T', body: 'B' });
  await tick();
  assert.equal(sentTo.length, 1, 'phone push without Do Not Disturb');

  reset();
  await push.sendDesktopNotificationToUsers(['dnd-user', 'plain-user'], {
    title: 'Chat',
    body: 'hi',
    type: 'message',
    url: '/chat',
  });
  await tick();
  assert.deepEqual(
    sentTo.map((s) => s.to),
    ['ExponentPushToken[plain-user]'],
    'fan-out skips only the DND user',
  );

  // Web Push: enable the leg and stub the sender (no network).
  (push as unknown as { enabled: boolean }).enabled = true;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- need the live CJS module to stub
  (require('web-push') as { sendNotification: unknown }).sendNotification = async (
    sub: {
      endpoint: string;
    },
    body: string,
  ) => {
    webSentTo.push(sub.endpoint);
    webBodies.push(JSON.parse(body) as Record<string, unknown>);
    return {};
  };
  reset();
  await push.sendDesktopNotificationToUsers(['dnd-user', 'plain-user'], {
    title: 'Chat',
    body: 'hi',
    type: 'message',
    url: '/chat',
  });
  await tick();
  assert.deepEqual(lookedUp, ['plain-user'], 'Web Push lookup excludes the DND user');
  assert.deepEqual(
    webSentTo,
    ['https://fcm.googleapis.com/fcm/send/plain-user'],
    'Web Push skips the DND user',
  );
  const callPayload = {
    title: 'Incoming call from Eve',
    body: 'Tap to answer.',
    type: 'call' as const,
    url: '/chat/r?call=c',
    data: { callerName: 'Eve' },
  };
  reset();
  await push.sendDesktopNotification('dnd-user', callPayload);
  await tick();
  assert.equal(webSentTo.length, 1, 'Web Push still delivers calls to DND users');
  assert.equal(webBodies[0]?.silent, true, 'Web Push call for DND user is flagged silent');
  assert.equal(webBodies[0]?.title, 'Call from Eve', 'silent call text');
  reset();
  await push.sendDesktopNotification('plain-user', callPayload);
  await tick();
  assert.equal(webBodies[0]?.silent, undefined, 'Web Push call for a normal user is not silent');
  assert.equal(webBodies[0]?.title, 'Incoming call from Eve', 'normal call text unchanged');
  reset();
  await push.sendDesktopNotification('dnd-user', {
    title: 'M',
    body: 'b',
    type: 'message',
    url: '/chat',
  });
  await tick();
  assert.equal(webSentTo.length, 0, 'Web Push non-call stays skipped for DND users');
  (push as unknown as { enabled: boolean }).enabled = false;

  reset();
  await push.sendDesktopNotification('dnd-user', callPayload);
  await tick();
  assert.equal(sentTo.length, 1, 'phone still gets the call under Do Not Disturb');
  assert.equal(sentTo[0]?.title, 'Call from Eve', 'silent call text');
  assert.equal(sentTo[0]?.sound, null, 'silent call has no sound');
  assert.equal(sentTo[0]?.channelId, 'calls-silent', 'silent call uses the silent channel');
  assert.equal(sentTo[0]?.categoryId, 'call', 'silent call keeps Answer and Decline');
  assert.equal(sentTo[0]?.data?.silent, true, 'silent flag reaches the app');
  assert.equal(sentTo[0]?.ttl, 30, 'call push expires after 30 seconds');
  assert.ok(
    typeof sentTo[0]?.expiration === 'number' && sentTo[0].expiration > Date.now() / 1000,
    'call push carries an expiration time',
  );

  reset();
  await push.sendDesktopNotification('dnd-user', {
    title: 'M',
    body: 'b',
    type: 'message',
    url: '/chat',
  });
  await tick();
  assert.equal(sentTo.length, 0, 'phone non-call stays skipped under Do Not Disturb');

  reset();
  await push.sendDesktopNotificationToUsers(['dnd-user', 'plain-user'], callPayload);
  await tick();
  assert.deepEqual(
    sentTo.map((m) => [m.to, m.channelId, m.sound]).sort(),
    [
      ['ExponentPushToken[dnd-user]', 'calls-silent', null],
      ['ExponentPushToken[plain-user]', 'calls', 'default'],
    ],
    'call fan-out: silent for DND, ringing for the rest',
  );

  reset();
  await push.sendDesktopNotification('plain-user', callPayload);
  await tick();
  assert.equal(sentTo[0]?.channelId, 'calls', 'calls still ring for users without Do Not Disturb');

  reset();
  await push.sendDesktopNotification('plain-user', {
    title: 'M',
    body: 'b',
    type: 'message',
    url: '/chat',
  });
  await tick();
  assert.equal(sentTo[0]?.ttl, undefined, 'only call pushes expire early');

  // Is this call still ringing for me? Only a non-caller participant of a
  // RINGING call sees it; everyone else gets "not ringing".
  const chat = Object.create(ChatService.prototype) as unknown as {
    activeCalls: Map<string, unknown>;
    getIncomingCall: ChatService['getIncomingCall'];
  };
  const ringing = {
    id: 'call1',
    callerId: 'caller',
    roomId: 'room1',
    status: 'RINGING',
    participantIds: new Set(['caller', 'callee']),
  };
  chat.activeCalls = new Map<string, unknown>([['call1', ringing]]);
  assert.deepEqual(chat.getIncomingCall('call1', 'callee'), {
    ringing: true,
    call: { callId: 'call1', roomId: 'room1', callerId: 'caller' },
  });
  assert.equal(chat.getIncomingCall('call1', 'caller').ringing, false, 'the caller is not ringing');
  assert.equal(
    chat.getIncomingCall('call1', 'stranger').ringing,
    false,
    'a non-participant sees nothing',
  );
  assert.equal(
    chat.getIncomingCall('gone', 'callee').ringing,
    false,
    'an ended call is not ringing',
  );
  ringing.status = 'ONGOING';
  assert.equal(
    chat.getIncomingCall('call1', 'callee').ringing,
    false,
    'an answered call is not ringing',
  );

  reset();
  prefsFail = true;
  await push.sendDesktopNotification('dnd-user', {
    title: 'T',
    body: 'B',
    type: 'generic',
    url: '/',
  });
  await tick();
  assert.equal(sentTo.length, 1, 'a failed preferences lookup fails open');

  console.log('check-leave-alert-dnd: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
