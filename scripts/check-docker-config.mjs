#!/usr/bin/env node
/**
 * Catches changes that would leave the Docker setup (`docker compose --profile
 * app up`) quietly broken while every other check passes. The CI `docker` job
 * catches anything that fails loudly; these fail silently:
 *
 *   1. A NEXT_PUBLIC_* var the web code reads but the image build never gets:
 *      it compiles to `undefined` in the browser bundle.
 *   2. A server-side URL in .env.example pointing at localhost that
 *      docker-compose.yml does not override for the API: inside the container
 *      `localhost` is the API itself.
 *   3. A presigned URL signed outside FilesService: it would be signed for
 *      the API's storage host, which browsers cannot reach in Docker.
 *   4. Web code outside the browser using NEXT_PUBLIC_API_URL to reach the
 *      API: on the server that has to be API_INTERNAL_URL.
 *   5. A Node version in the Dockerfile below the one package.json requires.
 *
 * Plain Node, no dependencies. Run: node scripts/check-docker-config.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

/**
 * .env.example entries that point at localhost on purpose: browsers use them,
 * and in Docker they reach the published ports. Anything else on localhost is
 * a server-side address and needs an override in docker-compose.yml.
 */
const BROWSER_FACING = new Set([
  'PUBLIC_APP_URL',
  'BETTER_AUTH_URL',
  'WEB_ORIGIN',
  'LIVEKIT_URL', // handed to browsers with the room token
]);

/** Files allowed to use env.apiUrl outside a 'use client' module. */
const API_URL_ALLOWED = new Set([
  'apps/web/src/lib/env.ts', // defines it
  'apps/web/src/lib/api.ts', // getApi(): browser only (cookies, workspace header)
  'apps/web/src/lib/server-api.ts', // prefers API_INTERNAL_URL
]);

const problems = [];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) out.push(path);
  }
  return out;
}

const rel = (path) => relative(ROOT, path).replaceAll('\\', '/');

/** Top-level block of one compose service, as text. */
function composeService(compose, name) {
  const lines = compose.split(/\r?\n/);
  const start = lines.findIndex((l) => l === `  ${name}:`);
  if (start === -1) return '';
  const end = lines.findIndex((l, i) => i > start && /^ {2}\S/.test(l));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

const dockerfile = read('Dockerfile');
const compose = read('docker-compose.yml');
const envExample = read('.env.example');

// 1. NEXT_PUBLIC_* reach the web build.
const webSources = [
  ...walk(join(ROOT, 'apps/web/src')),
  ...readdirSync(join(ROOT, 'packages')).flatMap((p) => {
    const src = join(ROOT, 'packages', p, 'src');
    try {
      return walk(src);
    } catch {
      return [];
    }
  }),
];
const publicVars = new Set();
for (const file of webSources) {
  for (const m of readFileSync(file, 'utf8').matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g)) {
    publicVars.add(m[1]);
  }
}
for (const name of [...publicVars].sort()) {
  if (!new RegExp(`^ARG ${name}=`, 'm').test(dockerfile)) {
    problems.push(`${name} is read by the web app but is not an ARG in the Dockerfile.`);
  }
  if (!new RegExp(`^ {6}${name}: \\$\\{${name}`, 'm').test(compose)) {
    problems.push(
      `${name} is read by the web app but docker-compose.yml does not pass it as a build arg (x-iwm-image).`,
    );
  }
}

// 2. Server-side localhost URLs are overridden for the API container.
const apiService = composeService(compose, 'api');
if (!apiService) problems.push('docker-compose.yml has no `api` service.');
for (const m of envExample.matchAll(/^([A-Z0-9_]+)=(.*(?:localhost|127\.0\.0\.1).*)$/gm)) {
  const name = m[1];
  if (name.startsWith('NEXT_PUBLIC_') || BROWSER_FACING.has(name)) continue;
  if (!new RegExp(`^ {6}${name}:`, 'm').test(apiService)) {
    problems.push(
      `${name} points at localhost in .env.example, but the api service in docker-compose.yml ` +
        'does not override it. Inside the container localhost is the API itself: set it to the ' +
        "service's name there, or add it to BROWSER_FACING in this script if browsers use it.",
    );
  }
}

// 3. Upload URLs are signed only in FilesService.
for (const file of walk(join(ROOT, 'apps/api/src'))) {
  const path = rel(file);
  if (path.startsWith('apps/api/src/scripts/') || path === 'apps/api/src/files/files.service.ts') {
    continue;
  }
  if (/\bgetSignedUrl\s*\(/.test(readFileSync(file, 'utf8'))) {
    problems.push(
      `${path} calls getSignedUrl. Sign through FilesService so S3_PRESIGN_ENDPOINT applies, ` +
        'or the URL will not work in Docker.',
    );
  }
}

// 4. Server-side web code does not reach the API through the browser URL.
for (const file of walk(join(ROOT, 'apps/web/src'))) {
  const path = rel(file);
  if (API_URL_ALLOWED.has(path)) continue;
  const text = readFileSync(file, 'utf8');
  if (!/\benv\.apiUrl\b/.test(text)) continue;
  if (/^\s*['"]use client['"]/m.test(text)) continue;
  problems.push(
    `${path} uses env.apiUrl outside a 'use client' module. Server code must reach the API ` +
      'through createPublicServerApi() (API_INTERNAL_URL); browsers keep env.apiUrl.',
  );
}

// 5. The image's Node satisfies package.json engines.
const wantedMajor = Number(
  /(\d+)/.exec(JSON.parse(read('package.json')).engines?.node ?? '')?.[1] ?? 0,
);
const imageMajor = Number(/^FROM node:(\d+)/m.exec(dockerfile)?.[1] ?? 0);
if (imageMajor < wantedMajor) {
  problems.push(`Dockerfile uses node:${imageMajor}, package.json needs Node ${wantedMajor}+.`);
}

if (problems.length > 0) {
  console.error('Docker setup check failed:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  `check-docker-config: ok (${publicVars.size} NEXT_PUBLIC vars, Node ${imageMajor} image)`,
);
