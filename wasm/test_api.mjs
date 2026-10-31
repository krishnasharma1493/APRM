// test_api.mjs: tests for wasm/api.c through the built web/vendor/aprm.js (K-13).
// Run: node wasm/test_api.mjs   (after `make wasm`). Exit 0 = all passed.
// Only node:assert and the standard library; no framework.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const require = createRequire(import.meta.url);
const M = await require(join(root, 'web', 'vendor', 'aprm.js'))();

const FCFS = 0, PRIORITY = 1, SJF = 2;
const MAXSAFE = 2 ** 53;
let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const str = (p) => M.UTF8ToString(p);
const json = (p) => JSON.parse(str(p));           // strict: throws on invalid JSON
const mk = (policy = FCFS, cpu = 16, mem = 32768) => M._aprm_create(cpu, mem, policy, 100, 50, 0.1);
const add = (h, id, arrival, duration, cpu, mem, pri) => M._aprm_add_job(h, id, arrival, duration, cpu, mem, pri);
const lastErr = (h) => json(M._aprm_last_error(h));
const expectErr = (h, code, field) => {
  const e = lastErr(h);
  assert.equal(e.ok, false);
  assert.equal(e.error.code, code);
  assert.equal(typeof e.error.message, 'string');
  assert.ok(e.error.message.length > 0);
  if (field !== undefined) assert.equal(e.error.field, field);
};
const runAll = (h) => { let rc; while ((rc = M._aprm_step(h)) > 0); return rc; };
const csvRows = (resultsJson) => resultsJson.data.map((r) => [r.id, r.arrival, r.start, r.finish, r.wait, r.turnaround, r.priority, r.cpu, r.mem].join(','));

test('create, destroy, handle reuse', () => {
  const a = mk(), b = mk(), c = mk();
  assert.deepEqual([a, b, c], [a, a + 1, a + 2]);
  assert.ok(a >= 1);
  assert.equal(M._aprm_destroy(b), 0);
  assert.equal(mk(), b, 'lowest free handle is reused');
  assert.equal(M._aprm_destroy(a), 0);
  assert.equal(M._aprm_destroy(b), 0);
  assert.equal(M._aprm_destroy(c), 0);
  assert.equal(mk(), a, 'all freed: first handle again');
  assert.equal(M._aprm_destroy(a), 0);
});

test('ten handles destroyed in scrambled order, then reusable', () => {
  const hs = Array.from({ length: 10 }, () => mk());
  for (const i of [3, 7, 0, 9, 1, 5, 2, 8, 4, 6]) assert.equal(M._aprm_destroy(hs[i]), 0);
  const again = Array.from({ length: 10 }, () => mk());
  assert.deepEqual([...again].sort((x, y) => x - y), [...hs].sort((x, y) => x - y));
  for (const h of again) assert.equal(M._aprm_destroy(h), 0);
});

test('bad handle: every function reports INVALID_ARGUMENT', () => {
  for (const bad of [0, -1, 99999, 1.5]) {
    assert.equal(M._aprm_step(bad), -1);
    assert.equal(M._aprm_run_until(bad, 5), -1);
    assert.equal(add(bad, 1, 0, 1, 1, 1, 0), -1);
    assert.equal(M._aprm_reset(bad), -1);
    assert.equal(M._aprm_destroy(bad), -1);
    expectErr(bad, -1, 'handle');
    for (const f of [M._aprm_state, M._aprm_results, M._aprm_metrics, M._aprm_exact]) {
      const e = json(f(bad));
      assert.equal(e.ok, false);
      assert.equal(e.error.code, -1);
    }
    assert.equal(json(M._aprm_log(bad, 0)).error.code, -1);
  }
  const h = mk();
  assert.equal(M._aprm_destroy(h), 0);
  assert.equal(M._aprm_destroy(h), -1, 'double destroy is an error, not a crash');
  assert.equal(M._aprm_step(h), -1, 'use after destroy');
});

