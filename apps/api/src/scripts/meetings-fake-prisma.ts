/**
 * A small in-memory stand-in for the Prisma delegates the meetings services
 * use (no database). Supports where filters (AND/OR/NOT, equality, in/notIn,
 * not, lt/lte/gt/gte, contains + mode, relation some/none/every and to-one
 * nesting), select/include with nested relation args, orderBy, take, nested
 * creates, unique keys (P2002), the soft-delete read filter on the client
 * (not on `raw`) and interactive transactions. Only for the check scripts.
 */
import { Prisma } from '@botss/database';

export type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

interface Rel {
  model: string;
  many: boolean;
  local: string;
  foreign: string;
}

const rel = (model: string, many: boolean, local: string, foreign: string): Rel => ({
  model,
  many,
  local,
  foreign,
});

const RELATIONS: Record<string, Record<string, Rel>> = {
  meeting: {
    attendees: rel('meetingAttendee', true, 'id', 'meetingId'),
    overrides: rel('meetingOccurrence', true, 'id', 'meetingId'),
    reminders: rel('meetingReminder', true, 'id', 'meetingId'),
    organizer: rel('user', false, 'organizerId', 'id'),
    organization: rel('organization', false, 'organizationId', 'id'),
  },
  meetingAttendee: {
    meeting: rel('meeting', false, 'meetingId', 'id'),
    user: rel('user', false, 'userId', 'id'),
  },
  meetingOccurrence: { meeting: rel('meeting', false, 'meetingId', 'id') },
  meetingReminder: {
    meeting: rel('meeting', false, 'meetingId', 'id'),
    user: rel('user', false, 'userId', 'id'),
    deliveries: rel('meetingReminderDelivery', true, 'id', 'reminderId'),
  },
  meetingReminderDelivery: { reminder: rel('meetingReminder', false, 'reminderId', 'id') },
  meetingFeedToken: { user: rel('user', false, 'userId', 'id') },
  user: { workspaceMemberships: rel('workspaceMembership', true, 'id', 'userId') },
  lead: { workspace: rel('workspace', false, 'workspaceId', 'id') },
  client: { workspace: rel('workspace', false, 'workspaceId', 'id') },
  project: { workspace: rel('workspace', false, 'workspaceId', 'id') },
};

const SOFT = new Set(['meeting', 'user', 'workspace', 'organization', 'lead', 'client', 'project']);

const UNIQUES: Record<string, string[][]> = {
  meeting: [['organizerId', 'icsUid']],
  meetingAttendee: [['meetingId', 'email'], ['meetingId', 'userId'], ['rsvpTokenHash']],
  meetingOccurrence: [['meetingId', 'originalStart']],
  meetingReminder: [['meetingId', 'userId', 'minutesBefore']],
  meetingReminderDelivery: [['reminderId', 'occurrenceStart']],
  meetingFeedToken: [['userId'], ['tokenHash']],
  userPreferences: [['userId']],
};

let counter = 0;
const newId = (prefix: string) =>
  `${prefix}${String(++counter).padStart(20 - prefix.length, '0')}fake`;

function defaults(model: string): Row {
  const now = new Date();
  switch (model) {
    case 'meeting':
      return {
        id: newId('cmmtg'),
        workspaceId: null,
        description: null,
        location: null,
        meetingUrl: null,
        allDay: false,
        rrule: null,
        lastEndsAt: null,
        exdates: [],
        status: 'CONFIRMED',
        color: null,
        source: 'MANUAL',
        sequence: 0,
        leadId: null,
        clientId: null,
        projectId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
    case 'meetingAttendee':
      return {
        id: newId('cmatt'),
        userId: null,
        name: null,
        response: 'NEEDS_ACTION',
        respondedAt: null,
        rsvpTokenHash: null,
        createdAt: now,
        updatedAt: now,
      };
    case 'meetingOccurrence':
      return {
        id: newId('cmocc'),
        title: null,
        description: null,
        location: null,
        meetingUrl: null,
        createdAt: now,
        updatedAt: now,
      };
    case 'meetingReminder':
      return { id: newId('cmrem'), createdAt: now };
    case 'meetingReminderDelivery':
      return { id: newId('cmdel'), firedAt: now, snoozedUntil: null, snoozeFiredAt: null };
    case 'meetingFeedToken':
      return { id: newId('cmfeed'), createdAt: now, lastUsedAt: null };
    default:
      return { id: newId('cmrow') };
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v);
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === undefined) a = null;
  if (b === undefined) b = null;
  return a === b;
}

