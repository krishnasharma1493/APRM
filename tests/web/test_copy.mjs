// test_copy.mjs: every copy key used by the page exists, and none is unused (K-43).
// Run: node tests/web/test_copy.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(web, 'js', 'copy.js'), 'utf8'), sandbox);
const copy = sandbox.window.APRM.copy;
const keys = [...copy.keys()];

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('get returns text and throws on an unknown key', () => {
  assert.equal(copy.get('step.build'), '1 Build');
  assert.throws(() => copy.get('no.such.key'), /Unknown copy key/);
});

test('sentence case, no jargon-only labels, no emoji or HTML in any string', () => {
  for (const k of keys) {
    const s = copy.get(k);
    assert.ok(s.length > 0, k + ' is empty');
    assert.ok(!/[<>&]/.test(s), k + ' contains markup characters');
    assert.ok(!/\p{Extended_Pictographic}/u.test(s), k + ' contains an emoji');
  }
});

test('every data-copy key and APRM.copy.get key in the page exists', () => {
  const sources = [readFileSync(join(web, 'index.html'), 'utf8')];
  for (const f of readdirSync(join(web, 'js'))) if (f.endsWith('.js') && f !== 'copy.js') sources.push(readFileSync(join(web, 'js', f), 'utf8'));
  const used = new Set();
  for (const src of sources) {
    for (const m of src.matchAll(/data-copy(?:-label)?="([^"]+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/copy\.get\('([^']+)'\)/g)) used.add(m[1]);
  }
  for (const k of used) assert.ok(keys.includes(k), 'missing copy key: ' + k);
});

test('every defined key is used somewhere (no dead copy)', () => {
  const sources = [readFileSync(join(web, 'index.html'), 'utf8')];
  for (const f of readdirSync(join(web, 'js'))) if (f.endsWith('.js') && f !== 'copy.js') sources.push(readFileSync(join(web, 'js', f), 'utf8'));
  const all = sources.join('\n');
  const presets = readFileSync(join(web, 'js', 'presets_data.js'), 'utf8');
  const dynamic = (k) => {                       // preset.<name>.title|hint is built as 'preset.' + name + '.title'
    const m = k.match(/^preset\.([a-z_]+)\.(title|hint)$/);
    if (m) return all.includes("'preset.'") && presets.includes('"name": "' + m[1] + '"');
    // keys built as 'prefix.' + name: the prefix literal must appear in the page code
    const prefix = k.match(/^(policy|metric|kind|status|short)\./);
    return !!prefix && all.includes("'" + prefix[1] + ".'");
  };
  for (const k of keys) assert.ok(all.includes('"' + k + '"') || all.includes("'" + k + "'") || dynamic(k), 'unused copy key: ' + k);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.error('FAIL ' + name + '\n  ' + e.message); }
}
if (failed) process.exit(1);
