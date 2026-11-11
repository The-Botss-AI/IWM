/**
 * Add-on and email-domain self-checks (no database). Everything runs against
 * an in-memory fake Prisma that records every write, so "nothing was
 * written" is checked, not assumed.
 *
 * Covered:
 *  - an existing organization with no add-on rows gets every current add-on
 *    on, `ai` off, and nothing is written on a read;
 *  - an organization with an existing mail server (OrganizationMailConfig)
 *    shows Mail configured and on with no new rows, and invoice settings are
 *    neither read nor copied;
 *  - a switched-off add-on: every gated controller answers 403
 *    `addon-disabled` through AddonGuard, and LiveKit tokens, mailbox
 *    self-setup and webmail import refuse it in the services too;
 *  - settings are stored encrypted, never returned in plain text, never in
 *    the audit log; the platform operator view has no settings at all;
 *  - support sessions cannot change add-ons;
 *  - HR: the root organization without settings uses the env fallback, any
 *    other organization without settings gets no warnings or signatory, and
 *    one with settings uses its own (timesheet warnings and payslips);
 *  - domains: DNS verification (mocked), one verified owner per domain, a
 *    verified domain blocks other organizations, and org-less verified staff
 *    on it are routed to its organization (the legacy emailDomain column is
 *    not used for routing).
 *
 * Run: pnpm --filter @botss/api test
 */
import 'reflect-metadata';

import assert from 'node:assert/strict';