function cmp(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : (a as number | string);
  const y = b instanceof Date ? b.getTime() : (b as number | string);
  return x < y ? -1 : x > y ? 1 : 0;
}

function fieldMatches(value: unknown, cond: unknown): boolean {
  if (cond === null) return value === null || value === undefined;
  if (!isPlainObject(cond)) return same(value, cond);
  const insensitive = cond['mode'] === 'insensitive';
  const norm = (v: unknown) => (insensitive && typeof v === 'string' ? v.toLowerCase() : v);
  for (const [op, arg] of Object.entries(cond)) {
    if (op === 'mode') continue;
    if (op === 'equals' && !same(norm(value), norm(arg))) return false;
    if (op === 'in' && !(arg as unknown[]).some((a) => same(norm(value), norm(a)))) return false;
    if (op === 'notIn' && (arg as unknown[]).some((a) => same(value, a))) return false;
    if (op === 'not' && fieldMatches(value, arg)) return false;
    if (op === 'lt' && !(value !== null && value !== undefined && cmp(value, arg) < 0))
      return false;
    if (op === 'lte' && !(value !== null && value !== undefined && cmp(value, arg) <= 0))
      return false;
    if (op === 'gt' && !(value !== null && value !== undefined && cmp(value, arg) > 0))
      return false;
    if (op === 'gte' && !(value !== null && value !== undefined && cmp(value, arg) >= 0))
      return false;
    if (
      op === 'contains' &&
      !(typeof value === 'string' && String(norm(value)).includes(String(norm(arg))))
    )
      return false;
  }
  return true;
}

export class FakeDb {
  readonly tables: Record<string, Row[]> = {};
  readonly writes: string[] = [];

  table(model: string): Row[] {
    return (this.tables[model] ??= []);
  }

  insert(model: string, row: Row): Row {
    const full = { ...defaults(model), ...row };
    this.assertUnique(model, full, null);
    this.table(model).push(full);
    return full;
  }

  private assertUnique(model: string, row: Row, self: Row | null): void {
    for (const keys of UNIQUES[model] ?? []) {
      if (keys.some((k) => row[k] === null || row[k] === undefined)) continue;
      const clash = this.table(model).find(
        (r) => r !== self && keys.every((k) => same(r[k], row[k])),
      );
      if (clash) {
        throw new Prisma.PrismaClientKnownRequestError(
          `Unique constraint failed on ${keys.join(',')}`,
          {
            code: 'P2002',
            clientVersion: 'fake',
          },
        );
      }
    }
  }

  related(model: string, row: Row, name: string): Row[] | Row | null {
    const r = RELATIONS[model]?.[name];
    if (!r) throw new Error(`fake prisma: no relation ${model}.${name}`);
    const rows = this.table(r.model).filter(
      (x) => same(x[r.foreign], row[r.local]) && row[r.local] !== null,
    );
    return r.many ? rows : (rows[0] ?? null);
  }

  matches(model: string, row: Row, where: Where | undefined): boolean {
    if (!where) return true;
    for (const [key, cond] of Object.entries(where)) {
      if (cond === undefined) continue;
      if (key === 'AND') {
        const list = Array.isArray(cond) ? cond : [cond];
        if (!list.every((w) => this.matches(model, row, w as Where))) return false;
      } else if (key === 'OR') {
        if (!(cond as Where[]).some((w) => this.matches(model, row, w))) return false;
      } else if (key === 'NOT') {
        const list = Array.isArray(cond) ? cond : [cond];
        if (list.some((w) => this.matches(model, row, w as Where))) return false;
      } else if (RELATIONS[model]?.[key]) {
        const r = RELATIONS[model]![key]!;
        const target = this.related(model, row, key);
        if (r.many) {
          const c = cond as { some?: Where; none?: Where; every?: Where };
          const list = target as Row[];
          if (c.some && !list.some((x) => this.matches(r.model, x, c.some))) return false;
          if (c.none && list.some((x) => this.matches(r.model, x, c.none))) return false;
          if (c.every && !list.every((x) => this.matches(r.model, x, c.every))) return false;
        } else if (cond === null) {
          if (target !== null) return false;
        } else if (!target || !this.matches(r.model, target as Row, cond as Where)) {
          return false;
        }
      } else if (!fieldMatches(row[key], cond)) {
        return false;
      }
    }
    return true;
  }

