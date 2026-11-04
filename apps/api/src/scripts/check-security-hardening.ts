/**
 * Security hardening checks (no database, Redis or network):
 *
 *  1. Chat socket: cross-site handshakes are refused by origin.
 *  2. Chat content: the server-reserved card / call / system prefixes are
 *     refused in every schema a person can type into, and by the service.
 *  3. Invitation and portal link tokens are stored hashed and a stored hash
 *     can never be replayed as a token.
 *  4. Invitations: the set-first-password link is shown only to an inviter
 *     who could have created the account; the base-role check runs whenever
 *     the base role changes, custom role or not.
 *  5. HR cannot hand out workspace OWNER / ADMIN; chat invites stay in one org.
 *  6. CASL: workspace roles no longer cover other people's attendance and
 *     leave; project rights are checked per project row.
 *  7. PermissionsGuard denies a route that declares nothing.
 *  8. AES-GCM refuses a truncated auth tag.
 *  9. Rate-limit counters set their TTL atomically and refuse (503) instead
 *     of hanging while Redis is down.
 * 10. Soft delete: findUnique with a narrow `select` no longer returns
 *     deleted rows.
 * 11. Services: coworker profiles only, public signup answers the same for a
 *     known email, platform mail never reads a user's mailbox.
 * 12. Passwords: a malformed stored hash never accepts any password.
 * 13. A base OWNER / ADMIN role under a narrower custom role is not an admin.
 * 14. The mail relay only carries vouched sender addresses.
 * 15. Task parents cannot form a cycle.
 *
 * Run: pnpm --filter @botss/api test
 */
import 'reflect-metadata';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  BadRequestException,
  type ExecutionContext,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { defineAbilityFor, hashPassword, presetPermissions, verifyPassword } from '@botss/auth';
import { withSoftDelete } from '@botss/database';
import {
  createChatRequestSchema,
  editChatMessageBodySchema,
  isReservedChatContent,
  sendChatMessageBodySchema,
  sendChatMessageSchema,
  type SystemRole,
  type WorkspaceRole,
} from '@botss/shared-types';

import { assertMayGrantWorkspaceRole } from '../admin/admin-user-policy';
import { ChatService } from '../chat/chat.service';
import { inviteKeepsOrganization } from '../chat/cross-org-block';
import { handOverSoleAdminRooms } from '../chat/room-admins';
import { isAllowedSocketOrigin, socketOriginGate } from '../chat/socket-origin';
import {
  hashLinkToken,
  linkTokenLookupValues,
  newLinkToken,
  storedLinkTokenValue,
} from '../common/access-code';
import { decrypt, encrypt } from '../common/crypto/aes-gcm.util';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { REQUIRED_ABILITY_KEY } from '../common/decorators/required-ability.decorator';
import { SKIP_PERMISSIONS_KEY } from '../common/decorators/skip-permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { adminCheckedRole } from '../common/permissions/effective-permissions';
import { abilityRow, assertCanUpdateProject } from '../common/permissions/request-ability';
import { projectAccessWhere } from '../common/project-access';
import { DocumentsService } from '../documents/documents.service';
import { LeadsService } from '../leads/leads.service';
import { relayMayCarry } from '../mail/mail-send.service';
import { OrganizationsService } from '../organizations/organizations.service';
import type { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { mayReadSourceDocument } from '../signatures/signature-visibility';
import { TasksService } from '../tasks/tasks.service';
import { UsersService } from '../users/users.service';
import { inviteLinkVisible, presetGrantCheckNeeded } from '../workspaces/invite-link-policy';

const WS = 'cmws0000000000000000000ws';
const ME = 'cmme0000000000000000000me';
const OTHER = 'cmother0000000000000other';
const PROJECT_A = 'cmprojecta00000000000000a';
const PROJECT_B = 'cmprojectb00000000000000b';
const ORG = 'cmorg000000000000000000org';

/** A Prisma stand-in that fails the test the moment anything touches it. */
const untouchablePrisma = {
  client: new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(`database touched: ${String(prop)}`);
      },
    },
  ),
} as unknown as PrismaService;

function abilityFor(
  systemRole: SystemRole,
  workspaceRole: WorkspaceRole,
  projectMemberships: { projectId: string; role: 'PROJECT_LEAD' | 'VIEWER' }[] = [],
) {
  return defineAbilityFor({
    userId: ME,
    systemRole,
    permissions: presetPermissions({ systemRole, workspaceMemberships: [{ role: workspaceRole }] }),
    workspaceMemberships: [{ workspaceId: WS, role: workspaceRole }],
    projectMemberships: projectMemberships.map((m) => ({
      projectId: m.projectId,
      workspaceId: WS,
      role: m.role,
      abilities: null,
    })),
  });
}

