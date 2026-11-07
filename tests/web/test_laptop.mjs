// test_laptop.mjs: the Build page machine controls and the exploded laptop (warm palette redesign).
// Run: node tests/web/test_laptop.mjs
// Pure rules (chips, cells, slider stops, the Next line) run in a node:vm context with the real
// scripts; static checks read the files. The browser-only drawing is checked by
// tests/demo/check_layout_cdp.mjs in headless Chrome. Only node:assert and the standard library.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '..', '..', 'web');
const read = (rel) => readFileSync(join(web, rel), 'utf8');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/* The real scripts in a context with no DOM: mount() is never called, so only the pure parts run. */
function load() {
  const win = { console, document: { getElementById: () => null } };
  win.window = win;
  const ctx = vm.createContext(win);
  for (const f of ['js/copy.js', 'js/store.js', 'js/editor.js', 'js/machine.js', 'js/laptop.js']) vm.runInContext(read(f), ctx, { filename: f });
  return ctx.APRM;
}
const A = load();
const M = A.machine, L = A.laptop;

test('memory sizes in words', () => {
  assert.equal(M.sizeText(32768), '32 GB');
  assert.equal(M.sizeText(40960), '40 GB');
  assert.equal(M.sizeText(1536), '1.5 GB');
  assert.equal(M.sizeText(1048576), '1 TB');
  assert.equal(M.sizeText(1), '0 GB');
});

test('slider: log scale from 1 to 128, snapping to the common sizes', () => {
  assert.equal(M.sliderFraction(1), 0);
  assert.equal(M.sliderFraction(128), 1);
  assert.equal(M.sliderFraction(16), 4 / 7);
  assert.equal(M.sliderFraction(5000), 1, 'clamped above');
  assert.equal(M.snapFromFraction(0), 1);
  assert.equal(M.snapFromFraction(1), 128);
  assert.equal(M.snapFromFraction(4 / 7), 16);
  assert.equal(M.snapFromFraction(-3), 1, 'clamped below');
  for (const v of M.SNAP) assert.equal(M.snapFromFraction(M.sliderFraction(v)), v, 'every stop maps to itself: ' + v);
});

test('slider keys step to the next stop and stop at the ends', () => {
  assert.equal(M.stepStop(16, 1), 24);
  assert.equal(M.stepStop(16, -1), 12);
  assert.equal(M.stepStop(5, 1), 6, 'a value between stops goes to the next one up');
  assert.equal(M.stepStop(5, -1), 4);
  assert.equal(M.stepStop(128, 1), 128);
  assert.equal(M.stepStop(1, -1), 1);
  assert.equal(M.stepStop(500, -1), 128, 'above the slider range: Left comes back to 128');
  assert.equal(M.stepStop(200, 1), 200, 'above the slider range: Right never lowers the value');
});

test('chips: 4096 MB each, the last filled to the remainder, 16 slots at most', () => {
  const p = (x) => JSON.parse(JSON.stringify(x));
  assert.deepEqual(p(L.memChips(32768)), { full: 8, frac: 0, over: false });
  assert.deepEqual(p(L.memChips(40960)), { full: 10, frac: 0, over: false });
  assert.deepEqual(p(L.memChips(6144)), { full: 1, frac: 0.5, over: false });
  assert.deepEqual(p(L.memChips(65536)), { full: 16, frac: 0, over: false });
  assert.deepEqual(p(L.memChips(65537)), { full: 16, frac: 0, over: true });
  assert.equal(L.memTag(1048576), '+ 960 GB more');
  assert.equal(L.memTag(65536), '');
  assert.equal(M.chipWords(6144), '1 full chip + 1 chip 50% filled');
  assert.equal(M.chipWords(1048576), '16 chips shown, 983040 MB more not drawn');
});

test('cells: one per core, 64 at most, with the rest said in words', () => {
  assert.equal(L.coreCells(16), 16);
  assert.equal(L.coreCells(64), 64);
  assert.equal(L.coreCells(128), 64);
  assert.equal(L.coreCells(0), 0);
  assert.equal(L.cpuTag(128), 'grid × 2 = 128 cores');
  assert.equal(L.cpuTag(64), '');
});

test('the intro is slow enough to follow, and in order: open, glide, explode, then the settings', () => {
  const T = L.INTRO;
  assert.ok(T.lidMs >= 1000, 'lid opens over at least a second');
  assert.ok(T.glideMs >= 800, 'glide left over at least 0.8 s');
  assert.ok(T.explodeMs >= 800 && T.layerGap >= 80, 'layers separate slowly, one after another');
  assert.ok(T.open < T.slide && T.slide < T.explode && T.explode < T.panel && T.panel < T.done, 'phases in order');
  assert.ok(T.open + T.lidMs <= T.slide, 'the lid is open before the glide starts');
  assert.ok(T.done <= 4000, 'the whole intro stays under 4 seconds (it can be skipped)');
  assert.equal(L.FRONT.rz, 0, 'the intro starts facing the front');
  assert.equal(L.CAMERA.rz, -32, 'and turns to the three-quarter view (direction 1a) as it glides left');
  assert.match(read('js/laptop.js'), /\(ph === 'closed' \|\| ph === 'open'\) \? FRONT : CAMERA/);
  const src = read('js/laptop.js');
  assert.match(src, /\(ORDER\.length - 1 - i\) \* INTRO\.layerGap/, 'explode staggered top-down, so no layer rises through the one above');
});