  private order(rows: Row[], orderBy: unknown): Row[] {
    if (!orderBy) return rows;
    const list = (Array.isArray(orderBy) ? orderBy : [orderBy]) as Record<string, 'asc' | 'desc'>[];
    return [...rows].sort((a, b) => {
      for (const o of list) {
        for (const [k, dir] of Object.entries(o)) {
          const c = cmp(a[k], b[k]);
          if (c !== 0) return dir === 'desc' ? -c : c;
        }
      }
      return 0;
    });
  }

  project(
    model: string,
    row: Row,
    args: { select?: Record<string, unknown>; include?: Record<string, unknown> },
  ): Row {
    const out: Row = {};
    const relArgs = (v: unknown) => (isPlainObject(v) ? (v as FindArgs) : {});
    if (args.select) {
      for (const [k, v] of Object.entries(args.select)) {
        if (!v) continue;
        if (RELATIONS[model]?.[k]) out[k] = this.loadRelation(model, row, k, relArgs(v));
        else out[k] = row[k];
      }
      return out;
    }
    Object.assign(out, row);
    for (const [k, v] of Object.entries(args.include ?? {})) {
      if (!v) continue;
      out[k] = this.loadRelation(model, row, k, relArgs(v));
    }
    return out;
  }

  private loadRelation(model: string, row: Row, name: string, args: FindArgs): unknown {
    const r = RELATIONS[model]![name]!;
    const target = this.related(model, row, name);
    if (!r.many) return target ? this.project(r.model, target as Row, args) : null;
    let list = (target as Row[]).filter((x) => this.matches(r.model, x, args.where));
    list = this.order(list, args.orderBy);
    if (args.take !== undefined) list = list.slice(0, args.take);
    return list.map((x) => this.project(r.model, x, args));
  }

  find(model: string, args: FindArgs, soft: boolean): Row[] {
    let rows = this.table(model).filter((r) => this.matches(model, r, args.where));
    if (soft && SOFT.has(model))
      rows = rows.filter((r) => r['deletedAt'] === null || r['deletedAt'] === undefined);
    rows = this.order(rows, args.orderBy);
    if (args.take !== undefined) rows = rows.slice(0, args.take);
    return rows;
  }

  /** Expand compound unique selectors (`meetingId_originalStart: {...}`). */
  uniqueWhere(where: Where): Where {
    const out: Where = {};
    for (const [k, v] of Object.entries(where)) {
      if (k.includes('_') && isPlainObject(v)) Object.assign(out, v);
      else out[k] = v;
    }
    return out;
  }

  /** Apply scalar data and nested creates to a row. */
  apply(model: string, row: Row, data: Row): void {
    const nested: Array<[string, unknown]> = [];
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      if (RELATIONS[model]?.[k]) nested.push([k, v]);
      else row[k] = v;
    }
    row['updatedAt'] = row['updatedAt'] !== undefined ? new Date() : row['updatedAt'];
    for (const [k, v] of nested) {
      const r = RELATIONS[model]![k]!;
      const create = (v as { create?: Row | Row[] }).create;
      if (!create) continue;
      for (const child of Array.isArray(create) ? create : [create]) {
        this.insert(r.model, { ...child, [r.foreign]: row[r.local] });
      }
    }
  }

  createRow(model: string, data: Row): Row {
    const scalars: Row = {};
    const nested: Row = {};
    for (const [k, v] of Object.entries(data)) {
      if (RELATIONS[model]?.[k]) nested[k] = v;
      else scalars[k] = v;
    }
    const row = this.insert(model, scalars);
    this.apply(model, row, nested);
    return row;
  }
}

export interface FindArgs {
  where?: Where;
  select?: Record<string, unknown>;
  include?: Record<string, unknown>;
  orderBy?: unknown;
  take?: number;
  includeDeleted?: boolean;
}

