/**
 * One-shot database setup for the Docker stack (the `db-setup` service).
 * Does what `pnpm quickstart` does for the schema and demo data:
 *
 *   1. Brings the database to the current schema with the migrations the
 *      repo ships (packages/database/scripts/schema-setup.mjs):
 *        - a fresh database gets `prisma migrate deploy`;
 *        - a database made before the repo shipped migrations is compared
 *          with schema.prisma (`prisma migrate diff --from-schema-datasource
 *          --to-schema-datamodel`), upgraded only by purely additive changes
 *          (it stops and prints the SQL if anything would be dropped, renamed
 *          or deleted), and then marked as having the shipped migrations
 *          (`prisma migrate resolve --applied`). Its old local migrations are
 *          moved to packages/database/prisma/migrations-backup/.
 *   2. Seeds the demo data while the database has no users, so a deleted
 *      demo admin is not brought back on the next start.
 *
 * packages/database/prisma is mounted from the host, so both setups share one
 * migrations folder. Runs as root so it can move old migrations in that
 * folder; anything it creates is handed to the folder's owner.
 */
import { spawnSync } from 'node:child_process';
import { chownSync, statSync } from 'node:fs';
import { join } from 'node:path';

import prismaClient from '@prisma/client';

import { runSchemaSetup } from '../packages/database/scripts/schema-setup.mjs';

const DB_DIR = '/repo/packages/database';
const PRISMA_DIR = join(DB_DIR, 'prisma');
const BIN = '/repo/node_modules/.bin';

function fail(msg, ...hints) {
  console.error(`\n[db-setup] stopped: ${msg}`);
  for (const hint of hints) console.error(`  ${hint}`);
  process.exit(1);
}

/** Give a path we created to the owner of the mounted folder (the host user). */
function handToHostUser(path) {
  const { uid, gid } = statSync(PRISMA_DIR);
  try {
    chownSync(path, uid, gid);
  } catch {
    // Docker Desktop bind mounts map ownership themselves and may refuse chown.
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail('DATABASE_URL is not set.');

  const kind = await runSchemaSetup({
    dbDir: DB_DIR,
    databaseUrl,
    log: (msg) => console.log(`[db-setup] ${msg}`),
    fail,
    onCreate: handToHostUser,
  });
  console.log(`[db-setup] schema is up to date (${kind})`);

  const prisma = new prismaClient.PrismaClient();
  let users = 0;
  try {
    users = await prisma.user.count();
  } finally {
    await prisma.$disconnect();
  }
  if (users > 0) {
    console.log('[db-setup] database already has users, demo seed skipped');
    return;
  }
  const seed = spawnSync(join(BIN, 'tsx'), ['prisma/seed.ts'], {
    cwd: DB_DIR,
    env: { ...process.env, NODE_ENV: 'development', ALLOW_SEED: 'true' },
    stdio: 'inherit',
  });
  if (seed.status !== 0) fail('the demo seed failed (see the output above).');
  console.log('[db-setup] demo data ready');
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