async function main(): Promise<void> {
  // 1. Socket origin ---------------------------------------------------------
  {
    const allowed = new Set(['https://app.example.com']);
    assert.ok(isAllowedSocketOrigin('https://app.example.com', allowed), 'app origin allowed');
    assert.ok(isAllowedSocketOrigin(undefined, allowed), 'no Origin (native client) allowed');
    for (const bad of ['https://evil.example', 'null', 'https://app.example.com.evil.example']) {
      assert.ok(!isAllowedSocketOrigin(bad, allowed), `origin ${bad} refused`);
    }
    const gate = socketOriginGate(allowed);
    const verdict = (origin: string | undefined) =>
      new Promise<[string | null | undefined, boolean]>((done) =>
        gate({ headers: origin ? { origin } : {} } as never, (err, ok) => done([err, ok])),
      );
    assert.deepEqual(await verdict('https://app.example.com'), [null, true]);
    const [err, ok] = await verdict('https://evil.example');
    assert.equal(ok, false, 'cross-site handshake refused');
    assert.ok(err, 'refusal carries a reason');
  }

  // 2. Reserved chat content -------------------------------------------------
  {
    const forged = [
      '__share__:task:x:{"title":"Invoice","link":"https://evil.example"}',
      '__system__:added:{"actor":"Admin","targets":"Mallory"}',
      '__call__:MISSED:0',
    ];
    for (const content of forged) {
      assert.ok(isReservedChatContent(content), `reserved: ${content}`);
      assert.ok(
        !sendChatMessageSchema.safeParse({ roomId: WS, content }).success,
        'socket send refuses it',
      );
      assert.ok(!sendChatMessageBodySchema.safeParse({ content }).success, 'REST send refuses it');
      assert.ok(
        !editChatMessageBodySchema.safeParse({ content: `  ${content}` }).success,
        'edit refuses it (after trim)',
      );
      assert.ok(
        !createChatRequestSchema.safeParse({ email: 'a@example.com', message: content }).success,
        'chat request refuses it',
      );
    }
    for (const fine of ['hello', 'about __share__: links', '__share__', ' __call__:x']) {
      assert.ok(!isReservedChatContent(fine), `not reserved: ${fine}`);
    }
    assert.ok(sendChatMessageSchema.safeParse({ roomId: WS, content: 'hello' }).success);

    // Service backstop: refused before any database access.
    const chat = new ChatService(untouchablePrisma, {} as never);
    await assert.rejects(
      chat.sendMessage(ME, { roomId: WS, content: forged[0]! } as never),
      BadRequestException,
    );
    await assert.rejects(chat.editMessage(ME, 'm1', forged[1]!), BadRequestException);
  }

  // 3. Link tokens stored hashed ---------------------------------------------
  {
    const token = newLinkToken();
    const stored = storedLinkTokenValue(token.raw);
    assert.equal(stored, `sha256:${hashLinkToken(token.raw)}`);
    assert.notEqual(stored, token.raw);
    assert.deepEqual(linkTokenLookupValues(token.raw), [stored, token.raw]);
    // A database reader holds `stored`; neither it nor its hex part opens the row.
    assert.equal(linkTokenLookupValues(stored), null, 'stored value is not a token');
    const hexOnly = linkTokenLookupValues(hashLinkToken(token.raw)) ?? [];
    assert.ok(!hexOnly.includes(stored), 'the bare hash never matches the stored value');
    assert.ok(linkTokenLookupValues('a'.repeat(64)), 'legacy 64-hex links still resolve');
    for (const bad of [
      '',
      'short',
      'has space aaaaaaaaaaaaaaaaaaaa',
      '../../etc/passwdxxxxxxxxx',
    ]) {
      assert.equal(linkTokenLookupValues(bad), null, `refused: ${bad}`);
    }
  }

  // 4. Invite link visibility and the base-role check ------------------------
  {
    const base = { workspaceId: WS, inviteeWorkspaceIds: [WS], inviteeCompanyPermissions: [] };
    assert.ok(inviteLinkVisible({ ...base, actorManagesUsers: false }), 'plain new member');
    assert.ok(
      inviteLinkVisible({
        ...base,
        actorManagesUsers: true,
        inviteeWorkspaceIds: [WS, 'other-ws'],
        inviteeCompanyPermissions: ['users.manage'],
      }),
      'an org admin always sees it',
    );
    assert.ok(
      !inviteLinkVisible({ ...base, actorManagesUsers: false, inviteeWorkspaceIds: [WS, 'ws-2'] }),
      'a person pending elsewhere: email only',
    );
    assert.ok(
      !inviteLinkVisible({
        ...base,
        actorManagesUsers: false,
        inviteeCompanyPermissions: ['hr.attendance'],
      }),
      'a pending HR / admin account: email only',
    );

    assert.ok(
      presetGrantCheckNeeded({ customRoleId: undefined, nextRole: 'ADMIN', currentRole: 'MEMBER' }),
    );
    assert.ok(
      presetGrantCheckNeeded({ customRoleId: null, nextRole: 'MEMBER', currentRole: 'MEMBER' }),
    );
    assert.ok(
      presetGrantCheckNeeded({ customRoleId: 'role-1', nextRole: 'ADMIN', currentRole: 'MEMBER' }),
      'a custom role no longer skips the check when the base role changes',
    );
    assert.ok(
      !presetGrantCheckNeeded({
        customRoleId: 'role-1',
        nextRole: 'MEMBER',
        currentRole: 'MEMBER',
      }),
      'keeping the base role with a custom role grants nothing new',
    );
  }

  // 5. HR workspace roles, chat invites --------------------------------------
  {
    for (const role of ['OWNER', 'ADMIN']) {
      assert.throws(() => assertMayGrantWorkspaceRole(role, false), ForbiddenException);
      assert.doesNotThrow(() => assertMayGrantWorkspaceRole(role, true));
    }
    for (const role of ['MEMBER', 'VIEWER', undefined, null]) {
      assert.doesNotThrow(() => assertMayGrantWorkspaceRole(role, false));
    }

    const same = { joinerOrgId: ORG, creatorOrgId: ORG, participantOrgIds: [ORG, ORG] };
    assert.ok(inviteKeepsOrganization(same));
    assert.ok(!inviteKeepsOrganization({ ...same, joinerOrgId: 'other-org' }), 'outsider refused');
    assert.ok(!inviteKeepsOrganization({ ...same, joinerOrgId: null }), 'org-less refused');
    assert.ok(!inviteKeepsOrganization({ ...same, creatorOrgId: 'other-org' }));
    assert.ok(!inviteKeepsOrganization({ ...same, participantOrgIds: [ORG, null] }));
  }

  // 6. CASL ------------------------------------------------------------------
  {
    const owner = abilityFor('EMPLOYEE', 'OWNER');
    const member = abilityFor('EMPLOYEE', 'MEMBER');
    const hr = abilityFor('HR', 'MEMBER');
    const admin = abilityFor('ADMIN', 'MEMBER');
    const theirs = abilityRow('Attendance', { userId: OTHER });
    const mine = abilityRow('Attendance', { userId: ME });
    for (const [name, a] of [
      ['workspace owner', owner],
      ['workspace member', member],
    ] as const) {
      assert.ok(!a.can('read', theirs), `${name} cannot read others' attendance`);
      assert.ok(!a.can('manage', theirs), `${name} cannot manage others' attendance`);
      assert.ok(!a.can('read', abilityRow('Leave', { userId: OTHER })), `${name}: others' leave`);
      assert.ok(a.can('read', mine), `${name} reads own attendance`);
      assert.ok(a.can('create', abilityRow('Leave', { userId: ME })), `${name} requests leave`);
    }
    assert.ok(
      owner.can('manage', abilityRow('Task', { projectId: PROJECT_A })),
      'owner keeps tasks',
    );
    for (const [name, a] of [
      ['HR', hr],
      ['ADMIN', admin],
    ] as const) {
      assert.ok(a.can('manage', theirs), `${name} manages attendance`);
      assert.ok(a.can('manage', abilityRow('Leave', { userId: OTHER })), `${name} manages leave`);
    }

    // A lead of project A (workspace VIEWER) may change A only.
    const lead = abilityFor('EMPLOYEE', 'VIEWER', [{ projectId: PROJECT_A, role: 'PROJECT_LEAD' }]);
    assert.ok(lead.can('update', 'Project'), 'the bare-subject guard lets the lead through');
    assert.doesNotThrow(() => assertCanUpdateProject(lead, PROJECT_A));
    assert.throws(() => assertCanUpdateProject(lead, PROJECT_B), ForbiddenException);
    assert.doesNotThrow(() => assertCanUpdateProject(member, PROJECT_B), 'projects.update holder');
  }

  // 7. PermissionsGuard denies an undeclared route ----------------------------
  {
    const guardWith = (meta: Record<string, unknown>) =>
      new PermissionsGuard({ getAllAndOverride: (key: string) => meta[key] } as never);
    const ctx = {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as ExecutionContext;
    assert.throws(() => guardWith({}).canActivate(ctx), ForbiddenException, 'undeclared: 403');
    assert.equal(guardWith({ [SKIP_PERMISSIONS_KEY]: true }).canActivate(ctx), true);
    assert.equal(guardWith({ [IS_PUBLIC_KEY]: true }).canActivate(ctx), true);
    assert.throws(
      () =>
        guardWith({ [REQUIRED_ABILITY_KEY]: { action: 'read', subject: 'Task' } }).canActivate(ctx),
      ForbiddenException,
      'a declared ability with no user is still refused',
    );
  }

  // 8. AES-GCM auth tag length -------------------------------------------------
  {
    process.env.MAIL_ENCRYPTION_KEY = 'ab'.repeat(32);
    const token = encrypt('mailbox password');
    assert.equal(decrypt(token), 'mailbox password');
    const [iv, body, tag] = token.split(':');
    assert.throws(() => decrypt(`${iv}:${body}:${tag!.slice(0, 8)}`), /auth tag length/);
  }

  // 9. Rate-limit window counter ---------------------------------------------
  {
    // A tiny Redis: INCR and EXPIRE (with NX) as Redis 7 runs them, applied
    // in order when the MULTI executes. ttl -1 means no expiry.
    const store = new Map<string, { value: number; ttl: number }>();
    const client = {
      status: 'ready',
      multi: () => {
        const ops: Array<() => unknown> = [];
        const chain = {
          incr: (key: string) => {
            ops.push(() => {
              const row = store.get(key) ?? { value: 0, ttl: -1 };
              row.value += 1;
              store.set(key, row);
              return row.value;
            });
            return chain;
          },
          expire: (key: string, seconds: number, flag?: string) => {
            ops.push(() => {
              const row = store.get(key);
              if (!row || (flag === 'NX' && row.ttl !== -1)) return 0;
              row.ttl = seconds;
              return 1;
            });
            return chain;
          },
          exec: async () => ops.map((op) => [null, op()]),
        };
        return chain;
      },
    };
    const redis = new RedisService({ get: () => undefined } as never);
    (redis as unknown as { _client: unknown })._client = client;
    assert.equal(await redis.hitWindow('rate:k', 60), 1);
    assert.deepEqual(store.get('rate:k'), { value: 1, ttl: 60 }, 'a new counter gets its window');
    store.get('rate:k')!.ttl = 17;
    assert.equal(await redis.hitWindow('rate:k', 60), 2);
    assert.equal(store.get('rate:k')!.ttl, 17, 'a running window is not extended');
    // A counter the old INCR-then-EXPIRE left without a TTL gets its window.
    store.set('rate:old', { value: 99, ttl: -1 });
    assert.equal(await redis.hitWindow('rate:old', 60), 100);
    assert.equal(store.get('rate:old')!.ttl, 60, 'a counter stuck without a TTL heals');
    (redis as unknown as { _client: unknown })._client = { status: 'reconnecting' };
    await assert.rejects(redis.hitWindow('rate:k', 60), ServiceUnavailableException);
  }

  // 10. Soft delete with a narrow select ---------------------------------------
  {
    type Hook = (a: {
      model: string;
      args: Record<string, unknown>;
      query: (args: unknown) => Promise<unknown>;
    }) => Promise<unknown>;
    const ext = withSoftDelete({ $extends: (d: unknown) => d } as never) as unknown as {
      query: { $allModels: Record<string, Hook> };
    };
    const { findUnique, findUniqueOrThrow } = ext.query.$allModels;
    let seen: Record<string, unknown> = {};
    const deletedRow = async (a: unknown) => (
      (seen = a as Record<string, unknown>),
      { id: 'u1', deletedAt: new Date() }
    );
    const liveRow = async () => ({ id: 'u1', deletedAt: null });
    const args = { where: { id: 'u1' }, select: { id: true } };
    assert.equal(
      await findUnique!({ model: 'User', args, query: deletedRow }),
      null,
      'deleted row hidden',
    );
    assert.equal(
      (seen['select'] as Record<string, unknown>)['deletedAt'],
      true,
      'checked column added',
    );
    assert.deepEqual(
      await findUnique!({ model: 'User', args, query: liveRow }),
      { id: 'u1' },
      'live row returned without the added column',
    );
    await assert.rejects(findUniqueOrThrow!({ model: 'User', args, query: deletedRow }));
    assert.deepEqual(
      await findUnique!({
        model: 'User',
        args: { where: { id: 'u1' }, select: { id: true, deletedAt: true } },
        query: liveRow,
      }),
      { id: 'u1', deletedAt: null },
      'a requested deletedAt stays',
    );
  }

  // 11. Services ---------------------------------------------------------------
  {
    let listed: Record<string, unknown> = {};
    const users = new UsersService({
      client: {
        user: {
          findMany: async (a: Record<string, unknown>) => ((listed = a), []),
          count: async () => 0,
        },
      },
    } as unknown as PrismaService);
    await users.listInWorkspace(WS, { page: 1, pageSize: 20 } as never);
    const select = listed['select'] as Record<string, unknown>;
    assert.equal(select['email'], true);
    for (const hidden of [
      'phone',
      'systemRole',
      'customRoleId',
      'organizationId',
      'emailVerified',
    ]) {
      assert.equal(select[hidden], undefined, `coworker list hides ${hidden}`);
    }

    // Public signup: a known email gets the same answer and creates nothing,
    // a deleted account's email included (it still holds the unique index).
    // The fake only sees the account when the lookup asks for deleted rows.
    const orgs = new OrganizationsService(
      {
        client: {
          organization: { findFirst: async () => null },
          user: {
            findUnique: async (args: { includeDeleted?: boolean }) =>
              args.includeDeleted === true ? { id: OTHER } : null,
          },
        },
      } as unknown as PrismaService,
      {} as never,
      {} as never,
      {} as never,
    );
    assert.deepEqual(
      await orgs.signupSelfServe({
        organizationName: 'Acme',
        email: 'taken@acme.example',
        name: 'Taken',
      } as never),
      { ok: true },
    );

    // Lead conversion: minting a client needs `sales.clients.all`.
    const leads = new LeadsService(untouchablePrisma, {} as never, {} as never);
    await assert.rejects(
      leads.convert(
        { userId: ME, workspaceId: WS, fullLeads: true, fullClients: false } as never,
        'l1',
        {},
      ),
      ForbiddenException,
    );

    // Platform mail never reads a user's mailbox (the MAIL_FROM lookup).
    const processor = readFileSync(resolve(__dirname, '../email/email.processor.ts'), 'utf8');
    assert.ok(!/mailAccount\./.test(processor), 'email.processor must not query MailAccount');
  }

  // 12. Password verification ---------------------------------------------------
  {
    const good = hashPassword('correct horse battery staple');
    assert.ok(verifyPassword(good, 'correct horse battery staple'));
    assert.ok(!verifyPassword(good, 'wrong password'));
    // Buffer.from(_, 'hex') drops invalid characters: these used to decode to
    // an empty key that matched ANY password.
    for (const malformed of [
      'scrypt$00$zz',
      'scrypt$zz$zz',
      'scrypt$00ff$0',
      `scrypt$${'ab'.repeat(16)}$${'cd'.repeat(10)}`,
      `${good}$extra`,
      'scrypt$$',
    ]) {
      assert.ok(!verifyPassword(malformed, 'anything'), `malformed hash refused: ${malformed}`);
    }
  }

  // 13. Admin roles under a custom role --------------------------------------
  {
    const full = presetPermissions({
      systemRole: 'EMPLOYEE',
      workspaceMemberships: [{ role: 'ADMIN' }],
    });
    const narrow = { company: [], workspace: ['workspace.view'] };
    assert.equal(adminCheckedRole('ADMIN', full), 'ADMIN', 'a real admin stays admin');
    assert.equal(adminCheckedRole('OWNER', full), 'OWNER');
    assert.equal(adminCheckedRole('ADMIN', narrow), 'MEMBER', 'base ADMIN under a narrow role');
    assert.equal(adminCheckedRole('OWNER', narrow), 'MEMBER');
    assert.equal(adminCheckedRole('VIEWER', narrow), 'VIEWER', 'other roles unchanged');
    assert.equal(adminCheckedRole(undefined, narrow), undefined);
  }

  // 14. Mail relay sender addresses ------------------------------------------
  {
    const env = {
      MAIL_RELAY_SENDER_DOMAINS: 'company.example, @shared.example',
    } as NodeJS.ProcessEnv;
    assert.ok(relayMayCarry('Me@Own.example', 'me@own.example', {}), "the owner's sign-in address");
    assert.ok(relayMayCarry('info@company.example', 'me@own.example', env), 'a listed domain');
    assert.ok(relayMayCarry('desk@shared.example', null, env), 'a listed domain with @');
    assert.ok(!relayMayCarry('ceo@company.example', 'me@own.example', {}), 'unlisted: not carried');
    assert.ok(!relayMayCarry('ceo@other.example', 'me@own.example', env), 'another domain');
    assert.ok(!relayMayCarry('not-an-address', 'me@own.example', env));
  }

  // 15. Task parent cycles ---------------------------------------------------
  {
    // T1 <- T2 <- T3 (T3's parent is T2, T2's parent is T1).
    const parents: Record<string, string | null> = { t1: null, t2: 't1', t3: 't2' };
    const tasks = new TasksService(
      {
        client: {
          task: {
            findUnique: async (a: { where: { id: string } }) => ({
              parentTaskId: parents[a.where.id] ?? null,
            }),
          },
        },
      } as unknown as PrismaService,
      {} as never,
      {} as never,
    );
    const walk = (
      tasks as unknown as {
        assertNotOwnAncestor: (taskId: string, parentId: string) => Promise<void>;
      }
    ).assertNotOwnAncestor.bind(tasks);
    await assert.rejects(walk('t1', 't3'), BadRequestException, 't1 under its grandchild t3');
    await assert.rejects(walk('t1', 't1'), BadRequestException, 'a task under itself');
    await walk('t3', 't1');
    await walk('t2', 't1');
  }

  // 16. Chat invites and room admins ------------------------------------------
  {
    const orgOf: Record<string, string> = { [ME]: 'org-a', [OTHER]: 'org-b' };
    let member = false;
    let expiresAt: Date | null = null;
    const invitePrisma = {
      client: {
        chatRoomInvite: {
          findFirst: async () => ({
            id: 'i1',
            code: 'code',
            roomId: 'r1',
            createdById: OTHER,
            maxUses: null,
            usedCount: 0,
            expiresAt,
            room: { id: 'r1', name: 'Secret', type: 'GROUP', workspaceId: null, deletedAt: null },
            createdBy: { id: OTHER, name: 'Other', email: 'other@b.example', image: null },
          }),
        },
        chatRoomParticipant: {
          findUnique: async () => (member ? { id: 'p1' } : null),
          count: async () => 2,
          findMany: async () => [{ user: { organizationId: 'org-b' } }],
        },
      },
    } as unknown as PrismaService;
    const invites = new ChatService(invitePrisma, {} as never);
    (invites as unknown as { getUserOrganizationId: (id: string) => Promise<string> })[
      'getUserOrganizationId'
    ] = async (id) => orgOf[id]!;
    // Someone from another org learns nothing about the room from a preview.
    await assert.rejects(invites.previewInvite(ME, 'code'), ForbiddenException);
    await assert.rejects(invites.acceptInvite(ME, 'code'), ForbiddenException);
    // A current member (here, of a cross-org room) is told so, not refused.
    member = true;
    assert.equal((await invites.previewInvite(ME, 'code')).alreadyJoined, true);
    assert.deepEqual(await invites.acceptInvite(ME, 'code'), {
      roomId: 'r1',
      alreadyJoined: true,
      systemMessage: null,
    });
    // Membership comes before expiry too: the invite page accepts again on
    // its own for members, and an error there made it retry in a loop.
    expiresAt = new Date(Date.now() - 60_000);
    assert.equal((await invites.acceptInvite(ME, 'code')).alreadyJoined, true);
    member = false;
    await assert.rejects(invites.acceptInvite(ME, 'code'), BadRequestException);
    expiresAt = null;

    // Admin changes count and write under the room lock, in one transaction.
    const steps: string[] = [];
    let admins: { userId: string; role: string }[] = [];
    const tx = {
      $queryRaw: async (sql: TemplateStringsArray) => {
        steps.push(/FOR NO KEY UPDATE/.test(sql.join('?')) ? 'lock' : 'sql');
        return [];
      },
      chatRoomParticipant: {
        findMany: async () => (steps.push('read'), admins),
        update: async (a: { where: { roomId_userId: { userId: string } } }) =>
          steps.push(`promote:${a.where.roomId_userId.userId}`),
        deleteMany: async () => steps.push('leave'),
      },
    };
    const roomPrisma = {
      client: {
        chatRoom: { findFirst: async () => ({ id: 'r1', type: 'GROUP', createdById: null }) },
        chatRoomParticipant: {
          findUnique: async () => ({ id: 'p1' }),
          findFirst: async () => ({ id: 'p2' }),
        },
        user: {
          findUnique: async () => ({ name: 'Me', email: 'me@a.example' }),
          findMany: async () => [],
        },
        $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
      },
    } as unknown as PrismaService;
    const rooms = new ChatService(roomPrisma, {} as never);
    const stub = rooms as unknown as Record<string, unknown>;
    stub['assertRoomAdmin'] = async () => undefined;
    stub['assertRoomMember'] = async () => undefined;
    stub['recordSystemMessage'] = async () => (steps.push('announce'), null);

    // The sole admin cannot step down.
    admins = [{ userId: ME, role: 'ADMIN' }];
    await assert.rejects(
      rooms.updateParticipantRole(ME, 'r1', ME, 'MEMBER'),
      BadRequestException,
      'the last admin stays one',
    );
    assert.deepEqual(steps, ['lock', 'read']);

    // Rights are checked again under the lock: an admin demoted a moment
    // ago (here: no longer ADMIN) can neither change roles nor remove anyone.
    steps.length = 0;
    admins = [
      { userId: OTHER, role: 'ADMIN' },
      { userId: ME, role: 'MEMBER' },
    ];
    await assert.rejects(rooms.updateParticipantRole(ME, 'r1', 'cmx', 'ADMIN'), ForbiddenException);
    await assert.rejects(rooms.removeParticipant(ME, 'r1', OTHER), ForbiddenException);
    assert.deepEqual(steps, ['lock', 'read', 'lock', 'read'], 'nothing written or announced');

    // A removal runs under the lock and is announced only once it happened.
    steps.length = 0;
    admins = [{ userId: ME, role: 'ADMIN' }];
    await rooms.removeParticipant(ME, 'r1', OTHER);
    assert.deepEqual(steps, ['lock', 'read', 'leave', 'announce']);

    steps.length = 0;
    admins = [
      { userId: ME, role: 'ADMIN' },
      { userId: OTHER, role: 'MEMBER' },
    ];
    await rooms.leaveRoom(ME, 'r1');
    assert.deepEqual(steps, ['announce', 'lock', 'read', 'leave', `promote:${OTHER}`]);

    // A room with no ADMIN row: its own members manage it (rooms older than
    // roles), but an open channel's same-org visitors, who need no row to
    // read and post, do not.
    let rows: { userId: string; role: string }[] = [];
    const legacy = new ChatService(
      {
        client: {
          chatRoom: {
            findFirst: async () => ({
              id: 'r1',
              type: 'TEXT_CHANNEL',
              isPrivate: false,
              workspace: { organizationId: 'org-a' },
              participants: rows.filter((r) => r.userId === ME),
            }),
          },
          chatRoomParticipant: { findMany: async () => rows },
        },
      } as unknown as PrismaService,
      {} as never,
    );
    (legacy as unknown as { getUserOrganizationId: () => Promise<string> })[
      'getUserOrganizationId'
    ] = async () => 'org-a';
    await assert.rejects(legacy.assertRoomAdmin(ME, 'r1'), ForbiddenException);
    rows = [{ userId: ME, role: 'MEMBER' }];
    await legacy.assertRoomAdmin(ME, 'r1');

    // Hard-deleting a room's only admin hands the room to its oldest other
    // participant first; a room with another admin is left alone. Locks come
    // first: the user row, then every non-DM room they are in, in id order.
    const people: Record<string, Array<{ userId: string; role: string; joinedAt: number }>> = {
      solo: [
        { userId: ME, role: 'ADMIN', joinedAt: 1 },
        { userId: 'cmlate', role: 'MEMBER', joinedAt: 3 },
        { userId: OTHER, role: 'MEMBER', joinedAt: 2 },
      ],
      shared: [
        { userId: ME, role: 'ADMIN', joinedAt: 1 },
        { userId: OTHER, role: 'ADMIN', joinedAt: 2 },
      ],
    };
    const handover: string[] = [];
    await handOverSoleAdminRooms(
      {
        $queryRaw: async (sql: TemplateStringsArray) => {
          const text = sql.join('?');
          if (/FROM "User"[\s\S]*FOR UPDATE/.test(text)) {
            handover.push('lock-user');
            return [];
          }
          assert.match(text, /type <> 'DM'[\s\S]*ORDER BY r\.id[\s\S]*FOR NO KEY UPDATE/);
          handover.push('lock-rooms');
          return [{ id: 'shared' }, { id: 'solo' }];
        },
        chatRoomParticipant: {
          findMany: async (a: { where: { roomId: { in: string[] }; role: string } }) =>
            a.where.roomId.in.flatMap((roomId) =>
              people[roomId]!.filter((p) => p.role === a.where.role).map((p) => ({ ...p, roomId })),
            ),
          findFirst: async (a: {
            where: { roomId: string; userId: { not: string } };
            orderBy: unknown;
          }) => {
            assert.deepEqual(a.orderBy, { joinedAt: 'asc' }, 'the oldest participant succeeds');
            return (
              [...people[a.where.roomId]!]
                .sort((x, y) => x.joinedAt - y.joinedAt)
                .find((p) => p.userId !== a.where.userId.not) ?? null
            );
          },
          update: async (a: { where: { roomId_userId: { roomId: string; userId: string } } }) => {
            const { roomId, userId } = a.where.roomId_userId;
            handover.push(`promote:${roomId}:${userId}`);
          },
        },
      } as never,
      ME,
    );
    assert.deepEqual(handover, ['lock-user', 'lock-rooms', `promote:solo:${OTHER}`]);
    // And the user deletion runs it, before the user row goes.
    const removeSource = readFileSync(
      resolve(__dirname, '../admin/admin-users.service.ts'),
      'utf8',
    );
    const handOverAt = removeSource.indexOf('await handOverSoleAdminRooms(tx, targetUserId)');
    assert.ok(handOverAt > 0, 'AdminUsersService.remove hands rooms over');
    assert.ok(
      handOverAt < removeSource.indexOf('await tx.user.delete({ where: { id: targetUserId } })'),
      'the hand-over runs before the user is deleted',
    );

    // The admin room list queries messages of public channels only, so DM,
    // group and private-channel bodies are never loaded.
    let listArgs: { include: { messages: { where: unknown } } } | undefined;
    await new ChatService(
      {
        client: {
          chatRoom: {
            findMany: async (a: typeof listArgs) => ((listArgs = a), []),
          },
        },
      } as unknown as PrismaService,
      {} as never,
    ).listAdminRoomsForWorkspace(WS, { systemRole: 'ADMIN', organizationId: ORG });
    assert.deepEqual(listArgs?.include.messages.where, {
      deletedAt: null,
      room: { workspaceId: { not: null }, isPrivate: false },
    });
  }

  // 17. Filing a document ------------------------------------------------------
  {
    const ALICE = 'cmalice00000000000000alice';
    const BOB = 'cmbob00000000000000000bob';
    const CLIENT_X = 'cmclientx000000000000000x'; // assigned to Alice
    const CLIENT_Y = 'cmclienty000000000000000y'; // assigned to someone else
    const assigneeOf: Record<string, string> = { [CLIENT_X]: ALICE, [CLIENT_Y]: OTHER };
    const projectWheres: Array<{ where: { AND: unknown[] } }> = [];
    const writes: unknown[] = [];
    const docs = new DocumentsService(
      {
        client: {
          // Alice owns d1; Bob holds a WRITE grant on it.
          document: {
            findFirst: async () => ({
              id: 'd1',
              workspaceId: WS,
              createdById: ALICE,
              _count: { access: 1 },
            }),
            update: async (a: unknown) => (writes.push(a), { id: 'd1' }),
            create: async (a: unknown) => (writes.push(a), { id: 'd2' }),
          },
          documentAccess: { findUnique: async () => ({ permission: 'WRITE' }) },
          // Applies clientVisibleWhere's assignee rule, as Postgres would.
          client: {
            findFirst: async (a: { where: { id: string; AND: Array<{ assigneeId?: string }> } }) =>
              assigneeOf[a.where.id] === a.where.AND[0]!.assigneeId ? { id: a.where.id } : null,
          },
          // The filer cannot see the project.
          project: {
            findFirst: async (a: { where: { AND: unknown[] } }) => (projectWheres.push(a), null),
          },
        },
      } as unknown as PrismaService,
      {} as never,
    );
    const filer = (userId: string) => ({
      actor: {
        userId,
        workspaceId: WS,
        fullAccess: false,
        fullLeads: false,
        fullClients: false,
        financeAccess: false,
      },
      scope: {
        userId,
        workspaceIds: [WS],
        projectIds: [],
        currentWorkspaceId: WS,
        workspaceRole: 'MEMBER',
        seesEveryProject: false,
      },
    });
    const ctx = (userId: string) => ({ userId, workspaceRole: 'MEMBER' });

    // A WRITE grantee edits the content but cannot re-file the document:
    // filing picks which clients the owner's share dialog offers.
    await docs.update(WS, 'd1', { title: 'Plan' } as never, ctx(BOB), filer(BOB));
    for (const refile of [{ clientId: CLIENT_X }, { projectId: PROJECT_A }, { clientId: null }]) {
      await assert.rejects(
        docs.update(WS, 'd1', refile as never, ctx(BOB), filer(BOB)),
        ForbiddenException,
        `a WRITE grantee cannot send ${JSON.stringify(refile)}`,
      );
    }
    // The owner files it, but only under a client they can see; a hidden
    // client answers like a missing one.
    await docs.update(WS, 'd1', { clientId: CLIENT_X } as never, ctx(ALICE), filer(ALICE));
    await assert.rejects(
      docs.update(WS, 'd1', { clientId: CLIENT_Y } as never, ctx(ALICE), filer(ALICE)),
      NotFoundException,
    );
    await assert.rejects(
      docs.create(WS, ALICE, { title: 'New', clientId: CLIENT_Y } as never, filer(ALICE)),
      NotFoundException,
    );
    // Projects go through projectAccessWhere, so a hidden one is refused too.
    await assert.rejects(
      docs.update(WS, 'd1', { projectId: PROJECT_A } as never, ctx(ALICE), filer(ALICE)),
      NotFoundException,
    );
    assert.deepEqual(projectWheres[0]!.where.AND, [
      projectAccessWhere(filer(ALICE).scope as never),
    ]);
    assert.equal(writes.length, 2, 'only the title edit and the visible filing are written');

    // The share dialog: a project's client (here Y, which Alice cannot see)
    // no longer gets past the sales rules. Only the filed client does, and
    // filing is already limited to the owner or an admin who can see it.
    let filed: { clientId: string | null; project: { clientId: string } | null } = {
      clientId: null,
      project: { clientId: CLIENT_Y },
    };
    const dialog = new DocumentsService(
      { client: { document: { findFirst: async () => filed } } } as unknown as PrismaService,
      {} as never,
    );
    const shareable = (
      dialog as unknown as {
        shareableClientWhere: (
          ws: string,
          id: string,
          actor: unknown,
        ) => Promise<{ AND: unknown[] }>;
      }
    ).shareableClientWhere.bind(dialog);
    const pickRule = async () => (await shareable(WS, 'd1', filer(ALICE).actor)).AND[0];
    assert.deepEqual(await pickRule(), { OR: [{ assigneeId: ALICE }, { id: { in: [] } }] });
    filed = { clientId: CLIENT_X, project: { clientId: CLIENT_Y } };
    assert.deepEqual(await pickRule(), { OR: [{ assigneeId: ALICE }, { id: { in: [CLIENT_X] } }] });
  }

  // 18. Signup slugs and signature titles -------------------------------------
  {
    // A deleted workspace still holds its slug in the unique index, so the
    // allocator must see it (raw client) and move on instead of answering
    // 409 to addresses with no account.
    const orgs = new OrganizationsService(
      {
        raw: {
          workspace: {
            findUnique: async (a: { where: { slug: string } }) =>
              a.where.slug === 'acme' ? { id: 'deleted-workspace' } : null,
          },
        },
        client: { workspace: { findUnique: async () => null } },
      } as unknown as PrismaService,
      {} as never,
      {} as never,
      {} as never,
    );
    const slug = await (
      orgs as unknown as { allocateWorkspaceSlug: (base: string) => Promise<string> }
    ).allocateWorkspaceSlug('acme');
    assert.match(slug, /^acme-[0-9a-f]{4}$/);

    // The client Signatures tab shows a source document's live title only to
    // someone who can still read the document.
    const member = { userId: ME, workspaceRole: 'MEMBER' };
    assert.equal(mayReadSourceDocument(member, { createdById: OTHER, access: [] }), false);
    assert.equal(mayReadSourceDocument(member, { createdById: OTHER, access: [{}] }), true);
    assert.equal(mayReadSourceDocument(member, { createdById: ME, access: [] }), true);
    assert.equal(
      mayReadSourceDocument(
        { userId: ME, workspaceRole: 'ADMIN' },
        { createdById: OTHER, access: [] },
      ),
      true,
    );
  }

  console.log('security-hardening: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
