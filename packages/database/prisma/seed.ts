import { randomBytes, scryptSync } from 'node:crypto';

import {
  Prisma,
  type LeadSource,
  type LeadStage,
  type ProjectRole,
  type SystemRole,
  type TaskPriority,
  type TaskStatus,
  type WorkspaceRole,
} from '@prisma/client';

import { prisma } from '../src/index.js';

/**
 * Demo seed for local development and the public live demo.
 *
 * Creates the root (platform) organization the API expects, one demo
 * organization with a workspace, a small fictional team, two projects with
 * tasks and an active sprint, leads, clients, an invoice, chat rooms,
 * documents, a form with responses, upcoming meetings and time entries.
 * Everything is fictional (names, companies, @example.com addresses).
 *
 * Idempotent: every row is upserted on a stable id (`seed_<entity>_<slug>`) or
 * unique key, and rows with dates relative to "now" use an empty update, so
 * running it twice changes nothing. It never deletes.
 *
 * Demo sign-in (development only, change or delete before any real use):
 *   email:    DEMO_LOGIN_EMAIL    (default admin@example.com)
 *   password: DEMO_LOGIN_PASSWORD (default demo-admin-password)
 * The other seeded people get random passwords nobody knows: they exist to
 * make the workspace look lived in, not to be signed into.
 *
 * Refuses to run against production: it needs NODE_ENV != production AND
 * ALLOW_SEED=true (`pnpm db:seed:dev` sets both).
 */
const DEMO_ADMIN_EMAIL = process.env.DEMO_LOGIN_EMAIL?.trim() || 'admin@example.com';
const DEMO_ADMIN_PASSWORD = process.env.DEMO_LOGIN_PASSWORD || 'demo-admin-password';
/** Must match ROOT_ORG_ID in apps/api/src/organizations/organizations.constants.ts. */
const ROOT_ORG_ID = 'org_root_thebotss';

function assertSafeEnvironment(): void {
  if (process.env.NODE_ENV === 'production' || process.env.ALLOW_SEED !== 'true') {
    console.error('[seed] Refusing to run. Set NODE_ENV=development and ALLOW_SEED=true to seed.');
    process.exit(1);
  }
}

/**
 * Same format as `hashPassword` in packages/auth (`scrypt$<saltHex>$<hashHex>`,
 * N=16384, r=8, p=1, keylen=64), so Better Auth's sign-in verifies it. Inlined
 * because packages/database must not depend on packages/auth.
 */
function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/** A password nobody knows, for seeded people who are never signed into. */
function unguessablePasswordHash(): string {
  return hashPassword(randomBytes(24).toString('hex'));
}

// ── Time helpers (all UTC, relative to the moment the seed runs) ────────────
const now = new Date();

/** `dayOffset` days from today at hh:mm UTC. */
function atUtc(dayOffset: number, hour = 0, minute = 0): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset, hour, minute),
  );
}

function minutesAgo(minutes: number): Date {
  return new Date(now.getTime() - minutes * 60_000);
}

function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 60_000);
}

/** The last `count` weekdays before today, as day offsets (-1 is yesterday). */
function lastWorkingDays(count: number): number[] {
  const offsets: number[] = [];
  for (let offset = -1; offsets.length < count; offset--) {
    const weekday = atUtc(offset).getUTCDay();
    if (weekday !== 0 && weekday !== 6) offsets.push(offset);
  }
  return offsets;
}

// ── Tiptap helpers ──────────────────────────────────────────────────────────
type TiptapNode = {
  type: string;
  attrs?: Record<string, number>;
  content?: TiptapNode[];
  text?: string;
};

const text = (value: string): TiptapNode => ({ type: 'text', text: value });
const heading = (level: number, value: string): TiptapNode => ({
  type: 'heading',
  attrs: { level },
  content: [text(value)],
});
const paragraph = (value: string): TiptapNode => ({ type: 'paragraph', content: [text(value)] });
const bulletList = (items: string[]): TiptapNode => ({
  type: 'bulletList',
  content: items.map((item) => ({ type: 'listItem', content: [paragraph(item)] })),
});

function tiptapContent(blocks: TiptapNode[]): Prisma.InputJsonValue {
  return { type: 'doc', content: blocks } as unknown as Prisma.InputJsonValue;
}

/** Build a minimal Tiptap doc with a heading + paragraph. */
function tiptapDoc(headingText: string, paragraphText: string): Prisma.InputJsonValue {
  return tiptapContent([heading(1, headingText), paragraph(paragraphText)]);
}