test('aprm_create failures with no handle (O-10, D64): aprm_last_error(0)', () => {
  const cases = [
    [[0, 32768, FCFS, 100, 50, 0.1], -2, 'cpu_cap'],
    [[16, 0, FCFS, 100, 50, 0.1], -2, 'mem_cap'],
    [[16, 32768, 9, 100, 50, 0.1], -1, 'policy'],
    [[16, 32768, -1, 100, 50, 0.1], -1, 'policy'],
    [[16, 32768, 1.5, 100, 50, 0.1], -2, 'policy'],
    [[16, 32768, FCFS, 10001, 50, 0.1], -2, 'alpha_milli'],
    [[16, 32768, FCFS, 100, -1, 0.1], -2, 'reserve_threshold'],
    [[16, 32768, FCFS, 100, 50, 0], -2, 'knapsack_eps'],
    [[16, 32768, FCFS, 100, 50, NaN], -2, 'knapsack_eps'],
    [[2 ** 53 + 2, 32768, FCFS, 100, 50, 0.1], -2, 'cpu_cap'],
    [[NaN, 32768, FCFS, 100, 50, 0.1], -2, 'cpu_cap'],
    [[Infinity, 32768, FCFS, 100, 50, 0.1], -2, 'cpu_cap'],
  ];
  for (const [args, code, field] of cases) {
    assert.equal(M._aprm_create(...args), code, JSON.stringify(args));
    expectErr(0, code, field);
  }
  // A good create does not clear it: the slot holds the most recent no-handle failure.
  const h = mk();
  expectErr(0, -2, 'cpu_cap');
  assert.equal(M._aprm_destroy(h), 0);
  // A failure on a live handle does not touch the no-handle slot.
  const h2 = mk();
  assert.equal(M._aprm_create(0, 1, 0, 0, 0, 0.5), -2);
  assert.equal(add(h2, 1, 0, 1, 99, 1, 0), -3);
  expectErr(0, -2, 'cpu_cap');
  expectErr(h2, -3);
  assert.equal(M._aprm_destroy(h2), 0);
});

test('last error on a fresh handle is {"ok":true,"data":null}', () => {
  const h = mk();
  assert.deepEqual(lastErr(h), { ok: true, data: null });
  assert.equal(M._aprm_destroy(h), 0);
});

test('every add_job error code through aprm_last_error', () => {
  const h = mk(FCFS, 4, 100);
  // INVALID_FIELD: engine range checks and the api number checks
  const bad = [
    [[1, 0, 0, 1, 1, 0], 'duration'],                 // duration 0
    [[1, 0, 1, 1, 1, 10], 'priority'],                // priority 10
    [[1, 0, 1, 1, 1, -1], 'priority'],
    [[-1, 0, 1, 1, 1, 0], 'id'],                      // negative id
    [[1, -1, 1, 1, 1, 0], 'arrival'],                 // negative arrival
    [[1, 0, 1, 0, 1, 0], 'cpu'],
    [[1, 0, 1, 1, 0, 0], 'mem'],
    [[1, 0.5, 1, 1, 1, 0], 'arrival'],                // not whole
    [[1, 0, NaN, 1, 1, 0], 'duration'],
    [[1, 0, Infinity, 1, 1, 0], 'duration'],
    [[1, MAXSAFE + 2, 1, 1, 1, 0], 'arrival'],        // beyond 2^53
    [[1, -(MAXSAFE + 2), 1, 1, 1, 0], 'arrival'],
    [[2 ** 31, 0, 1, 1, 1, 0], 'id'],                 // does not fit 32 bits
    [[1, 0, 1, 1, 2 ** 60, 0], 'mem'],
    [[1, 0, 1, 2 ** 70, 1, 0], 'cpu'],
    [[1, 0, 1, 1, 1, 2 ** 32], 'priority'],
  ];
  for (const [a, field] of bad) {
    assert.equal(add(h, ...a), -2, JSON.stringify(a));
    expectErr(h, -2, field);
  }
  assert.equal(json(M._aprm_state(h)).data.total, 0, 'rejected jobs change nothing');
  // exactly 2^53 is accepted by the number check (the engine still range-checks it)
  assert.equal(add(h, 1, MAXSAFE, 1, 1, 1, 0), -2);
  expectErr(h, -2, 'arrival');
  // CAPACITY_EXCEEDED
  assert.equal(add(h, 5, 0, 1, 5, 1, 0), -3);
  expectErr(h, -3);
  assert.equal(add(h, 5, 0, 1, 1, 101, 0), -3);
  // DUPLICATE_ID
  assert.equal(add(h, 7, 0, 5, 1, 1, 0), 0);
  assert.equal(add(h, 7, 1, 5, 1, 1, 0), -5);
  expectErr(h, -5);
  // ARRIVAL_IN_PAST
  assert.equal(add(h, 8, 10, 5, 1, 1, 0), 0);
  assert.equal(M._aprm_run_until(h, 10), 0);
  assert.equal(json(M._aprm_state(h)).data.now, 10);
  assert.equal(add(h, 9, 3, 5, 1, 1, 0), -4);
  expectErr(h, -4);
  // success does not clear the last error (documented), reset does
  assert.equal(add(h, 10, 10, 1, 1, 1, 0), 0);
  expectErr(h, -4);
  assert.equal(M._aprm_reset(h), 0);
  assert.deepEqual(lastErr(h), { ok: true, data: null });
  assert.equal(M._aprm_destroy(h), 0);
});

