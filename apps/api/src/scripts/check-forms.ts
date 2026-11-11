/**
 * Form builder self-checks (no database, no Redis, no S3).
 *
 * Covered:
 *  - every FormsController handler carries @RequireAbility (PermissionsGuard
 *    default-allows a handler without one) and the public controller is
 *    @Public + @SkipPermissions;
 *  - CASL: MEMBER may create/update forms, VIEWER may only read (fill);
 *  - access rules: owner, workspace admin, org admin, plain member, another
 *    workspace and an outside collaborator, for manage and fill;
 *  - open state: draft, closed, past close date, response limit;
 *  - upload policies: accept lists, wildcards, extensions, signature PNG, caps;
 *  - FormsService: a non-owner member gets 404 on a form, `scope=all` is admins only;
 *  - FormFillService on a fake Prisma: a honeypot fill stores nothing, an
 *    instant submit is asked to wait, a missing fill time is a 400, the 21st
 *    submit in an hour is a 429, a closed form and any version but the
 *    current one are 409s (submit and upload tickets), tickets go to the forms
 *    bucket and stop at the pending-bytes cap, IPv6 limits are per /64,
 *    invalid answers are a 400 keyed by field, an upload from another form is
 *    refused, the response limit holds inside the transaction, a good public
 *    submit stores clean answers, attaches its upload and notifies a
 *    still-member owner by an email without answers, and in-app CRM picks
 *    respect the workspace and the person's sales access.
 *
 * Run: pnpm --filter @botss/api test
 */
import 'reflect-metadata';

import assert from 'node:assert/strict';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { defineAbilityFor } from '@botss/auth';
import type { WorkspaceRole } from '@botss/shared-types';

import type { SalesActor } from '../common/decorators/sales-actor.decorator';
import type { UserScope } from '../common/decorators/user-scope.decorator';
import type { EmailService } from '../email/email.service';
import type { FilesService } from '../files/files.service';
import { FormFillService, type FillTarget } from '../forms/form-fill.service';
import {
  canFillForm,
  canManageForm,
  formOpenState,
  ipRateKey,
  uploadPolicy,
  type FormAccessFacts,
} from '../forms/form-rules';
import { FormsController } from '../forms/forms.controller';
import { FormsService } from '../forms/forms.service';
import { PublicFormsController } from '../forms/public-forms.controller';
import type { TurnstileClient } from '../forms/turnstile.client';
import type { AuditLogService } from '../audit-log/audit-log.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';

let failures = 0;
const pending: Promise<void>[] = [];
function check(name: string, fn: () => void | Promise<void>): void {
  pending.push(
    (async () => {
      try {
        await fn();
        console.log(`ok   ${name}`);
      } catch (err) {
        failures++;
        console.error(`FAIL ${name}: ${(err as Error).stack ?? (err as Error).message}`);
      }
    })(),
  );
}

async function rejects<T extends new (...a: never[]) => Error>(
  p: Promise<unknown>,
  type: T,
  status?: number,
): Promise<Error> {
  try {
    await p;
  } catch (e) {
    assert.ok(
      e instanceof type,
      `expected ${type.name}, got ${(e as Error)?.constructor?.name}: ${(e as Error)?.message}`,
    );
    if (status !== undefined) assert.equal((e as HttpException).getStatus(), status);
    return e as Error;
  }
  throw new Error(`expected ${type.name}, resolved instead`);
}

const WS = 'cmws00000000000000000000a';
const WS_OTHER = 'cmws00000000000000000000b';
const OWNER = 'cmowner000000000000000000';
const MEMBER = 'cmmember00000000000000000';
const FORM = 'cmform0000000000000000000';

const scope = (over: Partial<UserScope> = {}): UserScope => ({
  userId: MEMBER,
  workspaceIds: [WS],
  projectIds: [],
  currentWorkspaceId: WS,
  workspaceRole: 'MEMBER',
  seesEveryProject: false,
  ...over,
});

