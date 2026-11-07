// test_strip.mjs: tests for the heat-strip timeline, web/js/strip.js (K-53).
// Run: node tests/web/test_strip.mjs
// Grouping (cells of 1, 2, 5, 10 ... ticks, never under 6 px), what a cell shows (waiting, saved,
// running, finished, skipped), row order, the rows and columns drawn (virtualisation for 5,000
// jobs), hit testing and the use bands. With the real engine: for every preset and scheduler the
// strip's running cells are exactly the engine's start-to-finish ticks.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(resolve(here, '..', '..'), 'web');
const require = createRequire(import.meta.url);
const read = (rel) => readFileSync(join(web, rel), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function load(createAprm) {
  const win = { console };
  win.window = win;
  if (createAprm) win.createAprm = createAprm;
  const ctx = vm.createContext(win);
  for (const s of ['js/runmodel.js', 'js/strip.js', 'js/presets_data.js'].concat(createAprm ? ['js/wasm.js'] : [])) vm.runInContext(read(s), ctx, { filename: s });
  return ctx.APRM;
}
const A = load();
const S = A.strip, ST = A.strip.STATES;
const rec = (o) => ({ id: 1, arrival: 0, duration: 5, cpu: 1, mem: 1, priority: 3, arrived: null, start: null, finish: null, skips: [], resAt: null, resBy: null, ...o });

test('grouping: one tick per cell when there is room, then 2, 5, 10 ... ticks so a cell is at least 6 px', () => {
  const g1 = S.geometry(8, 40, 1200, 1, false);
  assert.equal(g1.g, 1);
  assert.equal(g1.rowH, 16); assert.equal(g1.labelW, 64);
  assert.ok(g1.cellW <= 28);
  const g2 = S.geometry(500, 2000, 1200, 1, false);
  assert.equal(g2.rowH, 4); assert.equal(g2.labelW, 0);
  assert.ok(g2.g > 1 && g2.cellW >= 6, JSON.stringify(plain(g2)));
  assert.equal(g2.cols, Math.ceil(2000 / g2.g));
  const z = S.geometry(500, 2000, 1200, 8, false);
  assert.ok(z.g < g2.g, 'zooming in groups fewer ticks');
  assert.equal(S.geometry(100, 30, 1200, 1, false).rowH, 6);
  assert.equal(S.geometry(5000, 30, 1200, 1, false).vh, 380, 'the view is at most 380 px tall; it scrolls');
  assert.equal(S.geometry(8, 30, 1200, 1, true).bottomH, 52, 'details add the use bands');
});

test('zoom stops where cells reach 28 px per tick; fit is 1', () => {
  const g = S.geometry(12, 60, 1158, 1, false);
  assert.ok(g.maxZoom > 1 && g.maxZoom < 2, 'about 1.5 for 60 ticks in 1158 px: ' + g.maxZoom);
  assert.equal(S.geometry(12, 60, 1158, g.maxZoom, false).cellW, 28);
  assert.ok(S.geometry(500, 2000, 1200, 1, false).maxZoom > 40, 'a long run can zoom a long way');
  assert.equal(S.geometry(12, 5, 1158, 1, false).maxZoom, 1, 'already at 28 px: no zoom in');
  assert.equal(S.geometry(12, 60, 1158, 1, false).cw % 1, 0, 'the scroll size is whole pixels');
});

test('cell state: waiting, saved, running, finished and nothing, as known at the clock', () => {
  const r = rec({ arrived: 2, start: 6, finish: 11, resAt: 4, resBy: 6, skips: [2, 3, 5] });
  assert.equal(S.cellState(r, 0, 1, 20), ST.NONE);
  assert.equal(S.cellState(r, 2, 2, 20), ST.WAIT);
  assert.equal(S.cellState(r, 4, 5, 20), ST.SAVED);
  assert.equal(S.cellState(r, 6, 6, 20), ST.RUN);
  assert.equal(S.cellState(r, 11, 11, 20), ST.DONE);
  assert.equal(S.cellState(r, 0, 9, 20), ST.RUN, 'the state covering most of a group wins (4 running ticks over 2 waiting and 2 saved)');
  assert.equal(S.cellState(r, 0, 5, 20), ST.SAVED, 'on a tie, saved beats waiting');
  assert.equal(S.cellState(r, 21, 22, 20), ST.NONE, 'nothing after the clock');
  const running = rec({ arrived: 0, start: 0 });
  assert.equal(S.cellState(running, 3, 3, 3), ST.RUN, 'running until the engine says it finished');
  assert.equal(S.skippedIn(r, 3, 4), 3);
  assert.equal(S.skippedIn(r, 4, 4), -1);
  assert.equal(S.skippedIn(r, 0, 1), -1);
});

test('row order: job number, arrival, priority (highest first), longest wait so far', () => {
  const h = { order: [1, 2, 3], jobs: { 1: rec({ id: 1, arrival: 5, priority: 2, arrived: 5, start: 6 }), 2: rec({ id: 2, arrival: 0, priority: 9, arrived: 0, start: 1 }), 3: rec({ id: 3, arrival: 1, priority: 2, arrived: 1 }) } };
  const ids = (by) => plain(S.sortRows(h, by, 10).map((r) => r.id));
  assert.deepEqual(ids('id'), [1, 2, 3]);
  assert.deepEqual(ids('arr'), [2, 3, 1]);
  assert.deepEqual(ids('pri'), [2, 1, 3]);
  assert.deepEqual(ids('wait'), [3, 1, 2]);
});

test('virtualisation: only the rows and columns in view are drawn, whatever the job count', () => {
  const g = S.geometry(5000, 3000, 1000, 1, false);
  const v = S.visible(g, 5000, 0, 8000, 1000, 380);
  assert.equal(v.r0, 2000);
  assert.ok(v.r1 - v.r0 <= Math.ceil((380 - g.bottomH) / g.rowH) + 1, 'about 89 rows, not 5000');
  assert.ok(v.c1 - v.c0 <= g.cols);
});

test('hit testing: the row and the ticks under the pointer; outside the rows is nothing', () => {
  const g = S.geometry(3, 20, 800, 1, false);
  const rows = [rec({ id: 4 }), rec({ id: 9 }), rec({ id: 2 })];
  const h = S.hit(g, rows, g.labelW + g.cellW * 3 + 1, g.rowH + 2, 0, 0, 200);
  assert.equal(h.rec.id, 9);
  assert.equal(h.t0, 3);
  assert.equal(S.hit(g, rows, 10, 2, 0, 0, 200), null, 'the label column');
  assert.equal(S.hit(g, rows, g.labelW + 5, 3 * g.rowH + 1, 0, 0, 200), null, 'below the last row');
});

test('rows: every job of the run has a row from the start, named in the log or not', () => {
  const h = { order: [2], jobs: { 2: rec({ id: 2, arrived: 0 }) } };
  const rows = S.rowsFor([{ id: 1, arrival: 5, duration: 1, cpu: 1, mem: 1, priority: 0 }, { id: 2, arrival: 0, duration: 5, cpu: 1, mem: 1, priority: 3 }], h);
  assert.deepEqual(plain(rows.map((r) => [r.id, r.arrived])), [[1, null], [2, 0]]);
  assert.equal(S.cellState(rows[0], 0, 9, 9), ST.NONE);
  assert.deepEqual(plain(S.sortRows(null, 'arr', 0, rows).map((r) => r.id)), [2, 1]);
});

test('use bands: cores and memory in use per tick from the history', () => {
  const h = { order: [1, 2], jobs: { 1: rec({ id: 1, cpu: 2, mem: 10, start: 0, finish: 3 }), 2: rec({ id: 2, cpu: 1, mem: 5, start: 2 }) } };
  const u = S.usage(h, 4);
  assert.deepEqual(plain(u.c.slice(0, 5)), [2, 2, 3, 1, 1]);
  assert.deepEqual(plain(u.m.slice(0, 5)), [10, 10, 15, 5, 5]);
});

test('span: up to the latest arrival, planned finish or the clock, plus one', () => {
  const h = { order: [1], jobs: { 1: rec({ id: 1, start: 4, duration: 10 }) } };
  assert.equal(S.span(h, [{ arrival: 30 }], 5), 31);
  assert.equal(S.span(h, [{ arrival: 0 }], 5), 15);
});

const vendor = join(web, 'vendor', 'aprm.js');
if (existsSync(vendor)) {
  test('real engine: running cells are exactly start to finish - 1 and finished cells start at finish, 6 presets x 6 schedulers', async () => {
    const E = load(require(vendor));
    const W = await E.wasm.init();
    let n = 0;
    for (const pr of E.presetsData) {
      for (const policy of ['fcfs', 'priority', 'sjf', 'aging', 'aging_reserve', 'knapsack']) {
        const h = W.create(pr.cpu_cap, pr.mem_cap, policy, pr.alpha_milli, pr.threshold, 0.1);
        const jobs = {};
        for (const j of pr.jobs) { W.addJob(h, j.id, j.arrival, j.duration, j.cpu, j.mem, j.priority); jobs[j.id] = j; }
        const v = E.runmodel.fromState(W.state(h));
        const hist = E.runmodel.history();
        let seq = 0;
        while (W.step(h) === 1) {
          const end = W.state(h);
          for (const e of W.log(h, seq)) { E.runmodel.apply(v, e, { jobs, policy, alphaMilli: pr.alpha_milli, end }); E.runmodel.record(hist, e, jobs, v); seq = e.seq; }
        }
        const now = W.state(h).now;
        for (const r of W.results(h)) {
          const row = hist.jobs[r.id];
          for (let t = 0; t <= now; t++) {
            const s = E.strip.cellState(row, t, t, now);
            const want = t < r.arrival ? E.strip.STATES.NONE : t < r.start ? null : t < r.finish ? E.strip.STATES.RUN : E.strip.STATES.DONE;
            if (want === null) assert.ok(s === E.strip.STATES.WAIT || s === E.strip.STATES.SAVED, pr.name + ' ' + policy + ' job ' + r.id + ' tick ' + t);
            else assert.equal(s, want, pr.name + ' ' + policy + ' job ' + r.id + ' tick ' + t);
            n++;
          }
        }
        W.destroy(h);
      }
    }
    assert.ok(n > 5000, n + ' cells checked');
  });
}

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n     ') : e)); }
}
console.log(`${tests.length - failed}/${tests.length} strip tests passed`);
if (failed) process.exit(1);
