// test_compare.mjs: tests for the Compare page (K-57): web/js/comparemodel.js and web/js/compare.js.
// Run: node tests/web/test_compare.mjs
// The real web/js scripts run in a node:vm context with a small fake DOM (enough for createElement,
// createElementNS, events and canvases). Logic tests use a fake engine behind the APRM.wasm interface
// and a fake scheduler (slices run by hand). If web/vendor/aprm.js and build/aprm exist, the same code
// drives the real engine and every policy is compared with the console program on every preset.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const web = join(root, 'web');
const require = createRequire(import.meta.url);
const html = readFileSync(join(web, 'index.html'), 'utf8');
const read = (rel) => readFileSync(join(web, rel), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------- fake DOM ----------
class Text { constructor(t) { this._t = t; this.parentNode = null; } get textContent() { return this._t; } set textContent(v) { this._t = String(v); } }
class El {
  constructor(tag, id = '') {
    this.tag = tag; this.id = id; this.attrs = {}; this.children = []; this.listeners = {}; this.style = {};
    this.hidden = false; this.value = ''; this.disabled = false; this.parentNode = null; this.clientWidth = 1280; this.offsetWidth = 1280;
  }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.children = String(v) === '' ? [] : [new Text(String(v))]; }
  get firstChild() { return this.children[0] || null; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children.splice(this.children.indexOf(c), 1); c.parentNode = null; return c; }
  replaceChild(n, o) { const i = this.children.indexOf(o); this.children[i] = n; n.parentNode = this; o.parentNode = null; return o; }
  focus() {}
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') { this.id = String(v); } if (k === 'hidden') { this.hidden = true; } }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  fire(type, ev = {}) { for (const fn of this.listeners[type] || []) fn({ currentTarget: this, target: this, clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {}, ...ev }); }
  click() { this.fire('click'); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 200 }; }
  all() { const out = []; const walk = (e) => { out.push(e); (e.children || []).forEach((c) => c.children && walk(c)); }; walk(this); return out; }
  querySelectorAll(sel) { const m = /^\[([a-z-]+)(?:="([^"]*)")?\]$/.exec(sel); return m ? this.all().filter((e) => e.getAttribute(m[1]) !== null && (m[2] === undefined || e.getAttribute(m[1]) === m[2])) : []; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  find(pred) { return this.all().filter(pred); }
}
function fakeCtx() {
  const calls = [];
  const grad = { addColorStop() {} };
  return new Proxy({ fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', globalAlpha: 1, shadowBlur: 0, shadowColor: '', textAlign: '', textBaseline: '' }, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'calls') return calls;
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
      if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (k === 'createPattern') return () => null;
      return (...a) => { calls.push({ op: String(k), a }); };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
function fakeDocument() {
  const byId = {};
  for (const m of html.matchAll(/<([a-z0-9]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const el = new El(m[1], m[2]);
    if (/\bhidden\b/.test(m[0])) el.hidden = true;
    byId[m[2]] = el;
  }
  const doc = {
    byId, listeners: {},
    getElementById: (id) => byId[id] || (doc.root ? doc.root.all().find((e) => e.id === id) : null) || null,
    createElement: (t) => { const e = new El(t); if (t === 'canvas') { e.ctx = fakeCtx(); e.getContext = () => e.ctx; } return e; },
    createElementNS: (ns, t) => new El(t),
    createTextNode: (t) => new Text(t),
    addEventListener: (t, fn) => { (doc.listeners[t] = doc.listeners[t] || []).push(fn); },
    querySelectorAll: () => [],
  };
  doc.root = byId['cmp-root'];
  return doc;
}

const tags = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
const srcs = tags.map((t) => (t.match(/\bsrc="([^"]+)"/) || [])[1]);
const localSrcs = srcs.filter((u) => u && !/^https?:/.test(u));

function page({ createAprm, wasm = false } = {}) {
  const doc = fakeDocument();
  const win = { document: doc, console, listeners: {}, innerWidth: 1440, devicePixelRatio: 1, scrollY: 0 };
  win.window = win;
  win.addEventListener = (t, fn) => { (win.listeners[t] = win.listeners[t] || []).push(fn); };
  if (createAprm) win.createAprm = createAprm;
  const ctx = vm.createContext(win);
  for (const s of localSrcs) {
    if (s.startsWith('vendor/') || s === 'js/app.js') continue;
    if (s === 'js/wasm.js' && !wasm) continue;
    vm.runInContext(read(s), ctx, { filename: s });
  }
  const A = ctx.APRM;
  const sched = { laters: [] };
  sched.later = (fn) => { sched.laters.push(fn); return sched.laters.length; };
  sched.cancelLater = () => { sched.laters.length = 0; };
  sched.runLater = () => { const f = sched.laters.shift(); assert.ok(f, 'a slice is scheduled'); f(); };
  sched.drain = () => { let n = 0; while (sched.laters.length) { sched.runLater(); n++; } return n; };
  A.compare.setScheduler(sched);
  return { ctx, doc, A, sched, el: (id) => doc.getElementById(id) };
}

// ---------- a fake engine behind the wasm.js interface ----------
class EngineError extends Error {
  constructor(code, message, field) { super(message); this.name = 'EngineError'; this.code = code; this.field = field || ''; }
}
function fakeWasm({ totalSteps = 10, failStepFor, failCreateAt, metricsFor } = {}) {
  const f = { live: new Set(), next: 1, created: [], stepCalls: [], sims: new Map(), destroyed: [], exactCalls: 0 };
  f.create = (cpu, mem, policy, alpha, thr, eps) => {
    if (failCreateAt !== undefined && f.created.length === failCreateAt) throw new EngineError(-7, 'Out of memory.', '');
    const h = f.next++; f.live.add(h); f.created.push({ h, cpu, mem, policy, alpha, thr, eps });
    f.sims.set(h, { jobs: [], steps: 0, policy, cpu, mem });
    return h;
  };
  f.addJob = (h, ...a) => { f.sims.get(h).jobs.push(a); return 0; };
  f.step = (h) => {
    const s = f.sims.get(h);
    f.stepCalls.push(h);
    if (failStepFor && s.policy === failStepFor) throw new EngineError(-4, 'Bad <b>step</b>.', '');
    if (s.steps >= totalSteps) return 0;
    s.steps++; return 1;
  };
  const rowsOf = (s) => s.jobs.map((j, i) => ({ id: j[0], arrival: j[1], start: j[1] + i, finish: j[1] + i + j[2], wait: i, turnaround: i + j[2], priority: j[5], cpu: j[3], mem: j[4] }));
  f.metrics = (h) => (metricsFor && metricsFor(f.sims.get(h).policy)) || { avg_wait: 1, max_wait: 2, avg_turnaround: 6, weighted_completion: 40, makespan: 9, util_cpu: 0.25, util_mem: 0.5, avg_wait_by_priority: [null, null, null, 1, null, null, null, null, null, null] };
  f.results = (h) => rowsOf(f.sims.get(h));
  f.log = () => [{ seq: 1, t: 0, kind: 'RESERVE', job: 1, msg: '' }, { seq: 2, t: 0, kind: 'BACKFILL', job: 2, msg: '' }];
  f.exact = (h) => { f.exactCalls++; const rows = rowsOf(f.sims.get(h)).map((r) => ({ ...r, start: r.arrival, finish: r.arrival + (r.finish - r.start), wait: 0, turnaround: r.finish - r.start })); return { total_wait: 0, schedule: rows }; };
  f.destroy = (h) => { if (!f.live.has(h)) throw new EngineError(-1, 'Not a valid simulation handle.', 'handle'); f.live.delete(h); f.destroyed.push(h); return 0; };
  return f;
}
const JOBS = [1, 2, 3].map((i) => ({ id: i, arrival: i - 1, duration: 5, cpu: 2, mem: 1024, priority: 3 }));
function ready(opts) {
  const p = page();
  p.fe = fakeWasm(opts);
  p.A.wasm = p.fe;
  p.A.compare.mount();
  p.A.store.setJobs(JOBS.map((j) => ({ ...j })));
  p.A.compare.setSource('yours');
  return p;
}

// ---------- static ----------
test('index.html loads comparemodel.js before compare.js; no chart library, no external script', () => {
  const i = (n) => srcs.indexOf(n);
  assert.ok(i('js/comparemodel.js') >= 0 && i('js/comparemodel.js') < i('js/compare.js'));
  assert.ok(!srcs.some((u) => /^https?:/.test(u || '')));
  assert.ok(!/chart\.js|Chart\./.test(read('js/compare.js')), 'no Chart.js reference');
  assert.ok(!existsSync(join(web, 'node_modules', 'chart.js')) || !JSON.parse(read('package.json')).dependencies, 'chart.js is no longer a dependency');
});

test('compare.js and comparemodel.js: no innerHTML, eval, Function, fetch, inline handlers; only window.APRM', () => {
  for (const f of ['js/compare.js', 'js/comparemodel.js']) {
    const s = read(f);
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|\beval\(|new Function|\bfetch\(|import\s*\(/.test(s), f);
    assert.ok(!/window\.(?!APRM\b|matchMedia|scrollTo|scrollY|innerWidth|addEventListener|devicePixelRatio)[A-Za-z_]+\s*=/.test(s), f + ' defines only APRM');
  }
  assert.ok(!/\son[a-z]+="/.test(html), 'no inline handlers');
});

// ---------- comparemodel: pure numbers ----------
test('model: fmt and percentiles the design way', () => {
  const M = page().A.comparemodel;
  assert.equal(M.fmt(3), '3'); assert.equal(M.fmt(2.88888), '2.889'); assert.equal(M.fmt(null), '—');
  assert.equal(M.pct([5, 1, 3, 2, 4], 0.5), 3); assert.equal(M.pct([5, 1, 3, 2, 4], 0.9), 5); assert.equal(M.pct([], 0.5), null);
});

test('model: engine metrics become the design measures (shares to percents), waits from the result rows', () => {
  const M = page().A.comparemodel;
  const m = M.fromEngine({ avg_wait: 1.5, max_wait: 3, avg_turnaround: 4, weighted_completion: 10, makespan: 9, util_cpu: 0.25, util_mem: null, avg_wait_by_priority: [1, null, null, null, null, null, null, null, null, null] },
    [{ id: 1, wait: 0, turnaround: 4 }, { id: 2, wait: 3, turnaround: 4 }]);
  assert.equal(m.maxw, 3); assert.equal(m.avgw, 1.5); assert.equal(m.cpu, 25); assert.equal(m.mem, null);
  assert.deepEqual(plain(m.waits), [0, 3]); assert.equal(m.totW, 3); assert.equal(m.totT, 8); assert.equal(m.per[0], 1);
});

test('model: the exact best measures from its schedule follow the PRD formulas', () => {
  const M = page().A.comparemodel;
  const rows = [{ id: 1, arrival: 0, start: 0, finish: 4, wait: 0, turnaround: 4, priority: 2, cpu: 4, mem: 1024 },
    { id: 2, arrival: 1, start: 4, finish: 6, wait: 3, turnaround: 5, priority: 0, cpu: 8, mem: 2048 }];
  const m = M.fromSchedule(rows, { cpu: 8, mem: 4096 });
  assert.equal(m.maxw, 3); assert.equal(m.avgw, 1.5); assert.equal(m.mk, 6);
  assert.equal(m.wc, 3 * 4 + 1 * 6);
  assert.ok(Math.abs(m.cpu - 100 * (4 * 4 + 8 * 2) / (8 * 6)) < 1e-9);
  assert.equal(m.per[2], 0); assert.equal(m.per[0], 3); assert.equal(m.per[5], null);
});

test('model: the verdict order is longest wait, then average wait, then CPU busy; ties keep the design order', () => {
  const M = page().A.comparemodel;
  const col = (key, maxw, avgw, cpu, order) => ({ key, order, bench: false, m: { maxw, avgw, cpu } });
  const r = M.rank([col('fcfs', 10, 3, 50, 0), col('sjf', 8, 4, 40, 2), col('aging', 8, 3, 30, 3), col('easy', 8, 3, 60, 4), col('knap', 8, 3, 60, 5), { key: 'opt', bench: true, order: 6, m: { maxw: 1 } }]);
  assert.deepEqual(r.map((x) => x.key), ['easy', 'knap', 'aging', 'sjf', 'fcfs']);
  const b = M.bests([col('fcfs', 10, 3, 50, 0), col('sjf', 8, 3, 50, 2)].map((c) => ({ ...c, m: { ...c.m, avgt: 1, wc: 1, mk: 1, mem: 1 } })));
  assert.deepEqual(Object.keys(b.maxw), ['sjf']); assert.deepEqual(Object.keys(b.avgw).sort(), ['fcfs', 'sjf']);
});

test('model: wait spread shares sum to 1 per scheduler; series match the rows', () => {
  const M = page().A.comparemodel;
  const cols = [{ key: 'fcfs', m: { waits: [0, 0, 5, 9], n: 4 } }, { key: 'sjf', m: { waits: [0, 1, 2, 3], n: 4 } }];
  const d = M.spread(cols);
  for (const k of ['fcfs', 'sjf']) assert.ok(Math.abs(d.shares[k].reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.equal(d.maxAll, 9);
  const ser = M.series([{ arrival: 0, start: 0, finish: 2, cpu: 4, mem: 1024 }, { arrival: 0, start: 2, finish: 3, cpu: 8, mem: 2048 }], 3, { cpu: 8, mem: 4096 });
  assert.deepEqual(plain(ser.cpu), [50, 50, 100, 0]); assert.deepEqual(plain(ser.q), [1, 1, 0, 0]);
});

test('model: "Who ran when" peaks are 1 at the middle of the run, 0 well outside it; never boxes', () => {
  const M = page().A.comparemodel;
  const r = { start: 10, finish: 20 };
  assert.equal(M.hill(r, 15), 1);
  assert.ok(M.hill(r, 12) > 0.5 && M.hill(r, 12) < 1, 'shoulders are curved, not flat');
  const sp = M.hillSpan(r);
  assert.equal(M.hill(r, sp[1] + 0.01), 0); assert.equal(M.hill(r, sp[0] - 0.01), 0);
  assert.ok(sp[0] < 10 && sp[1] > 20);
  assert.ok(!/NaN/.test(M.mono([[0, 0], [1, 2], [2, 2], [3, 0]])));
});

// ---------- the runner with a fake engine ----------
test('every picked scheduler gets one handle with the same machine, settings and jobs; all destroyed after', () => {
  const p = ready();
  assert.equal(p.A.compare.start(), true);
  assert.deepEqual(p.fe.created.map((c) => c.policy), ['fcfs', 'priority', 'sjf', 'aging', 'aging_reserve', 'knapsack']);
  assert.ok(p.fe.created.every((c) => c.cpu === 16 && c.mem === 32768 && c.alpha === 100 && c.thr === 50));
  for (const h of p.fe.created) assert.equal(p.fe.sims.get(h.h).jobs.length, 3);
  p.sched.drain();
  const s = p.A.compare.snapshot();
  assert.equal(s.status, 'done');
  assert.equal(s.columns.length, 7, 'six schedulers and the exact best (3 jobs)');
  assert.equal(p.fe.exactCalls, 1);
  assert.equal(p.fe.live.size, 0);
  assert.equal(p.A.compare.liveHandles().length, 0);
});

test('slices: at most SLICE_STEPS engine steps per callback', () => {
  const p = ready({ totalSteps: 1300 });
  p.A.compare.start();
  let worst = 0;
  while (p.sched.laters.length) { const before = p.fe.stepCalls.length; p.sched.runLater(); worst = Math.max(worst, p.fe.stepCalls.length - before); }
  assert.ok(worst <= p.A.compare.SLICE_STEPS + 1, 'worst ' + worst);
  assert.equal(p.A.compare.snapshot().status, 'done');
});

test('fewer than two schedulers or no jobs: a plain message and no engine call', () => {
  const p = ready();
  const box = p.el('compare-policies');
  for (const b of box.children.slice()) if (!['fcfs', 'opt'].includes(b.getAttribute('data-key'))) b.click();
  assert.equal(p.A.compare.start(), false);
  assert.equal(p.fe.created.length, 0);
  assert.match(p.el('compare-status').textContent, /two or more/);
  const q = ready();
  q.A.store.setJobs([]);
  q.A.compare.setSource('yours');
  assert.equal(q.A.compare.snapshot().source, 'nine', 'an empty Build list falls back to the starvation case');
});

test('the exact best is skipped above 9 jobs; design cases bring their own T = 12', () => {
  const p = ready();
  p.A.compare.setSource('big');
  p.A.compare.start(); p.sched.drain();
  assert.equal(p.fe.exactCalls, 0);
  assert.equal(p.A.compare.snapshot().columns.length, 6);
  const q = ready();
  q.A.compare.setSource('nine');
  q.A.compare.start();
  assert.ok(q.fe.created.every((c) => c.thr === 12), 'nine case: T = 12');
  q.A.store.setSettings({ threshold: 30 });
  q.A.compare.start();
  assert.ok(q.fe.created.slice(-6).every((c) => c.thr === 30), 'a T the user changed wins');
});

test('engine error on create or step: shown as plain text, every handle destroyed', () => {
  const p = ready({ failCreateAt: 2 });
  assert.equal(p.A.compare.start(), false);
  assert.equal(p.A.compare.snapshot().status, 'error');
  assert.match(p.el('compare-status').textContent, /Out of memory/);
  assert.equal(p.fe.live.size, 0);
  const q = ready({ failStepFor: 'sjf' });
  q.A.compare.start(); q.sched.drain();
  assert.equal(q.A.compare.snapshot().status, 'error');
  assert.equal(q.fe.live.size, 0);
  assert.ok(q.el('compare-status').textContent.includes('Bad <b>step</b>.'), 'engine text is shown as text');
});

test('cancel and leaving Compare mid-run destroy every handle and stop the slices', () => {
  const p = ready({ totalSteps: 5000 });
  p.A.compare.start(); p.sched.runLater();
  p.A.compare.cancel();
  assert.equal(p.fe.live.size, 0);
  assert.equal(p.sched.laters.length, 0);
});

test('results: verdict, full table, sections and boards are drawn from the engine numbers', () => {
  const p = ready({ metricsFor: (pol) => ({ avg_wait: pol === 'sjf' ? 0.5 : 1, max_wait: pol === 'sjf' ? 1 : 2, avg_turnaround: 6, weighted_completion: 40, makespan: 9, util_cpu: 0.25, util_mem: 0.5, avg_wait_by_priority: [null, null, null, 1, null, null, null, null, null, null] }) });
  p.A.compare.start(); p.sched.drain();
  assert.equal(p.A.compare.snapshot().winner, 'sjf');
  const res = p.el('cmp-results');
  assert.equal(res.hidden, false);
  const ids = res.all().map((e) => e.id).filter(Boolean);
  for (const s of ['cmp-verdict', 'cmp-results', 'cmp-waits', 'cmp-fair', 'cmp-exact', 'cmp-boards', 'cmp-timelines', 'cmp-use', 'cmp-job']) assert.ok(ids.includes(s), s);
  const v = p.A.compare.verdictOf();
  assert.equal(v.key, 'sjf');
  assert.match(v.rest, /kept the longest wait to 1 ticks/);
  const boardsCv = res.all().filter((e) => e.tag === 'canvas' && /cmp-flowcv/.test(e.getAttribute('class') || ''));
  assert.equal(boardsCv.length, 7, 'one "Who ran when" board per column');
  assert.ok(boardsCv[0].ctx.calls.some((c) => c.op === 'arc'), 'peaks and markers drawn');
  assert.ok(!boardsCv[0].ctx.calls.some((c) => c.op === 'fillRect' && c.a[2] > 40 && c.a[3] > 10 && c.a[1] > 30 && c.a[1] < 200), 'no job box is filled');
  const cells = res.all().filter((e) => e.tag === 'td').map((e) => e.textContent);
  assert.ok(cells.some((t) => /^Best?1$|Best1|^1$/.test(t)), 'the winner’s longest wait shows');
});

test('the hero chart switches measure and the per-job and highlight choices redraw', () => {
  const p = ready();
  p.A.compare.start(); p.sched.drain();
  const res = p.el('cmp-results');
  const tab = res.all().find((e) => e.getAttribute('data-metric') === 'avgw');
  tab.click();
  assert.equal(p.A.compare.snapshot().metric, 'avgw');
  const hit = res.all().find((e) => e.tag === 'rect' && /cmp-hit/.test(e.getAttribute('class') || ''));
  hit.fire('click');
  assert.ok(p.A.compare.snapshot().sel, 'a scheduler is highlighted');
});

test('verdict on a three-way tie names where the winner really won', () => {
  const p = ready({ metricsFor: (pol) => ({ avg_wait: pol === 'sjf' ? 3 : 2, max_wait: 5, avg_turnaround: 6, weighted_completion: 40, makespan: 9, util_cpu: 0.5, util_mem: 0.5, avg_wait_by_priority: [] }) });
  p.A.compare.start(); p.sched.drain();
  const v = p.A.compare.verdictOf();
  assert.match(v.rest, /ties with .* wins on average wait: 2 against 3 ticks/);
});

test('keyboard: measure tabs move with the arrow keys; gap and per-job rows are buttons', () => {
  const p = ready();
  p.A.compare.start(); p.sched.drain();
  const res = p.el('cmp-results');
  const tab = res.all().find((e) => e.getAttribute('data-metric') === 'maxw');
  tab.fire('keydown', { key: 'ArrowRight', currentTarget: tab });
  assert.equal(p.A.compare.snapshot().metric, 'avgw');
  const rows = res.all().filter((e) => /cmp-gaprow|cmp-dumb/.test(e.getAttribute('class') || '') && e.getAttribute('role') === 'button');
  assert.ok(rows.length >= 6 && rows.every((r) => r.getAttribute('tabindex') === '0'));
  rows[0].fire('keydown', { key: 'Enter' });
  assert.ok(p.A.compare.snapshot().sel);
});

test('removing every Build job drops the "Your jobs" results and falls back to the starvation case', () => {
  const p = ready();
  p.A.compare.start(); p.sched.drain();
  p.A.store.setJobs([]);
  const s = p.A.compare.snapshot();
  assert.equal(s.source, 'nine'); assert.equal(s.status, 'idle'); assert.equal(p.A.compare.model(), null);
});

test('changing the jobs after a comparison marks it out of date', () => {
  const p = ready();
  p.A.compare.start(); p.sched.drain();
  p.A.store.setJobs(JOBS.slice(0, 2).map((j) => ({ ...j })));
  assert.match(p.el('compare-status').textContent, /changed since/);
});

// ---------- the real engine ----------
const vendor = join(web, 'vendor', 'aprm.js');
const cli = join(root, 'build', 'aprm');
if (existsSync(vendor) && readFileSync(vendor).length > 0) {
  const createAprm = require(vendor);
  const realPage = async () => {
    const p = page({ createAprm, wasm: true });
    await p.A.wasm.init();
    p.A.compare.mount();
    return p;
  };
  const csvRows = (text) => text.trim().split('\n').slice(1).map((l) => l.split(',').map(Number));
  const cliName = (n) => (n === 'aging_reserve' ? 'reserve' : n);
  const presetNames = ['big_job_trap', 'heavy_load', 'memory_hog', 'priority_starvation', 'sjf_starvation', 'tiny_case'];

  for (const name of presetNames) {
    test('real engine: preset ' + name + ', every scheduler side by side equals the console program', async () => {
      const p = await realPage();
      const preset = p.A.presets.load(name);
      assert.ok(preset, 'preset exists');
      p.A.compare.setSource('yours');
      assert.equal(p.A.compare.start(), true, p.A.compare.snapshot().status);
      p.sched.drain();
      const R = p.A.compare.model();
      assert.ok(R, 'results');
      assert.equal(p.A.compare.liveHandles().length, 0);
      if (!existsSync(cli)) { console.log('note: build/aprm missing; differential comparison skipped'); return; }
      const dir = mkdtempSync(join(tmpdir(), 'k57-'));
      for (const col of R.cols.filter((c) => !c.bench)) {
        const out = join(dir, col.name + '.csv'); const met = join(dir, col.name + '.json');
        const r = spawnSync(cli, ['--policy', cliName(col.name), '--in', join(root, 'data', 'presets', name + '.csv'), '--out', out, '--metrics', met,
          '--cpu', String(preset.cpu_cap), '--mem', String(preset.mem_cap), '--alpha-milli', String(preset.alpha_milli), '--threshold', String(preset.threshold)]);
        assert.equal(r.status, 0, String(r.stderr));
        const rows = col.rows.map((x) => [x.id, x.arrival, x.start, x.finish, x.wait, x.turnaround, x.priority, x.cpu, x.mem]);
        assert.deepEqual(plain(rows), csvRows(readFileSync(out, 'utf8')), name + ' ' + col.name);
        const mm = (() => { const m = JSON.parse(readFileSync(met, 'utf8')); return m.data || m; })();
        for (const k of ['max_wait', 'makespan', 'weighted_completion']) assert.equal(col.raw[k], mm[k], col.name + ' ' + k);
        assert.equal(col.m.maxw, mm.max_wait); assert.equal(col.m.mk, mm.makespan);
        for (const k of ['avg_wait', 'avg_turnaround', 'util_cpu', 'util_mem']) {
          if (mm[k] === null) assert.equal(col.raw[k], null, k); else assert.ok(Math.abs(col.raw[k] - mm[k]) < 1e-9, col.name + ' ' + k);
        }
      }
      const opt = R.cols.find((c) => c.bench);
      if (R.n <= 9) {
        assert.ok(opt, 'exact best present for up to 9 jobs');
        const best = Math.min(...R.cols.filter((c) => !c.bench).map((c) => c.m.totW));
        assert.ok(opt.m.totW <= best, 'the exact best total wait is never worse than a scheduler’s');
      } else { assert.equal(opt, undefined); }
    });
  }

  test('real engine: the verdict winner is the scheduler with the shortest longest wait', async () => {
    const p = await realPage();
    p.A.compare.setSource('nine');
    p.A.compare.start(); p.sched.drain();
    const R = p.A.compare.model();
    const comp = R.cols.filter((c) => !c.bench);
    const min = Math.min(...comp.map((c) => c.m.maxw));
    assert.equal(R.cols.find((c) => c.key === R.winner).m.maxw, min);
  });

  test('real engine: 5000 jobs run in slices, never one long call, and free every handle', async () => {
    const p = await realPage();
    const jobs = [];
    for (let i = 1; i <= 5000; i++) jobs.push({ id: i, arrival: Math.floor(i / 4), duration: 1 + (i % 7), cpu: 1 + (i % 3), mem: 512 * (1 + (i % 5)), priority: i % 10 });
    p.A.store.setMachine(16, 32768);
    p.A.store.setJobs(jobs);
    p.A.compare.setSource('yours');
    assert.equal(p.A.compare.start(), true);
    let slices = 0, worst = 0;
    while (p.sched.laters.length) { const t0 = Date.now(); p.sched.runLater(); worst = Math.max(worst, Date.now() - t0); slices++; }
    assert.ok(slices >= 3, 'several slices: ' + slices);
    assert.ok(worst < 2500, 'longest slice ' + worst + ' ms');
    const R = p.A.compare.model();
    assert.ok(R.cols.every((c) => c.rows.length === 5000));
    assert.equal(p.A.compare.liveHandles().length, 0);
  });
} else {
  console.log('note: web/vendor/aprm.js not built (run `make wasm`); real-engine Compare tests skipped');
}

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n' + (e && e.stack || e)); }
}
console.log(`${tests.length - failed}/${tests.length} compare-mode tests passed`);
process.exit(failed ? 1 : 0);
