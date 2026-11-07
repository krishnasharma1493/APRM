// test_build_copy.mjs: the Build page structure (K-44). Run: node tests/web/test_build_copy.mjs
// Static checks on index.html: the disclosure holds the extra inputs, the machine values stay visible
// outside it, the toast region is always in the page, and the plain labels carry the technical names.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
const html = readFileSync(join(web, 'index.html'), 'utf8');
const build = html.slice(html.indexOf('id="build-panel"'), html.indexOf('id="run-panel"'));
const more = build.slice(build.indexOf('<details'), build.indexOf('</details>'));
const outside = build.replace(more, '');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('disclosure: random jobs, CSV and share are inside one <details>, closed by default, one click to open', () => {
  assert.match(more, /<details class="disclosure" id="more-ways">/);
  assert.ok(!/\bopen\b/.test(more.slice(0, more.indexOf('>') + 1)), 'closed by default');
  for (const id of ['gen-seed', 'gen-run', 'csv-file', 'csv-export', 'share-copy']) assert.ok(more.includes('id="' + id + '"'), id + ' inside the disclosure');
  assert.match(more, /<summary><span data-copy="build\.more">/);
});

test('the machine has its own section, before the examples: stepper, slider, quick memory choices', () => {
  for (const id of ['cpu-input', 'mem-input', 'cpu-dec', 'cpu-inc', 'cpu-slider', 'mem-quick', 'cpu-error', 'mem-error']) {
    assert.ok(outside.includes('id="' + id + '"'), id + ' outside the disclosure');
  }
  assert.ok(build.indexOf('id="cpu-input"') < build.indexOf('id="preset-tiles"'), 'machine first');
  assert.match(build, /id="cpu-slider" role="slider" tabindex="0"[^>]*aria-valuemin="1" aria-valuemax="128"/);
});

test('the laptop drawing is decorative; its labels and the Next line are real text', () => {
  assert.match(build, /<div id="laptop-stage" aria-hidden="true"><\/div>/);
  assert.match(build, /<div id="hero-labels" class="lt-labels"><\/div>/);
  assert.match(build, /<span id="build-next-note" class="next-note" role="status"><\/span><button type="button" class="btn btn-primary" data-next="run"/);
  assert.equal((build.match(/btn-primary/g) || []).length, 1, 'one primary button on Build');
});

test('machine values stay visible: the summary line is outside the disclosure', () => {
  assert.ok(outside.includes('id="machine-summary"'));
  assert.ok(!more.includes('id="machine-summary"'));
});

test('the example tiles come first, before the job table', () => {
  assert.ok(build.indexOf('id="preset-tiles"') < build.indexOf('id="job-body"'));
  assert.ok(build.indexOf('id="preset-tiles"') < build.indexOf('id="more-ways"'));
});

test('column labels give the plain word with the technical name in brackets', () => {
  const copy = readFileSync(join(web, 'js', 'copy.js'), 'utf8');
  for (const [k, re] of [['col.id', /\(id\)/], ['col.arrival', /\(arrival\)/], ['col.duration', /\(duration\)/], ['col.cpu', /\(CPU\)/], ['col.priority', /higher runs first/]]) {
    assert.match(copy.slice(copy.indexOf("'" + k + "'")).split('\n')[0], re, k);
  }
});

test('the toast region is always in the page (not hidden) so screen readers announce changes', () => {
  assert.match(html, /<div id="toast" class="toast" role="status" aria-live="polite"><\/div>/);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.error('FAIL ' + name + '\n  ' + e.message); }
}
if (failed) process.exit(1);