const facts = (over: Partial<FormAccessFacts> = {}): FormAccessFacts => ({
  workspaceId: WS,
  createdById: OWNER,
  status: 'PUBLISHED',
  publishedVersion: 1,
  internalAccess: 'NONE',
  ...over,
});

// ─── Decorators ─────────────────────────────────────────────────────────────

check('every FormsController handler has @RequireAbility', () => {
  const proto = FormsController.prototype as unknown as Record<string, unknown>;
  const names = Object.getOwnPropertyNames(proto).filter(
    (n) => n !== 'constructor' && typeof proto[n] === 'function',
  );
  assert.ok(names.length >= 20, `expected the full route set, saw ${names.length}`);
  for (const n of names) {
    const meta = Reflect.getMetadata('requiredAbility', proto[n] as object) as
      | { subject?: string }
      | undefined;
    assert.ok(meta, `${n} lacks @RequireAbility`);
    assert.equal(meta.subject, 'Form', `${n} checks ${meta.subject}`);
  }
});

check('the public controller is @Public and @SkipPermissions at class level', () => {
  const keys = Reflect.getMetadataKeys(PublicFormsController);
  assert.ok(keys.includes('isPublic'), 'not public');
  assert.ok(Reflect.getMetadata('isPublic', PublicFormsController) === true);
  assert.ok(
    keys.some((k) => String(k).toLowerCase().includes('skip')),
    'permissions not skipped',
  );
});

// ─── CASL ───────────────────────────────────────────────────────────────────

check('MEMBER can create and edit forms; VIEWER can only read them', () => {
  const as = (role: WorkspaceRole) =>
    defineAbilityFor({
      userId: 'u1',
      systemRole: 'EMPLOYEE',
      workspaceMemberships: [{ workspaceId: WS, role }],
      projectMemberships: [],
    });
  const member = as('MEMBER');
  assert.ok(
    member.can('create', 'Form') && member.can('update', 'Form') && member.can('read', 'Form'),
  );
  const viewer = as('VIEWER');
  assert.ok(viewer.can('read', 'Form'), 'viewer must be able to fill a shared form');
  assert.ok(
    !viewer.can('create', 'Form') && !viewer.can('update', 'Form') && !viewer.can('delete', 'Form'),
  );
  assert.ok(as('OWNER').can('manage', 'Form'));
});

// ─── Access rules ───────────────────────────────────────────────────────────

check('manage: owner and admins only, never across workspaces', () => {
  assert.ok(canManageForm(scope({ userId: OWNER }), facts()), 'owner');
  assert.ok(
    canManageForm(scope({ seesEveryProject: true, workspaceRole: 'ADMIN' }), facts()),
    'workspace admin',
  );
  assert.ok(
    canManageForm(
      scope({ seesEveryProject: true, workspaceIds: [], workspaceRole: null }),
      facts(),
    ),
    'org admin',
  );
  assert.ok(!canManageForm(scope(), facts()), 'plain member');
  assert.ok(
    !canManageForm(
      scope({ userId: OWNER, currentWorkspaceId: WS_OTHER, workspaceIds: [WS_OTHER] }),
      facts(),
    ),
    'other workspace',
  );
  assert.ok(
    !canManageForm(scope({ seesEveryProject: true, currentWorkspaceId: WS_OTHER }), facts()),
    'admin of another workspace',
  );
  assert.ok(
    !canManageForm(scope({ userId: OWNER, workspaceIds: [] }), facts()),
    'owner who left the workspace',
  );
});

check('fill: by access mode, never drafts or outsiders', () => {
  assert.ok(!canFillForm(scope(), facts({ internalAccess: 'NONE' }), false));
  assert.ok(canFillForm(scope(), facts({ internalAccess: 'WORKSPACE' }), false));
  assert.ok(!canFillForm(scope(), facts({ internalAccess: 'SELECTED' }), false));
  assert.ok(canFillForm(scope(), facts({ internalAccess: 'SELECTED' }), true));
  assert.ok(
    !canFillForm(
      scope(),
      facts({ internalAccess: 'WORKSPACE', status: 'DRAFT', publishedVersion: 0 }),
      true,
    ),
  );
  assert.ok(
    !canFillForm(scope({ workspaceIds: [] }), facts({ internalAccess: 'WORKSPACE' }), true),
    'outside collaborator',
  );
  assert.ok(
    canFillForm(scope({ userId: OWNER }), facts({ internalAccess: 'NONE' }), false),
    'owner can test their form',
  );
});

