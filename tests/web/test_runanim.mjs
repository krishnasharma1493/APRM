// test_runanim.mjs: tests for web/js/runanim.js and the shared laptop poses (K-52).
// Run: node tests/web/test_runanim.mjs
// The event table (which motion each engine log kind triggers), the motion length, where running
// jobs are drawn on the cores and memory, and the cores outlined for a saved spot. With the real
// engine: for every preset and scheduler, the drawing always shows exactly the engine's busy cores
// and memory after every moment.
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
  for (const s of ['js/copy.js', 'js/runmodel.js', 'js/runanim.js', 'js/laptop.js', 'js/runstage.js', 'js/presets_data.js'].concat(createAprm ? ['js/wasm.js'] : [])) vm.runInContext(read(s), ctx, { filename: s });
  return ctx.APRM;
}
const A = load();
const R = A.runanim;

test('event table: each engine log kind triggers the design motion', () => {
  const steps = (kind) => plain(R.plan({ kind, job: 7, t: 3 })).map((s) => s.fx + ':' + s.key).join(' ');
  assert.equal(steps('ARRIVE'), 'enter:j7');
  assert.equal(steps('START'), 'fly:j7 pop:cells');
  assert.equal(steps('SKIP'), 'shake:j7');
  assert.equal(steps('RESERVE'), 'mark:j7 pop:held');
  assert.equal(steps('BACKFILL'), 'tag:j7');
  assert.equal(steps('FINISH'), 'fly:j7');
  assert.equal(steps('BATCH_SELECT'), 'mark:j7');
  assert.equal(steps('REJECT'), '');
  assert.deepEqual(plain(R.plan(null)), []);
});

test('motion length: 620 ms at 1x, shorter when faster, never under 260 ms', () => {
  assert.equal(R.duration(0.5), 620);
  assert.equal(R.duration(1), 620);
  assert.equal(R.duration(2), 310);
  assert.equal(R.duration(4), 260);
});

test('allocate: lowest free cells and first free memory, in start order; finished jobs give them back', () => {
  const cap = { cpu: 8, mem: 1000 };
  let p = R.emptyPicture(cap);
  assert.equal(p.cells.length, 8);
  p = R.allocate(p, [{ id: 2, start: 1, cpu: 2, mem: 300 }, { id: 1, start: 0, cpu: 3, mem: 200 }], cap);
  assert.deepEqual(plain(p.cells), [1, 1, 1, 2, 2, null, null, null]);
  assert.deepEqual(plain(p.segs), { 1: [[0, 200]], 2: [[200, 500]] });
  p = R.allocate(p, [{ id: 2, start: 1, cpu: 2, mem: 300 }], cap);            // job 1 finished
  assert.deepEqual(plain(p.cells), [null, null, null, 2, 2, null, null, null]);
  p = R.allocate(p, [{ id: 2, start: 1, cpu: 2, mem: 300 }, { id: 3, start: 5, cpu: 4, mem: 600 }], cap);
  assert.deepEqual(plain(p.cells), [3, 3, 3, 2, 2, 3, null, null], 'a job keeps its cells; a new one fills the holes');
  assert.deepEqual(plain(p.segs[3]), [[0, 200], [500, 900]], 'memory too, split over the free gaps');
  assert.deepEqual(plain(p.segs[2]), [[200, 500]]);
});

test('allocate: more than 64 cores draws 64 cells; the picture before is not changed', () => {
  const cap = { cpu: 128, mem: 4096 };
  const p0 = R.emptyPicture(cap);
  const p1 = R.allocate(p0, [{ id: 1, start: 0, cpu: 100, mem: 10 }], cap);
  assert.equal(p1.cells.length, 64);
  assert.ok(p1.cells.every((c) => c === 1));
  assert.ok(p0.cells.every((c) => c === null));
});

