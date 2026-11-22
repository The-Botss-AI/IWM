// Checks the load-error helper (src/lib/load-error.ts): error detection and
// the reload-loop guard. The module is pure, so it is transpiled and imported
// directly, like check-safe-next-path.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const WEB_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = readFileSync(join(WEB_DIR, 'src', 'lib', 'load-error.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { isLoadError, canAutoReload, recordAutoReload } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

for (const e of [
  { name: 'ChunkLoadError', message: 'x' },
  new Error('Loading chunk 123 failed.'),
  new Error('Loading CSS chunk 9 failed'),
  new TypeError('Failed to fetch dynamically imported module: https://x/a.js'),
  new Error('Importing a module script failed.'),
  new Error('error loading dynamically imported module'),
  new Error('NetworkError when attempting to fetch resource.'),
  new TypeError('Failed to fetch'),
  new TypeError('Load failed'),
]) {
  assert.equal(isLoadError(e), true, `should detect ${e.message}`);
}
for (const e of [
  new Error('Cannot read properties of undefined'),
  new TypeError('x is not a function'),
  null,
  undefined,
  'Failed to fetch',
  {},
]) {
  assert.equal(isLoadError(e), false, `should not detect ${String(e?.message ?? e)}`);
}

const mem = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};
const s = mem();
assert.equal(canAutoReload(s, 1000), true);
recordAutoReload(s, 1000);
assert.equal(canAutoReload(s, 2000), true);
recordAutoReload(s, 2000);
assert.equal(canAutoReload(s, 3000), false, 'max 2 per window');
assert.equal(canAutoReload(s, 61_001), true, 'first stamp expired');
assert.equal(canAutoReload(null, 0), false, 'no storage means no auto reload');
const broken = { getItem: () => '{bad', setItem: () => {} };
assert.equal(canAutoReload(broken, 0), true, 'corrupt data is ignored');

console.log('load-error: all cases pass');
