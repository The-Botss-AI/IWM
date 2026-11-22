/**
 * Chat invite link self-checks (no database).
 *
 * ChatService runs against an in-memory fake Prisma that evaluates the
 * filters the invite gate depends on (workspace membership pinned to the
 * caller's organization, soft deletes), so a dropped filter lets a caller
 * through and the check fails. Covered:
 *  - an owner of another organization and the platform SUPER_ADMIN get the
 *    same 404 as an unknown code for org A's workspace-room and group
 *    invites, on preview and on accept, and nothing about the room leaks;
 *  - a member of the room's workspace (or of the inviter's org, for a group)
 *    still gets the preview, and accept still answers them;
 *  - a member moved to another org keeps no access through a stale membership.
 *
 * Run: pnpm --filter @botss/api test
 */
import 'reflect-metadata';

import assert from 'node:assert/strict';

import { HttpException, NotFoundException } from '@nestjs/common';

import { ChatService } from '../chat/chat.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';

type Row = Record<string, unknown>;

const ORG_A = 'cmorga000000000000000000a';
const ORG_B = 'cmorgb000000000000000000b';
const ORG_ROOT = 'cmorgroot0000000000000000';
const WS_A = 'cmwsa0000000000000000000a';
const WS_A2 = 'cmwsa2000000000000000000a';
const WS_B = 'cmwsb0000000000000000000b';

const INVITER = 'cminviter0000000000000000'; // org A admin, member of WS_A
const MEMBER_A = 'cmmembera0000000000000000'; // org A, member of WS_A
const OTHER_WS_A = 'cmotherwsa000000000000000'; // org A, only in WS_A2
const OWNER_B = 'cmownerb00000000000000000'; // org B owner
const SUPER = 'cmsuper000000000000000000'; // platform SUPER_ADMIN, root org
const MOVED = 'cmmoved000000000000000000'; // now org B, stale WS_A membership
const JOINED = 'cmjoined00000000000000000'; // org A, already in the room

const ROOM_WS = 'cmroomws00000000000000000';
const ROOM_GROUP = 'cmroomgrp0000000000000000';
const CODE_WS = 'wsinvitecode';
const CODE_GROUP = 'groupinvitecode';

const users: Row[] = [
  { id: INVITER, organizationId: ORG_A, systemRole: 'MEMBER' },
  { id: MEMBER_A, organizationId: ORG_A, systemRole: 'MEMBER' },
  { id: OTHER_WS_A, organizationId: ORG_A, systemRole: 'MEMBER' },
  { id: OWNER_B, organizationId: ORG_B, systemRole: 'ADMIN' },
  { id: SUPER, organizationId: ORG_ROOT, systemRole: 'SUPER_ADMIN' },
  { id: MOVED, organizationId: ORG_B, systemRole: 'MEMBER' },
  { id: JOINED, organizationId: ORG_A, systemRole: 'MEMBER' },
].map((u) => ({
  ...u,
  name: u['id'],
  email: `${u['id'] as string}@example.test`,
  image: null,
  deletedAt: null,
}));
const workspaces: Row[] = [
  { id: WS_A, organizationId: ORG_A },
  { id: WS_A2, organizationId: ORG_A },
  { id: WS_B, organizationId: ORG_B },
];
const memberships: Row[] = [
  { id: 'm1', userId: INVITER, workspaceId: WS_A, role: 'ADMIN' },
  { id: 'm2', userId: MEMBER_A, workspaceId: WS_A, role: 'MEMBER' },
  { id: 'm3', userId: OTHER_WS_A, workspaceId: WS_A2, role: 'MEMBER' },
  { id: 'm4', userId: OWNER_B, workspaceId: WS_B, role: 'OWNER' },
  { id: 'm5', userId: MOVED, workspaceId: WS_A, role: 'MEMBER' }, // stale
  { id: 'm6', userId: JOINED, workspaceId: WS_A, role: 'MEMBER' },
];
const rooms: Row[] = [
  { id: ROOM_WS, name: 'Secret channel', type: 'CHANNEL', workspaceId: WS_A, deletedAt: null },
  { id: ROOM_GROUP, name: 'Secret group', type: 'GROUP', workspaceId: null, deletedAt: null },
];
const participants: Row[] = [
  { id: 'p1', roomId: ROOM_WS, userId: INVITER },
  { id: 'p2', roomId: ROOM_WS, userId: JOINED },
  { id: 'p3', roomId: ROOM_GROUP, userId: INVITER },
  { id: 'p4', roomId: ROOM_GROUP, userId: JOINED },
];
const invites: Row[] = [
  { id: 'i1', roomId: ROOM_WS, code: CODE_WS, createdById: INVITER },
  { id: 'i2', roomId: ROOM_GROUP, code: CODE_GROUP, createdById: INVITER },
].map((i) => ({
  ...i,
  maxUses: null,
  usedCount: 0,
  expiresAt: null,
  deletedAt: null,
  createdAt: new Date(),
}));

const writes: string[] = [];
const pick = (row: Row, select: Record<string, unknown> | undefined): Row =>
  select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : row;
const userById = (id: unknown) => users.find((u) => u['id'] === id && !u['deletedAt']) ?? null;