import { ForbiddenException, HttpException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@botss/database';
import {
  ADDON_KEYS,
  livekitAddonSettingsSchema,
  platformAddonStateSchema,
  type AddonKey,
} from '@botss/shared-types';
import type { Request, Response } from 'express';

import { AddonGuard } from '../addons/addon.guard';
import { ADDON_REGISTRY, secretFields } from '../addons/addon-registry';
import { AddonsService } from '../addons/addons.service';
import { resolveHrConfig } from '../addons/hr-config';
import { REQUIRE_ADDON_KEY } from '../addons/require-addon.decorator';
import { AdminUsersService } from '../admin/admin-users.service';
import type { AuditLogService } from '../audit-log/audit-log.service';
import { AuthGuard } from '../common/guards/auth.guard';
import {
  currentRequestAuth,
  markSupportRequest,
  RequestContextMiddleware,
  setRequestAuth,
} from '../common/request-context';
import { AttendanceExportController } from '../hr/attendance-export.controller';
import { AttendanceController } from '../hr/attendance.controller';
import { HolidaysController } from '../hr/holidays.controller';
import { LeavesController } from '../hr/leaves.controller';
import { TimesheetWarningService } from '../hr/timesheet-warning.service';
import { LivekitController } from '../livekit/livekit.controller';
import { LivekitService } from '../livekit/livekit.service';
import { MailAccountsController } from '../mail/mail-accounts.controller';
import { MailAccountsService } from '../mail/mail-accounts.service';
import { MailCryptoService } from '../mail/mail-crypto.service';
import { MailEventsController } from '../mail/mail-events.controller';
import { MailFoldersController } from '../mail/mail-folders.controller';
import { MailMessagesController } from '../mail/mail-messages.controller';
import { OrganizationAutoRouteService } from '../organizations/auto-route.service';
import { assertNotVerifiedElsewhere, claimingOrgIdFor } from '../organizations/domain-claims';
import { DnsLookupTimeout, type TxtResolver } from '../organizations/domain-verification';
import { OrganizationDomainsService } from '../organizations/organization-domains.service';
import { ROOT_ORG_ID } from '../organizations/organizations.constants';
import { PayrollController } from '../payroll/payroll.controller';
import { PayslipRenderService } from '../payroll/payslip-render.service';
import { TimesheetsController } from '../timesheets/timesheets.controller';
import type { InvoiceRenderService } from '../invoices/invoice-render.service';
import type { PrismaService } from '../prisma/prisma.service';

const ORG_A = 'cmorga000000000000000000a';
const ORG_B = 'cmorgb000000000000000000b';
const ADMIN_A = 'cmadmina00000000000000000';
const ADMIN_B = 'cmadminb00000000000000000';
const ROOT_ADMIN = 'cmrootadmin00000000000000';
const MEMBER_A = 'cmmembera0000000000000000';
const SUPER = 'cmsuper000000000000000000';

const CURRENT_ADDONS: AddonKey[] = ['mail', 'cpanel', 'polar', 'twilio', 'livekit', 'hr'];

// ---------------------------------------------------------------- fake db

interface OrgRow {
  id: string;
  isRoot: boolean;
  isActive: boolean;
  deletedAt: Date | null;
  emailDomain: string | null;
  slug: string;
  hasMailConfig: boolean;
  invoiceSettings: Record<string, unknown>;
}
interface AddonDbRow {
  id: string;
  organizationId: string;
  key: string;
  enabled: boolean;
  settingsCiphertext: string | null;
  updatedById: string | null;
  updatedAt: Date;
}
interface DomainDbRow {
  id: string;
  organizationId: string;
  domain: string;
  verificationToken: string;
  verifiedAt: Date | null;
  verifiedDomain: string | null;
  createdAt: Date;
}
interface UserRow {
  id: string;
  email: string;
  organizationId: string | null;
  accountType: 'STAFF' | 'CLIENT';
  emailVerified: boolean;
  name: string;
}

type Where = Record<string, unknown>;

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function fakeDb() {
  const orgs = new Map<string, OrgRow>();
  const addons: AddonDbRow[] = [];
  const domains: DomainDbRow[] = [];
  const users = new Map<string, UserRow>();
  const writes: string[] = [];
  const reads: string[] = [];
  const userFindFirst: Where[] = [];
  let seq = 0;

  const addOrg = (o: Partial<OrgRow> & { id: string }): void => {
    orgs.set(o.id, {
      isRoot: false,
      isActive: true,
      deletedAt: null,
      emailDomain: null,
      slug: o.id,
      hasMailConfig: false,
      invoiceSettings: {},
      ...o,
    });
  };
  const addUser = (u: Partial<UserRow> & { id: string; email: string }): void => {
    users.set(u.id, {
      organizationId: null,
      accountType: 'STAFF',
      emailVerified: true,
      name: u.id,
      ...u,
    });
  };
  const orgView = (o: OrgRow) => ({
    id: o.id,
    isRoot: o.isRoot,
    slug: o.slug,
    emailDomain: o.emailDomain,
    mailConfig: o.hasMailConfig ? { id: `mc_${o.id}` } : null,
  });
  const orgMatches = (o: OrgRow, where: Where): boolean => {
    for (const [k, v] of Object.entries(where)) {
      if (k === 'deletedAt') {
        if (v === null && o.deletedAt !== null) return false;
      } else if (k === 'OR') {
        continue;
      } else if ((o as unknown as Record<string, unknown>)[k] !== v) {
        return false;
      }
    }
    return true;
  };
  const domainMatches = (d: DomainDbRow, where: Where): boolean => {
    for (const [k, v] of Object.entries(where)) {
      if (k === 'organization') {
        const o = orgs.get(d.organizationId);
        if (!o || o.deletedAt !== null) return false;
      } else if ((d as unknown as Record<string, unknown>)[k] !== v) {
        return false;
      }
    }
    return true;
  };
  const domainSelect = (d: DomainDbRow) => ({
    id: d.id,
    domain: d.domain,
    verificationToken: d.verificationToken,
    verifiedAt: d.verifiedAt,
    createdAt: d.createdAt,
    organizationId: d.organizationId,
  });

  const client = {
    organization: {
      findFirst: async (args: { where: Where }) => {
        reads.push('organization.findFirst');
        const o = [...orgs.values()].find((x) => orgMatches(x, args.where));
        return o ? orgView(o) : null;
      },
      findUnique: async (args: { where: { id: string } }) => {
        reads.push('organization.findUnique');
        const o = orgs.get(args.where.id);
        return o ? orgView(o) : null;
      },
      findMany: async (args: { where: Where }) => {
        reads.push('organization.findMany');
        return [...orgs.values()]
          .filter((o) => orgMatches(o, args.where))
          .filter(
            (o) => o.isRoot || addons.some((a) => a.organizationId === o.id && a.key === 'hr'),
          )
          .map((o) => ({ id: o.id }));
      },
      update: async () => {
        writes.push('organization.update');
        return {};
      },
    },
    organizationAddon: {
      findMany: async (args: { where: { organizationId: string } }) => {
        reads.push('organizationAddon.findMany');
        return addons
          .filter((a) => a.organizationId === args.where.organizationId)
          .map((a) => ({
            key: a.key,
            enabled: a.enabled,
            settingsCiphertext: a.settingsCiphertext,
            updatedAt: a.updatedAt,
          }));
      },
      upsert: async (args: {
        where: { organizationId_key: { organizationId: string; key: string } };
        create: Omit<AddonDbRow, 'id' | 'updatedAt'>;
        update: Partial<AddonDbRow>;
      }) => {
        writes.push('organizationAddon.upsert');
        const { organizationId, key } = args.where.organizationId_key;
        const row = addons.find((a) => a.organizationId === organizationId && a.key === key);
        if (row) Object.assign(row, args.update, { updatedAt: new Date() });
        else addons.push({ id: `ad${++seq}`, updatedAt: new Date(), ...args.create });
        return {};
      },
    },
    organizationDomain: {
      findFirst: async (args: { where: Where }) => {
        reads.push('organizationDomain.findFirst');
        const d = domains.find((x) => domainMatches(x, args.where));
        return d ? domainSelect(d) : null;
      },
      findMany: async (args: { where: Where }) =>
        domains.filter((x) => domainMatches(x, args.where)).map(domainSelect),
      count: async (args: { where: Where }) =>
        domains.filter((x) => domainMatches(x, args.where)).length,
      create: async (args: {
        data: { organizationId: string; domain: string; verificationToken: string };
      }) => {
        writes.push('organizationDomain.create');
        if (
          domains.some(
            (d) => d.organizationId === args.data.organizationId && d.domain === args.data.domain,
          )
        ) {
          throw p2002();
        }
        const row: DomainDbRow = {
          id: `cmdomain${String(++seq).padStart(17, '0')}`,
          verifiedAt: null,
          verifiedDomain: null,
          createdAt: new Date(),
          ...args.data,
        };
        domains.push(row);
        return domainSelect(row);
      },
      update: async (args: { where: { id: string }; data: Partial<DomainDbRow> }) => {
        writes.push('organizationDomain.update');
        const row = domains.find((d) => d.id === args.where.id);
        if (!row) throw new Error('not found');
        if (
          args.data.verifiedDomain &&
          domains.some((d) => d.id !== row.id && d.verifiedDomain === args.data.verifiedDomain)
        ) {
          throw p2002();
        }
        Object.assign(row, args.data);
        return domainSelect(row);
      },
      deleteMany: async (args: { where: { id: string; organizationId: string } }) => {
        writes.push('organizationDomain.deleteMany');
        const i = domains.findIndex(
          (d) => d.id === args.where.id && d.organizationId === args.where.organizationId,
        );
        if (i >= 0) domains.splice(i, 1);
        return { count: i >= 0 ? 1 : 0 };
      },
    },
    user: {
      findFirst: async (args: { where: Where }) => {
        userFindFirst.push(args.where);
        const u = [...users.values()].find((x) =>
          Object.entries(args.where).every(([k, v]) =>
            k === 'deletedAt' ? true : (x as unknown as Record<string, unknown>)[k] === v,
          ),
        );
        return u ?? null;
      },
      findUnique: async (args: { where: { id: string } }) => users.get(args.where.id) ?? null,
      updateMany: async (args: {
        where: { id: string; organizationId: null };
        data: { organizationId: string };
      }) => {
        writes.push('user.updateMany');
        const u = users.get(args.where.id);
        if (!u || u.organizationId !== null) return { count: 0 };
        u.organizationId = args.data.organizationId;
        return { count: 1 };
      },
      findMany: async () => [],
    },
    mailAccount: {
      findFirst: async () => null,
    },
    chatRoom: {
      findFirst: async () => {
        reads.push('chatRoom.findFirst');
        return null;
      },
    },
  };
  return {
    prisma: { client } as unknown as PrismaService,
    orgs,
    addons,
    domains,
    users,
    writes,
    reads,
    userFindFirst,
    addOrg,
    addUser,
  };
}

// --------------------------------------------------------------- helpers

process.env.MAIL_ENCRYPTION_KEY = 'a'.repeat(64);
const crypto = new MailCryptoService();
crypto.onModuleInit();

function auditSink() {
  const emitted: Array<{ action: string; metadata?: Record<string, unknown> }> = [];
  const log = {
    emit: async (e: { action: string; metadata?: Record<string, unknown> }) => {
      emitted.push(e);
    },
  } as unknown as AuditLogService;
  return { log, emitted };
}

/** Run `fn` inside a request whose signed-in user holds `company` permissions. */
function asUser<T>(
  userId: string,
  organizationId: string | null,
  company: string[],
  fn: () => Promise<T>,
  opts: { support?: boolean } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    new RequestContextMiddleware().use({} as Request, {} as Response, () => {
      setRequestAuth({
        userId,
        systemRole: 'ADMIN',
        organizationId,
        permissions: { company, workspace: [] },
      });
      if (opts.support) markSupportRequest({ userId, workspaceIds: [] });
      fn().then(resolve, reject);
    });
  });
}