/** Plain text of a block list, for `Document.contentText` (search). */
function plainText(blocks: TiptapNode[]): string {
  const lines: string[] = [];
  const walk = (node: TiptapNode): void => {
    if (node.text) lines.push(node.text);
    node.content?.forEach(walk);
    if (['paragraph', 'heading'].includes(node.type)) lines.push('\n');
  };
  blocks.forEach(walk);
  return lines
    .join(' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Deterministic seed ids (`seed_<entity>_<slug>`) let us upsert without
 * depending on composite unique keys. Runtime rows use cuids.
 */
const ids = {
  organization: 'seed_org_demo',
  project: 'seed_project_demo',
  projectMobile: 'seed_project_mobile',
  task: (position: number) => `seed_task_demo_${position}`,
  document: 'seed_document_welcome',
};

type PersonKey = 'admin' | 'maya' | 'ravi' | 'lena' | 'tomas';
type People = Record<PersonKey, { id: string; name: string; email: string }>;

interface PersonSpec {
  key: Exclude<PersonKey, 'admin'>;
  name: string;
  email: string;
  timezone: string;
  systemRole: SystemRole;
  workspaceRole: WorkspaceRole;
}

const TEAM: PersonSpec[] = [
  {
    key: 'maya',
    name: 'Maya Okafor',
    email: 'maya.okafor@example.com',
    timezone: 'America/New_York',
    systemRole: 'PROJECT_MANAGER',
    workspaceRole: 'MANAGER',
  },
  {
    key: 'ravi',
    name: 'Ravi Menon',
    email: 'ravi.menon@example.com',
    timezone: 'Asia/Singapore',
    systemRole: 'EMPLOYEE',
    workspaceRole: 'MEMBER',
  },
  {
    key: 'lena',
    name: 'Lena Fischer',
    email: 'lena.fischer@example.com',
    timezone: 'Europe/Berlin',
    systemRole: 'EMPLOYEE',
    workspaceRole: 'MEMBER',
  },
  {
    key: 'tomas',
    name: 'Tomas Silva',
    email: 'tomas.silva@example.com',
    timezone: 'Europe/Lisbon',
    systemRole: 'EMPLOYEE',
    workspaceRole: 'MEMBER',
  },
];

// ── People ──────────────────────────────────────────────────────────────────
async function seedPeople(
  organizationId: string,
  workspaceId: string,
  admin: { id: string; name: string; email: string },
): Promise<People> {
  const people: People = {
    admin,
    maya: { id: '', name: '', email: '' },
    ravi: { id: '', name: '', email: '' },
    lena: { id: '', name: '', email: '' },
    tomas: { id: '', name: '', email: '' },
  };
  for (const spec of TEAM) {
    const user = await prisma.user.upsert({
      where: { email: spec.email },
      update: {},
      create: {
        email: spec.email,
        name: spec.name,
        emailVerified: true,
        timezone: spec.timezone,
        systemRole: spec.systemRole,
        organizationId,
      },
    });
    // Password only on first creation; nobody is meant to sign in as these people.
    await prisma.account.upsert({
      where: { providerId_accountId: { providerId: 'credential', accountId: user.id } },
      update: {},
      create: {
        userId: user.id,
        providerId: 'credential',
        accountId: user.id,
        password: unguessablePasswordHash(),
      },
    });
    await prisma.workspaceMembership.upsert({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
      update: {},
      create: { workspaceId, userId: user.id, role: spec.workspaceRole, invitedById: admin.id },
    });
    people[spec.key] = { id: user.id, name: spec.name, email: spec.email };
  }
  return people;
}

// ── Projects, tasks, sprint ─────────────────────────────────────────────────
interface TaskSpec {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** Position inside its board column. */
  position: number;
  assignee: PersonKey | null;
  /** Due date in days from today (negative = past); null = no due date. */
  dueInDays: number | null;
  estimateHours?: number;
}

const DEMO_TASKS: TaskSpec[] = [
  {
    id: ids.task(1),
    title: 'Invite your team',
    status: 'TODO',
    priority: 'MEDIUM',
    position: 1,
    assignee: 'admin',
    dueInDays: null,
  },
  {
    id: ids.task(2),
    title: 'Create your first client',
    status: 'BACKLOG',
    priority: 'MEDIUM',
    position: 2,
    assignee: 'admin',
    dueInDays: null,
  },
  {
    id: ids.task(3),
    title: 'Explore the project board',
    status: 'IN_PROGRESS',
    priority: 'MEDIUM',
    position: 3,
    assignee: 'admin',
    dueInDays: null,
  },
  {
    id: ids.task(4),
    title: 'Audit current site content',
    description: 'List every page, mark what to keep, merge or drop.',
    status: 'DONE',
    priority: 'HIGH',
    position: 1,
    assignee: 'maya',
    dueInDays: -6,
    estimateHours: 6,
  },
  {
    id: ids.task(5),
    title: 'Define sitemap and navigation',
    status: 'DONE',
    priority: 'MEDIUM',
    position: 2,
    assignee: 'ravi',
    dueInDays: -3,
    estimateHours: 4,
  },
  {
    id: ids.task(6),
    title: 'Design homepage wireframes',
    description: 'Low fidelity layouts for desktop and mobile, ready for review.',
    status: 'IN_REVIEW',
    priority: 'HIGH',
    position: 1,
    assignee: 'lena',
    dueInDays: 1,
    estimateHours: 12,
  },
  {
    id: ids.task(7),
    title: 'Build responsive hero section',
    description: 'Hero with headline, call to action and an optimised image.',
    status: 'IN_PROGRESS',
    priority: 'URGENT',
    position: 4,
    assignee: 'ravi',
    dueInDays: 2,
    estimateHours: 8,
  },
  {
    id: ids.task(8),
    title: 'Write pricing page copy',
    status: 'TODO',
    priority: 'MEDIUM',
    position: 2,
    assignee: 'admin',
    dueInDays: 5,
    estimateHours: 5,
  },
  {
    id: ids.task(9),
    title: 'Set up analytics and consent banner',
    status: 'BACKLOG',
    priority: 'LOW',
    position: 3,
    assignee: 'lena',
    dueInDays: 12,
    estimateHours: 3,
  },
  {
    id: ids.task(10),
    title: 'Evaluate third party chat widget',
    status: 'CANCELLED',
    priority: 'LOW',
    position: 1,
    assignee: null,
    dueInDays: null,
  },
];

const mobileTask = (n: number): string => `seed_task_mobile_${n}`;

const MOBILE_TASKS: TaskSpec[] = [
  {
    id: mobileTask(1),
    title: 'Define MVP scope',
    status: 'DONE',
    priority: 'HIGH',
    position: 1,
    assignee: 'maya',
    dueInDays: -10,
    estimateHours: 8,
  },
  {
    id: mobileTask(2),
    title: 'Design onboarding flow',
    status: 'DONE',
    priority: 'MEDIUM',
    position: 2,
    assignee: 'lena',
    dueInDays: -5,
    estimateHours: 10,
  },
  {
    id: mobileTask(3),
    title: 'Implement login and sessions',
    status: 'IN_REVIEW',
    priority: 'HIGH',
    position: 1,
    assignee: 'ravi',
    dueInDays: 1,
    estimateHours: 14,
  },
  {
    id: mobileTask(4),
    title: 'Build shipment list screen',
    description: 'Paged list with pull to refresh and status filters.',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    position: 1,
    assignee: 'ravi',
    dueInDays: 3,
    estimateHours: 16,
  },
  {
    id: mobileTask(5),
    title: 'Push notification setup',
    status: 'IN_PROGRESS',
    priority: 'MEDIUM',
    position: 2,
    assignee: 'lena',
    dueInDays: 4,
    estimateHours: 6,
  },
  {
    id: mobileTask(6),
    title: 'Offline mode for the driver app',
    status: 'TODO',
    priority: 'URGENT',
    position: 1,
    assignee: 'ravi',
    dueInDays: 6,
    estimateHours: 20,
  },
  {
    id: mobileTask(7),
    title: 'Prepare store listing assets',
    status: 'TODO',
    priority: 'LOW',
    position: 2,
    assignee: 'admin',
    dueInDays: 9,
    estimateHours: 4,
  },
  {
    id: mobileTask(8),
    title: 'Recruit beta testers',
    status: 'BACKLOG',
    priority: 'MEDIUM',
    position: 1,
    assignee: 'maya',
    dueInDays: null,
  },
];

async function seedMemberships(
  projectId: string,
  roles: Partial<Record<PersonKey, ProjectRole>>,
  people: People,
): Promise<void> {
  for (const [key, role] of Object.entries(roles) as [PersonKey, ProjectRole][]) {
    await prisma.projectMembership.upsert({
      where: { projectId_userId: { projectId, userId: people[key].id } },
      update: key === 'admin' ? { role } : {},
      create: { projectId, userId: people[key].id, role },
    });
  }
}

async function seedTasks(projectId: string, specs: TaskSpec[], people: People): Promise<void> {
  for (const t of specs) {
    const dueAt = t.dueInDays === null ? null : atUtc(t.dueInDays, 17);
    await prisma.task.upsert({
      where: { id: t.id },
      update: {},
      create: {
        id: t.id,
        projectId,
        createdById: people.admin.id,
        assigneeId: t.assignee ? people[t.assignee].id : null,
        title: t.title,
        description: t.description ?? null,
        status: t.status,
        priority: t.priority,
        position: t.position,
        dueDate: dueAt,
        estimateHours: t.estimateHours ?? null,
        completedAt: t.status === 'DONE' ? (dueAt ?? minutesAgo(24 * 60)) : null,
      },
    });
  }
}

async function seedSprint(projectId: string, people: People): Promise<void> {
  const sprintId = 'seed_sprint_mobile_3';
  await prisma.sprint.upsert({
    where: { id: sprintId },
    update: {},
    create: {
      id: sprintId,
      projectId,
      name: 'Sprint 3',
      goal: 'Ship login, the shipment list and push notifications to the beta group.',
      startDate: atUtc(-4),
      endDate: atUtc(10),
      status: 'ACTIVE',
    },
  });
  const sprintTaskNumbers = [3, 4, 5, 6, 7];
  for (const [index, n] of sprintTaskNumbers.entries()) {
    await prisma.sprintTask.upsert({
      where: { sprintId_taskId: { sprintId, taskId: mobileTask(n) } },
      update: {},
      create: {
        id: `seed_sprinttask_mobile_${n}`,
        sprintId,
        taskId: mobileTask(n),
        position: index,
        addedById: people.maya.id,
      },
    });
  }
}

// ── Clients and leads ───────────────────────────────────────────────────────
interface ClientSpec {
  id: string;
  name: string;
  legalName: string;
  email: string;
  industry: string;
  city: string;
  country: string;
  website: string;
  contact: { name: string; email: string; role: 'PRIMARY' | 'MEMBER' };
}

const CLIENTS: ClientSpec[] = [
  {
    id: 'seed_client_northwind',
    name: 'Northwind Studio',
    legalName: 'Northwind Studio Ltd',
    email: 'hello@example.com',
    industry: 'Design agency',
    city: 'Lisbon',
    country: 'PT',
    website: 'https://northwind.example.com',
    contact: { name: 'Priya Nair', email: 'priya.nair@example.com', role: 'PRIMARY' },
  },
  {
    id: 'seed_client_bluefin',
    name: 'Bluefin Logistics',
    legalName: 'Bluefin Logistics GmbH',
    email: 'office@example.com',
    industry: 'Freight and logistics',
    city: 'Hamburg',
    country: 'DE',
    website: 'https://bluefin.example.com',
    contact: { name: 'Marcus Webb', email: 'marcus.webb@example.com', role: 'PRIMARY' },
  },
];

async function seedClients(workspaceId: string, people: People): Promise<void> {
  for (const c of CLIENTS) {
    await prisma.client.upsert({
      where: { id: c.id },
      update: {},
      create: {
        id: c.id,
        workspaceId,
        createdById: people.tomas.id,
        assigneeId: people.tomas.id,
        name: c.name,
        legalName: c.legalName,
        email: c.email,
        website: c.website,
        industry: c.industry,
        status: 'ACTIVE',
        city: c.city,
        country: c.country,
        tags: ['demo'],
      },
    });
    // Portal contacts are CLIENT accounts: no organization, no workspace.
    const portalUser = await prisma.user.upsert({
      where: { email: c.contact.email },
      update: {},
      create: {
        email: c.contact.email,
        name: c.contact.name,
        emailVerified: true,
        accountType: 'CLIENT',
        organizationId: null,
      },
    });
    await prisma.account.upsert({
      where: { providerId_accountId: { providerId: 'credential', accountId: portalUser.id } },
      update: {},
      create: {
        userId: portalUser.id,
        providerId: 'credential',
        accountId: portalUser.id,
        password: unguessablePasswordHash(),
      },
    });
    await prisma.clientContact.upsert({
      where: { clientId_userId: { clientId: c.id, userId: portalUser.id } },
      update: {},
      create: {
        id: `seed_contact_${c.id.replace('seed_client_', '')}`,
        clientId: c.id,
        userId: portalUser.id,
        role: c.contact.role,
        invitedById: people.admin.id,
      },
    });
  }
}

interface LeadSpec {
  slug: string;
  name: string;
  email: string;
  company: string;
  jobTitle: string;
  source: LeadSource;
  stage: LeadStage;
  estimatedValue: number;
  notes: string;
  followupInDays?: number;
}

const LEADS: LeadSpec[] = [
  {
    slug: 'lumen',
    name: 'Hannah Brooks',
    email: 'hannah.brooks@example.com',
    company: 'Lumen Bakery Co',
    jobTitle: 'Owner',
    source: 'WEBSITE',
    stage: 'NEW',
    estimatedValue: 3500,
    notes: 'Filled in the contact form asking about an online ordering page.',
  },
  {
    slug: 'harborview',
    name: 'Daniel Okoye',
    email: 'daniel.okoye@example.com',
    company: 'Harborview Dental',
    jobTitle: 'Practice Manager',
    source: 'REFERRAL',
    stage: 'QUALIFIED',
    estimatedValue: 8200,
    notes: 'Referred by an existing client. Wants a booking portal.',
  },
  {
    slug: 'pinecrest',
    name: 'Sofia Alvarez',
    email: 'sofia.alvarez@example.com',
    company: 'Pinecrest Outfitters',
    jobTitle: 'Head of E-commerce',
    source: 'EVENT',
    stage: 'CONTACTED',
    estimatedValue: 14500,
    notes: 'Met at a retail meetup. Sent an intro email.',
    followupInDays: 2,
  },
  {
    slug: 'quartzline',
    name: 'Jonas Becker',
    email: 'jonas.becker@example.com',
    company: 'Quartzline Analytics',
    jobTitle: 'CTO',
    source: 'COLD_OUTREACH',
    stage: 'DEMO_SCHEDULED',
    estimatedValue: 22000,
    notes: 'Demo booked for later this week.',
    followupInDays: 3,
  },
  {
    slug: 'redwood',
    name: 'Aisha Rahman',
    email: 'aisha.rahman@example.com',
    company: 'Redwood Fitness',
    jobTitle: 'Operations Director',
    source: 'PARTNER',
    stage: 'PROPOSAL',
    estimatedValue: 18000,
    notes: 'Proposal sent, waiting for feedback from their finance team.',
  },
  {
    slug: 'saltmarsh',
    name: 'Viktor Lindqvist',
    email: 'viktor.lindqvist@example.com',
    company: 'Saltmarsh Foods',
    jobTitle: 'Founder',
    source: 'SOCIAL',
    stage: 'NEGOTIATION',
    estimatedValue: 31000,
    notes: 'Negotiating scope and a phased payment plan.',
  },
];

async function seedLeads(workspaceId: string, people: People): Promise<void> {
  for (const l of LEADS) {
    await prisma.lead.upsert({
      where: { id: `seed_lead_${l.slug}` },
      update: {},
      create: {
        id: `seed_lead_${l.slug}`,
        workspaceId,
        createdById: people.tomas.id,
        assigneeId: people.tomas.id,
        name: l.name,
        email: l.email,
        company: l.company,
        jobTitle: l.jobTitle,
        source: l.source,
        stage: l.stage,
        estimatedValue: l.estimatedValue,
        currency: 'USD',
        notes: l.notes,
        tags: ['demo'],
        followupAt: l.followupInDays === undefined ? null : atUtc(l.followupInDays, 9),
      },
    });
  }
}

// ── Invoice ─────────────────────────────────────────────────────────────────
/**
 * One SENT invoice. Line amounts follow InvoicesService.computeLineItem:
 * amount = quantity x unitPrice, minus discount, plus tax. Subtotal 5680.00,
 * tax 568.00 (10%), total 6248.00. The PDF is rendered on demand by the API.
 */
async function seedInvoice(workspaceId: string, people: People): Promise<void> {
  const year = now.getUTCFullYear();
  const invoiceId = 'seed_invoice_northwind_1';
  await prisma.invoiceNumberSequence.upsert({
    where: { workspaceId },
    update: {},
    create: { workspaceId, year, lastNumber: 1 },
  });
  await prisma.invoice.upsert({
    where: { id: invoiceId },
    update: {},
    create: {
      id: invoiceId,
      workspaceId,
      clientId: 'seed_client_northwind',
      projectId: ids.project,
      createdById: people.admin.id,
      number: `INV-${year}-0001`,
      status: 'SENT',
      currency: 'USD',
      issuedAt: atUtc(-5, 9),
      dueAt: atUtc(25, 9),
      subtotal: '5680.00',
      discountAmount: '0.00',
      taxAmount: '568.00',
      total: '6248.00',
      amountPaid: '0.00',
      notes: 'Thank you for your business.',
      terms: 'Payment due within 30 days of the issue date.',
    },
  });
  const lines = [
    {
      description: 'Discovery workshop',
      quantity: '1.00',
      unitPrice: '1200.00',
      amount: '1320.00',
    },
    { description: 'UI design (hours)', quantity: '24.00', unitPrice: '95.00', amount: '2508.00' },
    {
      description: 'Frontend build (hours)',
      quantity: '20.00',
      unitPrice: '110.00',
      amount: '2420.00',
    },
  ];
  for (const [index, line] of lines.entries()) {
    await prisma.invoiceLineItem.upsert({
      where: { id: `seed_invoiceitem_northwind_1_${index + 1}` },
      update: {},
      create: {
        id: `seed_invoiceitem_northwind_1_${index + 1}`,
        invoiceId,
        position: index,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        taxRate: '10.00',
        discountRate: '0.00',
        amount: line.amount,
      },
    });
  }
}

// ── Chat ────────────────────────────────────────────────────────────────────
interface ChatMessageSpec {
  by: PersonKey;
  text: string;
  minutesAgo: number;
  unread?: boolean;
}

interface ChatRoomSpec {
  slug: string;
  type: 'TEXT_CHANNEL' | 'DM';
  name: string | null;
  description: string | null;
  members: PersonKey[];
  messages: ChatMessageSpec[];
}

const CHAT_ROOMS: ChatRoomSpec[] = [
  {
    slug: 'general',
    type: 'TEXT_CHANNEL',
    name: 'general',
    description: 'Announcements and everyday conversation for the whole team.',
    members: ['admin', 'maya', 'ravi', 'lena', 'tomas'],
    messages: [
      { by: 'admin', text: 'Welcome to the workspace, everyone. Say hi here.', minutesAgo: 1380 },
      {
        by: 'maya',
        text: 'Morning all. The Website Redesign sync is tomorrow at 10:00 UTC.',
        minutesAgo: 960,
      },
      {
        by: 'tomas',
        text: 'Quartzline confirmed their demo for later this week.',
        minutesAgo: 540,
      },
      { by: 'ravi', text: 'Login for the mobile app is up for review.', minutesAgo: 210 },
      { by: 'lena', text: 'Nice work. I will take a look after lunch.', minutesAgo: 95 },
    ],
  },
  {
    slug: 'design',
    type: 'TEXT_CHANNEL',
    name: 'design',
    description: 'Design reviews, assets and feedback.',
    members: ['admin', 'maya', 'ravi', 'lena'],
    messages: [
      { by: 'lena', text: 'Homepage wireframes are in review. Feedback welcome.', minutesAgo: 780 },
      { by: 'maya', text: 'Looks clean. Can we try a shorter hero headline?', minutesAgo: 600 },
      { by: 'ravi', text: 'A shorter headline also helps on small screens.', minutesAgo: 420 },
      { by: 'lena', text: 'Agreed, updating the frames now.', minutesAgo: 300 },
    ],
  },
  {
    slug: 'dm_admin_maya',
    type: 'DM',
    name: null,
    description: null,
    members: ['admin', 'maya'],
    messages: [
      { by: 'admin', text: 'Can you own the Bluefin demo next week?', minutesAgo: 700 },
      {
        by: 'maya',
        text: 'Yes, I will prepare the walkthrough and share it with you.',
        minutesAgo: 650,
      },
      { by: 'admin', text: 'Great, thanks.', minutesAgo: 640 },
      {
        by: 'maya',
        text: 'Draft agenda is in the project notes whenever you have a minute.',
        minutesAgo: 35,
        unread: true,
      },
    ],
  },
];

async function seedChat(workspaceId: string, people: People): Promise<void> {
  for (const room of CHAT_ROOMS) {
    const roomId = `seed_room_${room.slug}`;
    const isDm = room.type === 'DM';
    await prisma.chatRoom.upsert({
      where: { id: roomId },
      update: {},
      create: {
        id: roomId,
        type: room.type,
        name: room.name,
        description: room.description,
        // Direct messages belong to no workspace, like rooms the app creates.
        workspaceId: isDm ? null : workspaceId,
        createdById: people.admin.id,
        isPrivate: isDm,
        createdAt: atUtc(-14, 9),
      },
    });
    for (const member of room.members) {
      await prisma.chatRoomParticipant.upsert({
        where: { roomId_userId: { roomId, userId: people[member].id } },
        update: {},
        create: {
          roomId,
          userId: people[member].id,
          role: member === 'admin' ? 'ADMIN' : 'MEMBER',
        },
      });
    }
    for (const [index, m] of room.messages.entries()) {
      const id = `seed_msg_${room.slug}_${index + 1}`;
      await prisma.chatRoomMessage.upsert({
        where: { id },
        update: {},
        create: {
          id,
          roomId,
          senderId: people[m.by].id,
          content: m.text,
          status: m.unread ? 'SENT' : 'READ',
          createdAt: minutesAgo(m.minutesAgo),
        },
      });
    }
  }
}

// ── Documents ───────────────────────────────────────────────────────────────
async function seedDocuments(workspaceId: string, people: People): Promise<void> {
  await prisma.document.upsert({
    where: { id: ids.document },
    update: {},
    create: {
      id: ids.document,
      workspaceId,
      createdById: people.admin.id,
      title: 'Welcome',
      visibility: 'WORKSPACE',
      content: tiptapDoc('Welcome', 'This document was created by the demo seed.'),
    },
  });

  const kickoff: TiptapNode[] = [
    heading(1, 'Project kickoff notes'),
    paragraph(
      'Website Redesign kickoff with the Northwind Studio team. Summary of what we agreed.',
    ),
    heading(2, 'Goals'),
    bulletList([
      'Replace the current site with a faster, mobile first design.',
      'Cut the number of pages from 48 to about 15.',
      'Launch in six weeks, with a soft launch after four.',
    ]),
    heading(2, 'Scope'),
    paragraph(
      'Homepage, services, pricing, case studies, contact and a simple blog. No shop in this phase.',
    ),
    heading(2, 'Next steps'),
    bulletList([
      'Maya shares the content audit by Friday.',
      'Lena prepares homepage wireframes for review.',
      'Ravi sets up the staging environment and the build pipeline.',
    ]),
  ];
  await prisma.document.upsert({
    where: { id: 'seed_document_kickoff' },
    update: {},
    create: {
      id: 'seed_document_kickoff',
      workspaceId,
      projectId: ids.project,
      createdById: people.maya.id,
      title: 'Project kickoff notes',
      visibility: 'WORKSPACE',
      content: tiptapContent(kickoff),
      contentText: plainText(kickoff),
    },
  });
}

// ── Form with responses ─────────────────────────────────────────────────────
/** A published form definition, in the shape formDefinitionSchema produces. */
const FEEDBACK_FORM_DEFINITION = {
  fields: [
    { id: 'intro', type: 'heading', label: 'Tell us how the project went', level: 2 },
    { id: 'name', type: 'short_text', label: 'Your name', required: true },
    { id: 'email', type: 'email', label: 'Email address', required: true },
    { id: 'rating', type: 'star_rating', label: 'Overall satisfaction', required: true, max: 5 },
    {
      id: 'source',
      type: 'dropdown',
      label: 'How did you first hear about us?',
      required: false,
      options: [
        { id: 'referral', label: 'Referral' },
        { id: 'search', label: 'Search' },
        { id: 'social', label: 'Social media' },
      ],
    },
    { id: 'comments', type: 'long_text', label: 'Anything we could do better?', required: false },
  ],
} as const;

const FEEDBACK_RESPONSES: {
  by: PersonKey;
  hoursAgo: number;
  answers: Record<string, string | number>;
}[] = [
  {
    by: 'admin',
    hoursAgo: 70,
    answers: {
      name: 'Priya Nair',
      email: 'priya.nair@example.com',
      rating: 5,
      source: 'referral',
      comments: 'Clear communication and quick turnaround.',
    },
  },
  {
    by: 'maya',
    hoursAgo: 52,
    answers: {
      name: 'Marcus Webb',
      email: 'marcus.webb@example.com',
      rating: 4,
      source: 'search',
      comments: 'Great results. A shared task board earlier would have helped.',
    },
  },
  {
    by: 'lena',
    hoursAgo: 30,
    answers: {
      name: 'Hannah Brooks',
      email: 'hannah.brooks@example.com',
      rating: 5,
      source: 'social',
    },
  },
  {
    by: 'ravi',
    hoursAgo: 9,
    answers: {
      name: 'Jonas Becker',
      email: 'jonas.becker@example.com',
      rating: 4,
      source: 'referral',
      comments: 'Happy overall. Invoices could be itemised more.',
    },
  },
];

async function seedForm(workspaceId: string, people: People): Promise<void> {
  const formId = 'seed_form_feedback';
  const versionId = 'seed_formversion_feedback_1';
  const definition = FEEDBACK_FORM_DEFINITION as unknown as Prisma.InputJsonValue;
  await prisma.form.upsert({
    where: { id: formId },
    update: {},
    create: {
      id: formId,
      workspaceId,
      createdById: people.admin.id,
      title: 'Project feedback survey',
      description: 'A short survey we send to clients after a project wraps up.',
      status: 'PUBLISHED',
      draft: definition,
      publishedVersion: 1,
      internalAccess: 'WORKSPACE',
      settings: {
        notifyOnSubmit: true,
        confirmationMessage: 'Thank you for your feedback.',
      },
    },
  });
  await prisma.formVersion.upsert({
    where: { formId_version: { formId, version: 1 } },
    update: {},
    create: {
      id: versionId,
      formId,
      version: 1,
      definition,
      publishedById: people.admin.id,
      publishedAt: atUtc(-4, 9),
    },
  });
  for (const [index, r] of FEEDBACK_RESPONSES.entries()) {
    const id = `seed_formsubmission_feedback_${index + 1}`;
    await prisma.formSubmission.upsert({
      where: { id },
      update: {},
      create: {
        id,
        workspaceId,
        formId,
        versionId,
        submittedById: people[r.by].id,
        source: 'INTERNAL',
        answers: r.answers,
        createdAt: minutesAgo(r.hoursAgo * 60),
      },
    });
  }
}

// ── Meetings ────────────────────────────────────────────────────────────────
interface MeetingSpec {
  slug: string;
  title: string;
  description: string;
  startsAt: Date;
  durationMin: number;
  meetingUrl: string;
  projectId: string;
  clientId: string;
  attendees: { key: PersonKey; response: 'ACCEPTED' | 'NEEDS_ACTION' }[];
  /** Reminder offsets for the organizer, in minutes. */
  reminders: number[];
}

/**
 * One-off meetings organized by the demo admin. Like the meetings service, a
 * one-off meeting has no MeetingOccurrence rows (those hold changed
 * occurrences of a series), `lastEndsAt` is its end, and each reminder's
 * `nextFireAt` is the start minus its offset.
 */
async function seedMeetings(
  organizationId: string,
  workspaceId: string,
  people: People,
): Promise<void> {
  const meetings: MeetingSpec[] = [
    {
      slug: 'website_sync',
      title: 'Website Redesign weekly sync',
      description: 'Review wireframes, the content audit and the launch plan.',
      startsAt: atUtc(1, 10),
      durationMin: 30,
      meetingUrl: 'https://meet.example.com/website-sync',
      projectId: ids.project,
      clientId: 'seed_client_northwind',
      attendees: [
        { key: 'maya', response: 'ACCEPTED' },
        { key: 'ravi', response: 'NEEDS_ACTION' },
      ],
      reminders: [10, 60],
    },
    {
      slug: 'bluefin_demo',
      title: 'Bluefin Logistics app demo',
      description: 'Walk through the beta build of the driver app with the Bluefin team.',
      startsAt: atUtc(3, 14),
      durationMin: 45,
      meetingUrl: 'https://meet.example.com/bluefin-demo',
      projectId: ids.projectMobile,
      clientId: 'seed_client_bluefin',
      attendees: [
        { key: 'maya', response: 'ACCEPTED' },
        { key: 'tomas', response: 'NEEDS_ACTION' },
      ],
      reminders: [10, 60],
    },
  ];

  for (const m of meetings) {
    const id = `seed_meeting_${m.slug}`;
    const endsAt = new Date(m.startsAt.getTime() + m.durationMin * 60_000);
    await prisma.meeting.upsert({
      where: { id },
      update: {},
      create: {
        id,
        organizationId,
        workspaceId,
        organizerId: people.admin.id,
        title: m.title,
        description: m.description,
        location: 'Video call',
        meetingUrl: m.meetingUrl,
        startsAt: m.startsAt,
        endsAt,
        allDay: false,
        timeZone: 'UTC',
        rrule: null,
        lastEndsAt: endsAt,
        status: 'CONFIRMED',
        source: 'MANUAL',
        icsUid: `seed-${m.slug}@meetings.example.com`,
        projectId: m.projectId,
        clientId: m.clientId,
      },
    });
    for (const a of m.attendees) {
      await prisma.meetingAttendee.upsert({
        where: { meetingId_userId: { meetingId: id, userId: people[a.key].id } },
        update: {},
        create: {
          id: `seed_attendee_${m.slug}_${a.key}`,
          meetingId: id,
          userId: people[a.key].id,
          email: people[a.key].email.toLowerCase(),
          name: people[a.key].name,
          response: a.response,
          respondedAt: a.response === 'ACCEPTED' ? minutesAgo(120) : null,
        },
      });
    }
    // The organizer's reminders, plus a 10 minute one for each attendee.
    const reminders = [
      ...m.reminders.map((minutesBefore) => ({ key: 'admin' as PersonKey, minutesBefore })),
      ...m.attendees.map((a) => ({ key: a.key, minutesBefore: 10 })),
    ];
    for (const r of reminders) {
      await prisma.meetingReminder.upsert({
        where: {
          meetingId_userId_minutesBefore: {
            meetingId: id,
            userId: people[r.key].id,
            minutesBefore: r.minutesBefore,
          },
        },
        update: {},
        create: {
          id: `seed_reminder_${m.slug}_${r.key}_${r.minutesBefore}`,
          meetingId: id,
          userId: people[r.key].id,
          minutesBefore: r.minutesBefore,
          nextFireAt: new Date(m.startsAt.getTime() - r.minutesBefore * 60_000),
        },
      });
    }
  }
}

// ── Time entries ────────────────────────────────────────────────────────────
interface TimeSlot {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  taskId: string;
  projectId: string;
  description: string;
}

/** Stopped entries (endTime and durationMin set) over the last 5 working days. */
async function seedTimeEntries(workspaceId: string, people: People): Promise<void> {
  const daily: { who: PersonKey; slots: TimeSlot[] }[] = [
    {
      who: 'ravi',
      slots: [
        {
          startHour: 9,
          startMinute: 0,
          endHour: 12,
          endMinute: 30,
          taskId: mobileTask(4),
          projectId: ids.projectMobile,
          description: 'Shipment list screen',
        },
        {
          startHour: 13,
          startMinute: 30,
          endHour: 17,
          endMinute: 0,
          taskId: mobileTask(3),
          projectId: ids.projectMobile,
          description: 'Login and session handling',
        },
      ],
    },
    {
      who: 'admin',
      slots: [
        {
          startHour: 10,
          startMinute: 0,
          endHour: 12,
          endMinute: 30,
          taskId: ids.task(8),
          projectId: ids.project,
          description: 'Pricing page copy',
        },
      ],
    },
  ];

  for (const [dayIndex, dayOffset] of lastWorkingDays(5).entries()) {
    for (const { who, slots } of daily) {
      for (const [slotIndex, s] of slots.entries()) {
        const startTime = atUtc(dayOffset, s.startHour, s.startMinute);
        const endTime = atUtc(dayOffset, s.endHour, s.endMinute);
        const id = `seed_time_${who}_${dayIndex + 1}_${slotIndex + 1}`;
        await prisma.timeEntry.upsert({
          where: { id },
          update: {},
          create: {
            id,
            userId: people[who].id,
            workspaceId,
            projectId: s.projectId,
            taskId: s.taskId,
            description: s.description,
            startTime,
            endTime,
            durationMin: minutesBetween(startTime, endTime),
            billable: true,
          },
        });
      }
    }
  }
}

async function main(): Promise<void> {
  assertSafeEnvironment();

  console.log('Seeding demo data (idempotent - no deletes)...');

  // ── Root (platform) organization ──────────────────────────────────────────
  // The API refers to this row by id (ROOT_ORG_ID in
  // apps/api/src/organizations/organizations.constants.ts); platform admins
  // (SUPER_ADMIN) live here. It holds no tenant data.
  await prisma.organization.upsert({
    where: { id: ROOT_ORG_ID },
    update: {},
    create: {
      id: ROOT_ORG_ID,
      name: 'Platform',
      slug: 'platform',
      emailDomain: null,
      isRoot: true,
    },
  });

  // ── Demo organization ─────────────────────────────────────────────────────
  const organization = await prisma.organization.upsert({
    where: { id: ids.organization },
    update: { name: 'Demo Organization', isActive: true, deletedAt: null },
    create: {
      id: ids.organization,
      name: 'Demo Organization',
      slug: 'demo',
      emailDomain: null,
      baseCurrency: 'USD',
    },
  });

  // ── Demo admin (org ADMIN) + credential account ───────────────────────────
  const admin = await prisma.user.upsert({
    where: { email: DEMO_ADMIN_EMAIL },
    update: { name: 'Demo Admin', emailVerified: true, deletedAt: null },
    create: {
      email: DEMO_ADMIN_EMAIL,
      name: 'Demo Admin',
      emailVerified: true,
      timezone: 'UTC',
      systemRole: 'ADMIN',
      organizationId: organization.id,
    },
  });

  // Only set the password on first creation so a changed demo password survives re-seeding.
  await prisma.account.upsert({
    where: { providerId_accountId: { providerId: 'credential', accountId: admin.id } },
    update: {},
    create: {
      userId: admin.id,
      providerId: 'credential',
      accountId: admin.id,
      password: hashPassword(DEMO_ADMIN_PASSWORD),
    },
  });

  // ── Workspace + membership ────────────────────────────────────────────────
  const workspace = await prisma.workspace.upsert({
    where: { slug: 'demo' },
    update: { name: 'Demo Workspace', deletedAt: null },
    create: {
      name: 'Demo Workspace',
      slug: 'demo',
      ownerId: admin.id,
      organizationId: organization.id,
    },
  });

  await prisma.workspaceMembership.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: admin.id } },
    update: { role: 'OWNER' },
    create: { workspaceId: workspace.id, userId: admin.id, role: 'OWNER' },
  });

  // ── Team ──────────────────────────────────────────────────────────────────
  const people = await seedPeople(organization.id, workspace.id, {
    id: admin.id,
    name: admin.name,
    email: admin.email,
  });

  // ── Clients (projects link to them) ───────────────────────────────────────
  await seedClients(workspace.id, people);

  // ── Projects ──────────────────────────────────────────────────────────────
  const project = await prisma.project.upsert({
    where: { workspaceId_key: { workspaceId: workspace.id, key: 'DEMO' } },
    update: { name: 'Website Redesign', status: 'ACTIVE' },
    create: {
      id: ids.project,
      workspaceId: workspace.id,
      clientId: 'seed_client_northwind',
      createdById: admin.id,
      name: 'Website Redesign',
      key: 'DEMO',
      status: 'ACTIVE',
      visibility: 'WORKSPACE',
      color: '#6366f1',
      description: 'A faster, mobile first redesign of the Northwind Studio marketing site.',
      startDate: atUtc(-21),
      dueDate: atUtc(21),
    },
  });
  await seedMemberships(
    project.id,
    {
      admin: 'PROJECT_LEAD',
      maya: 'PROJECT_LEAD',
      ravi: 'CONTRIBUTOR',
      lena: 'CONTRIBUTOR',
      tomas: 'VIEWER',
    },
    people,
  );
  await seedTasks(project.id, DEMO_TASKS, people);

  const mobile = await prisma.project.upsert({
    where: { workspaceId_key: { workspaceId: workspace.id, key: 'MOBILE' } },
    update: {},
    create: {
      id: ids.projectMobile,
      workspaceId: workspace.id,
      clientId: 'seed_client_bluefin',
      createdById: admin.id,
      name: 'Mobile App Launch',
      key: 'MOBILE',
      status: 'ACTIVE',
      visibility: 'WORKSPACE',
      color: '#10b981',
      description: 'A driver and dispatcher app for Bluefin Logistics, from MVP to store release.',
      startDate: atUtc(-14),
      dueDate: atUtc(45),
    },
  });
  await seedMemberships(
    mobile.id,
    { admin: 'PROJECT_LEAD', maya: 'PROJECT_LEAD', ravi: 'CONTRIBUTOR', lena: 'CONTRIBUTOR' },
    people,
  );
  await seedTasks(mobile.id, MOBILE_TASKS, people);
  await seedSprint(mobile.id, people);

  // ── Sales, billing, collaboration ─────────────────────────────────────────
  await seedLeads(workspace.id, people);
  await seedInvoice(workspace.id, people);
  await seedChat(workspace.id, people);
  await seedDocuments(workspace.id, people);
  await seedForm(workspace.id, people);
  await seedMeetings(organization.id, workspace.id, people);
  await seedTimeEntries(workspace.id, people);

  console.log(`Seed complete. Sign in as ${DEMO_ADMIN_EMAIL} / ${DEMO_ADMIN_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
