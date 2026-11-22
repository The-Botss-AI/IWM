/**
 * Nightly reset of a public live demo: deletes ALL data and files, then seeds
 * the demo data again.
 *
 *   pnpm demo:reset --yes-delete-all-demo-data
 *
 * Refuses to run unless:
 *   - DEMO_MODE=true (the API of a demo server runs with it too),
 *   - the flag above is passed,
 *   - every user in the database has an @example.com address or is exactly
 *     DEMO_LOGIN_EMAIL. A demo never has anyone else, because the demo API
 *     refuses new people and email changes. A real install does, so a
 *     DEMO_MODE set there by mistake still stops here;
 *   - every organization other than the root one is the seed's demo org;
 *   - DEMO_S3_BUCKET is set and equals S3_BUCKET, a second, deliberate
 *     confirmation of which bucket gets emptied.
 *
 * Steps: clear the demo upload counter, delete every object in S3_BUCKET,
 * TRUNCATE every table except `_prisma_migrations`, run
 * packages/database/prisma/seed.ts. Never point it
 * at a real install. See README, "Run a public demo".
 */
import 'reflect-metadata';

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { rawPrisma } from '@botss/database';
import IORedis from 'ioredis';

import { DEMO_UPLOAD_BYTES_KEY, isDemoMode } from '../common/demo-mode';
import { createS3Client } from '../files/files.service';

const CONFIRM_FLAG = '--yes-delete-all-demo-data';
const ROOT = resolve(__dirname, '../../../..');
/** The organization id packages/database/prisma/seed.ts creates. */
const DEMO_ORG_ID = 'seed_org_demo';

function stop(msg: string): never {
  console.error(`[demo-reset] stopped: ${msg}`);
  process.exit(1);
}

function isDemoUser(email: string): boolean {
  const address = email.trim().toLowerCase();
  const login = process.env.DEMO_LOGIN_EMAIL?.trim().toLowerCase();
  return address.endsWith('@example.com') || (!!login && address === login);
}

async function assertDemoDatabase(): Promise<void> {
  const users = await rawPrisma.user.findMany({ select: { email: true } });
  const outsiders = users.filter((u) => !isDemoUser(u.email));
  if (outsiders.length > 0) {
    stop(
      `${outsiders.length} user(s) are neither @example.com nor DEMO_LOGIN_EMAIL. ` +
        'This does not look like a demo database; nothing was deleted.',
    );
  }
  const orgs = await rawPrisma.organization.findMany({
    where: { isRoot: false, id: { not: DEMO_ORG_ID } },
    select: { id: true },
  });
  if (orgs.length > 0) {
    stop(
      `${orgs.length} organization(s) besides the root and the demo org (${DEMO_ORG_ID}) exist. ` +
        'This does not look like a demo database; nothing was deleted.',
    );
  }
}

function demoBucket(): string {
  const bucket = process.env.S3_BUCKET ?? 'botss-files';
  const confirmed = process.env.DEMO_S3_BUCKET?.trim();
  if (!confirmed || confirmed !== bucket) {
    stop(
      `DEMO_S3_BUCKET must be set to the S3_BUCKET being emptied (${bucket}). Nothing was deleted.`,
    );
  }
  return bucket;
}

async function clearUploadCounter(): Promise<void> {
  const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
  });
  try {
    await redis.del(DEMO_UPLOAD_BYTES_KEY);
  } finally {
    redis.disconnect();
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

async function emptyBucket(bucket: string): Promise<number> {
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
  const bucket = demoBucket();
  await assertDemoDatabase();

  // Redis and files first: if either is unreachable, the database is left
  // as it was.
  await clearUploadCounter();
  console.log('[demo-reset] cleared the upload counter');
  const files = await emptyBucket(bucket);
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
