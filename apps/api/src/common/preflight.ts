/**
 * Boot-time preflight: catches the setup mistakes a first-time self-hoster
 * makes (no .env, placeholder secrets, Docker services not running) and stops
 * the boot with one readable message instead of a stack trace from deep inside
 * Better Auth, Prisma or ioredis.
 *
 * Runs in every role before Nest starts. It never logs secret values.
 */
import { Socket } from 'node:net';

/** The placeholder shipped in .env.example. A real install must replace it. */
export const BETTER_AUTH_SECRET_PLACEHOLDER = 'replace-me-with-32-byte-hex-secret';

const SETUP_HINT =
  'Run `pnpm quickstart` from the repository root to create .env and fill in secrets.';

export class PreflightError extends Error {
  constructor(readonly problems: string[]) {
    super(
      [
        'The API cannot start because of a setup problem:',
        ...problems.map((p) => `  - ${p}`),
        '',
        'See "Quick start" and "Troubleshooting" in README.md.',
      ].join('\n'),
    );
    this.name = 'PreflightError';
  }
}

/** Pure check of the required env vars. Returns one message per problem. */
export function findEnvProblems(env: NodeJS.ProcessEnv): string[] {
  const problems: string[] = [];

  const authSecret = env.BETTER_AUTH_SECRET?.trim();
  if (!authSecret) {
    problems.push(`BETTER_AUTH_SECRET is not set. ${SETUP_HINT}`);
  } else if (authSecret === BETTER_AUTH_SECRET_PLACEHOLDER) {
    problems.push(`BETTER_AUTH_SECRET is still the placeholder from .env.example. ${SETUP_HINT}`);
  }

  const mailKey = env.MAIL_ENCRYPTION_KEY?.trim();
  if (!mailKey) {
    problems.push(`MAIL_ENCRYPTION_KEY is not set. ${SETUP_HINT}`);
  } else if (!/^[0-9a-fA-F]{64}$/.test(mailKey)) {
    problems.push(
      'MAIL_ENCRYPTION_KEY must be exactly 64 hex characters. ' +
        "Generate one with `node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"`.",
    );
  }

  if (!env.DATABASE_URL?.trim()) problems.push(`DATABASE_URL is not set. ${SETUP_HINT}`);
  if (!env.REDIS_URL?.trim()) problems.push(`REDIS_URL is not set. ${SETUP_HINT}`);

  return problems;
}

/** host:port of a connection URL, or null if it cannot be parsed. */
export function hostPortOf(
  url: string,
  defaultPort: number,
): { host: string; port: number } | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) return null;
    return { host: parsed.hostname, port: parsed.port ? Number(parsed.port) : defaultPort };
  } catch {
    return null;
  }
}

function canConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

/** TCP-level check that Postgres and Redis are listening. */
export async function findServiceProblems(
  env: NodeJS.ProcessEnv,
  timeoutMs = 3000,
): Promise<string[]> {
  const services = [
    { name: 'PostgreSQL', url: env.DATABASE_URL, defaultPort: 5432 },
    { name: 'Redis', url: env.REDIS_URL, defaultPort: 6379 },
  ];
  const problems: string[] = [];
  for (const service of services) {
    if (!service.url) continue;
    const target = hostPortOf(service.url, service.defaultPort);
    if (!target) {
      problems.push(`${service.name} URL in .env could not be parsed.`);
      continue;
    }
    if (!(await canConnect(target.host, target.port, timeoutMs))) {
      problems.push(
        `${service.name} is not reachable at ${target.host}:${target.port}. ` +
          'Is Docker running? Start the local services with `docker compose up -d`.',
      );
    }
  }
  return problems;
}

/**
 * Throws PreflightError when the env or the local services are not ready.
 * The service check runs outside production only: a deployed process keeps
 * its existing behaviour of letting Prisma / ioredis retry while a database
 * restarts.
 */
export async function runPreflight(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const envProblems = findEnvProblems(env);
  // Missing URLs make the service check meaningless; report env first.
  if (envProblems.length > 0) throw new PreflightError(envProblems);
  if (env.NODE_ENV === 'production') return;
  const serviceProblems = await findServiceProblems(env);
  if (serviceProblems.length > 0) throw new PreflightError(serviceProblems);
}
