/**
 * API entrypoint for the Docker setup (`docker compose --profile app up`).
 *
 * BETTER_AUTH_SECRET and MAIL_ENCRYPTION_KEY are taken from the environment
 * (your .env) when set. Otherwise each is generated once and kept in the
 * `iwm-secrets` volume, so IWM runs without a .env and keeps the same secrets
 * across restarts: a new MAIL_ENCRYPTION_KEY would make every stored mailbox
 * password unreadable, and a new auth secret would sign everyone out.
 *
 * A value that is set but malformed is left alone; the API preflight reports
 * it. Secret values are never printed.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SECRETS_DIR = process.env.IWM_SECRETS_DIR ?? '/secrets';
const AUTH_PLACEHOLDER = 'replace-me-with-32-byte-hex-secret';

const SECRETS = [
  { name: 'BETTER_AUTH_SECRET', file: 'better-auth-secret' },
  { name: 'MAIL_ENCRYPTION_KEY', file: 'mail-encryption-key' },
];

for (const { name, file } of SECRETS) {
  const current = process.env[name]?.trim();
  if (current && current !== AUTH_PLACEHOLDER) {
    console.log(`[iwm] ${name}: using the value from the environment`);
    continue;
  }
  const path = join(SECRETS_DIR, file);
  if (existsSync(path)) {
    process.env[name] = readFileSync(path, 'utf8').trim();
    console.log(`[iwm] ${name}: using the generated value from the iwm-secrets volume`);
    continue;
  }
  const value = randomBytes(32).toString('hex');
  // `wx` fails rather than overwrite if the file appeared in the meantime.
  writeFileSync(path, `${value}\n`, { mode: 0o600, flag: 'wx' });
  process.env[name] = value;
  console.log(`[iwm] ${name}: generated and stored in the iwm-secrets volume`);
}

// Same process: signals from `docker compose stop` reach the API directly.
await import(pathToFileURL(join(process.cwd(), 'dist', 'main.js')).href);