check('open state', () => {
  const now = new Date('2026-11-09T12:00:00Z');
  const base = {
    status: 'PUBLISHED' as const,
    publishedVersion: 1,
    closesAt: null,
    responseLimit: null,
  };
  assert.deepEqual(formOpenState(base, 0, now), { open: true });
  assert.deepEqual(formOpenState({ ...base, status: 'DRAFT', publishedVersion: 0 }, 0, now), {
    open: false,
    reason: 'not_published',
  });
  assert.deepEqual(formOpenState({ ...base, status: 'CLOSED' }, 0, now), {
    open: false,
    reason: 'closed',
  });
  assert.deepEqual(formOpenState({ ...base, closesAt: now }, 0, now), {
    open: false,
    reason: 'past_close_date',
  });
  assert.deepEqual(formOpenState({ ...base, responseLimit: 3 }, 3, now), {
    open: false,
    reason: 'limit_reached',
  });
  assert.deepEqual(formOpenState({ ...base, responseLimit: 3 }, 2, now), { open: true });
});

check('upload policies', () => {
  const MB = 1024 * 1024;
  const file = uploadPolicy(
    {
      id: 'f',
      type: 'file_upload',
      label: 'F',
      required: false,
      maxFiles: 1,
      maxSizeMb: 5,
      accept: ['application/pdf', 'image/*', '.docx'],
    },
    250 * MB,
  )!;
  assert.equal(file.maxBytes, 5 * MB);
  assert.ok(
    file.accepts('application/pdf', 'a.pdf') &&
      file.accepts('image/png', 'a.png') &&
      file.accepts('application/octet-stream', 'cv.DOCX'),
  );
  assert.ok(!file.accepts('text/html', 'x.html'));
  const sig = uploadPolicy({ id: 's', type: 'signature', label: 'S', required: false }, 250 * MB)!;
  assert.ok(sig.accepts('image/png', 'sig.png') && !sig.accepts('image/svg+xml', 'sig.svg'));
  const capped = uploadPolicy(
    { id: 'v', type: 'video_recording', label: 'V', required: false, maxSeconds: 60 },
    10 * MB,
  )!;
  assert.equal(capped.maxBytes, 10 * MB, 'deployment cap wins');
  assert.equal(
    uploadPolicy({ id: 't', type: 'short_text', label: 'T', required: false }, MB),
    null,
  );
});

// ─── FormsService (fake Prisma) ─────────────────────────────────────────────

function formRow(over: Record<string, unknown> = {}) {
  return {
    id: FORM,
    workspaceId: WS,
    createdById: OWNER,
    title: 'Survey',
    description: null,
    status: 'PUBLISHED',
    draft: { fields: [] },
    publishedVersion: 1,
    internalAccess: 'WORKSPACE',
    publicEnabled: true,
    publicToken: 'x'.repeat(24),
    closesAt: null,
    responseLimit: null,
    settings: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    createdBy: { id: OWNER, name: 'Owner', email: 'o@x.test', image: null },
    workspace: { organizationId: 'org1' },
    ...over,
  };
}

check(
  'FormsService: a plain member gets 404 on someone else form, scope=all is admins only',
  async () => {
    const prisma = {
      client: {
        form: { findFirst: async () => formRow() },
        formAccess: { findUnique: async () => null },
      },
    } as unknown as PrismaService;
    const svc = new FormsService(
      prisma,
      {} as NotificationsService,
      { emit: async () => {} } as unknown as AuditLogService,
    );
    await rejects(svc.get(scope(), WS, FORM), NotFoundException, 404);
    await rejects(svc.update(scope(), WS, FORM, { title: 'x' }), NotFoundException, 404);
    await rejects(
      svc.loadManaged(scope({ currentWorkspaceId: WS_OTHER }), WS, FORM),
      NotFoundException,
      404,
    );
    await rejects(
      svc.list(scope(), WS, { scope: 'all', page: 1, pageSize: 20 }),
      ForbiddenException,
      403,
    );
  },
);

