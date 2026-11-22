// Checks stripTags/htmlHasText (src/lib/portal/html-text.ts) against nested and
// overlapping tag payloads: the output must never contain '<', so no tag,
// script or handler can be reassembled from what is left.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const WEB_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = readFileSync(join(WEB_DIR, 'src', 'lib', 'portal', 'html-text.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { stripTags, htmlHasText } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

const payloads = [
  '<scr<script>ipt>alert(1)</scr</script>ipt>',
  '<scr<script>ipt>',
  '<img src=x onerror=alert(1)>',
  '<<img src=x onerror=alert(1)>>',
  '<a href="javascript:alert(1)">x</a>',
  '<svg/onload=alert(1)>',
  '<script>alert(1)',
  '<img src=x onerror=alert(1)',
  '<<<<>>>>',
];
for (const p of payloads) {
  const out = stripTags(p);
  assert.ok(!out.includes('<'), `no '<' survives: ${JSON.stringify(p)} -> ${JSON.stringify(out)}`);
}
assert.equal(stripTags('<img src=x onerror=alert(1)>'), '');
assert.equal(stripTags('<p>Hello <b>world</b></p>'), 'Hello world');
assert.equal(htmlHasText('<p></p>'), false);
assert.equal(htmlHasText('<p> \n</p>'), false);
assert.equal(htmlHasText('<img src=x onerror=alert(1)>'), false);
assert.equal(htmlHasText('<p>hi</p>'), true);

// Linear time on an adversarial input.
const big = '<'.repeat(200000) + 'a'.repeat(200000);
const t0 = Date.now();
stripTags(big);
assert.ok(Date.now() - t0 < 1000, 'stripTags is linear');

console.log('portal html-text: all cases pass');
