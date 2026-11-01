// test_keys.mjs: keyboard shortcuts (K-43). Run: node tests/web/test_keys.mjs
// Space plays or pauses, Right arrow steps; both ignored in fields, buttons and with modifiers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
const calls = [];
let mode = 'run';
let status = 'paused';
const listeners = {};
const sandbox = {
  window: {},
  document: { addEventListener: (type, fn) => { listeners[type] = fn; } }
};
vm.createContext(sandbox);
sandbox.window.APRM = {
  store: { get: () => ({ mode }) },
  player: {
    snapshot: () => ({ status }),
    play: () => { calls.push('play'); return true; },
    pause: () => { calls.push('pause'); return true; },
    stepOnce: () => { calls.push('step'); return true; }
  }
};
vm.runInContext(readFileSync(join(web, 'js', 'keys.js'), 'utf8'), sandbox);
const keys = sandbox.window.APRM.keys;

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const ev = (o) => ({ key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
  target: { tagName: 'BODY' }, preventDefault() { this.prevented = true; }, ...o });

test('actionFor: Space toggles, ArrowRight steps, others ignored', () => {
  assert.equal(keys.actionFor(ev({ key: ' ' })), 'toggle');
  assert.equal(keys.actionFor(ev({ key: 'ArrowRight' })), 'step');
  assert.equal(keys.actionFor(ev({ key: 'a' })), null);
});

test('ignored inside input, textarea, select, button, summary, link and editable text', () => {
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'SUMMARY', 'A']) {
    assert.equal(keys.actionFor(ev({ key: ' ', target: { tagName: tag } })), null, tag);
  }
  assert.equal(keys.actionFor(ev({ key: ' ', target: { tagName: 'DIV', isContentEditable: true } })), null);
});

test('ignored with a modifier key', () => {
  for (const m of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) assert.equal(keys.actionFor(ev({ key: ' ', [m]: true })), null, m);
});

test('mount attaches one keydown listener and is safe twice', () => {
  keys.mount(); const first = listeners.keydown; keys.mount();
  assert.equal(typeof first, 'function'); assert.equal(listeners.keydown, first);
});

test('Space plays when paused and pauses when playing, only on the Run step', () => {
  calls.length = 0; mode = 'run'; status = 'paused';
  const e1 = ev({ key: ' ' }); listeners.keydown(e1);
  status = 'playing'; listeners.keydown(ev({ key: ' ' }));
  assert.deepEqual(calls, ['play', 'pause']); assert.equal(e1.prevented, true);
  calls.length = 0; mode = 'build'; listeners.keydown(ev({ key: ' ' }));
  assert.deepEqual(calls, [], 'no action outside Run');
});

test('Right arrow steps one event on the Run step', () => {
  calls.length = 0; mode = 'run'; status = 'paused'; listeners.keydown(ev({ key: 'ArrowRight' }));
  assert.deepEqual(calls, ['step']);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.error('FAIL ' + name + '\n  ' + e.message); }
}
if (failed) process.exit(1);