const code = (err: unknown): unknown =>
  err instanceof HttpException ? (err.getResponse() as { code?: unknown }).code : undefined;
const status = (err: unknown): number | null =>
  err instanceof HttpException ? err.getStatus() : null;
const detailOf = (err: unknown): string =>
  err instanceof HttpException
    ? String((err.getResponse() as { detail?: unknown }).detail ?? '')
    : '';

function isAddonDisabled(name: string) {
  return (err: unknown): boolean => {
    assert.ok(err instanceof ForbiddenException, 'a 403');
    assert.equal(code(err), 'addon-disabled');
    const detail = String((err.getResponse() as { detail?: unknown }).detail ?? '');
    assert.ok(detail.includes(name), `detail names ${name}`);
    assert.ok(/admin can turn it on/i.test(detail), 'detail says an admin can turn it on');
    assert.ok(!/ - |—|–/.test(detail), 'no dashes in the message');
    return true;
  };
}

function ctxFor(
  cls: new (...args: never[]) => unknown,
  organizationId: string | null,
): ExecutionContext {
  const handlerName = Object.getOwnPropertyNames(cls.prototype).find((n) => n !== 'constructor');
  const handler = (cls.prototype as Record<string, unknown>)[
    handlerName ?? 'constructor'
  ] as () => void;
  return {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user: { organizationId } }) }),
  } as unknown as ExecutionContext;
}

async function disable(addons: AddonsService, orgId: string, key: AddonKey): Promise<void> {
  await asUser(`admin_${orgId}`, orgId, ['org.settings'], () =>
    addons.update(`admin_${orgId}`, orgId, key, { enabled: false }),
  );
}

// ------------------------------------------------------------------ main

