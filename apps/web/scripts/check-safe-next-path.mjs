// Checks safeNextPath (src/lib/safe-next-path.ts) against open-redirect
// payloads. The module is pure, so it is transpiled with the TypeScript
// compiler and imported directly, no test runner needed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const WEB_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = readFileSync(join(WEB_DIR, 'src', 'lib', 'safe-next-path.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { safeNextPath } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

const rejected = [
  '//x',
  '/\\x',
  decodeURIComponent('/%09/x'),
  '/\t/x',
  '/\n/x',
  '/\t\\x',
  'https://x',
  '/..//x',
  '/.//x',
  '/a/..//x',
  '/%2e%2e//x',
  'javascript:alert(1)',
  '',
  null,
  undefined,
];
const accepted = [
  ['/projects/1?tab=a#b', '/projects/1?tab=a#b'],
  ['/home', '/home'],
];

function run(label) {
  for (const value of rejected) {
    assert.equal(safeNextPath(value), null, `${label}: ${JSON.stringify(value)} should be rejected`);
  }
  for (const [value, expected] of accepted) {
    assert.equal(safeNextPath(value), expected, `${label}: ${JSON.stringify(value)}`);
  }
}

run('no window');
globalThis.window = { location: { origin: 'https://portal.example.com' } };
run('with window');
delete globalThis.window;

console.log('safeNextPath: all cases pass');
