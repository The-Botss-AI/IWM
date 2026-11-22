/**
 * Nightly reset of a public live demo: deletes ALL data and files, then seeds
 * the demo data again.
 *
 *   pnpm demo:reset --yes-delete-all-demo-data
 *
 * Refuses to run unless:
 *   - DEMO_MODE=true (the API of a demo server runs with it too),
 *   - the flag above is passed,
 *   - every user in the database has an @example.com address or one on the
 *     domain of DEMO_LOGIN_EMAIL. A demo never has anyone else, because the
 *     demo API refuses new people and email changes. A real install does, so
 *     a DEMO_MODE set there by mistake still stops here.
 *
 * Steps: delete every object in S3_BUCKET, TRUNCATE every table except
 * `_prisma_migrations`, run packages/database/prisma/seed.ts. Never point it
 * at a real install. See README, "Run a public demo".
 */
import 'reflect-metadata';

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { rawPrisma } from '@botss/database';

import { isDemoMode } from '../common/demo-mode';
import { createS3Client } from '../files/files.service';

const CONFIRM_FLAG = '--yes-delete-all-demo-data';
const ROOT = resolve(__dirname, '../../../..');

function stop(msg: string): never {
  console.error(`[demo-reset] stopped: ${msg}`);
  process.exit(1);
}

function allowedDomains(): Set<string> {
  const domains = new Set(['example.com']);
  const login = process.env.DEMO_LOGIN_EMAIL?.trim().toLowerCase();
  const domain = login?.split('@')[1];
  if (domain) domains.add(domain);
  return domains;
}

async function assertDemoDatabase(): Promise<void> {
  const allowed = allowedDomains();
  const users = await rawPrisma.user.findMany({ select: { email: true } });
  const outsiders = users.filter((u) => !allowed.has(u.email.toLowerCase().split('@')[1] ?? ''));
  if (outsiders.length > 0) {
    stop(
      `${outsiders.length} user(s) have addresses outside ${[...allowed].join(', ')}. ` +
        'This does not look like a demo database; nothing was deleted.',
    );
  }
}

async function truncateAll(): Promise<number> {
  const tables = await rawPrisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return 0;
  const list = tables.map((t) => `"${t.tablename.replaceAll('"', '""')}"`).join(', ');
  await rawPrisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  return tables.length;
}

async function emptyBucket(): Promise<number> {
  const bucket = process.env.S3_BUCKET ?? 'botss-files';
  const s3 = createS3Client(process.env.S3_ENDPOINT ?? 'http://localhost:9100');
  let deleted = 0;
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token, MaxKeys: 1000 }),
    );
    const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
    if (keys.length > 0) {
      await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }));
      deleted += keys.length;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return deleted;
}

function runSeed(): void {
  const dbDir = join(ROOT, 'packages/database');
  const tsxCli = createRequire(join(dbDir, 'package.json')).resolve('tsx/cli');
  const result = spawnSync(process.execPath, [tsxCli, 'prisma/seed.ts'], {
    cwd: dbDir,
    env: { ...process.env, NODE_ENV: 'development', ALLOW_SEED: 'true' },
    stdio: 'inherit',
  });
  if (result.status !== 0) stop('the demo seed failed (see the output above).');
}

async function main(): Promise<void> {
  if (!isDemoMode()) stop('DEMO_MODE is not true. This script only runs on a demo server.');
  if (!process.argv.includes(CONFIRM_FLAG)) {
    stop(`pass ${CONFIRM_FLAG} to confirm that every row and file will be deleted.`);
  }
  await assertDemoDatabase();

  // Files first: if storage is unreachable, the database is left as it was.
  const files = await emptyBucket();
  console.log(`[demo-reset] deleted ${files} file(s) from storage`);
  const tables = await truncateAll();
  console.log(`[demo-reset] emptied ${tables} tables`);
  await rawPrisma.$disconnect();
  runSeed();
  console.log(`[demo-reset] done at ${new Date().toISOString()}`);
}

main().catch(async (err) => {
  await rawPrisma.$disconnect().catch(() => undefined);
  stop(err instanceof Error ? err.message : String(err));
});
