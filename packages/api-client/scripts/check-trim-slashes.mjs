// Checks src/trim-slashes.ts: same results as the regexes it replaced, and
// linear time on a long adversarial string.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = readFileSync(join(DIR, 'src', 'trim-slashes.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { trimTrailingSlashes, trimOneTrailingSlash } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

const samples = [
  '',
  '/',
  '//',
  '///',
  'a',
  'a/',
  'a//',
  '/a',
  '/a/b/',
  'http://x.test///',
  '/api/v1',
  '/api/v1/',
  '//a//',
];
for (const s of samples) {
  assert.equal(trimTrailingSlashes(s), s.replace(/\/+$/, ''), `all: ${JSON.stringify(s)}`);
  assert.equal(trimOneTrailingSlash(s), s.replace(/\/?$/, ''), `one: ${JSON.stringify(s)}`);
}

const adversarial = 'a/'.repeat(100000) + 'b';
const t0 = Date.now();
assert.equal(trimTrailingSlashes(adversarial), adversarial);
assert.equal(trimOneTrailingSlash(adversarial), adversarial);
assert.equal(trimTrailingSlashes('/'.repeat(500000)), '');
assert.ok(Date.now() - t0 < 500, 'trimming is linear');

console.log('trim-slashes: all cases pass');
