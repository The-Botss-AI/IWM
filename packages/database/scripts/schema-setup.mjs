/**
 * Brings a database to the current schema without ever dropping data. Shared
 * by `pnpm quickstart` (scripts/quickstart.mjs) and the Docker `db-setup`
 * service (docker/db-setup.mjs).
 *
 * The repo ships its migration history in prisma/migrations, starting with
 * one generic `init` migration (INIT_MIGRATION). Three kinds of database meet
 * it:
 *
 *   fresh    No tables yet. `prisma migrate deploy` applies the shipped
 *            migrations.
 *   tracked  `_prisma_migrations` already records our init. `prisma migrate
 *            deploy` applies whatever shipped since.
 *   adopt    Tables exist but our init was never recorded: an install made
 *            before the repo shipped migrations (it created its own local
 *            `init`, possibly `_upgrade` ones, or used `db push`). The
 *            database is compared with schema.prisma
 *            (`prisma migrate diff --from-schema-datasource
 *            --to-schema-datamodel`):
 *              - it matches: nothing to change;
 *              - it is behind (an older IWM): the missing tables, columns,
 *                enum values and indexes are added, and only when every
 *                statement is purely additive;
 *              - anything else (a drop, rename, type change, row write):
 *                stop and print the SQL, nothing is changed.
 *            Then the old local migrations are moved to
 *            prisma/migrations-backup/<time>/ (with a copy of the old
 *            `_prisma_migrations` rows), and in one transaction the old rows
 *            are replaced by one applied row per shipped migration (the row
 *            and checksum `prisma migrate resolve --applied` would write),
 *            because the database now equals the schema they produce. Extra
 *            indexes the database has and the schema does not (SQL-only
 *            search indexes, for example) are left in place.
 *
 * A run holds a Postgres advisory lock for the whole setup, so two at once
 * (quickstart and the Docker db-setup, say) take turns instead of racing.
 *
 * The pure functions (classifyDiff, planSetup, planAdoption, setupSchema with
 * injected I/O) are tested by schema-setup.test.mjs. Plain Node, no build.
 */
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/** The first shipped migration. Must match the folder in prisma/migrations. */
export const INIT_MIGRATION = '20261122000000_init';
export const BACKUP_DIR = 'migrations-backup';
const MIGRATIONS_TABLE = '_prisma_migrations';
/**
 * Advisory lock key held for the whole setup ("IWMS" in ASCII). It must differ
 * from Prisma's own migrate lock (72707369): `migrate deploy` takes that one
 * while we hold ours.
 */
export const SETUP_LOCK_ID = 1230392659;

/** SQL statements without comments or blank lines. */
export function sqlStatements(sql) {
  return sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// An allowlist: a statement is additive only when it starts with one of these
// clauses and nothing after that clause drops, renames or retypes anything.
// Everything else (UPDATE, INSERT, `DROP "col"`, `ALTER COLUMN ... TYPE ...
// USING`, ...) is destructive. SET DEFAULT changes no rows, and `ON DELETE
// CASCADE` / `ON UPDATE` in a new foreign key are not among the words below.
const ADDITIVE =
  /^(?:CREATE (?:UNIQUE )?INDEX|CREATE TABLE|CREATE TYPE|CREATE EXTENSION|ALTER TYPE \S+ ADD VALUE|ALTER TABLE \S+ ADD (?:COLUMN|CONSTRAINT)|ALTER TABLE \S+ ALTER COLUMN \S+ SET DEFAULT)\b/i;
const CHANGES = /\b(?:DROP|RENAME|TYPE|USING)\b/i;
// In CREATE INDEX, USING names the index method (`USING GIN`).
const INDEX_CHANGES = /\b(?:DROP|RENAME|TYPE)\b/i;
const EXTRA_INDEX = /^DROP INDEX\b/i;

/** True when the statement only creates or adds something (see ADDITIVE). */
export function isAdditive(statement) {
  const normalized = statement.replace(/\s+/g, ' ').trim();
  const start = ADDITIVE.exec(normalized);
  if (!start) return false;
  // Quoted names and string literals may hold any word ("type", 'DROP').
  const rest = normalized
    .slice(start[0].length)
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/'(?:[^']|'')*'/g, "''");
  const forbidden = /^CREATE (?:UNIQUE )?INDEX/i.test(start[0]) ? INDEX_CHANGES : CHANGES;
  return !forbidden.test(rest);
}