function delegate(db: FakeDb, model: string, soft: boolean) {
  const view = (row: Row, args: FindArgs) => db.project(model, row, args);
  const one = (args: FindArgs) =>
    db.find(model, { ...args, take: undefined }, soft && !args.includeDeleted)[0] ?? null;
  return {
    findMany: async (args: FindArgs = {}) =>
      db.find(model, args, soft && !args.includeDeleted).map((r) => view(r, args)),
    findFirst: async (args: FindArgs = {}) => {
      const r = one(args);
      return r ? view(r, args) : null;
    },
    findFirstOrThrow: async (args: FindArgs = {}) => {
      const r = one(args);
      if (!r) throw new Error(`fake prisma: ${model} not found`);
      return view(r, args);
    },
    findUnique: async (args: FindArgs) => {
      const r = one({ ...args, where: db.uniqueWhere(args.where ?? {}) });
      return r ? view(r, args) : null;
    },
    count: async (args: FindArgs = {}) => db.find(model, args, soft).length,
    create: async (args: { data: Row } & FindArgs) => {
      db.writes.push(`${model}.create`);
      return view(db.createRow(model, args.data), args);
    },
    createMany: async (args: { data: Row[]; skipDuplicates?: boolean }) => {
      db.writes.push(`${model}.createMany`);
      let count = 0;
      for (const d of args.data) {
        try {
          db.createRow(model, d);
          count += 1;
        } catch (err) {
          if (!args.skipDuplicates) throw err;
        }
      }
      return { count };
    },
    update: async (args: { where: Where; data: Row } & FindArgs) => {
      db.writes.push(`${model}.update`);
      const r = db.find(model, { where: db.uniqueWhere(args.where) }, false)[0];
      if (!r) throw new Error(`fake prisma: ${model} to update not found`);
      db.apply(model, r, args.data);
      return view(r, args);
    },
    updateMany: async (args: { where: Where; data: Row }) => {
      db.writes.push(`${model}.updateMany`);
      const rows = db.find(model, { where: args.where }, false);
      for (const r of rows) db.apply(model, r, args.data);
      return { count: rows.length };
    },
    upsert: async (args: { where: Where; create: Row; update: Row } & FindArgs) => {
      db.writes.push(`${model}.upsert`);
      const r = db.find(model, { where: db.uniqueWhere(args.where) }, false)[0];
      if (r) {
        db.apply(model, r, args.update);
        return view(r, args);
      }
      return view(db.createRow(model, args.create), args);
    },
    delete: async (args: { where: Where }) => {
      db.writes.push(`${model}.delete`);
      const r = db.find(model, { where: db.uniqueWhere(args.where) }, false)[0];
      if (!r) throw new Error(`fake prisma: ${model} to delete not found`);
      if (soft && SOFT.has(model)) r['deletedAt'] = new Date();
      else db.tables[model] = db.table(model).filter((x) => x !== r);
      return r;
    },
    deleteMany: async (args: { where?: Where } = {}) => {
      db.writes.push(`${model}.deleteMany`);
      const rows = db.find(model, { where: args.where ?? {} }, false);
      if (soft && SOFT.has(model)) for (const r of rows) r['deletedAt'] = new Date();
      else db.tables[model] = db.table(model).filter((x) => !rows.includes(x));
      return { count: rows.length };
    },
  };
}

const MODELS = [
  'meeting',
  'meetingAttendee',
  'meetingOccurrence',
  'meetingReminder',
  'meetingReminderDelivery',
  'meetingFeedToken',
  'user',
  'userPreferences',
  'workspace',
  'workspaceMembership',
  'organization',
  'lead',
  'client',
  'project',
];

function makeClient(db: FakeDb, soft: boolean): Record<string, unknown> {
  const client: Record<string, unknown> = {};
  for (const m of MODELS) client[m] = delegate(db, m, soft);
  client['$transaction'] = async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: unknown) => Promise<unknown>)(client);
    return Promise.all(arg as Promise<unknown>[]);
  };
  client['$queryRaw'] = async () => {
    throw new Error('fake prisma: raw SQL is not evaluated');
  };
  return client;
}

/** `{ client, raw }` shaped like PrismaService. */
export function fakePrismaService(db: FakeDb): {
  client: Record<string, unknown>;
  raw: Record<string, unknown>;
} {
  return { client: makeClient(db, true), raw: makeClient(db, false) };
}