// ─── FormFillService (fake Prisma) ──────────────────────────────────────────

const DEF = {
  fields: [
    { id: 'name', type: 'short_text', label: 'Name', required: true },
    {
      id: 'cv',
      type: 'file_upload',
      label: 'CV',
      required: false,
      maxFiles: 1,
      maxSizeMb: 5,
      accept: [],
    },
    {
      id: 'client',
      type: 'crm_picker',
      label: 'Client',
      required: true,
      entity: 'client',
      multiple: false,
    },
  ],
};

const CLIENT_OK = 'cmclient00000000000000000';
const CLIENT_ELSEWHERE = 'cmclientelsewhere00000000';

interface World {
  submissions: Array<Record<string, unknown>>;
  uploads: Array<{
    id: string;
    formId: string;
    fieldId: string;
    status: string;
    uploadedById: string | null;
    objectKey: string;
    mimeType: string;
    fileName: string;
    sizeBytes?: bigint;
    submissionId?: string;
  }>;
  clients: Array<{ id: string; workspaceId: string; assigneeId: string | null }>;
  /** Users who are still members of the form's workspace. */
  members: Set<string>;
  pendingBytes: bigint;
  notified: number;
  emailed: Array<Record<string, unknown>>;
  redisCount: Map<string, number>;
  objects: Map<string, number>;
}

/** Evaluates the small `where` shapes the client checks use: AND, equality, `in`. */
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'AND') return (cond as Record<string, unknown>[]).every((w) => matches(row, w));
    if (cond && typeof cond === 'object' && 'in' in (cond as object)) {
      return (cond as { in: unknown[] }).in.includes(row[k]);
    }
    return row[k] === cond;
  });
}