/**
 * Sorts the statements of a `migrate diff` script (database -> schema):
 *   additive     creates or adds something the database lacks,
 *   extraIndexes would drop an index only the database has (left alone),
 *   destructive  would drop, rename, retype or delete something.
 */
export function classifyDiff(sql) {
  const result = { additive: [], extraIndexes: [], destructive: [] };
  for (const statement of sqlStatements(sql)) {
    if (EXTRA_INDEX.test(statement)) result.extraIndexes.push(statement);
    else if (isAdditive(statement)) result.additive.push(statement);
    else result.destructive.push(statement);
  }
  return result;
}

/** Local migrations left by installs made before the repo shipped its own. */
export function legacyMigrations(local, recorded) {
  const recordedSet = new Set(recorded);
  return local.filter(
    (name) =>
      name !== INIT_MIGRATION &&
      (name < INIT_MIGRATION || /_(init|upgrade)$/.test(name) || recordedSet.has(name)),
  );
}

/**
 * @param {{ tables: number, recorded: string[] | null, local: string[] }} state
 *   tables:   tables in the schema, `_prisma_migrations` not counted
 *   recorded: migration names in `_prisma_migrations` (null: no such table)
 *   local:    migration folders in prisma/migrations
 */
export function planSetup({ tables, recorded, local }) {
  if (!local.includes(INIT_MIGRATION)) return { kind: 'missing-init' };
  const rows = recorded ?? [];
  if (rows.includes(INIT_MIGRATION)) return { kind: 'tracked' };
  // In both remaining cases nothing recorded was built on our init, so every
  // recorded row and older local folder belongs to the old setup.
  const legacy = legacyMigrations(local, tables === 0 ? [] : rows);
  if (tables === 0) return { kind: 'fresh', legacy };
  return { kind: 'adopt', legacy };
}

/** What adopting an existing database takes, from its `migrate diff` script. */
export function planAdoption(diffSql) {
  const { additive, extraIndexes, destructive } = classifyDiff(diffSql);
  if (destructive.length > 0) return { kind: 'blocked', statements: destructive, extraIndexes };
  if (additive.length > 0) return { kind: 'behind', statements: additive, extraIndexes };
  return { kind: 'matching', statements: [], extraIndexes };
}

const toScript = (statements) => statements.map((s) => `${s};`).join('\n\n');

/**
 * Runs the decision above against injected I/O, so the same code serves the
 * host, the container and the tests. Returns the kind of database it found.
 *
 * io: listLocal(), countTables(), recordedMigrations(), diffFromDatabase(),
 *     execSql(sql), migrateDeploy(),
 *     markApplied(names): in one transaction, replace every
 *       `_prisma_migrations` row with one applied row per name,
 *     backupLegacy(names) -> folder or null when there was nothing to save,
 *     clearHistory(), log(msg), fail(msg, ...hints)
 */
