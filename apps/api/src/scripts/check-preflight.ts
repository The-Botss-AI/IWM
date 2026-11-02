/**
 * Boot preflight (common/preflight.ts), no database or Redis needed:
 *
 *  1. Missing, placeholder and malformed secrets are each reported with a
 *     message that points at `pnpm quickstart`.
 *  2. A complete env passes the env check.
 *  3. Unreachable Postgres/Redis are reported by host:port; production skips
 *     the service check.
 *
 * Run: pnpm --filter @botss/api test.
 */
import assert from 'node:assert/strict';
import { createServer, type AddressInfo } from 'node:net';

import {
  BETTER_AUTH_SECRET_PLACEHOLDER,
  findEnvProblems,
  findServiceProblems,
  hostPortOf,
  PreflightError,
  runPreflight,
} from '../common/preflight';

const GOOD_ENV = {
  BETTER_AUTH_SECRET: 'a'.repeat(64),
  MAIL_ENCRYPTION_KEY: 'b'.repeat(64),
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:5433/db?schema=public',
  REDIS_URL: 'redis://127.0.0.1:6380',
};

async function main(): Promise<void> {
  // 1. Env problems.
  const empty = findEnvProblems({});
  assert.equal(empty.length, 4);
  assert.ok(empty.every((p) => p.includes('pnpm quickstart')));

  const placeholder = findEnvProblems({
    ...GOOD_ENV,
    BETTER_AUTH_SECRET: BETTER_AUTH_SECRET_PLACEHOLDER,
  });
  assert.equal(placeholder.length, 1);
  assert.match(placeholder[0]!, /placeholder/);

  const badKey = findEnvProblems({ ...GOOD_ENV, MAIL_ENCRYPTION_KEY: 'not-hex' });
  assert.equal(badKey.length, 1);
  assert.match(badKey[0]!, /64 hex characters/);

  // 2. Complete env.
  assert.deepEqual(findEnvProblems(GOOD_ENV), []);

  // 3. Services.
  assert.deepEqual(hostPortOf('redis://localhost:6380', 6379), { host: 'localhost', port: 6380 });
  assert.deepEqual(hostPortOf('redis://localhost', 6379), { host: 'localhost', port: 6379 });
  assert.equal(hostPortOf('nonsense', 1), null);

  const listener = createServer().listen(0, '127.0.0.1');
  await new Promise<void>((r) => listener.once('listening', () => r()));
  const openPort = (listener.address() as AddressInfo).port;
  // A port that was free a moment ago: bind, read, close.
  const probe = createServer().listen(0, '127.0.0.1');
  await new Promise<void>((r) => probe.once('listening', () => r()));
  const closedPort = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));

  try {
    const reachable = await findServiceProblems(
      {
        DATABASE_URL: `postgresql://u:p@127.0.0.1:${openPort}/db`,
        REDIS_URL: `redis://127.0.0.1:${openPort}`,
      },
      1000,
    );
    assert.deepEqual(reachable, []);

    const downEnv = { ...GOOD_ENV, REDIS_URL: `redis://127.0.0.1:${closedPort}` };
    downEnv.DATABASE_URL = `postgresql://u:p@127.0.0.1:${openPort}/db`;
    const down = await findServiceProblems(downEnv, 1000);
    assert.equal(down.length, 1);
    assert.match(down[0]!, new RegExp(`Redis is not reachable at 127\\.0\\.0\\.1:${closedPort}`));
    assert.match(down[0]!, /docker compose up -d/);

    await assert.rejects(runPreflight(downEnv), PreflightError);
    await runPreflight({ ...downEnv, NODE_ENV: 'production' });
    await assert.rejects(runPreflight({ NODE_ENV: 'production' }), PreflightError);
  } finally {
    listener.close();
  }

  // eslint-disable-next-line no-console
  console.log('check-preflight: ok');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