function makeFill(world: World): FormFillService {
  const tx = {
    $queryRaw: async () => [],
    formSubmission: {
      count: async () => world.submissions.length,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `cmsub${world.submissions.length}`.padEnd(25, '0'),
          createdAt: new Date(),
          ...data,
        };
        world.submissions.push(row);
        return row;
      },
    },
    formUpload: {
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status: string };
        data: { submissionId: string };
      }) => {
        const u = world.uploads.find((x) => x.id === where.id && x.status === where.status);
        if (!u) return { count: 0 };
        u.status = 'ATTACHED';
        u.submissionId = data.submissionId;
        return { count: 1 };
      },
    },
  };
  const prisma = {
    client: {
      formSubmission: { count: async () => world.submissions.length },
      formVersion: {
        findUnique: async ({ where }: { where: { formId_version: { version: number } } }) =>
          where.formId_version.version <= 2
            ? { id: `cmver${where.formId_version.version}`.padEnd(25, '0'), definition: DEF }
            : null,
      },
      formUpload: {
        findMany: async ({
          where,
        }: {
          where: {
            id: { in: string[] };
            formId: string;
            status: string;
            uploadedById: string | null;
          };
        }) =>
          world.uploads.filter(
            (u) =>
              where.id.in.includes(u.id) &&
              u.formId === where.formId &&
              u.status === where.status &&
              u.uploadedById === where.uploadedById,
          ),
        aggregate: async () => ({ _sum: { sizeBytes: world.pendingBytes } }),
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const id = `cmupnew${world.uploads.length}`.padEnd(25, '0');
          world.uploads.push({ ...(data as World['uploads'][number]), id, status: 'PENDING' });
          return { id };
        },
      },
      workspaceMembership: {
        findFirst: async ({ where }: { where: { userId: string } }) =>
          world.members.has(where.userId)
            ? { user: { id: where.userId, email: 'o@x.test' } }
            : null,
      },
      user: { findFirst: async () => ({ name: 'Member' }) },
      client: {
        count: async ({ where }: { where: Record<string, unknown> }) =>
          world.clients.filter((c) => matches(c as unknown as Record<string, unknown>, where))
            .length,
      },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  } as unknown as PrismaService;
  const redis = {
    client: {
      multi: () => {
        let key = '';
        const chain = {
          incr: (k: string) => {
            key = k;
            return chain;
          },
          expire: () => chain,
          exec: async () => {
            const n = (world.redisCount.get(key) ?? 0) + 1;
            world.redisCount.set(key, n);
            return [[null, n]];
          },
        };
        return chain;
      },
    },
  } as unknown as RedisService;
  const files = {
    maxUploadBytes: 250 * 1024 * 1024,
    formsBucket: 'forms-private',
    safeObjectName: (n: string) => n.replace(/[^a-zA-Z0-9._-]+/g, '_'),
    presignObjectUpload: async (a: { bucket: string }) => {
      assert.equal(a.bucket, 'forms-private', 'form uploads go to the forms bucket');
      return { uploadUrl: 'https://s3.test/put', headers: {}, expiresAt: new Date() };
    },
    headObject: async (bucket: string, key: string) => {
      assert.equal(bucket, 'forms-private');
      return world.objects.has(key)
        ? { sizeBytes: world.objects.get(key)!, mimeType: 'application/pdf' }
        : null;
    },
  } as unknown as FilesService;
  const notifications = {
    emit: async () => void world.notified++,
  } as unknown as NotificationsService;
  const email = {
    sendFormSubmission: async (_org: string, args: Record<string, unknown>) =>
      void world.emailed.push(args),
  } as unknown as EmailService;
  const turnstile = { enabled: false, verify: async () => true } as unknown as TurnstileClient;
  return new FormFillService(prisma, redis, files, notifications, email, turnstile);
}

const UP1 = 'cmup100000000000000000000';
const UP2 = 'cmup200000000000000000000';

const newWorld = (): World => ({
  submissions: [],
  uploads: [
    {
      id: UP1,
      formId: FORM,
      fieldId: 'cv',
      status: 'PENDING',
      uploadedById: null,
      objectKey: `workspaces/${WS}/forms/${FORM}/abc-cv.pdf`,
      mimeType: 'application/pdf',
      fileName: 'cv.pdf',
    },
    {
      id: UP2,
      formId: 'cmotherform00000000000000',
      fieldId: 'cv',
      status: 'PENDING',
      uploadedById: null,
      objectKey: `workspaces/${WS}/forms/other/x.pdf`,
      mimeType: 'application/pdf',
      fileName: 'x.pdf',
    },
  ],
  clients: [
    { id: CLIENT_OK, workspaceId: WS, assigneeId: MEMBER },
    { id: 'cmclientnotmine0000000000', workspaceId: WS, assigneeId: OWNER },
  ],
  members: new Set([OWNER, MEMBER]),
  pendingBytes: 0n,
  notified: 0,
  emailed: [],
  redisCount: new Map(),
  objects: new Map([[`workspaces/${WS}/forms/${FORM}/abc-cv.pdf`, 1000]]),
});

const target = (over: Partial<FillTarget> = {}): FillTarget => ({
  id: FORM,
  workspaceId: WS,
  createdById: OWNER,
  title: 'Survey',
  description: null,
  status: 'PUBLISHED',
  publishedVersion: 1,
  closesAt: null,
  responseLimit: null,
  settings: { confirmationMessage: 'Thanks!' },
  workspace: { organizationId: 'org1' },
  ...over,
});

