// test_compare.mjs: tests for Compare mode (K-27): web/js/compare.js and the Chart.js script tag.
// Run: node tests/web/test_compare.mjs
// The real web/js scripts run in a node:vm context with a small fake DOM built from the ids in the
// real index.html. Logic tests use a fake engine behind the APRM.wasm wrapper interface and a fake
// scheduler (slices are run by hand). If web/vendor/aprm.js and build/aprm exist, the same code
// drives the real engine and every policy is compared with the console program on every preset.
// Chart.js itself is never loaded here: a fake window.Chart (or none) stands in. Optional: set
// CHARTJS_FILE=<path to the downloaded chart.umd.min.js> to also check the SRI hash against it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
class Text { constructor(t) { this._t = t; } get textContent() { return this._t; } }
class El {
  constructor(tag, id = '') {
    this.tag = tag; this.id = id; this.attrs = {}; this.children = []; this.listeners = {};
    this.hidden = false; this.value = ''; this.disabled = false; this.checked = false;
  }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.children = String(v) === '' ? [] : [new Text(String(v))]; }
  get firstChild() { return this.children[0] || null; }
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { this.children.splice(this.children.indexOf(c), 1); return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  fire(type) { for (const fn of this.listeners[type] || []) fn({ currentTarget: this, target: this }); }
  click() { this.fire('click'); }
  find(tag) { const out = []; const walk = (e) => { if (e.tag === tag) out.push(e); (e.children || []).forEach((c) => c.children && walk(c)); }; walk(this); return out; }
}
function fakeCtx() {
  const calls = [];
  return new Proxy({ fillStyle: '', strokeStyle: '', lineWidth: 1, font: '' }, {
    get(t, k) { if (k in t) return t[k]; if (k === 'calls') return calls; return (...a) => { calls.push({ op: String(k), a }); }; },
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
  return {
    head: new El('head'), byId, getElementById: (id) => byId[id] || null,
    createElement: (t) => { const e = new El(t); if (t === 'canvas') { e.ctx = fakeCtx(); e.getContext = () => e.ctx; } return e; },
    createTextNode: (t) => new Text(t),
    querySelectorAll: () => [],
  };
}

const tags = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
const cmpSrc = read('js/compare.js');
const srcs = tags.map((t) => (t.match(/\bsrc="([^"]+)"/) || [])[1]);
const localSrcs = srcs.filter((u) => !/^https?:/.test(u));

function page({ createAprm, wasm = false, Chart } = {}) {
  const doc = fakeDocument();
  const win = { document: doc, console };
  win.window = win;
  if (createAprm) win.createAprm = createAprm;
  if (Chart) win.Chart = Chart;
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
  sched.timeout = () => 1; sched.cancelTimeout = () => {};
  A.compare.setScheduler(sched);
  return { ctx, doc, A, sched, el: (id) => doc.byId[id] };
}

// ---------- a fake engine behind the wasm.js interface ----------
class EngineError extends Error {
  constructor(code, message, field) { super(message); this.name = 'EngineError'; this.code = code; this.field = field || ''; }
}
function fakeWasm({ totalSteps = 10, metrics, failStepFor, failCreateAt, metricsFor, exactTotal } = {}) {
  const f = { live: new Set(), next: 1, created: [], stepCalls: 0, sims: new Map(), destroyed: [] };
  f.create = (cpu, mem, policy, alpha, thr, eps) => {
    if (failCreateAt !== undefined && f.created.length === failCreateAt) throw new EngineError(-7, 'Out of memory.', '');
    const h = f.next++; f.live.add(h); f.created.push({ h, cpu, mem, policy, alpha, thr, eps });
    f.sims.set(h, { jobs: [], steps: 0, policy });
    return h;
  };
  f.addJob = (h, ...a) => { f.sims.get(h).jobs.push(a); return 0; };
  f.step = (h) => {
    f.stepCalls++;
    const s = f.sims.get(h);
    if (failStepFor && s.policy === failStepFor) throw new EngineError(-4, 'Bad <b>step</b>.', '');
    if (s.steps >= totalSteps) return 0;
    s.steps++; return 1;
  };
  f.metrics = (h) => (metricsFor && metricsFor(f.sims.get(h).policy)) || metrics || { avg_wait: 1.5, max_wait: 3, avg_turnaround: 4.25, weighted_completion: 10, makespan: 9, util_cpu: null, util_mem: 0.5 };
  f.exact = () => (exactTotal === undefined ? { total_wait: 3 } : exactTotal);
  f.results = (h) => f.sims.get(h).jobs.map((j, i) => ({ id: j[0], arrival: j[1], start: j[1] + i, finish: j[1] + i + j[2], wait: i, turnaround: i + j[2] }));
  f.destroy = (h) => { if (!f.live.has(h)) throw new EngineError(-1, 'Not a valid simulation handle.', 'handle'); f.live.delete(h); f.destroyed.push(h); return 0; };
  return f;
}
const JOBS = [1, 2, 3].map((i) => ({ id: i, arrival: i - 1, duration: 5, cpu: 2, mem: 1024, priority: 3 }));
function ready(opts, pageOpts) {
  const p = page(pageOpts);
  p.fe = fakeWasm(opts);
  p.A.wasm = p.fe;
  p.A.compare.mount();
  p.A.store.setJobs(JOBS.map((j) => ({ ...j })));
  return p;
}
const tableText = (p) => p.el('compare-body').children.map((tr) => tr.children.map((c) => c.textContent));

// ---------- static ----------
test('index.html has no external script; Build and Run mode make no network request', () => {
  assert.equal(tags.filter((t) => /src="(https?:)?\/\//.test(t)).length, 0);
  assert.ok(!/cdn\.jsdelivr|integrity=/i.test(html), 'no CDN reference in index.html');
});

test('compare.js pins Chart.js in one place: exact version URL, sha384 integrity', () => {
  const url = cmpSrc.match(/CHART_URL = '([^']+)'/)[1];
  const integrity = cmpSrc.match(/CHART_INTEGRITY = '([^']+)'/)[1];
  assert.match(url, /^https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js@\d+\.\d+\.\d+\/dist\/chart\.umd\.min\.js$/, 'exact version, no range or latest');
  assert.match(integrity, /^sha384-[A-Za-z0-9+/]{64}$/);
  assert.equal(cmpSrc.match(/https?:\/\//g).filter((u) => true).length, 1, 'the URL appears once');
  if (process.env.CHARTJS_FILE) {
    const digest = 'sha384-' + createHash('sha384').update(readFileSync(process.env.CHARTJS_FILE)).digest('base64');
    assert.equal(integrity, digest, 'integrity equals the hash of the downloaded file');
  }
});

test('loader: first open of Compare injects one script with integrity and crossorigin; never twice', () => {
  const p = ready();
  assert.equal(p.doc.head.children.length, 0, 'nothing injected in Build mode');
  p.A.store.setMode('run');
  assert.equal(p.doc.head.children.length, 0, 'nothing injected in Run mode');
  p.A.store.setMode('compare');
  assert.equal(p.doc.head.children.length, 1);
  const el = p.doc.head.children[0];
  assert.equal(el.tag, 'script');
  assert.equal(el.getAttribute('src'), p.A.compare.CHART_URL);
  assert.equal(el.getAttribute('integrity'), p.A.compare.CHART_INTEGRITY);
  assert.equal(el.getAttribute('crossorigin'), 'anonymous');
  assert.equal(p.A.compare.chartState(), 'loading');
  p.A.store.setMode('build'); p.A.store.setMode('compare');
  p.A.compare.setSelected(['fcfs', 'aging']); p.A.compare.start(); p.sched.drain();
  assert.equal(p.doc.head.children.length, 1, 'still one script');
  assert.match(p.el('compare-chart-note').textContent, /still loading/);
  assert.equal(p.el('compare-table-wrap').hidden, false);
});

test('loader: onload draws the charts; onerror falls back to the table and never retries', () => {
  const made = [];
  const p = ready();
  p.A.store.setMode('compare');
  p.A.compare.setSelected(['fcfs', 'aging']); p.A.compare.start(); p.sched.drain();
  p.ctx.Chart = class { constructor() { made.push(this); } destroy() {} };
  p.doc.head.children[0].onload();
  assert.equal(p.A.compare.chartState(), 'loaded');
  assert.equal(made.length, 4);

  const q = ready();
  q.A.store.setMode('compare');
  q.A.compare.setSelected(['fcfs', 'aging']); q.A.compare.start(); q.sched.drain();
  q.doc.head.children[0].onerror();
  assert.equal(q.A.compare.chartState(), 'failed');
  assert.match(q.el('compare-chart-note').textContent, /could not load/);
  assert.equal(q.el('compare-error').hidden, true);
  for (let i = 0; i < 5; i++) { q.A.store.setMode('build'); q.A.store.setMode('compare'); q.A.compare.start(); q.sched.drain(); }
  assert.equal(q.doc.head.children.length, 1, 'a failed load is not retried');
  assert.equal(tableText(q).length, 2);
});

test('loader: a load that never finishes times out into the fallback', () => {
  const p = ready();
  const timers = [];
  p.A.compare.setScheduler({ timeout: (fn) => { timers.push(fn); return timers.length; }, cancelTimeout: () => {} });
  p.A.store.setMode('compare');
  p.A.compare.setSelected(['fcfs', 'aging']); p.A.compare.start(); p.sched.drain();
  assert.equal(timers.length, 1);
  timers[0]();
  assert.equal(p.A.compare.chartState(), 'failed');
  assert.match(p.el('compare-chart-note').textContent, /could not load/);
});

test('leaving Compare mode destroys the charts', () => {
  const made = [];
  class FakeChart { constructor() { this.d = false; made.push(this); } destroy() { this.d = true; } }
  const p = ready({}, { Chart: FakeChart });
  p.A.store.setMode('compare');
  p.A.compare.setSelected(['fcfs', 'aging']); p.A.compare.start(); p.sched.drain();
  assert.equal(made.length, 4);
  p.A.store.setMode('run');
  assert.ok(made.every((c) => c.d));
});

test('compare.js and index.html: no innerHTML, eval, Function, fetch, inline handlers, modules', () => {
  for (const f of ['js/compare.js', 'index.html']) {
    const t = read(f);
    for (const re of [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /\beval\s*\(/, /new\s+Function/, /\bfetch\s*\(/, /XMLHttpRequest/, /document\.write/, /\bon[a-z]+\s*=\s*["']/i, /type="module"/]) {
      assert.ok(!re.test(t), `${re} in ${f}`);
    }
  }
});

test('compare.js attaches only to window.APRM', () => {
  const { ctx } = page();
  assert.deepEqual(plain(Object.getOwnPropertyNames(ctx).filter((k) => !['document', 'console', 'window', 'APRM'].includes(k))), []);
  assert.ok(ctx.APRM.compare);
});

test('mount builds the policy boxes; knapsack is listed and enabled; the panel follows the mode', () => {
  const p = ready();
  const boxes = p.el('compare-policies').children;
  assert.equal(boxes.length, 6);
  const inputs = boxes.map((l) => l.firstChild);
  const knap = inputs.find((i) => i.getAttribute('data-policy') === 'knapsack');
  assert.equal(knap.disabled, false);
  assert.equal(knap.checked, false);
  assert.doesNotMatch(boxes[5].textContent, /not implemented/);
  assert.match(boxes[5].textContent, /knapsack/);
  p.A.store.setMode('compare');
  assert.equal(p.el('compare-panel').hidden, false);
  p.A.store.setMode('build');
  assert.equal(p.el('compare-panel').hidden, true);
  assert.deepEqual(plain(p.A.compare.setSelected(['knapsack', 'sjf', 'fcfs'])), ['fcfs', 'sjf', 'knapsack'], 'knapsack can be selected');
  assert.deepEqual(plain(p.A.compare.setSelected(['bogus', 'sjf'])), ['sjf'], 'unknown policies are ignored');
});

// ---------- running ----------
test('every ticked policy gets one handle with identical machine, settings and jobs; all handles destroyed at the end', () => {
  const p = ready();
  p.A.store.setMachine(8, 4096);
  p.A.store.setSettings({ alphaMilli: 250, threshold: 77, eps: 0.2 });
  p.A.compare.setSelected(['fcfs', 'sjf', 'aging', 'aging_reserve']);
  assert.equal(p.A.compare.start(), true);
  assert.equal(p.A.compare.snapshot().status, 'running');
  assert.deepEqual(plain(p.fe.created.map((c) => c.policy)), ['fcfs', 'sjf', 'aging', 'aging_reserve']);
  for (const c of p.fe.created) assert.deepEqual([c.cpu, c.mem, c.alpha, c.thr, c.eps], [8, 4096, 250, 77, 0.2]);
  const jobsOf = (h) => JSON.stringify(p.fe.sims.get(h).jobs);
  assert.equal(new Set(p.fe.created.map((c) => jobsOf(c.h))).size, 1, 'identical jobs, same order');
  assert.equal(p.fe.sims.get(1).jobs.length, 3);
  assert.equal(p.A.compare.liveHandles().length, 4);
  p.sched.drain();
  const snap = p.A.compare.snapshot();
  assert.equal(snap.status, 'done');
  assert.equal(p.fe.live.size, 0, 'no handle leaks');
  assert.equal(p.A.compare.liveHandles().length, 0);
  assert.equal(snap.columns.length, 4);
});

test('slices: no more than SLICE_STEPS steps per handle per callback', () => {
  const p = ready({ totalSteps: 1234 });
  p.A.compare.setSelected(['fcfs', 'sjf']);
  p.A.compare.start();
  const per = [];
  while (p.sched.laters.length) { const b = p.fe.stepCalls; p.sched.runLater(); per.push(p.fe.stepCalls - b); }
  assert.ok(per.every((n) => n <= 2 * p.A.compare.SLICE_STEPS), String(per));
  assert.ok(per.length >= 3);
  assert.equal(p.A.compare.snapshot().status, 'done');
});

test('re-running many times never leaks handles (limit is 4096)', () => {
  const p = ready();
  p.A.compare.setSelected(['fcfs', 'priority', 'sjf', 'aging', 'aging_reserve']);
  for (let i = 0; i < 30; i++) { p.A.compare.start(); if (i % 3 === 0) p.sched.drain(); }
  p.sched.drain();
  assert.equal(p.fe.live.size, 0);
  assert.equal(p.A.compare.snapshot().status, 'done');
});

test('cancel (and leaving Compare mode) mid-run destroys all handles and stops the slices', () => {
  const p = ready({ totalSteps: 5000 });
  p.A.store.setMode('compare');
  p.A.compare.setSelected(['fcfs', 'aging']);
  p.A.compare.start();
  p.sched.runLater();
  assert.equal(p.fe.live.size, 2);
  p.A.store.setMode('run');
  assert.equal(p.fe.live.size, 0);
  assert.equal(p.sched.laters.length, 0);
  assert.equal(p.A.compare.snapshot().status, 'idle');
});

test('fewer than two policies or no jobs: a message, no engine call', () => {
  const p = ready();
  p.A.compare.setSelected(['fcfs']);
  assert.equal(p.A.compare.start(), false);
  assert.match(p.el('compare-error').textContent, /at least two/i);
  assert.equal(p.el('compare-error').hidden, false);
  assert.equal(p.fe.created.length, 0);
  p.A.compare.setSelected(['fcfs', 'sjf']);
  p.A.store.setJobs([]);
  assert.equal(p.A.compare.start(), false);
  assert.match(p.el('compare-error').textContent, /no jobs/i);
  assert.equal(p.fe.created.length, 0);
  assert.equal(p.el('compare-empty').hidden, false);
});

test('engine error on create or step: shown as plain text, every handle destroyed', () => {
  let p = ready({ failCreateAt: 1 });
  p.A.compare.setSelected(['fcfs', 'sjf', 'aging']);
  assert.equal(p.A.compare.start(), false);
  assert.equal(p.A.compare.snapshot().status, 'error');
  assert.equal(p.el('compare-error').textContent, 'Out of memory.');
  assert.equal(p.fe.live.size, 0);

  p = ready({ failStepFor: 'sjf' });
  p.A.compare.setSelected(['fcfs', 'sjf', 'aging']);
  assert.equal(p.A.compare.start(), true);
  p.sched.drain();
  assert.equal(p.A.compare.snapshot().status, 'error');
  assert.equal(p.el('compare-error').textContent, 'Bad <b>step</b>.', 'text, never markup');
  assert.equal(p.fe.live.size, 0);
  assert.equal(p.sched.laters.length, 0);
  assert.equal(p.el('compare-table-wrap').hidden, true);
});

// ---------- drawing ----------
test('metrics table: one row per policy, numbers as the engine gave them, nulls as an em dash', () => {
  const p = ready();
  p.A.compare.setSelected(['fcfs', 'aging']);
  p.A.compare.start(); p.sched.drain();
  assert.equal(p.el('compare-table-wrap').hidden, false);
  assert.equal(p.el('compare-empty').hidden, true);
  const head = p.el('compare-head').children[0].children.map((c) => c.textContent);
  assert.equal(head.length, 1 + p.A.compare.METRIC_COLUMNS.length);
  const rows = tableText(p);
  assert.equal(rows.length, 2);
  assert.deepEqual(plain(rows[0]), ['First come, first served (FCFS)', '1.500', '3', '4.250', '10', '9', '—', '0.500']);
  assert.equal(rows[1][0], 'Aging');
  assert.match(p.el('compare-exact').textContent, /^Exact best order \(up to 9 jobs\): total wait 3\./);
  assert.equal(p.el('compare-exact').hidden, false);
});

test('verdict, best marks and the exact line come from the engine numbers', () => {
  const m = (makespan, avg, util) => ({ avg_wait: avg, max_wait: 3, avg_turnaround: 4, weighted_completion: 10, makespan, util_cpu: util, util_mem: 0.5 });
  const p = ready({ metricsFor: (policy) => (policy === 'fcfs' ? m(20, 2.5, 0.4) : m(15, 1.5, 0.6)), exactTotal: { total_wait: 1 } });
  p.A.compare.setSelected(['fcfs', 'aging']);
  p.A.compare.start(); p.sched.drain();
  assert.equal(p.el('compare-verdict').hidden, false);
  assert.equal(p.el('compare-verdict').textContent, 'Aging finished everything first, at tick 15. First come, first served (FCFS) took 5 ticks longer.');
  const rows = p.el('compare-body').children;          // fcfs row, aging row
  const col = (r, i) => rows[r].children[i];
  assert.equal(col(1, 1).getAttribute('data-best'), 'Best');        // avg_wait: lower is better
  assert.equal(col(0, 1).getAttribute('data-best'), null);
  assert.equal(col(1, 6).getAttribute('data-best'), 'Best');        // cpu utilization: higher is better
  assert.equal(col(1, 2).getAttribute('data-best'), null, 'equal values are not marked');
  assert.equal(col(1, 1).textContent, '1.500', 'the cell text is still the engine number');
  assert.match(p.el('compare-exact').textContent, /total wait 1\./);
  assert.match(p.el('compare-exact').textContent, /Aging is 2 above it\./);
});

test('verdict: a tie is named, and more than nine jobs skips the exact solver', () => {
  const p = ready();
  p.A.compare.setSelected(['fcfs', 'aging']);
  p.A.compare.start(); p.sched.drain();
  assert.match(p.el('compare-verdict').textContent, /tied for first, finishing at tick 9\.$/);
  const many = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, arrival: 0, duration: 1, cpu: 1, mem: 1, priority: 1 }));
  p.A.store.setJobs(many);
  p.A.compare.start(); p.sched.drain();
  assert.equal(p.el('compare-exact').textContent, 'The exact best order is only worked out for 9 jobs or fewer.');
});

test('verdict: no sentence when one column has no makespan; plural names; singular tick', () => {
  const m = (makespan) => ({ avg_wait: 1, max_wait: 1, avg_turnaround: 1, weighted_completion: 1, makespan, util_cpu: 0.5, util_mem: 0.5 });
  let p = ready({ metricsFor: (policy) => (policy === 'fcfs' ? m(null) : m(10)) });
  p.A.compare.setSelected(['fcfs', 'aging']); p.A.compare.start(); p.sched.drain();
  assert.equal(p.el('compare-verdict').hidden, true);
  p = ready({ metricsFor: (policy) => (policy === 'aging' ? m(10) : m(11)) });
  p.A.compare.setSelected(['fcfs', 'sjf', 'aging']); p.A.compare.start(); p.sched.drain();
  assert.equal(p.el('compare-verdict').textContent, 'Aging finished everything first, at tick 10. First come, first served (FCFS) and Shortest job first (SJF) took 1 tick longer.');
});

test('timelines: one canvas per policy, drawn with the same time scale', () => {
  const p = ready();
  p.A.compare.setSelected(['fcfs', 'sjf', 'aging']);
  p.A.compare.start(); p.sched.drain();
  const canvases = p.el('compare-timelines').find('canvas');
  assert.equal(canvases.length, 3);
  for (const cv of canvases) assert.ok(cv.ctx.calls.filter((c) => c.op === 'fillRect').length >= 3, 'bars drawn');
  assert.equal(p.A.compare.snapshot().tmax, 9);
  for (const cv of canvases) assert.equal(cv.__layout.tmax, 9, 'every board uses the shared time scale');
  assert.ok(!canvases[0].ctx.calls.some((c) => c.op === 'fillText' && String(c.a[0]).startsWith('now ')), 'a finished board has no now rail');
  assert.ok(canvases[0].ctx.calls.some((c) => c.op === 'fillText' && c.a[0] === 'finished 9'), 'it marks where it ended');
  const cells = p.el('compare-body').children[0].children;
  assert.equal(cells[1].getAttribute('data-label'), 'Average wait', 'every number keeps its name on a phone');
});

test('charts: with Chart.js present, one bar chart per key metric; old charts destroyed on re-run', () => {
  const made = [];
  class FakeChart { constructor(cv, cfg) { this.cfg = cfg; this.destroyed = false; made.push(this); } destroy() { this.destroyed = true; } }
  const p = ready({}, { Chart: FakeChart });
  p.A.compare.setSelected(['fcfs', 'aging']);
  p.A.compare.start(); p.sched.drain();
  assert.equal(made.length, 4);
  assert.ok(made.every((c) => c.cfg.type === 'bar' && c.cfg.data.labels.length === 2));
  assert.equal(p.el('compare-chart-note').hidden, true);
  p.A.compare.start();
  assert.ok(made.every((c) => c.destroyed), 'destroyed when a new comparison starts');
  p.sched.drain();
  assert.equal(made.length, 8);
  assert.equal(p.el('compare-table-wrap').hidden, false);
});

test('Chart.js missing or blocked (offline, wrong integrity): table and timelines still shown, a note explains', () => {
  const p = ready();                               // no window.Chart at all
  p.A.compare.setSelected(['fcfs', 'aging']);
  p.A.compare.start(); p.sched.drain();
  p.doc.head.children[0].onerror();                // the browser reports the blocked or failed load
  assert.equal(p.A.compare.snapshot().status, 'done');
  assert.equal(p.A.compare.snapshot().error, '');
  assert.equal(p.el('compare-error').hidden, true, 'not an error');
  assert.equal(p.el('compare-table-wrap').hidden, false);
  assert.equal(tableText(p).length, 2);
  assert.equal(p.el('compare-chart-note').hidden, false);
  assert.match(p.el('compare-chart-note').textContent, /Charts could not load/);
  assert.equal(p.el('compare-charts').children.length, 0);
  assert.equal(p.el('compare-timelines').find('canvas').length, 2);
});

test('Chart.js that throws: fall back to the table, not an error state', () => {
  class Broken { constructor() { throw new Error('boom'); } }
  const p = ready({}, { Chart: Broken });
  p.A.compare.setSelected(['fcfs', 'aging']);
  p.A.compare.start(); p.sched.drain();
  assert.equal(p.A.compare.snapshot().status, 'done');
  assert.equal(p.el('compare-chart-note').hidden, false);
  assert.match(p.el('compare-chart-note').textContent, /could not be drawn \(boom\)/);
  assert.equal(p.el('compare-charts').children.length, 0);
  assert.equal(tableText(p).length, 2);
});

test('changing the jobs after a comparison marks it as out of date', () => {
  const p = ready();
  p.A.compare.setSelected(['fcfs', 'aging']);
  p.A.compare.start(); p.sched.drain();
  p.A.store.setJobs([]);
  assert.equal(p.A.compare.snapshot().stale, true);
  assert.match(p.el('compare-status').textContent, /changed since/);
});

// ---------- the real engine ----------
const vendor = join(web, 'vendor', 'aprm.js');
const cli = join(root, 'build', 'aprm');
if (existsSync(vendor) && readFileSync(vendor).length > 0) {
  const createAprm = require(vendor);
  const realPage = async (opts = {}) => {
    const p = page({ createAprm, wasm: true, ...opts });
    await p.A.wasm.init();
    p.A.compare.mount();
    return p;
  };
  const csvRows = (text) => text.trim().split('\n').slice(1).map((l) => l.split(',').map(Number));
  const ALL = ['fcfs', 'priority', 'sjf', 'aging', 'aging_reserve'];
  const cliName = (n) => (n === 'aging_reserve' ? 'reserve' : n);
  const presetNames = ['big_job_trap', 'heavy_load', 'memory_hog', 'priority_starvation', 'sjf_starvation', 'tiny_case'];

  for (const name of presetNames) {
    test('real engine: preset ' + name + ', all five policies side by side equal the console program', async () => {
      const p = await realPage();
      const preset = p.A.presets.load(name);
      assert.ok(preset, 'preset exists');
      p.A.compare.setSelected(ALL);
      assert.equal(p.A.compare.start(), true, p.A.compare.snapshot().error);
      p.sched.drain();
      const snap = p.A.compare.snapshot();
      assert.equal(snap.status, 'done', snap.error);
      assert.equal(snap.columns.length, 5);
      assert.equal(p.A.compare.liveHandles().length, 0);
      assert.throws(() => p.A.wasm.state(1), 'handle 1 really is destroyed');
      if (!existsSync(cli)) { console.log('note: build/aprm missing; differential comparison skipped'); return; }
      const dir = mkdtempSync(join(tmpdir(), 'k27-'));
      for (const col of snap.columns) {
        const out = join(dir, col.policy + '.csv'); const met = join(dir, col.policy + '.json');
        const r = spawnSync(cli, ['--policy', cliName(col.policy), '--in', join(root, 'data', 'presets', name + '.csv'), '--out', out, '--metrics', met,
          '--cpu', String(preset.cpu_cap), '--mem', String(preset.mem_cap), '--alpha-milli', String(preset.alpha_milli), '--threshold', String(preset.threshold)]);
        assert.equal(r.status, 0, String(r.stderr));
        const rows = col.rows.map((x) => [x.id, x.arrival, x.start, x.finish, x.wait, x.turnaround, x.priority, x.cpu, x.mem]);
        assert.deepEqual(plain(rows), csvRows(readFileSync(out, 'utf8')), name + ' ' + col.policy);
        const m = JSON.parse(readFileSync(met, 'utf8')); const mm = m.data || m;
        for (const k of ['max_wait', 'makespan', 'weighted_completion']) assert.equal(col.metrics[k], mm[k], col.policy + ' ' + k);
        for (const k of ['avg_wait', 'avg_turnaround', 'util_cpu', 'util_mem']) {
          if (mm[k] === null) assert.equal(col.metrics[k], null, k); else assert.ok(Math.abs(col.metrics[k] - mm[k]) < 1e-9, col.policy + ' ' + k);
        }
      }
      // the table text shows the engine's numbers for the first policy
      const first = snap.columns[0];
      const cells = p.el('compare-body').children[0].children.map((c) => c.textContent);
      assert.equal(cells[5], String(first.metrics.makespan));
      // all five timelines were drawn, and all columns used the identical jobs
      assert.equal(p.el('compare-timelines').find('canvas').length, 5);
      for (const col of snap.columns) assert.deepEqual(plain(col.rows.map((x) => [x.id, x.arrival])).sort(), plain(snap.columns[0].rows.map((x) => [x.id, x.arrival])).sort());
    });
  }

  test('real engine: a single job compares cleanly', async () => {
    const p = await realPage();
    p.A.store.setJobs([{ id: 1, arrival: 0, duration: 4, cpu: 1, mem: 1024, priority: 5 }]);
    p.A.compare.setSelected(['fcfs', 'sjf']);
    p.A.compare.start(); p.sched.drain();
    assert.equal(p.A.compare.snapshot().status, 'done');
    assert.equal(p.A.compare.snapshot().columns[0].metrics.makespan, 4);
  });

  test('real engine: 5000 jobs under five policies run in slices, never one long call, and free every handle', async () => {
    const p = await realPage();
    const jobs = [];
    for (let i = 1; i <= 5000; i++) jobs.push({ id: i, arrival: Math.floor(i / 4), duration: 1 + (i % 7), cpu: 1 + (i % 3), mem: 512 * (1 + (i % 5)), priority: i % 10 });
    p.A.store.setMachine(16, 32768);
    p.A.store.setJobs(jobs);
    p.A.compare.setSelected(ALL);
    assert.equal(p.A.compare.start(), true, p.A.compare.snapshot().error);
    let slices = 0, worst = 0;
    while (p.sched.laters.length) { const t0 = Date.now(); p.sched.runLater(); worst = Math.max(worst, Date.now() - t0); slices++; }
    assert.ok(slices >= 3, 'several slices: ' + slices);
    assert.ok(worst < 1000, 'longest slice ' + worst + ' ms');
    const snap = p.A.compare.snapshot();
    assert.equal(snap.status, 'done', snap.error);
    assert.equal(snap.columns.every((c) => c.rows.length === 5000), true);
    assert.equal(p.A.compare.liveHandles().length, 0);
    for (let h = 1; h <= 5; h++) assert.throws(() => p.A.wasm.state(h));
    // creating again still works: handles were really released
    assert.equal(p.A.compare.start(), true);
    p.sched.drain();
  });
} else {
  console.log('note: web/vendor/aprm.js not built (run `make wasm`); real-engine Compare mode tests skipped');
}

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n' + (e && e.stack || e)); }
}
console.log(`${tests.length - failed}/${tests.length} compare-mode tests passed`);
process.exit(failed ? 1 : 0);