const client = {
  user: {
    findUnique: async ({ where, select }: { where: Row; select?: Row }) => {
      const u = userById(where['id']);
      return u ? pick(u, select) : null;
    },
    findFirst: async ({ where, select }: { where: Row; select?: Row }) => {
      const u = userById(where['id']);
      if (!u || ('deletedAt' in where && u['deletedAt'] !== where['deletedAt'])) return null;
      return pick(u, select);
    },
  },
  workspaceMembership: {
    findFirst: async ({ where, select }: { where: Row; select?: Row }) => {
      const wsOrg = (where['workspace'] as Row | undefined)?.['organizationId'];
      assert.ok(wsOrg, 'membership lookup is pinned to an organization');
      const m = memberships.find(
        (r) =>
          r['userId'] === where['userId'] &&
          r['workspaceId'] === where['workspaceId'] &&
          workspaces.find((w) => w['id'] === r['workspaceId'])?.['organizationId'] === wsOrg,
      );
      return m ? pick(m, select) : null;
    },
  },
  chatRoomInvite: {
    findFirst: async ({ where }: { where: Row }) => {
      const inv = invites.find((i) => i['code'] === where['code'] && i['deletedAt'] === null);
      if (!inv) return null;
      const room = rooms.find((r) => r['id'] === inv['roomId'])!;
      const creator = userById(inv['createdById'])!;
      return {
        ...inv,
        room: pick(room, { id: 1, name: 1, type: 1, workspaceId: 1, deletedAt: 1 }),
        createdBy: pick(creator, { id: 1, name: 1, email: 1, image: 1, organizationId: 1 }),
      };
    },
    updateMany: async () => {
      writes.push('chatRoomInvite.updateMany');
      return { count: 1 };
    },
  },
  chatRoomParticipant: {
    count: async ({ where }: { where: Row }) =>
      participants.filter((p) => p['roomId'] === where['roomId']).length,
    findUnique: async ({ where }: { where: { roomId_userId: Row } }) => {
      const k = where.roomId_userId;
      const p = participants.find(
        (r) => r['roomId'] === k['roomId'] && r['userId'] === k['userId'],
      );
      return p ? { id: p['id'] } : null;
    },
    create: async () => {
      writes.push('chatRoomParticipant.create');
      return {};
    },
  },
  $transaction: async () => {
    writes.push('$transaction');
    throw new Error('refused callers must never reach the join transaction');
  },
};

const chat = new ChatService(
  { client } as unknown as PrismaService,
  {} as unknown as NotificationsService,
);

async function errorOf(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

/** The exact problem body an unknown code produces, for comparison. */
async function unknownCodeBody(userId: string): Promise<unknown> {
  const err = await errorOf(chat.previewInvite(userId, 'no-such-code'));
  assert.ok(err instanceof NotFoundException, 'unknown code is a 404');
  return err.getResponse();
}

let checks = 0;

async function main(): Promise<void> {
  const unknown = await unknownCodeBody(OWNER_B);

  // Refused callers: same 404 as an unknown code, on preview and accept.
  const refused: Array<[string, string, string]> = [
    [OWNER_B, CODE_WS, 'org B owner, workspace room'],
    [SUPER, CODE_WS, 'SUPER_ADMIN, workspace room'],
    [OWNER_B, CODE_GROUP, 'org B owner, group'],
    [SUPER, CODE_GROUP, 'SUPER_ADMIN, group'],
    [OTHER_WS_A, CODE_WS, 'org A user outside the workspace'],
    [MOVED, CODE_WS, 'user moved to org B (stale membership)'],
    [MOVED, CODE_GROUP, 'user moved to org B, group'],
  ];
  for (const [userId, code, label] of refused) {
    for (const [op, call] of [
      ['preview', () => chat.previewInvite(userId, code)],
      ['accept', () => chat.acceptInvite(userId, code)],
    ] as const) {
      const err = await errorOf(call());
      checks++;
      assert.ok(err instanceof HttpException, `${label}: ${op} refused`);
      assert.equal(err.getStatus(), 404, `${label}: ${op} answers 404`);
      assert.deepEqual(err.getResponse(), unknown, `${label}: ${op} body matches an unknown code`);
      const text = JSON.stringify(err.getResponse());
      for (const secret of [ROOM_WS, ROOM_GROUP, INVITER, 'Secret']) {
        assert.ok(!text.includes(secret), `${label}: ${op} leaks nothing`);
      }
    }
  }
  assert.deepEqual(writes, [], 'refused callers write nothing');

  // Allowed callers still get the preview.
  const wsPreview = await chat.previewInvite(MEMBER_A, CODE_WS);
  checks++;
  assert.equal(wsPreview.room.id, ROOM_WS);
  assert.equal(wsPreview.room.participantCount, 2);
  assert.equal(wsPreview.invitedBy.id, INVITER);
  assert.equal(wsPreview.alreadyJoined, false);
  assert.ok(!('organizationId' in wsPreview.invitedBy), 'preview does not echo the inviter org');

  const groupPreview = await chat.previewInvite(OTHER_WS_A, CODE_GROUP);
  checks++;
  assert.equal(groupPreview.room.id, ROOM_GROUP, 'same-org user previews a group invite');

  const joinedPreview = await chat.previewInvite(JOINED, CODE_WS);
  checks++;
  assert.equal(joinedPreview.alreadyJoined, true);

  // Accept still answers an allowed caller (already-joined path, no writes).
  for (const code of [CODE_WS, CODE_GROUP]) {
    const res = await chat.acceptInvite(JOINED, code);
    checks++;
    assert.equal(res.alreadyJoined, true, `allowed accept answers for ${code}`);
  }
  assert.deepEqual(writes, [], 'already-joined accept writes nothing');
}

main().then(
  () => console.log(`Chat invite checks: all ${checks} passed.`),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
