// Checks the occurrence text helpers in src/lib/meetings/meeting-form.ts. The
// module imports workspace packages, so only the two pure helpers are cut out,
// transpiled and imported (like check-load-error.mjs does for a whole file).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const WEB_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));
// Normalise Windows line endings so the markers match on every checkout.
const source = readFileSync(
  join(WEB_DIR, 'src', 'lib', 'meetings', 'meeting-form.ts'),
  'utf8',
).replace(/\r\n/g, '\n');
function slice(startMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, 'missing ' + startMarker);
  const end = source.indexOf(String.fromCharCode(10) + '}' + String.fromCharCode(10), start);
  return source.slice(start, end + 3);
}
const code = [
  'export interface OccurrenceText { title: string; description: string; location: string; meetingUrl: string }',
  slice('export function occurrenceText('),
  slice('export function changedText('),
].join(String.fromCharCode(10));
const { outputText } = ts.transpileModule(code, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { occurrenceText, changedText } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

const t1 = new Date('2026-01-05T10:00:00Z');
const t2 = new Date('2026-01-12T10:00:00Z');
const meeting = {
  title: 'Standup',
  description: 'Series notes',
  location: null,
  meetingUrl: 'https://meet.example.com/a',
  overrides: [
    { originalStart: t1, title: 'Special', description: '', location: 'Room 4', meetingUrl: null },
  ],
};

// A changed occurrence: override value wins, null falls back to the series, "" is empty.
assert.deepEqual(occurrenceText(meeting, t1), {
  title: 'Special',
  description: '',
  location: 'Room 4',
  meetingUrl: 'https://meet.example.com/a',
});
// An unchanged occurrence and a one-off meeting show the series values.
assert.deepEqual(occurrenceText(meeting, t2), {
  title: 'Standup',
  description: 'Series notes',
  location: '',
  meetingUrl: 'https://meet.example.com/a',
});
assert.equal(occurrenceText(meeting, null).title, 'Standup');

// Saving one occurrence sends only what the person changed.
const was = occurrenceText(meeting, t2);
const same = {
  title: 'Standup',
  description: 'Series notes',
  location: null,
  meetingUrl: 'https://meet.example.com/a',
};
assert.deepEqual(changedText(same, was), {});
assert.deepEqual(changedText({ ...same, title: 'Standup moved' }, was), { title: 'Standup moved' });
assert.deepEqual(changedText({ ...same, location: 'Room 1' }, was), { location: 'Room 1' });
assert.deepEqual(changedText({ ...same, description: null }, was), { description: null });
console.log('meeting form checks passed');