export async function setupSchema(io) {
  const local = await io.listLocal();
  const plan = planSetup({
    tables: await io.countTables(),
    recorded: await io.recordedMigrations(),
    local,
  });

  if (plan.kind === 'missing-init') {
    return io.fail(
      `packages/database/prisma/migrations/${INIT_MIGRATION} is missing.`,
      'Restore it from git: git checkout -- packages/database/prisma/migrations',
    );
  }

  if (plan.kind === 'tracked') {
    await io.migrateDeploy();
    const left = classifyDiff(await io.diffFromDatabase());
    if (left.additive.length > 0 || left.destructive.length > 0) {
      io.log(
        'schema.prisma has changes no migration covers yet. If you changed it, create one with ' +
          '`pnpm db:migrate --name <change>` (see CONTRIBUTING.md).',
      );
    }
    return 'tracked';
  }

  if (plan.kind === 'fresh') {
    if (plan.legacy.length > 0) {
      io.log(`moved old local migrations to ${await io.backupLegacy(plan.legacy)}`);
      await io.clearHistory();
    }
    await io.migrateDeploy();
    return 'fresh';
  }

  // adopt
  const adoption = planAdoption(await io.diffFromDatabase());
  if (adoption.kind === 'blocked') {
    return io.fail(
      'the database differs from schema.prisma in a way that would drop, rename or change data.',
      'Nothing was changed. Review the SQL below and bring the database in line yourself',
      '(see "Upgrading an existing install" in the README):',
      '',
      toScript(adoption.statements),
    );
  }
  if (adoption.kind === 'behind') {
    io.log(`the database is behind schema.prisma, adding ${adoption.statements.length} item(s)`);
    await io.execSql(toScript(adoption.statements));
    const after = planAdoption(await io.diffFromDatabase());
    if (after.kind !== 'matching') {
      return io.fail(
        'the database still differs from schema.prisma after the additive upgrade.',
        'Review the SQL below:',
        '',
        toScript(after.statements),
      );
    }
  }
  if (adoption.extraIndexes.length > 0) {
    io.log(`kept ${adoption.extraIndexes.length} index(es) the schema does not define`);
  }

  const folder = await io.backupLegacy(plan.legacy);
  const legacy = new Set(plan.legacy);
  await io.markApplied(local.filter((n) => !legacy.has(n)).sort());
  io.log(
    folder
      ? `adopted the existing database; old migration history saved in ${folder}`
      : 'adopted the existing database',
  );
  await io.migrateDeploy();
  return adoption.kind === 'behind' ? 'adopt-behind' : 'adopt-matching';
}

// ─── Real I/O ───────────────────────────────────────────────────────────────

/**
 * Runs setupSchema against a real database.
 *
 * @param {object} opts
 * @param {string} opts.dbDir        packages/database
 * @param {string} opts.databaseUrl  the DATABASE_URL to use
 * @param {(msg: string) => void} opts.log
 * @param {(msg: string, ...hints: string[]) => never} opts.fail
 * @param {(path: string) => void} [opts.onCreate]  called for every path created (Docker hands it to the host user)
 */
