#!/usr/bin/env node
/**
 * One-command local setup for a fresh clone: `pnpm quickstart`.
 *
 *   1. Checks Node and Docker.
 *   2. Creates .env and apps/web/.env.local from the examples (never
 *      overwrites) and fills in BETTER_AUTH_SECRET and MAIL_ENCRYPTION_KEY when
 *      they are blank or still the placeholder.
 *   3. Starts the docker compose services and waits for Postgres and Redis.
 *   4. Applies the database schema and seeds the demo data.
 *
 * Safe to run again: every step skips what is already done.
 * Plain Node, no dependencies, works the same on Windows, macOS and Linux.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIN_NODE = [22, 12];
const AUTH_PLACEHOLDER = 'replace-me-with-32-byte-hex-secret';
const WAIT_FOR = ['botss-postgres', 'botss-redis'];
const WAIT_TIMEOUT_MS = 120_000;

const isWindows = process.platform === 'win32';
const color = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = color('1');
const green = color('32');
const yellow = color('33');
const red = color('31');

function step(title) {
  console.log(`\n${bold(`> ${title}`)}`);
}
function ok(msg) {
  console.log(`  ${green('ok')}  ${msg}`);
}
function warn(msg) {
  console.log(`  ${yellow('!!')}  ${msg}`);
}
function fail(msg, ...hints) {
  console.error(`\n${red('Setup stopped:')} ${msg}`);
  for (const hint of hints) console.error(`  ${hint}`);
  console.error('\nFix the above and run `pnpm quickstart` again. It picks up where it left off.');
  process.exit(1);
}

/** Run a command, inheriting the terminal. Returns true on exit code 0. */
function run(cmd, args, { quiet = false } = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: quiet ? 'pipe' : 'inherit',
    // pnpm and docker are .cmd shims on Windows; spawning them needs a shell.
    shell: isWindows,
    encoding: 'utf8',
  });
  return { ok: result.status === 0, stdout: result.stdout ?? '' };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── 1. Prerequisites ───────────────────────────────────────────────────────

function checkPrerequisites() {
  step('Checking prerequisites');

  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
    fail(
      `Node ${process.versions.node} is too old. IWM needs Node ${MIN_NODE.join('.')} or newer.`,
      'Install the current Node 22 LTS from https://nodejs.org and reopen your terminal.',
    );
  }
  ok(`Node ${process.versions.node}`);

  if (!existsSync(join(ROOT, 'node_modules'))) {
    fail('Dependencies are not installed.', 'Run `pnpm install` first.');
  }
  ok('Dependencies installed');

  if (!run('docker', ['--version'], { quiet: true }).ok) {
    fail(
      'Docker is not installed or not on your PATH.',
      'Install Docker Desktop from https://www.docker.com/products/docker-desktop/',
    );
  }
  if (!run('docker', ['info'], { quiet: true }).ok) {
    fail(
      'Docker is installed but not running.',
      'Start Docker Desktop and wait until it says "Engine running".',
    );
  }
  ok('Docker is running');
}

// ─── 2. Env files ───────────────────────────────────────────────────────────

function readEnvValue(text, key) {
  const match = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : undefined;
}

function setEnvValue(text, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  return pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
}

function copyIfMissing(example, target) {
  const label = target.replace(`${ROOT}${isWindows ? '\\' : '/'}`, '');
  if (existsSync(target)) {
    ok(`${label} already exists, kept as is`);
    return;
  }
  copyFileSync(example, target);
  ok(`Created ${label}`);
}