const pub = {
  mode: 'public' as const,
  scope: null,
  sales: null,
  ip: '203.0.113.9',
  userAgent: 'test',
};
const salesFor = (over: Partial<SalesActor> = {}): SalesActor => ({
  userId: MEMBER,
  workspaceId: WS,
  fullAccess: false,
  fullLeads: false,
  fullClients: false,
  financeAccess: false,
  ...over,
});
const internal = (sales = salesFor()) => ({
  mode: 'internal' as const,
  scope: scope(),
  sales,
  ip: '10.0.0.1',
  userAgent: null,
});
const SLOW = 10_000;
const settle = () => new Promise((r) => setTimeout(r, 10));

check(
  'submit: a honeypot fill looks fine but stores nothing; an instant submit is asked to wait',
  async () => {
    const w = newWorld();
    const fill = makeFill(w);
    const r1 = await fill.submit(
      target(),
      { version: 1, answers: { name: 'Bot' }, fillMs: SLOW, website: 'spam.example' },
      pub,
    );
    assert.equal(r1.ok, true);
    const e = await rejects(
      fill.submit(target(), { version: 1, answers: { name: 'Fast' }, fillMs: 300 }, pub),
      BadRequestException,
      400,
    );
    assert.equal(
      ((e as BadRequestException).getResponse() as { code: string }).code,
      'form_too_fast',
    );
    assert.equal(w.submissions.length, 0);
  },
);

check(
  'submit: missing fill time is a 400; the 21st public submit in an hour is a 429',
  async () => {
    const w = newWorld();
    const fill = makeFill(w);
    await rejects(
      fill.submit(target(), { version: 1, answers: { name: 'A' } }, pub),
      BadRequestException,
      400,
    );
    for (let i = 0; i < 19; i++) {
      await fill.submit(target(), { version: 1, answers: { name: `A${i}` }, fillMs: SLOW }, pub);
    }
    await rejects(
      fill.submit(target(), { version: 1, answers: { name: 'x' }, fillMs: SLOW }, pub),
      HttpException,
      429,
    );
    assert.equal(w.submissions.length, 19);
  },
);

check('submit: closed form, a future version and an OLDER version are all 409s', async () => {
  const fill = makeFill(newWorld());
  await rejects(
    fill.submit(
      target({ status: 'CLOSED' }),
      { version: 1, answers: { name: 'A' }, fillMs: SLOW },
      pub,
    ),
    ConflictException,
    409,
  );
  await rejects(
    fill.submit(target(), { version: 2, answers: { name: 'A' }, fillMs: SLOW }, pub),
    ConflictException,
    409,
  );
  await rejects(
    fill.submit(
      target({ publishedVersion: 2 }),
      { version: 1, answers: { name: 'A' }, fillMs: SLOW },
      pub,
    ),
    ConflictException,
    409,
  );
});

check(
  'uploads: an older version gets no ticket; tickets use the forms bucket; pending bytes are capped',
  async () => {
    const w = newWorld();
    const fill = makeFill(w);
    const ticket = {
      version: 1,
      fieldId: 'cv',
      fileName: 'cv.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
    };
    await rejects(
      fill.createUpload(target({ publishedVersion: 2 }), ticket, pub),
      ConflictException,
      409,
    );
    const ok = await fill.createUpload(target(), ticket, pub);
    assert.ok(ok.uploadId);
    w.pendingBytes = 2n * 1024n * 1024n * 1024n;
    await rejects(fill.createUpload(target(), ticket, pub), HttpException, 429);
  },
);

check('uploads: one IPv6 /64 shares a single per-IP limit', async () => {
  assert.equal(ipRateKey('203.0.113.9'), '203.0.113.9');
  assert.equal(ipRateKey('::ffff:203.0.113.9'), '203.0.113.9');
  const a = ipRateKey('2001:db8:85a3:0042:1000:8a2e:0370:7334');
  assert.equal(a, '2001:db8:85a3:42::/64');
  assert.equal(ipRateKey('2001:db8:85a3:42::1'), a);
  assert.equal(ipRateKey('2001:DB8:85A3:42:ffff::9'), a);
  assert.notEqual(ipRateKey('2001:db8:85a3:43::1'), a);
});

