// test_motion.mjs: the spring helper (K-43). Run: node tests/web/test_motion.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
function load(reducedMotion) {
  const sandbox = { window: { matchMedia: () => ({ matches: reducedMotion }) } };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(web, 'js', 'motion.js'), 'utf8'), sandbox);
  return sandbox.window.APRM.motion;
}
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('springStep with damping 1.0 settles on the target without overshoot', () => {
  const m = load(false);
  let x = 0, v = 0, max = 0;
  for (let i = 0; i < 600; i++) { const s = m.springStep(x, v, 1, 0.3, 1.0, 1 / 60); x = s.x; v = s.v; max = Math.max(max, x); }
  assert.ok(Math.abs(x - 1) < 0.001, 'settled: ' + x);
  assert.ok(max <= 1.0005, 'no overshoot: ' + max);
});

test('reduced motion: spring applies the end state at once, element ends clean', () => {
  const m = load(true);
  const el = { style: {} };
  m.spring(el, { y: 24, opacity: 0 }, {});
  assert.equal(el.style.transform, '');
  assert.equal(el.style.opacity, '');
});

test('reduced() follows the media query and survives a missing matchMedia', () => {
  assert.equal(load(true).reduced(), true);
  assert.equal(load(false).reduced(), false);
  const sandbox = { window: {} }; vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(web, 'js', 'motion.js'), 'utf8'), sandbox);
  assert.equal(sandbox.window.APRM.motion.reduced(), false);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.error('FAIL ' + name + '\n  ' + e.message); }
}
if (failed) process.exit(1);
