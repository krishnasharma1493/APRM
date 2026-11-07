// test_runmodel.mjs: tests for web/js/runmodel.js (K-51).
// Run: node tests/web/test_runmodel.mjs
// The model replays the log entries of one engine moment on the previous engine state. The key
// check: after the last entry of every moment the replayed view equals the engine's own state JSON,
// for all six presets under all six schedulers, before the page replaces it with that JSON.
// The real-engine part needs web/vendor/aprm.js (make wasm) and is skipped with a note otherwise.
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
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function load(createAprm) {
  const win = { console };
  win.window = win;
  if (createAprm) win.createAprm = createAprm;
  const ctx = vm.createContext(win);
  for (const s of ['js/runmodel.js', 'js/presets_data.js'].concat(createAprm ? ['js/wasm.js'] : [])) vm.runInContext(read(s), ctx, { filename: s });
  return ctx.APRM;
}
const plain = (x) => JSON.parse(JSON.stringify(x));

const M = load().runmodel;
const JOBS = { 1: { id: 1, arrival: 0, duration: 5, cpu: 2, mem: 100, priority: 3 }, 2: { id: 2, arrival: 0, duration: 3, cpu: 4, mem: 200, priority: 7 },
  3: { id: 3, arrival: 1, duration: 4, cpu: 8, mem: 300, priority: 1 } };
const EMPTY = { now: 0, done: 0, total: 3, cap: { cpu: 8, mem: 1000 }, free: { cpu: 8, mem: 1000 }, waiting: [], running: [], reservation: null };
const ctx = (end, policy = 'fcfs') => ({ jobs: JOBS, policy, alphaMilli: 100, end });

test('score: the PRD formula from integers, null for a policy without one, three-decimal text', () => {
  assert.equal(M.score('aging', 100, 2, 0, 42), 6.2);
  assert.equal(M.score('aging_reserve', 1000, 3, 4, 7), 6);
  assert.equal(M.score('fcfs', 100, 2, 0, 42), null);
  assert.equal(M.scoreText(6.2), '6.200');
  assert.equal(M.scoreText(14), '14.000');
  assert.equal(M.scoreText(0.005), '0.005');
  assert.equal(M.scoreText(null), '');
});

test('apply ARRIVE then START: the job moves from waiting to running and the free room follows', () => {
  const v = M.fromState(EMPTY);
  M.apply(v, { seq: 1, t: 0, kind: 'ARRIVE', job: 1 }, ctx(null));
  M.apply(v, { seq: 2, t: 0, kind: 'ARRIVE', job: 2 }, ctx(null));
  assert.deepEqual(v.waiting.map((w) => w.id), [1, 2]);
  M.apply(v, { seq: 3, t: 0, kind: 'START', job: 2 }, ctx(null));
  assert.deepEqual(v.waiting.map((w) => w.id), [1]);
  assert.deepEqual(plain(v.running), [{ id: 2, start: 0, finish: 3, cpu: 4, mem: 200 }]);
  assert.deepEqual(plain(v.free), { cpu: 4, mem: 800 });
});

test('apply SKIP, RESERVE, BACKFILL, BATCH_SELECT, FINISH: marks and the saved spot from the engine state', () => {
  const v = M.fromState(EMPTY);
  M.apply(v, { t: 0, kind: 'ARRIVE', job: 1 }, ctx(null));
  M.apply(v, { t: 0, kind: 'START', job: 1 }, ctx(null));
  M.apply(v, { t: 1, kind: 'ARRIVE', job: 3 }, ctx(null));
  const end = { ...EMPTY, now: 1, waiting: [{ id: 3 }], reservation: { id: 3, shadow_time: 5 } };
  M.apply(v, { t: 1, kind: 'SKIP', job: 3 }, ctx(end));
  assert.equal(v.skipped[3], 1);
  M.apply(v, { t: 1, kind: 'RESERVE', job: 3 }, ctx(end));
  assert.deepEqual(plain(v.reservation), { id: 3, shadow_time: 5 });
  M.apply(v, { t: 1, kind: 'BACKFILL', job: 1 }, ctx(end));
  assert.equal(v.squeezed[1], true);
  M.apply(v, { t: 1, kind: 'BATCH_SELECT', job: 3 }, ctx(end));
  assert.equal(v.chosen[3], 1);
  M.apply(v, { t: 5, kind: 'FINISH', job: 1 }, ctx(null));
  assert.equal(v.done, 1);
  assert.deepEqual(plain(v.free), { cpu: 8, mem: 1000 });
  assert.equal(v.squeezed[1], undefined);
  M.apply(v, { t: 5, kind: 'START', job: 3 }, ctx(null));
  assert.equal(v.reservation, null, 'the saved spot ends when its job starts');
  assert.equal(v.skipped[3], undefined, 'a started job is no longer marked skipped');
});

test('waiting order between entries follows the engine order at the moment end; jobs starting later go first', () => {
  const v = M.fromState(EMPTY);
  for (const id of [1, 2, 3]) M.apply(v, { t: 1, kind: 'ARRIVE', job: id }, ctx(null));
  const end = { ...EMPTY, now: 1, waiting: [{ id: 3 }, { id: 1 }] };     // job 2 starts later in this moment
  M.apply(v, { t: 1, kind: 'SKIP', job: 1 }, ctx(end));
  assert.deepEqual(v.waiting.map((w) => w.id), [2, 3, 1]);
});