async function main(): Promise<void> {
  // --- existing org, no rows: everything current is on, ai off, no writes ---
  {
    const db = fakeDb();
    db.addOrg({ id: ORG_A, invoiceSettings: { companyName: 'Acme', bankDetails: 'IBAN 1' } });
    const addons = new AddonsService(db.prisma, crypto);
    for (const key of CURRENT_ADDONS) {
      assert.equal(await addons.isEnabled(ORG_A, key), true, `${key} on by default`);
    }
    assert.equal(await addons.isEnabled(ORG_A, 'ai'), false, 'ai off by default');
    const list = await asUser(MEMBER_A, ORG_A, [], () => addons.list(MEMBER_A, ORG_A));
    assert.deepEqual(
      list.items.map((i) => i.key),
      [...ADDON_KEYS],
      'every registry add-on listed',
    );
    for (const i of list.items) {
      assert.equal(i.enabled, i.key !== 'ai', `${i.key} default state in the list`);
      assert.deepEqual(i.settings, {}, 'a member sees no settings');
      assert.deepEqual(i.secretsSet, [], 'a member sees no secret flags');
      assert.equal(i.reason, null, 'a member sees no reason (it can quote settings)');
    }
    assert.equal(list.canManage, false);
    assert.equal(
      list.items.find((i) => i.key === 'mail')?.configured,
      true,
      'mail works with no settings',
    );
    assert.equal(
      list.items.find((i) => i.key === 'hr')?.configured,
      true,
      'hr works with no settings',
    );
    assert.deepEqual(db.writes, [], 'reads write nothing');
    assert.equal(db.addons.length, 0, 'no rows created for an existing org');
    // Invoice settings are not an add-on's: never read through the add-on
    // paths (the fake returns no invoiceSettings at all) and never copied.
    assert.ok(!JSON.stringify(list).includes('IBAN'), 'invoice settings never copied into add-ons');
  }

  // --- org with an existing mail server: configured, on, no new rows ------
  {
    const db = fakeDb();
    db.addOrg({ id: ORG_A, hasMailConfig: true });
    const addons = new AddonsService(db.prisma, crypto);
    const list = await asUser(ADMIN_A, ORG_A, ['org.settings'], () => addons.list(ADMIN_A, ORG_A));
    const mail = list.items.find((i) => i.key === 'mail');
    assert.equal(mail?.enabled, true);
    assert.equal(mail?.configured, true);
    assert.match(
      mail?.reason ?? '',
      /organization mail server/i,
      'reason points at the existing settings',
    );
    assert.equal(
      mail?.settingsHref,
      '/settings/organization-mail',
      'links to the existing settings page',
    );
    assert.deepEqual(db.writes, [], 'nothing written');
    assert.equal(
      ADDON_REGISTRY.mail.fields.length,
      0,
      'mail stores nothing of its own (no duplicate)',
    );
  }

  // --- disabled add-on: gated routes 403 addon-disabled --------------------
  {
    const db = fakeDb();
    db.addOrg({ id: ORG_A });
    db.addOrg({ id: ORG_B });
    const addons = new AddonsService(db.prisma, crypto);
    const guard = new AddonGuard(new Reflector(), addons);
    const gated: Array<[new (...args: never[]) => unknown, AddonKey]> = [
      [LeavesController, 'hr'],
      [AttendanceController, 'hr'],
      [AttendanceExportController, 'hr'],
      [HolidaysController, 'hr'],
      [PayrollController, 'hr'],
      [MailAccountsController, 'mail'],
      [MailMessagesController, 'mail'],
      [MailFoldersController, 'mail'],
      [MailEventsController, 'mail'],
      [LivekitController, 'livekit'],
    ];
    for (const [cls, key] of gated) {
      assert.equal(
        Reflect.getMetadata(REQUIRE_ADDON_KEY, cls),
        key,
        `${cls.name} is marked ${key}`,
      );
      assert.equal(await guard.canActivate(ctxFor(cls, ORG_A)), true, `${cls.name} open while on`);
    }
    for (const key of ['hr', 'mail', 'livekit'] as const) await disable(addons, ORG_A, key);
    for (const [cls, key] of gated) {
      await assert.rejects(
        guard.canActivate(ctxFor(cls, ORG_A)),
        isAddonDisabled(ADDON_REGISTRY[key].name),
        `${cls.name} closed`,
      );
      assert.equal(
        await guard.canActivate(ctxFor(cls, ORG_B)),
        true,
        `${cls.name} still open for another org`,
      );
    }

    // LiveKit tokens refuse in the service too, before any room lookup.
    db.addUser({ id: ADMIN_A, email: 'a@a.test', organizationId: ORG_A });
    const livekit = new LivekitService(db.prisma, { get: () => 'x' } as never, addons);
    const roomReads = db.reads.filter((r) => r === 'chatRoom.findFirst').length;
    await assert.rejects(
      livekit.mintToken(ADMIN_A, { roomId: 'cmroom000000000000000000', kind: 'call' } as never),
      isAddonDisabled('Video and voice calls'),
    );
    assert.equal(
      db.reads.filter((r) => r === 'chatRoom.findFirst').length,
      roomReads,
      'refused before the room lookup',
    );
  }

  // --- cPanel off: mailbox self-setup and webmail import refuse ------------
  {
    const db = fakeDb();
    db.addOrg({ id: ROOT_ORG_ID, isRoot: true });
    db.addUser({ id: ROOT_ADMIN, email: 'person@platform.test', organizationId: ROOT_ORG_ID });
    const addons = new AddonsService(db.prisma, crypto);
    await disable(addons, ROOT_ORG_ID, 'cpanel');
    let cpanelCalls = 0;
    const cpanel = {
      isEnabled: () => true,
      ownsEmail: () => true,
      setPassword: async () => {
        cpanelCalls += 1;
      },
      listEmails: async () => {
        cpanelCalls += 1;
        return [];
      },
    };
    const mail = new MailAccountsService(
      db.prisma,
      crypto,
      {} as never,
      cpanel as never,
      {} as never,
      {} as never,
      addons,
    );
    await assert.rejects(
      mail.selfSetup('cmws', ROOT_ADMIN, 'password-123'),
      isAddonDisabled('cPanel mailboxes'),
    );
    assert.equal(cpanelCalls, 0, 'cPanel never called while the add-on is off');
  }

  // --- settings encrypted, secrets never returned, audit has no values -----
  {
    const db = fakeDb();
    db.addOrg({ id: ORG_A });
    const audit = auditSink();
    const addons = new AddonsService(db.prisma, crypto, audit.log);
    const SECRET = 'lk-secret-value-123';
    const view = await asUser(ADMIN_A, ORG_A, ['org.settings'], () =>
      addons.update(ADMIN_A, ORG_A, 'livekit', {
        settings: { url: 'wss://lk.example.com', apiKey: 'key-1', apiSecret: SECRET },
      }),
    );
    const row = db.addons.find((a) => a.key === 'livekit');
    assert.ok(row?.settingsCiphertext, 'settings stored');
    assert.ok(!row.settingsCiphertext.includes(SECRET), 'ciphertext is not the secret');
    assert.ok(
      !Buffer.from(row.settingsCiphertext, 'base64').toString('utf8').includes(SECRET),
      'not plain text after base64 either',
    );
    assert.equal(
      JSON.parse(crypto.decrypt(Buffer.from(row.settingsCiphertext, 'base64'))).apiSecret,
      SECRET,
    );
    assert.ok(!JSON.stringify(view).includes(SECRET), 'update response has no secret');
    assert.deepEqual(view.secretsSet, ['apiSecret']);
    assert.equal(view.settings.url, 'wss://lk.example.com', 'non-secret values shown to managers');
    assert.equal(view.configured, true);
    assert.deepEqual(secretFields('livekit'), ['apiSecret']);
    const list = await asUser(ADMIN_A, ORG_A, ['org.settings'], () => addons.list(ADMIN_A, ORG_A));
    assert.ok(!JSON.stringify(list).includes(SECRET), 'list has no secret');
    assert.ok(!JSON.stringify(audit.emitted).includes(SECRET), 'audit has no secret');
    assert.ok(
      !JSON.stringify(audit.emitted).includes('key-1'),
      'audit has no setting values at all',
    );
    const updated = audit.emitted.find((e) => e.action === 'addon.updated');
    assert.deepEqual(
      updated?.metadata?.changedSettings,
      ['url', 'apiKey', 'apiSecret'],
      'audit names fields',
    );
    assert.equal(
      (await addons.livekitCredentials(ORG_A))?.apiSecret,
      SECRET,
      'server side can read it',
    );

    // Leaving a secret out keeps it; null clears it.
    await asUser(ADMIN_A, ORG_A, ['org.settings'], () =>
      addons.update(ADMIN_A, ORG_A, 'livekit', { settings: { apiKey: 'key-2' } }),
    );
    assert.equal(
      (await addons.settings(ORG_A, 'livekit')).apiSecret,
      SECRET,
      'omitted secret kept',
    );
    await asUser(ADMIN_A, ORG_A, ['org.settings'], () =>
      addons.update(ADMIN_A, ORG_A, 'livekit', { settings: { apiSecret: null } }),
    );
    assert.equal((await addons.settings(ORG_A, 'livekit')).apiSecret, undefined, 'null clears it');

    // Validation and permissions.
    await assert.rejects(
      asUser(ADMIN_A, ORG_A, ['org.settings'], () =>
        addons.update(ADMIN_A, ORG_A, 'livekit', { settings: { url: 'http://not-websocket' } }),
      ),
      (e: unknown) => status(e) === 400 && code(e) === 'addon-invalid-settings',
    );
    await assert.rejects(
      asUser(ADMIN_A, ORG_A, ['org.settings'], () =>
        addons.update(ADMIN_A, ORG_A, 'mail', { settings: { smtpHost: 'x' } }),
      ),
      (e: unknown) => code(e) === 'addon-unknown-setting',
      'mail has no own settings to duplicate',
    );
    const before = db.writes.length;
    await assert.rejects(
      asUser(MEMBER_A, ORG_A, [], () => addons.update(MEMBER_A, ORG_A, 'hr', { enabled: false })),
      (e: unknown) => status(e) === 403 && code(e) === 'addons-forbidden',
    );
    await assert.rejects(
      asUser(
        SUPER,
        ORG_A,
        ['org.settings'],
        () => addons.update(SUPER, ORG_A, 'hr', { enabled: false }),
        {
          support: true,
        },
      ),
      (e: unknown) => status(e) === 403,
      'a support session cannot change add-ons',
    );
    assert.equal(db.writes.length, before, 'refused updates write nothing');

    // Support sessions never see settings either.
    const supportList = await asUser(
      SUPER,
      ORG_A,
      ['org.settings'],
      () => addons.list(SUPER, ORG_A),
      {
        support: true,
      },
    );
    assert.ok(
      supportList.items.every(
        (i) => Object.keys(i.settings).length === 0 && i.secretsSet.length === 0,
      ),
    );
    assert.ok(
      supportList.items.every((i) => i.reason === null),
      'a support session sees no reason',
    );

    // Platform operator view: key, enabled, configured. Nothing else.
    const platform = await addons.platformList(ORG_A);
    for (const item of platform.items) {
      assert.deepEqual(
        Object.keys(item).sort(),
        ['configured', 'enabled', 'key'],
        'only three fields',
      );
      platformAddonStateSchema.parse(item);
    }
    assert.ok(
      !JSON.stringify(platform).includes('lk.example.com'),
      'no settings in the platform view',
    );
    assert.equal(platform.items.find((i) => i.key === 'ai')?.enabled, false, 'ai off');

    // ai can be turned on explicitly.
    await asUser(ADMIN_A, ORG_A, ['org.settings'], () =>
      addons.update(ADMIN_A, ORG_A, 'ai', { enabled: true }),
    );
    assert.equal(await addons.isEnabled(ORG_A, 'ai'), true);
  }

  // --- Polar and Twilio: not available, stored settings kept and hidden --
  {
    const db = fakeDb();
    db.addOrg({ id: ORG_A });
    const stored = crypto
      .encrypt(JSON.stringify({ accessToken: 'polar-token-1' }))
      .toString('base64');
    db.addons.push({
      id: 'cmaddonpolar0000000000000',
      organizationId: ORG_A,
      key: 'polar',
      enabled: true,
      settingsCiphertext: stored,
      updatedById: null,
      updatedAt: new Date(),
    });
    const addons = new AddonsService(db.prisma, crypto);
    for (const key of ['polar', 'twilio'] as const) {
      assert.deepEqual(ADDON_REGISTRY[key].fields, [], `${key} offers no settings`);
    }
    const list = await asUser(ADMIN_A, ORG_A, ['org.settings'], () => addons.list(ADMIN_A, ORG_A));
    for (const key of ['polar', 'twilio'] as const) {
      const item = list.items.find((i) => i.key === key);
      assert.equal(item?.configured, false, `${key} not configured`);
      assert.equal(item?.reason, 'Not available yet.');
      assert.equal(item?.enabled, true, `${key} keeps its on/off state`);
    }
    assert.ok(
      !JSON.stringify(list).includes('polar-token-1'),
      'a stored Polar token is never sent',
    );
    await assert.rejects(
      asUser(ADMIN_A, ORG_A, ['org.settings'], () =>
        addons.update(ADMIN_A, ORG_A, 'polar', { settings: { accessToken: 'x' } }),
      ),
      (e: unknown) => code(e) === 'addon-unknown-setting',
    );
    await asUser(ADMIN_A, ORG_A, ['org.settings'], () =>
      addons.update(ADMIN_A, ORG_A, 'polar', { enabled: false }),
    );
    const row = db.addons.find((a) => a.key === 'polar');
    assert.equal(row?.settingsCiphertext, stored, 'stored settings untouched');

    // Attendance in Timesheets is HR's, the rest of Timesheets is not.
    assert.equal(
      Reflect.getMetadata(REQUIRE_ADDON_KEY, TimesheetsController.prototype.adminAttendance),
      'hr',
    );
    assert.equal(
      Reflect.getMetadata(REQUIRE_ADDON_KEY, TimesheetsController.prototype.adminList),
      undefined,
    );
    assert.equal(Reflect.getMetadata(REQUIRE_ADDON_KEY, TimesheetsController), undefined);

    // LiveKit needs wss://.
    for (const url of ['ws://lk.example.com', 'http://lk.example.com']) {
      assert.equal(livekitAddonSettingsSchema.safeParse({ url }).success, false, `${url} refused`);
    }
    assert.equal(
      livekitAddonSettingsSchema.safeParse({ url: 'wss://lk.example.com' }).success,
      true,
    );
  }

  // --- HR settings: root env fallback, other orgs own or nothing ----------
  {
    const env = {
      HR_SENDER_EMAIL: 'hr@platform.test',
      HR_EMAIL_DOMAIN: 'platform.test',
      PAYSLIP_SIGNATORY_NAME: 'Platform Signer',
      PAYSLIP_SIGNATORY_TITLE: 'CEO',
    };
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(env)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    try {
      const pure = resolveHrConfig({ isRoot: true, settings: {}, env });
      assert.deepEqual(pure.timesheetWarnings, {
        senderEmail: 'hr@platform.test',
        emailDomain: 'platform.test',
      });
      assert.deepEqual(pure.signatory, { name: 'Platform Signer', title: 'CEO' });
      const other = resolveHrConfig({ isRoot: false, settings: {}, env });
      assert.equal(other.timesheetWarnings, null, 'another org never inherits the env sender');
      assert.equal(other.signatory, null, 'another org never inherits the env signatory');
      assert.equal(
        resolveHrConfig({ isRoot: true, settings: {}, env: {} }).timesheetWarnings,
        null,
        'no env: off',
      );

      const db = fakeDb();
      db.addOrg({ id: ROOT_ORG_ID, isRoot: true });
      db.addOrg({ id: ORG_A });
      db.addOrg({ id: ORG_B });
      const addons = new AddonsService(db.prisma, crypto);
      assert.deepEqual(
        (await addons.hrConfig(ROOT_ORG_ID)).timesheetWarnings?.senderEmail,
        'hr@platform.test',
      );
      assert.equal((await addons.hrConfig(ORG_A)).timesheetWarnings, null, 'org A: off');
      assert.equal((await addons.hrConfig(ORG_A)).signatory, null, 'org A: no signatory');
      await asUser(ADMIN_B, ORG_B, ['org.settings'], () =>
        addons.update(ADMIN_B, ORG_B, 'hr', {
          settings: {
            timesheetWarningsEnabled: true,
            timesheetSenderEmail: 'people@b.test',
            timesheetEmailDomain: 'b.test',
            payslipSignatoryName: 'B Director',
            payslipSignatoryTitle: 'Director',
          },
        }),
      );
      // The HR reason quotes the sender and signatory: managers only.
      const hrFor = async (userId: string, company: string[]) =>
        (await asUser(userId, ORG_B, company, () => addons.list(userId, ORG_B))).items.find(
          (i) => i.key === 'hr',
        );
      assert.match(
        (await hrFor(ADMIN_B, ['org.settings']))?.reason ?? '',
        /people@b\.test/,
        'manager sees the reason',
      );
      const memberHr = await hrFor('cmmemberb0000000000000000', []);
      assert.equal(memberHr?.reason, null, 'a member never sees the HR sender');
      assert.ok(!JSON.stringify(memberHr).includes('B Director'), 'nor the payslip signatory');
      const supportHr = await asUser(
        SUPER,
        ORG_B,
        ['org.settings'],
        () => addons.list(SUPER, ORG_B),
        { support: true },
      );
      assert.ok(
        !JSON.stringify(supportHr).includes('people@b.test'),
        'a support session never sees the HR sender',
      );
      const b = await addons.hrConfig(ORG_B);
      assert.deepEqual(
        b.timesheetWarnings,
        { senderEmail: 'people@b.test', emailDomain: 'b.test' },
        'org B: own',
      );
      assert.deepEqual(b.signatory, { name: 'B Director', title: 'Director' });

      // Payslips: root signs with the env name, org A with none, org B its own.
      const payslips = new PayslipRenderService({} as InvoiceRenderService, addons);
      assert.equal((await payslips.signatoryFor(ROOT_ORG_ID))?.name, 'Platform Signer');
      assert.equal(await payslips.signatoryFor(ORG_A), null);
      assert.equal((await payslips.signatoryFor(ORG_B))?.name, 'B Director');

      // Timesheet warnings run for root (env) and org B (own), never org A,
      // and look for the sender inside that same organization.
      const warnings = new TimesheetWarningService(db.prisma, {} as never, {} as never, addons);
      await warnings.warnDelinquentEmployees(new Date('2026-10-28T00:00:00Z'));
      const senders = db.userFindFirst.filter((w) => typeof w.email === 'string');
      assert.deepEqual(
        senders.map((w) => [w.email, w.organizationId]).sort(),
        [
          ['hr@platform.test', ROOT_ORG_ID],
          ['people@b.test', ORG_B],
        ].sort(),
        'warnings for root (env) and org B (own) only',
      );

      // HR switched off: no warnings even with settings.
      await disable(addons, ORG_B, 'hr');
      db.userFindFirst.length = 0;
      await warnings.warnDelinquentEmployees(new Date('2026-10-28T00:00:00Z'));
      assert.ok(
        !db.userFindFirst.some((w) => w.organizationId === ORG_B),
        'no warnings for an org with HR off',
      );

      // Root with its own (partial) HR settings keeps the env sender until it
      // sets timesheet fields itself.
      await asUser(ROOT_ADMIN, ROOT_ORG_ID, ['org.settings'], () =>
        addons.update(ROOT_ADMIN, ROOT_ORG_ID, 'hr', {
          settings: { payslipSignatoryName: 'Root Own' },
        }),
      );
      const root = await addons.hrConfig(ROOT_ORG_ID);
      assert.equal(root.signatory?.name, 'Root Own', 'own signatory wins');
      assert.equal(
        root.timesheetWarnings?.senderEmail,
        'hr@platform.test',
        'timesheet still on the env fallback',
      );
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  // --- domains: DNS verify (mocked), one verified owner --------------------
  {
    const db = fakeDb();
    db.addOrg({ id: ORG_A });
    db.addOrg({ id: ORG_B });
    db.addOrg({ id: ROOT_ORG_ID, isRoot: true, emailDomain: 'platform.test' });
    const txt = new Map<string, string[][] | Error>();
    const resolver: TxtResolver = async (domain) => {
      const r = txt.get(domain);
      if (r instanceof Error) throw r;
      return r ?? [];
    };
    const audit = auditSink();
    const domains = new OrganizationDomainsService(db.prisma, audit.log, resolver);
    const asA = <T>(fn: () => Promise<T>) => asUser(ADMIN_A, ORG_A, ['org.settings'], fn);
    const asB = <T>(fn: () => Promise<T>) => asUser(ADMIN_B, ORG_B, ['org.settings'], fn);

    const a = await asA(() => domains.add(ADMIN_A, ORG_A, { domain: 'acme.test' }));
    assert.equal(a.verified, false);
    assert.match(a.txtRecordValue, /^iwm-verification=[0-9a-f]{32}$/);
    assert.equal(a.txtRecordName, 'acme.test');
    // B may add the same domain while nobody verified it (no squatting).
    const b = await asB(() => domains.add(ADMIN_B, ORG_B, { domain: 'acme.test' }));

    // No record yet / DNS errors / timeout: 422 with a reason.
    await assert.rejects(
      asA(() => domains.verify(ADMIN_A, ORG_A, a.id)),
      (e: unknown) => status(e) === 422 && code(e) === 'domain-verification-failed',
    );
    txt.set('acme.test', Object.assign(new Error('no data'), { code: 'ENODATA' }));
    await assert.rejects(
      asA(() => domains.verify(ADMIN_A, ORG_A, a.id)),
      (e: unknown) => status(e) === 422,
    );
    txt.set('acme.test', new DnsLookupTimeout());
    await assert.rejects(
      asA(() => domains.verify(ADMIN_A, ORG_A, a.id)),
      (e: unknown) => status(e) === 422 && /timed out/.test(detailOf(e)),
    );
    // B's token on the domain does not verify A.
    txt.set('acme.test', [[b.txtRecordValue.slice(0, 20), b.txtRecordValue.slice(20)]]);
    await assert.rejects(
      asA(() => domains.verify(ADMIN_A, ORG_A, a.id)),
      (e: unknown) => status(e) === 422,
    );

    // A's record (split into chunks, as DNS may return it) verifies A.
    txt.set('acme.test', [
      ['v=spf1 -all'],
      [a.txtRecordValue.slice(0, 10), a.txtRecordValue.slice(10)],
    ]);
    const verified = await asA(() => domains.verify(ADMIN_A, ORG_A, a.id));
    assert.equal(verified.verified, true);
    assert.ok(audit.emitted.some((e) => e.action === 'org.domain_verified'));

    // Only one org can verify it: B is refused, even with its own record.
    txt.set('acme.test', [[b.txtRecordValue]]);
    await assert.rejects(
      asB(() => domains.verify(ADMIN_B, ORG_B, b.id)),
      (e: unknown) => status(e) === 409 && code(e) === 'domain-claimed',
    );
    await assert.rejects(
      asB(() => domains.add(ADMIN_B, ORG_B, { domain: 'acme.test' })),
      (e: unknown) => status(e) === 409,
    );
    // The legacy emailDomain counts as a claim too.
    await assert.rejects(
      asB(() => domains.add(ADMIN_B, ORG_B, { domain: 'platform.test' })),
      (e: unknown) => code(e) === 'domain-claimed',
    );
    // Backstop: the unique column refuses a second verified owner.
    db.domains.find((d) => d.id === b.id)!.verifiedDomain = null;
    await assert.rejects(
      (db.prisma.client.organizationDomain.update as (a: unknown) => Promise<unknown>)({
        where: { id: b.id },
        data: { verifiedDomain: 'acme.test' },
      }),
      (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002',
    );

    // Claims: A owns acme.test now; B cannot put people on it.
    assert.equal(await claimingOrgIdFor(db.prisma, 'acme.test'), ORG_A);
    assert.equal(
      await claimingOrgIdFor(db.prisma, 'platform.test'),
      ROOT_ORG_ID,
      'legacy root domain still claimed',
    );
    await assert.rejects(
      assertNotVerifiedElsewhere(db.prisma, ORG_B, 'new@acme.test'),
      (e: unknown) => code(e) === 'email-domain-not-allowed',
    );
    await assertNotVerifiedElsewhere(db.prisma, ORG_A, 'new@acme.test');
    await assertNotVerifiedElsewhere(db.prisma, ORG_B, 'new@platform.test'); // legacy column: unchanged invites

    // Admin user creation in B on A's domain is refused (assertEmailDomainAllowed).
    const admin = new AdminUsersService(
      db.prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await assert.rejects(
      admin.assertEmailDomainAllowed(ORG_B, 'x@acme.test'),
      (e: unknown) => code(e) === 'email-domain-not-allowed',
    );
    await admin.assertEmailDomainAllowed(ORG_A, 'x@acme.test');

    // Routing: an org-less verified staff account on acme.test joins A;
    // unverified, client, or legacy-domain accounts are not routed.
    const route = new OrganizationAutoRouteService(db.prisma);
    db.addUser({ id: 'u_staff', email: 'p@acme.test' });
    db.addUser({ id: 'u_unverified', email: 'q@acme.test', emailVerified: false });
    db.addUser({ id: 'u_client', email: 'c@acme.test', accountType: 'CLIENT' });
    db.addUser({ id: 'u_legacy', email: 'l@platform.test' });
    assert.equal(await route.attachOnBootstrap('u_staff', 'p@acme.test'), ORG_A);
    assert.equal(db.users.get('u_staff')?.organizationId, ORG_A);
    assert.equal(await route.attachOnBootstrap('u_unverified', 'q@acme.test'), null);
    assert.equal(await route.attachOnBootstrap('u_client', 'c@acme.test'), null);
    assert.equal(
      await route.attachOnBootstrap('u_legacy', 'l@platform.test'),
      null,
      'legacy column never routes',
    );

    // AuthGuard: the bootstrap request that routes the account uses the fresh
    // context (organization, role, permissions) and checks it again.
    class RoutedController {
      handle(): void {}
    }
    const guardRun = async (after: { orgInactive?: boolean; userDisabled?: boolean } = {}) => {
      let resolutions = 0;
      const fakeAuth = {
        getSessionFromRequest: async () => ({
          user: { id: 'u_new', email: 'n@acme.test', name: 'N', emailVerified: true, image: null },
          session: { id: 's_new' },
        }),
        resolveRequestContext: async () => {
          resolutions += 1;
          const routed = resolutions > 1;
          return {
            extras: {
              systemRole: routed ? 'EMPLOYEE' : 'USER',
              organizationId: routed ? ORG_A : null,
              accountType: 'STAFF',
              orgInactive: routed && after.orgInactive === true,
              userDisabled: routed && after.userDisabled === true,
            },
            session: routed
              ? {
                  currentWorkspaceId: 'w_a',
                  workspaceMemberships: [{ workspaceId: 'w_a', role: 'MEMBER' }],
                  projectMemberships: [],
                }
              : { currentWorkspaceId: null, workspaceMemberships: [], projectMemberships: [] },
            permissions: routed
              ? { company: ['org.view'], workspace: [] }
              : { company: [], workspace: [] },
          };
        },
        ensureBootstrapWorkspace: async () => 'w_a',
      };
      const authGuard = new AuthGuard(new Reflector(), fakeAuth as never);
      const req: Record<string, unknown> = { headers: {}, method: 'GET', url: '/x' };
      const ctx = {
        getType: () => 'http',
        getHandler: () => RoutedController.prototype.handle,
        getClass: () => RoutedController,
        switchToHttp: () => ({ getRequest: () => req }),
      } as unknown as ExecutionContext;
      return new Promise<{
        req: Record<string, unknown>;
        auth: ReturnType<typeof currentRequestAuth>;
        err: unknown;
      }>((resolve) => {
        new RequestContextMiddleware().use({} as Request, {} as Response, () => {
          authGuard.canActivate(ctx).then(
            () => resolve({ req, auth: currentRequestAuth(), err: null }),
            (err: unknown) => resolve({ req, auth: currentRequestAuth(), err }),
          );
        });
      });
    };
    {
      const r = await guardRun();
      assert.equal(r.err, null);
      const user = r.req.user as { organizationId: string | null; systemRole: string };
      assert.equal(user.organizationId, ORG_A, 'req.user follows the fresh context');
      assert.equal(user.systemRole, 'EMPLOYEE');
      assert.equal(
        r.auth?.organizationId,
        ORG_A,
        'request auth snapshot follows the fresh context',
      );
      assert.equal(r.auth?.systemRole, 'EMPLOYEE');
      assert.deepEqual(r.auth?.permissions.company, ['org.view']);
    }
    assert.equal(
      status((await guardRun({ orgInactive: true })).err),
      401,
      'routed into a suspended org: refused',
    );
    assert.equal(
      status((await guardRun({ userDisabled: true })).err),
      401,
      'disabled on the fresh read: refused',
    );

    // Remove frees the domain.
    await asA(() => domains.remove(ADMIN_A, ORG_A, a.id));
    assert.equal(await claimingOrgIdFor(db.prisma, 'acme.test'), null);
    // Members and support sessions cannot manage domains.
    await assert.rejects(
      asUser(MEMBER_A, ORG_A, [], () => domains.list(MEMBER_A, ORG_A)),
      (e: unknown) => status(e) === 403,
    );
    await assert.rejects(
      asUser(
        SUPER,
        ORG_A,
        ['org.settings'],
        () => domains.add(SUPER, ORG_A, { domain: 'z.test' }),
        { support: true },
      ),
      (e: unknown) => status(e) === 403,
    );
  }

  console.log('check-addons: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