test('LIMIT_REACHED at 5000 jobs', () => {
  const h = mk(FCFS, 1000, 1000000);
  for (let i = 0; i < 5000; i++) assert.equal(add(h, i, i, 1, 1, 1, 0), 0);
  assert.equal(add(h, 5000, 5000, 1, 1, 1, 0), -6);
  expectErr(h, -6);
  assert.equal(json(M._aprm_state(h)).data.total, 5000);
  assert.equal(runAll(h), 0);
  assert.equal(json(M._aprm_results(h)).data.length, 5000);
  assert.equal(M._aprm_destroy(h), 0);
});

test('step and run_until: not-implemented policy, number check, D59 clock', () => {
  const h = mk(SJF);
  assert.equal(M._aprm_step(h), -1);
  expectErr(h, -1);
  assert.match(lastErr(h).error.message, /not implemented/);
  assert.equal(M._aprm_destroy(h), 0);

  const g = mk(FCFS);
  assert.equal(M._aprm_run_until(g, MAXSAFE * 2), -2);
  expectErr(g, -2, 't');
  assert.equal(M._aprm_run_until(g, 1.5), -2);
  assert.equal(add(g, 1, 5, 10, 1, 1, 0), 0);
  assert.equal(add(g, 2, 20, 10, 1, 1, 0), 0);
  assert.equal(M._aprm_run_until(g, 12), 0);
  assert.equal(json(M._aprm_state(g)).data.now, 5, 'now stays at the last event handled (D59), not at t=12');
  // arrival == now is the D59 edge case: accepted, handled by a second step at the same tick
  assert.equal(add(g, 3, 5, 1, 1, 1, 0), 0);
  assert.equal(M._aprm_step(g), 1);
  assert.equal(json(M._aprm_state(g)).data.now, 5);
  assert.equal(M._aprm_destroy(g), 0);
});

test('aprm_exact is an error envelope until K-33', () => {
  const h = mk();
  const e = json(M._aprm_exact(h));
  assert.equal(e.ok, false);
  assert.equal(e.error.code, -9);
  assert.match(e.error.message, /not built yet/);
  assert.equal(lastErr(h).error.code, -9);
  assert.equal(M._aprm_destroy(h), 0);
});

test('JSON envelope shapes (strict JSON.parse)', () => {
  const h = mk();
  assert.equal(add(h, 1, 0, 10, 16, 32768, 0), 0);
  assert.equal(add(h, 2, 2, 5, 8, 16384, 3), 0);
  assert.equal(add(h, 3, 4, 3, 16, 8192, 9), 0);
  assert.equal(M._aprm_step(h), 1);
  const st = json(M._aprm_state(h));
  assert.equal(st.ok, true);
  assert.deepEqual(Object.keys(st.data), ['now', 'done', 'total', 'cap', 'free', 'waiting', 'running', 'reservation']);
  assert.equal(st.data.total, 3);
  assert.deepEqual(st.data.cap, { cpu: 16, mem: 32768 });
  assert.equal(st.data.running.length, 1);
  assert.equal(st.data.reservation, null);
  assert.equal(runAll(h), 0);
  const log = json(M._aprm_log(h, 0));
  assert.equal(log.ok, true);
  assert.ok(Array.isArray(log.data) && log.data.length > 0);
  assert.deepEqual(Object.keys(log.data[0]), ['seq', 't', 'kind', 'job', 'msg']);
  assert.deepEqual(json(M._aprm_log(h, log.data.length)).data, []);
  assert.equal(json(M._aprm_log(h, log.data.length - 1)).data.length, 1);
  assert.equal(json(M._aprm_log(h, -5)).data.length, log.data.length);
  const res = json(M._aprm_results(h));
  assert.equal(res.ok, true);
  assert.deepEqual(res.data.map((r) => r.id), [1, 2, 3]);
  assert.deepEqual(Object.keys(res.data[0]), ['id', 'arrival', 'start', 'finish', 'wait', 'turnaround', 'priority', 'cpu', 'mem']);
  const met = json(M._aprm_metrics(h));
  assert.equal(met.ok, true);
  assert.equal(met.data.makespan, 18);
  assert.equal(met.data.avg_wait_by_priority.length, 10);
  assert.equal(M._aprm_destroy(h), 0);
});