test('scores are refreshed when the clock moves, for the aging schedulers only', () => {
  const v = M.fromState(EMPTY);
  M.apply(v, { t: 0, kind: 'ARRIVE', job: 1 }, ctx(null, 'aging'));
  assert.equal(v.waiting[0].score, 3);
  M.apply(v, { t: 10, kind: 'ARRIVE', job: 2 }, ctx(null, 'aging'));
  assert.equal(v.waiting[0].score, 4);
  const f = M.fromState(EMPTY);
  M.apply(f, { t: 0, kind: 'ARRIVE', job: 1 }, ctx(null, 'sjf'));
  assert.equal(f.waiting[0].score, null);
});

test('diff names every field that differs; snap makes the view the engine state but keeps the marks', () => {
  const v = M.fromState(EMPTY);
  M.apply(v, { t: 0, kind: 'ARRIVE', job: 1 }, ctx(null));
  M.apply(v, { t: 0, kind: 'SKIP', job: 1 }, ctx(null));
  const st = { ...EMPTY, done: 1 };
  assert.ok(M.diff(v, st).some((d) => d.startsWith('done')));
  assert.ok(M.diff(v, st).some((d) => d.startsWith('waiting')));
  M.snap(v, st);
  assert.deepEqual(plain(M.diff(v, st)), []);
  assert.equal(v.skipped[1], 0, 'marks survive the snap');
});

test('history: arrival, start, finish, skip ticks once per tick, saved spot, squeezed in; bars use planned finish', () => {
  const h = M.history();
  const v = M.fromState(EMPTY);
  v.reservation = { id: 3, shadow_time: 9 };
  M.record(h, { t: 0, kind: 'ARRIVE', job: 1 }, JOBS, v);
  M.record(h, { t: 2, kind: 'START', job: 1 }, JOBS, v);
  M.record(h, { t: 1, kind: 'ARRIVE', job: 3 }, JOBS, v);
  M.record(h, { t: 1, kind: 'SKIP', job: 3 }, JOBS, v);
  M.record(h, { t: 1, kind: 'SKIP', job: 3 }, JOBS, v);
  M.record(h, { t: 2, kind: 'SKIP', job: 3 }, JOBS, v);
  M.record(h, { t: 2, kind: 'RESERVE', job: 3 }, JOBS, v);
  M.record(h, { t: 2, kind: 'BACKFILL', job: 1 }, JOBS, v);
  assert.deepEqual(plain(h.jobs[3].skips), [1, 2]);
  assert.equal(h.jobs[3].resBy, 9);
  assert.equal(h.jobs[1].squeezed, true);
  assert.deepEqual(plain(M.bars(h)), { 1: { start: 2, finish: 7 } });
  M.record(h, { t: 6, kind: 'FINISH', job: 1 }, JOBS, v);
  assert.deepEqual(plain(M.bars(h)), { 1: { start: 2, finish: 6 } });
});

// ---------- the real engine ----------
const vendor = join(web, 'vendor', 'aprm.js');
if (existsSync(vendor)) {
  const POLICIES = ['fcfs', 'priority', 'sjf', 'aging', 'aging_reserve', 'knapsack'];
  test('real engine: for 6 presets x 6 schedulers, the replayed view equals the engine state at every moment end', async () => {
    const A = load(require(vendor));
    const W = await A.wasm.init();
    let moments = 0, entries = 0, silent = 0;
    for (const pr of A.presetsData) {
      for (const policy of POLICIES) {
        const h = W.create(pr.cpu_cap, pr.mem_cap, policy, pr.alpha_milli, pr.threshold, 0.1);
        const jobs = {};
        for (const j of pr.jobs) { W.addJob(h, j.id, j.arrival, j.duration, j.cpu, j.mem, j.priority); jobs[j.id] = j; }
        const v = A.runmodel.fromState(W.state(h));
        const hist = A.runmodel.history();
        let seq = 0;
        while (W.step(h) === 1) {
          const fresh = W.log(h, seq);
          const end = W.state(h);
          if (fresh.length === 0) { silent++; assert.equal(policy, 'knapsack', 'only a knapsack window boundary may write nothing'); }
          for (const e of fresh) {
            A.runmodel.apply(v, e, { jobs, policy, alphaMilli: pr.alpha_milli, end });
            A.runmodel.record(hist, e, jobs, v);
            const used = v.running.reduce((s, r) => s + r.cpu, 0);
            assert.equal(v.free.cpu, pr.cpu_cap - used, 'free cores always equal capacity minus running jobs');
            entries++;
            seq = e.seq;
          }
          if (fresh.length) assert.deepEqual(plain(A.runmodel.diff(v, end)), [], pr.name + ' ' + policy + ' at tick ' + end.now);
          A.runmodel.snap(v, end);
          moments++;
        }
        const res = W.results(h);
        const rows = Array.isArray(res) ? res : res.jobs || res.results || [];
        const bars = A.runmodel.bars(hist);
        for (const r of rows) assert.deepEqual(plain(bars[r.id]), { start: r.start, finish: r.finish }, 'history start and finish equal the results JSON');
        W.destroy(h);
      }
    }
    assert.ok(moments > 300 && entries > 1000, moments + ' moments, ' + entries + ' entries');
    assert.ok(silent > 0, 'the knapsack window boundaries with nothing to choose are covered');
  });
} else {
  console.log('note: web/vendor/aprm.js not built, real-engine checks skipped (run make wasm)');
}

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n     ') : e)); }
}
console.log(`${tests.length - failed}/${tests.length} runmodel tests passed`);
if (failed) process.exit(1);