test('labels state the exact numbers', () => {
  const t = L.labelTexts({ machine: { cpu: 8, mem: 32768 }, jobs: [{ id: 1, cpu: 2, duration: 3 }, { id: 2, cpu: 1, duration: 4 }] });
  assert.equal(t.cpu.title, 'CPU · 8 cores');
  assert.equal(t.cpu.val, '8 cores');
  assert.equal(t.mem.title, 'Memory · 32 GB');
  assert.equal(t.mem.val, '32768 MB');
  assert.equal(t.keys.val, '2 jobs');
  assert.equal(t.keys.sub, '2 jobs · 10 core·ticks of work');
  assert.equal(L.labelTexts({ machine: { cpu: 1, mem: 1 }, jobs: [] }).keys.val, 'No jobs yet');
});

test('Next line: ready in sage, problems in red, empty in muted', () => {
  const st = (jobs, cpu = 8, mem = 32768) => ({ machine: { cpu, mem }, jobs });
  const ok = { id: 1, arrival: 0, duration: 3, cpu: 2, mem: 1024, priority: 5 };
  assert.deepEqual(JSON.parse(JSON.stringify(M.nextNote(st([])))), { text: 'Add at least one job first', state: 'empty' });
  assert.deepEqual(JSON.parse(JSON.stringify(M.nextNote(st([ok, { ...ok, id: 2 }])))), { text: '2 jobs on 8 cores and 32 GB', state: 'ready' });
  const bad = M.nextNote(st([ok, { ...ok, id: 2, mem: 40960 }]));
  assert.equal(bad.state, 'bad');
  assert.equal(bad.text, '1 job needs fixing first');
  assert.equal(M.nextNote(st([{ ...ok, cpu: 9 }, { ...ok, id: 2, cpu: 9, mem: 40960 }])).text, '2 jobs need fixing first', 'counted per job, not per problem');
  assert.equal(M.nextNote(st([ok], 0)).text, 'Fix the machine settings first');
});

test('the font is embedded from the committed file, with its licence, and nothing is downloaded', async () => {
  const { fontsCss } = await import(join(web, 'fonts', 'embed_font.mjs'));
  assert.equal(read('css/fonts.css'), fontsCss(readFileSync(join(web, 'fonts', 'InterTight-latin.woff2'))), 'fonts.css is up to date (run node web/fonts/embed_font.mjs)');
  assert.match(read('fonts/OFL.txt'), /SIL Open Font License, Version 1\.1/);
  const html = read('index.html');
  assert.ok(html.indexOf('href="css/fonts.css"') < html.indexOf('href="css/tokens.css"'), 'font before tokens');
  assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(html + read('css/tokens.css') + read('css/style.css') + read('css/components.css')), 'no font link');
  assert.match(read('css/tokens.css'), /--font: "Inter Tight", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;/);
});

test('no monospace, no bracket tags, and only weights 400, 500, 600, 800 in the stylesheets', () => {
  const css = (read('css/tokens.css') + read('css/components.css') + read('css/style.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/monospace|ui-monospace|Menlo|Consolas|Courier/i.test(css), 'no monospace font');
  for (const m of css.matchAll(/font-weight:\s*(\d+)/g)) assert.ok(['400', '500', '600', '800'].includes(m[1]), 'weight ' + m[1]);
  for (const m of css.matchAll(/--fw-[a-z]+:\s*(\d+)/g)) assert.ok(['400', '500', '600', '800'].includes(m[1]), 'weight token ' + m[1]);
  assert.ok(!/\[ [A-Z]+ \]/.test(read('js/copy.js')), 'no "[ LABEL ]" tags');
});

test('no colour literals in the new scripts; gradients only for the spotlight and patterns', () => {
  for (const f of ['js/machine.js', 'js/laptop.js', 'js/runanim.js', 'js/runstage.js', 'js/strip.js', 'js/runmodel.js']) {
    const t = read(f);
    assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(t), 'colour literal in ' + f);
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|\beval\s*\(|new\s+Function/.test(t), 'unsafe DOM call in ' + f);
  }
  const css = read('css/style.css') + read('css/components.css') + read('css/run.css');
  const smooth = [...css.matchAll(/(?<!repeating-)(radial|linear)-gradient\(/g)];
  assert.equal(smooth.length, 1, 'one smooth gradient: the Build spotlight');
  assert.match(css, /\.lt-spot \{[^}]*radial-gradient\(closest-side, var\(--spot\)/);
  assert.match(css, /@media \(prefers-contrast: more\) \{ \.lt-spot \{ display: none; \} \}/, 'spotlight removed under more contrast');
  assert.ok(!/backdrop-filter|filter:\s*blur/.test(css), 'no glass blur');
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.error('FAIL ' + name + '\n  ' + e.message); }
}
console.log((tests.length - failed) + '/' + tests.length + ' laptop and machine tests passed');
if (failed) process.exit(1);
