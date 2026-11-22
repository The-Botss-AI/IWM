import { describe, expect, it } from 'vitest';

import {
  INIT_MIGRATION,
  classifyDiff,
  legacyMigrations,
  planAdoption,
  planSetup,
  setupSchema,
} from './schema-setup.mjs';

const ADD_TABLE = `-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'MEETING_INVITE';

-- AlterTable
ALTER TABLE "Account" ADD COLUMN "scope" TEXT;
`;
const DROP_COLUMN = `-- AlterTable
ALTER TABLE "Task" DROP COLUMN "legacy";
`;
const EXTRA_INDEX = `-- DropIndex
DROP INDEX "Task_search_fts_idx";
`;

/** In-memory database and migrations folder; records every call. */
function fakeIo({ tables, recorded, local, diffs }) {
  const calls = [];
  const remaining = [...diffs];
  const io = {
    calls,
    log: () => {},
    fail: (msg) => {
      calls.push(['fail', msg]);
      throw new Error(`fail: ${msg}`);
    },
    listLocal: async () => [...local],
    countTables: async () => tables,
    recordedMigrations: async () => recorded,
    diffFromDatabase: async () => {
      calls.push(['diff']);
      return remaining.length > 1 ? remaining.shift() : (remaining[0] ?? '');
    },
    execSql: async (sql) => calls.push(['exec', sql]),
    migrateDeploy: async () => calls.push(['deploy']),
    markApplied: async (names) => calls.push(['mark-applied', names]),
    backupLegacy: async (names) => {
      calls.push(['backup', names]);
      return 'backup-folder';
    },
    clearHistory: async () => calls.push(['clear-history']),
  };
  return io;
}

const kinds = (io) => io.calls.map((c) => c[0]);

describe('classifyDiff', () => {
  it('treats creates, added columns and enum values as additive', () => {
    const d = classifyDiff(ADD_TABLE);
    expect(d.additive).toHaveLength(3);
    expect(d.destructive).toHaveLength(0);
  });
  it('flags drops, renames, retypes and deletes', () => {
    for (const sql of [
      DROP_COLUMN,
      'ALTER TABLE "A" RENAME COLUMN "b" TO "c";',
      'ALTER TABLE "A" ALTER COLUMN "b" SET DATA TYPE INTEGER;',
      'DELETE FROM "A";',
      'DROP TABLE "A";',
      'ALTER TABLE "A" ALTER COLUMN "b" TYPE INTEGER USING "b"::integer;',
      'UPDATE "A" SET "b" = 1;',
      `INSERT INTO "A" ("id") VALUES ('x');`,
      'ALTER TABLE "A" DROP "col";',
      'ALTER TABLE "A" ADD COLUMN "c" TEXT, DROP COLUMN "d";',
      'ALTER TABLE "A" ALTER COLUMN "b" SET DEFAULT 1, ALTER COLUMN "c" DROP NOT NULL;',
      'ALTER TABLE "A" ALTER COLUMN "b" DROP DEFAULT;',
      'ALTER INDEX "a_idx" RENAME TO "b_idx";',
      'TRUNCATE "A";',
    ]) {
      expect(classifyDiff(sql).destructive, sql).toHaveLength(1);
    }
  });
  it('does not read ON DELETE CASCADE in a new foreign key as a delete', () => {
    const d = classifyDiff(
      'ALTER TABLE "A" ADD CONSTRAINT "A_b_fkey" FOREIGN KEY ("b") REFERENCES "B"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
    );
    expect(d.additive).toHaveLength(1);
    expect(d.destructive).toHaveLength(0);
  });
  it('reads SET DEFAULT as safe: it changes no rows', () => {
    const d = classifyDiff(
      `ALTER TABLE "User" ALTER COLUMN "timezone" SET DEFAULT 'UTC';
ALTER TABLE "Organization" ALTER COLUMN "baseCurrency" SET DEFAULT 'USD';`,
    );
    expect(d.additive).toHaveLength(2);
    expect(d.destructive).toHaveLength(0);
  });
  it('ignores words inside quoted names, string literals and index methods', () => {
    const d = classifyDiff(
      `CREATE TABLE "Note" ("id" TEXT NOT NULL, "type" TEXT NOT NULL DEFAULT 'drop', CONSTRAINT "Note_pkey" PRIMARY KEY ("id"));
ALTER TABLE "Note" ADD COLUMN "renamedAt" TIMESTAMP(3);
CREATE TYPE "Kind" AS ENUM ('DROP', 'TYPE');
CREATE INDEX "Note_type_trgm_idx" ON "Note" USING GIN ("type" gin_trgm_ops);
CREATE UNIQUE INDEX "Note_id_key" ON "Note"("id");
CREATE EXTENSION IF NOT EXISTS pg_trgm;`,
    );
    expect(d.destructive).toEqual([]);
    expect(d.additive).toHaveLength(6);
  });
  it('keeps index drops apart: the extra index stays in place', () => {
    const d = classifyDiff(EXTRA_INDEX);
    expect(d.extraIndexes).toHaveLength(1);
    expect(d.destructive).toHaveLength(0);
  });
  it('reads an empty diff as nothing to do', () => {
    expect(classifyDiff('-- This is an empty migration.\n')).toEqual({
      additive: [],
      extraIndexes: [],
      destructive: [],
    });
  });
});

