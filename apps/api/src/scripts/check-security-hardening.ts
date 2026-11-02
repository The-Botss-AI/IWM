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
  ServiceUnavailableException,
} from '@nestjs/common';
import { defineAbilityFor, presetPermissions } from '@botss/auth';
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
import { abilityRow, assertCanUpdateProject } from '../common/permissions/request-ability';
import { LeadsService } from '../leads/leads.service';
import { OrganizationsService } from '../organizations/organizations.service';
import type { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
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
    const calls: unknown[][] = [];
    const chain = {
      set: (...a: unknown[]) => (calls.push(['set', ...a]), chain),
      incr: (...a: unknown[]) => (calls.push(['incr', ...a]), chain),
      exec: async () => [
        [null, 'OK'],
        [null, 3],
      ],
    };
    const redis = new RedisService({ get: () => undefined } as never);
    (redis as unknown as { _client: unknown })._client = { status: 'ready', multi: () => chain };
    assert.equal(await redis.hitWindow('rate:k', 60), 3);
    assert.deepEqual(calls, [
      ['set', 'rate:k', '0', 'EX', 60, 'NX'],
      ['incr', 'rate:k'],
    ]);
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

    // Public signup: a known email gets the same answer and creates nothing.
    const orgs = new OrganizationsService(
      {
        client: {
          organization: { findFirst: async () => null },
          user: { findUnique: async () => ({ id: OTHER }) },
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

  console.log('security-hardening: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