function prepareEnvFiles() {
  step('Preparing env files');

  const envPath = join(ROOT, '.env');
  copyIfMissing(join(ROOT, '.env.example'), envPath);
  copyIfMissing(join(ROOT, 'apps/web/.env.example'), join(ROOT, 'apps/web/.env.local'));

  let env = readFileSync(envPath, 'utf8');
  const original = env;

  const authSecret = readEnvValue(env, 'BETTER_AUTH_SECRET');
  if (!authSecret || authSecret === AUTH_PLACEHOLDER) {
    env = setEnvValue(env, 'BETTER_AUTH_SECRET', randomBytes(32).toString('hex'));
    ok('Generated BETTER_AUTH_SECRET');
  } else {
    ok('BETTER_AUTH_SECRET already set');
  }

  const mailKey = readEnvValue(env, 'MAIL_ENCRYPTION_KEY');
  if (!mailKey) {
    env = setEnvValue(env, 'MAIL_ENCRYPTION_KEY', randomBytes(32).toString('hex'));
    ok('Generated MAIL_ENCRYPTION_KEY');
  } else if (!/^[0-9a-fA-F]{64}$/.test(mailKey)) {
    // Never replace a non-empty key: it may already encrypt stored mail passwords.
    fail(
      'MAIL_ENCRYPTION_KEY in .env is set but is not 64 hex characters.',
      'If this is a fresh install, delete the value (leave `MAIL_ENCRYPTION_KEY=`) and re-run.',
    );
  } else {
    ok('MAIL_ENCRYPTION_KEY already set');
  }

  if (env !== original) writeFileSync(envPath, env);
}

// ─── 3. Docker services ─────────────────────────────────────────────────────

function containerHealth(name) {
  const result = run('docker', ['inspect', '-f', '{{.State.Health.Status}}', name], {
    quiet: true,
  });
  return result.ok ? result.stdout.trim() : 'missing';
}

async function startServices() {
  step('Starting Postgres, Redis, MinIO, Gotenberg and LiveKit (docker compose)');

  if (!run('docker', ['compose', 'up', '-d']).ok) {
    fail(
      '`docker compose up -d` failed (see the output above).',
      'A common cause is a port already in use: 5433, 6380, 9100, 9101, 3100 or 7880-7882.',
      'Stop whatever uses it, or change the host port in docker-compose.yml and the matching URL in .env.',
    );
  }

  process.stdout.write('  ..  Waiting for Postgres and Redis to be ready');
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (WAIT_FOR.every((name) => containerHealth(name) === 'healthy')) {
      process.stdout.write('\n');
      ok('Postgres and Redis are ready');
      return;
    }
    process.stdout.write('.');
    await sleep(2000);
  }
  process.stdout.write('\n');
  fail(
    'Postgres or Redis did not become healthy within 2 minutes.',
    'Check their logs with `docker compose logs postgres redis`.',
  );
}

// ─── 4. Database ────────────────────────────────────────────────────────────

function hasMigrations() {
  const dir = join(ROOT, 'packages/database/prisma/migrations');
  return existsSync(dir) && readdirSync(dir).some((entry) => /^\d/.test(entry));
}

function prepareDatabase() {
  step('Creating the database schema');

  // The repo does not ship migrations yet (see README, "Not included"). The
  // first run creates an `init` migration from schema.prisma; later runs apply
  // whatever exists without prompting.
  const migrated = hasMigrations()
    ? run('pnpm', [
        'exec',
        'dotenv',
        '-e',
        '.env',
        '--',
        'pnpm',
        '--filter',
        '@botss/database',
        'exec',
        'prisma',
        'migrate',
        'deploy',
      ])
    : run('pnpm', ['db:migrate', '--name', 'init', '--skip-seed']);
  if (!migrated.ok) {
    fail('Creating the schema failed (see the output above).');
  }
  ok('Schema is up to date');

  step('Seeding demo data');
  if (!run('pnpm', ['db:seed:dev']).ok) {
    fail('Seeding failed (see the output above).');
  }
  ok('Demo data ready');
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(bold('IWM quickstart'));
  checkPrerequisites();
  prepareEnvFiles();
  await startServices();
  prepareDatabase();

  console.log(`
${green(bold('All set.'))}

  Start the app:   ${bold('pnpm dev')}
  Then open:       ${bold('http://localhost:3000')}
  Sign in with:    admin@example.com / demo-admin-password

  The demo account is for local development only.
`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