test('JSON string pointer rules', () => {
  const a = mk(), b = mk();
  add(a, 1, 0, 3, 1, 1, 0); add(b, 1, 0, 3, 1, 1, 0); add(b, 2, 0, 3, 1, 1, 0);
  const pa = M._aprm_state(a);
  const textA = str(pa);
  const pb = M._aprm_state(b);
  assert.notEqual(pa, pb, 'two handles never share a buffer');
  assert.equal(str(pa), textA, 'calls on another handle do not touch this handle\'s string');
  // the same handle's pointer is valid only until its next call: copy first
  const copy = str(pa);
  M._aprm_step(a);
  runAll(a);
  const p2 = M._aprm_results(a);
  assert.equal(JSON.parse(copy).data.total, 1);
  assert.equal(json(p2).data.length, 1);
  // JSON functions replace the buffer, they do not append (D53)
  const first = str(M._aprm_results(a));
  const second = str(M._aprm_results(a));
  assert.equal(first, second);
  assert.doesNotThrow(() => JSON.parse(second));
  // a JSON function never returns a NULL pointer
  for (const f of [M._aprm_state, M._aprm_results, M._aprm_metrics, M._aprm_exact, M._aprm_last_error]) {
    assert.notEqual(f(a), 0);
    assert.notEqual(f(12345), 0);
  }
  assert.equal(M._aprm_destroy(a), 0);
  assert.equal(M._aprm_destroy(b), 0);
});

test('reset restarts the clock, keeps the config', () => {
  const h = mk(FCFS, 8, 1000);
  add(h, 1, 0, 5, 8, 1000, 0);
  runAll(h);
  assert.equal(json(M._aprm_state(h)).data.done, 1);
  assert.equal(M._aprm_reset(h), 0);
  const st = json(M._aprm_state(h)).data;
  assert.deepEqual([st.now, st.done, st.total], [0, 0, 0]);
  assert.deepEqual(st.cap, { cpu: 8, mem: 1000 });
  assert.equal(add(h, 1, 0, 5, 8, 1000, 0), 0, 'ids are free again');
  assert.equal(M._aprm_destroy(h), 0);
});

// A fixed pseudo-random workload (LCG, no Math.random: runs are reproducible).
function workload(seed, n) {
  let x = seed >>> 0;
  const r = (m) => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x % m; };
  const jobs = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    t += r(4);
    jobs.push([i + 1, t, 1 + r(20), 1 + r(8), 256 + r(8000), r(10)]);
  }
  return jobs;
}

test('50 simulations interleaved equal 50 run alone', () => {
  const N = 50;
  const wl = Array.from({ length: N }, (_, i) => workload(i + 1, 20 + (i % 7)));
  const alone = wl.map((jobs) => {
    const h = mk();
    for (const j of jobs) assert.equal(add(h, ...j), 0);
    assert.equal(runAll(h), 0);
    const out = str(M._aprm_results(h));
    M._aprm_destroy(h);
    return out;
  });
  const hs = wl.map(() => mk());
  assert.equal(new Set(hs).size, N);
  // interleave: round-robin one job, then round-robin one step
  const maxJobs = Math.max(...wl.map((w) => w.length));
  for (let k = 0; k < maxJobs; k++)
    for (let i = 0; i < N; i++) if (k < wl[i].length) assert.equal(add(hs[i], ...wl[i][k]), 0);
  let live = N;
  const done = new Set();
  while (live > 0) {
    for (let i = 0; i < N; i++) {
      if (done.has(i)) continue;
      const rc = M._aprm_step(hs[i]);
      assert.ok(rc >= 0);
      if (rc === 0) { done.add(i); live--; }
    }
  }
  for (let i = 0; i < N; i++) assert.equal(str(M._aprm_results(hs[i])), alone[i], `simulation ${i}`);
  for (const h of hs) assert.equal(M._aprm_destroy(h), 0);
});

test('handle table limit: LIMIT_REACHED with no handle, then recovery', () => {
  const hs = [];
  let rc;
  while ((rc = mk()) > 0) hs.push(rc);
  assert.equal(hs.length, 4096);
  assert.equal(rc, -6);
  expectErr(0, -6);
  assert.equal(M._aprm_destroy(hs[100]), 0);
  assert.equal(mk(), hs[100]);
  for (const h of hs) assert.equal(M._aprm_destroy(h), 0);
});