test('held cores for a saved spot: what the saved job needs, at most what is free', () => {
  const cells = [1, 1, null, null, null, null, null, null];
  const st = { free: { cpu: 6, mem: 500 }, reservation: { id: 9, shadow_time: 12 }, waiting: [{ id: 9, cpu: 4, mem: 100 }] };
  assert.equal(R.heldCount(st, cells), 4);
  assert.equal(R.heldCount({ ...st, waiting: [{ id: 9, cpu: 8, mem: 1 }] }, cells), 6);
  assert.equal(R.heldCount({ ...st, reservation: null }, cells), 0);
  assert.equal(R.heldCount(null, cells), 0);
});

test('one laptop, two poses: Build explodes the layers, Run assembles them and opens the lid further', () => {
  const ex = plain(A.laptop.pose('exploded')), as = plain(A.laptop.pose('assembled'));
  assert.deepEqual(ex.z, { base: 0, mem: 70, cpu: 170, keys: 272, lid: 322 });
  assert.deepEqual(as.z, { base: 0, mem: 2, cpu: 4.5, keys: 8, lid: 9.5 });
  assert.equal(ex.lid, 100);
  assert.equal(as.lid, 114);
  assert.deepEqual(ex.cam, plain(A.laptop.CAMERA));
  assert.deepEqual(as.cam, { rx: 60, rz: -16 });
  assert.equal(A.laptop.layerTransform(as, 'lid'), 'translate3d(0px,0px,9.5px) rotateX(114deg)');
  assert.equal(A.laptop.layerTransform(ex, 'cpu'), 'translate3d(0px,0px,170.0px)');
  assert.equal(plain(A.laptop.pose('collapse')).lid, 108);
});

test('stage geometry: side columns from 1100 px, the screen about 600 px wide on a desktop, always on a phone', () => {
  const g = A.runstage.geometry(1440);
  assert.equal(g.side, true);
  assert.equal(g.screenW, 600);
  const m = A.runstage.geometry(1000);
  assert.equal(m.side, false);
  const p = A.runstage.geometry(375);
  assert.equal(p.narrow, true);
  assert.ok(p.screenW < 375 - 32, 'fits a phone');
  assert.ok(g.h > p.h);
});

// ---------- the real engine ----------
const vendor = join(web, 'vendor', 'aprm.js');
if (existsSync(vendor)) {
  test('real engine: the drawing shows exactly the engine busy cores and memory after every moment, 6 presets x 6 schedulers', async () => {
    const E = load(require(vendor));
    const W = await E.wasm.init();
    let n = 0;
    for (const pr of E.presetsData) {
      for (const policy of ['fcfs', 'priority', 'sjf', 'aging', 'aging_reserve', 'knapsack']) {
        const h = W.create(pr.cpu_cap, pr.mem_cap, policy, pr.alpha_milli, pr.threshold, 0.1);
        for (const j of pr.jobs) W.addJob(h, j.id, j.arrival, j.duration, j.cpu, j.mem, j.priority);
        const cap = { cpu: pr.cpu_cap, mem: pr.mem_cap };
        let pic = E.runanim.emptyPicture(cap);
        while (W.step(h) === 1) {
          const st = W.state(h);
          pic = E.runanim.allocate(pic, st.running, cap);
          const busyCells = pic.cells.filter((c) => c !== null).length;
          assert.equal(busyCells, Math.min(64, cap.cpu - st.free.cpu), pr.name + ' ' + policy + ' cores at ' + st.now);
          let mem = 0;
          for (const r of st.running) for (const g of pic.segs[r.id]) mem += g[1] - g[0];
          assert.equal(mem, cap.mem - st.free.mem, pr.name + ' ' + policy + ' memory at ' + st.now);
          for (const r of st.running) assert.equal(pic.cells.filter((c) => c === r.id).length, r.cpu, 'job ' + r.id + ' shows its own cores');
          n++;
        }
        W.destroy(h);
      }
    }
    assert.ok(n > 300, n + ' moments');
  });
} else {
  console.log('note: web/vendor/aprm.js not built, real-engine checks skipped (run make wasm)');
}

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n     ') : e)); }
}
console.log(`${tests.length - failed}/${tests.length} runanim tests passed`);
if (failed) process.exit(1);