check('submit: invalid answers are a 400 keyed by field', async () => {
  const fill = makeFill(newWorld());
  const e = await rejects(
    fill.submit(target(), { version: 1, answers: {}, fillMs: SLOW }, pub),
    BadRequestException,
    400,
  );
  const body = (e as BadRequestException).getResponse() as { errors: Record<string, string[]> };
  assert.deepEqual(Object.keys(body.errors), ['name']);
});

check('submit: an upload from another form is refused', async () => {
  const w = newWorld();
  const fill = makeFill(w);
  await rejects(
    fill.submit(target(), { version: 1, answers: { name: 'A', cv: [UP2] }, fillMs: SLOW }, pub),
    BadRequestException,
    400,
  );
  assert.equal(w.submissions.length, 0);
});

check('submit: response limit is enforced inside the transaction', async () => {
  const w = newWorld();
  w.submissions.push({ id: 'x' });
  const fill = makeFill(w);
  await rejects(
    fill.submit(
      target({ responseLimit: 1 }),
      { version: 1, answers: { name: 'A' }, fillMs: SLOW },
      pub,
    ),
    ConflictException,
    409,
  );
});

check(
  'submit: a good public submit stores clean answers, attaches its upload and notifies the owner without answers',
  async () => {
    const w = newWorld();
    const fill = makeFill(w);
    const res = await fill.submit(
      target(),
      {
        version: 1,
        answers: { name: '  Ali  ', cv: [UP1], client: CLIENT_OK, extra: 'dropped' },
        fillMs: SLOW,
      },
      pub,
    );
    assert.equal(res.confirmationMessage, 'Thanks!');
    assert.equal(w.submissions.length, 1);
    const stored = w.submissions[0]!;
    assert.equal(stored.source, 'PUBLIC');
    assert.equal(stored.submittedById, null);
    assert.deepEqual(
      stored.answers,
      { name: 'Ali', cv: [UP1] },
      'CRM picker and unknown keys are dropped on public fills',
    );
    assert.equal(w.uploads[0]!.status, 'ATTACHED');
    await settle();
    assert.equal(w.notified, 1);
    assert.equal(w.emailed.length, 1);
    assert.deepEqual(
      Object.keys(w.emailed[0]!).sort(),
      ['formTitle', 'submittedBy', 'to', 'url'],
      'no answers in the email',
    );
  },
);

check('submit: an owner who left the workspace is not notified', async () => {
  const w = newWorld();
  w.members.delete(OWNER);
  const fill = makeFill(w);
  await fill.submit(target(), { version: 1, answers: { name: 'A' }, fillMs: SLOW }, pub);
  await settle();
  assert.equal(w.submissions.length, 1);
  assert.equal(w.notified, 0);
  assert.equal(w.emailed.length, 0);
});

check(
  'submit: in-app CRM picks must be in the workspace AND within the person sales access',
  async () => {
    const w = newWorld();
    const fill = makeFill(w);
    await rejects(
      fill.submit(
        target(),
        { version: 1, answers: { name: 'A', client: CLIENT_ELSEWHERE } },
        internal(),
      ),
      BadRequestException,
      400,
    );
    await rejects(
      fill.submit(
        target(),
        { version: 1, answers: { name: 'A', client: 'cmclientnotmine0000000000' } },
        internal(),
      ),
      BadRequestException,
      400,
    );
    await fill.submit(
      target(),
      { version: 1, answers: { name: 'A', client: 'cmclientnotmine0000000000' } },
      internal(salesFor({ fullClients: true })),
    );
    await fill.submit(
      target(),
      { version: 1, answers: { name: 'B', client: CLIENT_OK } },
      internal(),
    );
    assert.equal(w.submissions.length, 2);
    assert.equal(w.submissions[0]!.submittedById, MEMBER);
    assert.equal(w.submissions[0]!.source, 'INTERNAL');
  },
);

void Promise.all(pending).then(() => {
  if (failures > 0) {
    console.error(`\n${failures} form check(s) failed`);
    process.exit(1);
  }
  console.log('\nform checks passed');
});