test('aprm.js runs as a classic script in a browser-like context (no module, no require, no fetch)', async () => {
  const code = readFileSync(join(root, 'web', 'vendor', 'aprm.js'), 'utf8');
  assert.ok(!/import\.meta/.test(code), 'import.meta present');
  assert.ok(!/^\s*export\s/m.test(code), 'ES module export present');
  const vm = await import('node:vm');
  const sandbox = {
    WebAssembly, TextDecoder, TextEncoder, URL, Promise, setTimeout, clearTimeout, console,
    fetch() { throw new Error('fetch must not be used'); },
    document: {}, location: { href: 'file:///index.html' },
  };
  sandbox.window = sandbox;                      // a window global, no process/require/module/exports
  vm.createContext(sandbox);
  vm.runInContext(code + '\n;this.__factory = typeof createAprm === "function" ? createAprm : null;', sandbox);
  assert.equal(typeof sandbox.createAprm, 'function', 'a classic script defines the global factory');
  const B = await sandbox.__factory();
  const h = B._aprm_create(16, 32768, 0, 100, 50, 0.1);
  assert.ok(h >= 1);
  assert.equal(B._aprm_add_job(h, 1, 0, 10, 16, 32768, 0), 0);
  while (B._aprm_step(h) > 0);
  assert.equal(JSON.parse(B.UTF8ToString(B._aprm_results(h))).data[0].finish, 10);
  B._aprm_destroy(h);
});

// ---- byte-identical results.csv against the golden files ----
const runner = join(here, 'run_wasm.mjs');
const casesDir = join(root, 'tests', 'cases');
const cli = join(root, 'build', 'aprm');
const goldens = readdirSync(casesDir).filter((f) => /\.fcfs\.expected\.csv$/.test(f)).sort();
for (const g of goldens) {
  const name = g.replace(/\.fcfs\.expected\.csv$/, '');
  test(`golden ${name} (fcfs): run_wasm.mjs is byte-identical to ${g}`, () => {
    const argsFile = join(casesDir, `${name}.args`);
    const extra = existsSync(argsFile) ? readFileSync(argsFile, 'utf8').split(/\s+/).filter(Boolean) : [];
    const run = spawnSync('node', [runner, '--policy', 'fcfs', '--in', join(casesDir, `${name}.csv`), ...extra]);
    assert.equal(run.status, 0, run.stderr.toString());
    assert.ok(run.stdout.equals(readFileSync(join(casesDir, g))), 'stdout differs from the golden file');
    if (existsSync(cli)) {
      const out = join(root, 'build', `wasm-test-${name}.csv`);
      const c = spawnSync(cli, ['--policy', 'fcfs', '--in', join(casesDir, `${name}.csv`), '--out', out, ...extra]);
      assert.equal(c.status, 0, c.stderr.toString());
      assert.ok(readFileSync(out).equals(run.stdout), 'differs from build/aprm');
    }
  });
}
test('golden cases for other policies are skipped (not implemented yet)', () => {
  const others = readdirSync(casesDir).filter((f) => /\.expected\.csv$/.test(f) && !/\.fcfs\.expected\.csv$/.test(f));
  console.log(`  skipped ${others.length} golden files of policies other than fcfs`);
  const run = spawnSync('node', [runner, '--policy', 'sjf', '--in', join(casesDir, 'sjf_order.csv')]);
  assert.equal(run.status, 4);
});

test('run_wasm.mjs exit codes', () => {
  const r = (args) => spawnSync('node', [runner, ...args]).status;
  assert.equal(r([]), 1);
  assert.equal(r(['--bogus', '1']), 1);
  assert.equal(r(['--policy', 'nope', '--in', 'x']), 1);
  assert.equal(r(['--in']), 1);
  assert.equal(r(['--in', join(root, 'does-not-exist.csv')]), 2);
  assert.equal(r(['--in', join(casesDir, 'capacity_reject.csv')]), 3);
  assert.equal(r(['--in', join(casesDir, 'fcfs_basic.csv'), '--cpu', '0']), 1);
  assert.equal(r(['--in', join(casesDir, 'fcfs_basic.csv')]), 0);
  assert.equal(r(['--policy', 'aging', '--in', join(casesDir, 'fcfs_basic.csv')]), 4);
});

if (existsSync(cli)) console.log('build/aprm found: golden cases also compared with the console program');
else console.log('build/aprm not found: golden cases compared with the golden files only');

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n${e && e.stack ? e.stack : e}`); }
}
console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