export async function runSchemaSetup({ dbDir, databaseUrl, log, fail, onCreate = () => {} }) {
  const prismaDir = join(dbDir, 'prisma');
  const migrationsDir = join(prismaDir, 'migrations');
  const require = createRequire(join(dbDir, 'package.json'));
  const prismaCli = require.resolve('prisma/build/index.js');
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    CHECKPOINT_DISABLE: '1',
    PRISMA_HIDE_UPDATE_MESSAGE: '1',
  };

  function prisma(args, { capture = false, input } = {}) {
    const result = spawnSync(process.execPath, [prismaCli, ...args], {
      cwd: dbDir,
      env,
      input,
      stdio: [input === undefined ? 'ignore' : 'pipe', capture ? 'pipe' : 'inherit', 'inherit'],
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) fail(`\`prisma ${args.join(' ')}\` failed (see the output above).`);
    return result.stdout ?? '';
  }

  const { PrismaClient } = (await import('@prisma/client')).default;
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  // The advisory lock belongs to one Postgres session, so it gets a client of
  // its own with a single connection, kept busy so the pool never closes it
  // as idle while `migrate deploy` runs.
  const lockUrl = new URL(databaseUrl);
  lockUrl.searchParams.set('connection_limit', '1');
  const lockDb = new PrismaClient({ datasourceUrl: lockUrl.toString() });
  let keepAlive;
  const hasHistoryTable = async () => {
    const [{ n }] = await db.$queryRaw`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = ${MIGRATIONS_TABLE}`;
    return n > 0;
  };

  try {
    const [{ locked }] = await lockDb.$queryRawUnsafe(
      `SELECT pg_try_advisory_lock(${SETUP_LOCK_ID}) AS locked`,
    );
    if (!locked) {
      log('another schema setup is running on this database, waiting for it to finish');
      await lockDb.$executeRawUnsafe(`SELECT pg_advisory_lock(${SETUP_LOCK_ID})`);
    }
    keepAlive = setInterval(() => {
      lockDb.$queryRawUnsafe('SELECT 1').catch(() => {});
    }, 30_000);
    keepAlive.unref();

    return await setupSchema({
      log,
      fail,
      listLocal: () =>
        existsSync(migrationsDir)
          ? readdirSync(migrationsDir, { withFileTypes: true })
              .filter((e) => e.isDirectory() && /^\d/.test(e.name))
              .map((e) => e.name)
              .sort()
          : [],
      countTables: async () => {
        const [{ n }] = await db.$queryRaw`
          SELECT count(*)::int AS n FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name <> ${MIGRATIONS_TABLE}`;
        return n;
      },
      recordedMigrations: async () => {
        if (!(await hasHistoryTable())) return null;
        const rows = await db.$queryRawUnsafe(
          `SELECT migration_name FROM "${MIGRATIONS_TABLE}" WHERE rolled_back_at IS NULL`,
        );
        return rows.map((r) => r.migration_name);
      },
      diffFromDatabase: async () =>
        prisma(
          [
            'migrate',
            'diff',
            '--from-schema-datasource',
            'prisma/schema.prisma',
            '--to-schema-datamodel',
            'prisma/schema.prisma',
            '--script',
          ],
          { capture: true },
        ),
      execSql: async (sql) => {
        prisma(['db', 'execute', '--stdin', '--schema', 'prisma/schema.prisma'], { input: sql });
      },
      migrateDeploy: async () => {
        prisma(['migrate', 'deploy']);
      },
      markApplied: async (names) => {
        // What `prisma migrate resolve --applied` writes, for every shipped
        // migration at once: the checksum is the SHA-256 of migration.sql.
        const rows = names.map((name) => ({
          name,
          checksum: createHash('sha256')
            .update(readFileSync(join(migrationsDir, name, 'migration.sql')))
            .digest('hex'),
        }));
        await db.$transaction([
          // Prisma's own definition, for an install that never had the table
          // (made with `db push`).
          db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (
            "id"                    VARCHAR(36) PRIMARY KEY NOT NULL,
            "checksum"              VARCHAR(64) NOT NULL,
            "finished_at"           TIMESTAMPTZ,
            "migration_name"        VARCHAR(255) NOT NULL,
            "logs"                  TEXT,
            "rolled_back_at"        TIMESTAMPTZ,
            "started_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
            "applied_steps_count"   INTEGER NOT NULL DEFAULT 0
          )`),
          db.$executeRawUnsafe(`DELETE FROM "${MIGRATIONS_TABLE}"`),
          ...rows.map(({ name, checksum }) =>
            db.$executeRawUnsafe(
              `INSERT INTO "${MIGRATIONS_TABLE}"
                 (id, checksum, migration_name, logs, started_at, finished_at, applied_steps_count)
               VALUES ($1, $2, $3, NULL, now(), now(), 1)`,
              randomUUID(),
              checksum,
              name,
            ),
          ),
        ]);
      },
      backupLegacy: async (names) => {
        const rows = (await hasHistoryTable())
          ? await db.$queryRawUnsafe(`SELECT * FROM "${MIGRATIONS_TABLE}"`)
          : [];
        if (names.length === 0 && rows.length === 0) return null;
        const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
        const root = join(prismaDir, BACKUP_DIR);
        const folder = join(root, stamp);
        if (!existsSync(root)) {
          mkdirSync(root);
          onCreate(root);
        }
        mkdirSync(folder);
        onCreate(folder);
        if (rows.length > 0) {
          const file = join(folder, `${MIGRATIONS_TABLE}.json`);
          writeFileSync(file, `${JSON.stringify(rows, null, 2)}\n`);
          onCreate(file);
        }
        for (const name of names) renameSync(join(migrationsDir, name), join(folder, name));
        return `packages/database/prisma/${BACKUP_DIR}/${stamp}`;
      },
      clearHistory: async () => {
        if (await hasHistoryTable())
          await db.$executeRawUnsafe(`DELETE FROM "${MIGRATIONS_TABLE}"`);
      },
    });
  } finally {
    clearInterval(keepAlive);
    // Unlocking a lock this session does not hold only warns; closing the
    // connection would release it anyway.
    await lockDb.$executeRawUnsafe(`SELECT pg_advisory_unlock(${SETUP_LOCK_ID})`).catch(() => {});
    await lockDb.$disconnect();
    await db.$disconnect();
  }
}