describe('planSetup', () => {
  it('fresh: no tables', () => {
    expect(planSetup({ tables: 0, recorded: null, local: [INIT_MIGRATION] }).kind).toBe('fresh');
  });
  it('tracked: our init is recorded', () => {
    expect(
      planSetup({ tables: 90, recorded: [INIT_MIGRATION], local: [INIT_MIGRATION] }).kind,
    ).toBe('tracked');
  });
  it('adopt: tables but no record of our init, old local migrations are legacy', () => {
    const plan = planSetup({
      tables: 90,
      recorded: ['20250301120000_init', '20260901090000_upgrade'],
      local: ['20250301120000_init', '20260901090000_upgrade', INIT_MIGRATION],
    });
    expect(plan).toEqual({
      kind: 'adopt',
      legacy: ['20250301120000_init', '20260901090000_upgrade'],
    });
  });
  it('missing-init: the shipped folder is gone', () => {
    expect(planSetup({ tables: 0, recorded: null, local: [] }).kind).toBe('missing-init');
  });
  it('an old local init made after our init date is still legacy', () => {
    expect(legacyMigrations(['20261201000000_init', INIT_MIGRATION], [])).toEqual([
      '20261201000000_init',
    ]);
  });
  it('a contributor migration after our init is kept', () => {
    expect(legacyMigrations([INIT_MIGRATION, '20261201000000_add_widgets'], [])).toEqual([]);
  });
});

describe('planAdoption', () => {
  it('matching, behind and blocked', () => {
    expect(planAdoption('').kind).toBe('matching');
    expect(planAdoption(EXTRA_INDEX).kind).toBe('matching');
    expect(planAdoption(ADD_TABLE).kind).toBe('behind');
    expect(planAdoption(ADD_TABLE + DROP_COLUMN).kind).toBe('blocked');
  });
});

describe('setupSchema', () => {
  it('fresh database: deploy only', async () => {
    const io = fakeIo({ tables: 0, recorded: null, local: [INIT_MIGRATION], diffs: [''] });
    expect(await setupSchema(io)).toBe('fresh');
    expect(kinds(io)).toEqual(['deploy']);
  });

  it('tracked database: deploy, then a schema check', async () => {
    const io = fakeIo({
      tables: 90,
      recorded: [INIT_MIGRATION],
      local: [INIT_MIGRATION],
      diffs: [''],
    });
    expect(await setupSchema(io)).toBe('tracked');
    expect(kinds(io)).toEqual(['deploy', 'diff']);
  });

  it('existing database that matches: baseline without touching data', async () => {
    const io = fakeIo({
      tables: 90,
      recorded: ['20250301120000_init'],
      local: ['20250301120000_init', INIT_MIGRATION],
      diffs: [EXTRA_INDEX],
    });
    expect(await setupSchema(io)).toBe('adopt-matching');
    expect(io.calls).toEqual([
      ['diff'],
      ['backup', ['20250301120000_init']],
      ['mark-applied', [INIT_MIGRATION]],
      ['deploy'],
    ]);
  });

  it('existing database that is behind: additive upgrade, then baseline', async () => {
    const io = fakeIo({
      tables: 80,
      recorded: ['20250301120000_init'],
      local: ['20250301120000_init', INIT_MIGRATION],
      diffs: [ADD_TABLE, ''],
    });
    expect(await setupSchema(io)).toBe('adopt-behind');
    expect(kinds(io)).toEqual(['diff', 'exec', 'diff', 'backup', 'mark-applied', 'deploy']);
    const sql = io.calls.find((c) => c[0] === 'exec')[1];
    expect(sql).toContain('CREATE TABLE "Meeting"');
    expect(sql).not.toMatch(/DROP/);
  });

  it('existing database that would lose data: stops before changing anything', async () => {
    const io = fakeIo({
      tables: 80,
      recorded: null,
      local: [INIT_MIGRATION],
      diffs: [ADD_TABLE + DROP_COLUMN],
    });
    await expect(setupSchema(io)).rejects.toThrow(/drop, rename or change data/);
    expect(kinds(io)).toEqual(['diff', 'fail']);
  });

  it('missing shipped init: stops', async () => {
    const io = fakeIo({ tables: 0, recorded: null, local: [], diffs: [''] });
    await expect(setupSchema(io)).rejects.toThrow(/is missing/);
    expect(kinds(io)).toEqual(['fail']);
  });
});
