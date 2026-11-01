// test_player.mjs: tests for Run mode (K-25): player.js, canvas.js, whylog.js.
// Run: node tests/web/test_player.mjs
// The real web/js scripts run in a node:vm context with a small fake DOM built from the ids in
// the real index.html. Logic tests use a fake engine behind the APRM.wasm wrapper interface and a
// fake scheduler (frames and slices are run by hand). If web/vendor/aprm.js and build/aprm exist,
// the same player drives the real engine and its results are compared with the console program.
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
const plain = (x) => JSON.parse(JSON.stringify(x));   // vm objects have another realm's prototypes
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------- fake DOM ----------
class Text { constructor(t) { this._t = t; } get textContent() { return this._t; } }
class El {
  constructor(tag, id = '') {
    this.tag = tag; this.id = id; this.attrs = {}; this.children = []; this.listeners = {};
    this.hidden = false; this.value = ''; this.disabled = false;
  }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.children = String(v) === '' ? [] : [new Text(String(v))]; }
  get firstChild() { return this.children[0] || null; }
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { this.children.splice(this.children.indexOf(c), 1); return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  fire(type, ev = {}) { for (const fn of this.listeners[type] || []) fn({ currentTarget: this, target: this, ...ev }); }
  click() { this.fire('click'); }
}

// A recording 2D context: every method call is kept, fillStyle at the time of each fillRect too.
function fakeCtx() {
  const calls = [];
  const ctx = new Proxy({ fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textBaseline: '' }, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'calls') return calls;
      return (...a) => { calls.push({ op: String(k), a, fill: t.fillStyle }); };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return ctx;
}

function fakeDocument() {
  const byId = {};
  for (const m of html.matchAll(/<([a-z0-9]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const el = new El(m[1], m[2]);
    if (/\bhidden\b/.test(m[0])) el.hidden = true;
    const v = m[0].match(/\bvalue="([^"]*)"/);
    if (v) el.value = v[1];
    byId[m[2]] = el;
  }
  const cv = byId['run-canvas'];
  cv.clientWidth = 800; cv.width = 640; cv.height = 420;
  cv.ctx = fakeCtx();
  cv.getContext = () => cv.ctx;
  cv.getBoundingClientRect = () => ({ left: 0, top: 0 });
  return {
    byId, getElementById: (id) => byId[id] || null,
    createElement: (t) => new El(t), createTextNode: (t) => new Text(t),
    querySelectorAll: () => [],
  };
}

const srcs = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^https?:/.test(u));

// Real scripts except vendor and app.js; mount() is called by hand like app.js does.
function page({ createAprm, wasm = false } = {}) {
  const doc = fakeDocument();
  const win = { document: doc, console };
  win.window = win;
  if (createAprm) win.createAprm = createAprm;
  const ctx = vm.createContext(win);
  for (const s of srcs) {
    if (s.startsWith('vendor/') || s === 'js/app.js') continue;
    if (s === 'js/wasm.js' && !wasm) continue;
    vm.runInContext(read(s), ctx, { filename: s });
  }
  const A = ctx.APRM;
  const sched = fakeScheduler();
  A.player.setScheduler(sched);
  return { ctx, doc, A, sched, canvas: doc.byId['run-canvas'] };
}

function fakeScheduler() {
  const s = { frames: [], laters: [], cancelledFrames: 0, cancelledLaters: 0 };
  s.frame = (fn) => { s.frames.push(fn); return s.frames.length; };
  s.cancelFrame = () => { s.cancelledFrames++; s.frames.length = 0; };
  s.later = (fn) => { s.laters.push(fn); return s.laters.length; };
  s.cancelLater = () => { s.cancelledLaters++; s.laters.length = 0; };
  s.runFrame = () => { const f = s.frames.shift(); assert.ok(f, 'a frame is scheduled'); f(); };
  s.runLater = () => { const f = s.laters.shift(); assert.ok(f, 'a slice is scheduled'); f(); };
  return s;
}

// ---------- a fake engine behind the wasm.js interface ----------
class EngineError extends Error {
  constructor(code, message, field) { super(message); this.name = 'EngineError'; this.code = code; this.field = field || ''; }
}
function fakeWasm({ totalSteps = 10, msg } = {}) {
  const f = { live: new Set(), next: 1, destroyed: [], created: 0, stepCalls: 0, logSince: [], sims: new Map(), failCreate: false };
  f.create = (...args) => {
    if (f.failCreate) throw new EngineError(-2, 'cpu must be 1 to 1000000.', 'cpu');
    const h = f.next++; f.live.add(h); f.created++; f.args = args;
    f.sims.set(h, { jobs: [], steps: 0 });
    return h;
  };
  f.destroy = (h) => { if (!f.live.has(h)) throw new EngineError(-1, 'Not a valid simulation handle.', 'handle'); f.live.delete(h); f.destroyed.push(h); return 0; };
  f.addJob = (h, id, arrival) => {
    const s = f.sims.get(h);
    if (s.jobs.some((j) => j.id === id)) throw new EngineError(-5, 'Job id ' + id + ' already exists.', 'id');
    if (arrival < s.steps) throw new EngineError(-4, 'Arrival ' + arrival + ' is before current time ' + s.steps + '.', 'arrival');
    s.jobs.push({ id, arrival });
    return 0;
  };
  f.step = (h) => {
    f.stepCalls++;
    const s = f.sims.get(h);
    if (s.steps >= totalSteps) return 0;
    s.steps++; return 1;
  };
  f.state = (h) => {
    const s = f.sims.get(h);
    return { now: s.steps, done: Math.floor(s.steps / 3), total: s.jobs.length, cap: { cpu: 16, mem: 32768 }, free: { cpu: 4, mem: 8192 },
      waiting: [{ id: 7, score: 6.2, priority: 2, arrival: 0, duration: 30, cpu: 8, mem: 20480 }, { id: 8, score: 5, priority: 5, arrival: 1, duration: 3, cpu: 1, mem: 10 }],
      running: [{ id: 1, start: 0, finish: 5, cpu: 8, mem: 4096 }, { id: 2, start: 1, finish: 9, cpu: 4, mem: 8192 }],
      reservation: s.steps >= 2 ? { id: 7, shadow_time: 9 } : null };
  };
  f.log = (h, since) => {
    f.logSince.push(since);
    const s = f.sims.get(h);
    const out = [];
    for (let q = since + 1; q <= s.steps; q++) out.push({ seq: q, t: q, kind: q % 2 ? 'START' : 'SKIP', job: (q % 2) + 1, msg: msg || ('event ' + q + ' for job ' + ((q % 2) + 1)) });
    return out;
  };
  f.metrics = () => ({ avg_wait: 1.5, max_wait: 3, avg_turnaround: 4.25, weighted_completion: 10, makespan: 9, util_cpu: null, util_mem: 0.5 });
  return f;
}

const JOBS = [1, 2, 3].map((i) => ({ id: i, arrival: 0, duration: 5, cpu: 2, mem: 1024, priority: 3 }));
function ready(opts) {
  const p = page();
  p.fe = fakeWasm(opts);
  p.A.wasm = p.fe;
  p.A.whylog.mount();
  p.A.player.mount();
  p.A.store.setJobs(JOBS.map((j) => ({ ...j })));
  return p;
}

// ---------- static ----------
test('index.html has canvas, whylog, player before app.js in PRD order', () => {
  const i = (n) => srcs.indexOf(n);
  assert.ok(i('js/canvas.js') > i('js/generator.js') && i('js/canvas.js') < i('js/whylog.js'));
  assert.ok(i('js/whylog.js') < i('js/player.js') && i('js/player.js') < i('js/app.js'));
});

// ---------- player state machine ----------
test('state machine: idle -> paused -> playing -> paused -> finished -> reset', () => {
  const p = ready({ totalSteps: 6 });
  const P = p.A.player;
  assert.equal(P.snapshot().status, 'idle');
  assert.equal(P.play(), false, 'cannot play without a run');
  assert.equal(P.start(), true);
  assert.equal(P.snapshot().status, 'paused');
  assert.equal(p.fe.created, 1);
  assert.equal(p.doc.byId['run-play'].disabled, false);
  assert.equal(P.play(), true);
  assert.equal(P.snapshot().status, 'playing');
  assert.equal(p.doc.byId['run-play'].textContent, 'Pause');
  assert.equal(p.sched.frames.length, 1);
  p.sched.runFrame();                       // speed 1: one step
  assert.equal(P.snapshot().events, 1);
  assert.equal(p.sched.frames.length, 1, 'next frame scheduled');
  assert.equal(P.pause(), true);
  assert.equal(P.snapshot().status, 'paused');
  assert.equal(p.sched.frames.length, 0, 'frame cancelled');
  assert.equal(P.stepOnce(), true);
  assert.equal(P.snapshot().events, 2);
  P.setSpeed(100);
  P.play();
  p.sched.runFrame();                       // only 4 steps remain, then the engine says finished
  assert.equal(P.snapshot().status, 'finished');
  assert.equal(P.snapshot().events, 6);
  assert.equal(p.sched.frames.length, 0);
  assert.equal(P.play(), false);
  P.reset();
  assert.equal(P.snapshot().status, 'idle');
  assert.equal(p.fe.live.size, 0);
  assert.equal(p.doc.byId['canvas-empty'].hidden, false);
});

test('start with no jobs shows an empty-state message, no engine call', () => {
  const p = ready();
  p.A.store.setJobs([]);
  assert.equal(p.A.player.start(), false);
  assert.equal(p.fe.created, 0);
  assert.match(p.doc.byId['run-error'].textContent, /no jobs/i);
});

test('engine error on create is shown next to the Run button, nothing leaks', () => {
  const p = ready();
  p.fe.failCreate = true;
  assert.equal(p.A.player.start(), false);
  assert.equal(p.A.player.snapshot().status, 'error');
  assert.equal(p.doc.byId['run-error'].textContent, 'cpu: cpu must be 1 to 1000000.');
  assert.equal(p.doc.byId['run-error'].hidden, false);
  assert.equal(p.fe.live.size, 0);
});

test('step cap: a frame never runs more than MAX_STEPS_PER_FRAME steps', () => {
  const p = ready({ totalSteps: 100000 });
  const P = p.A.player;
  assert.equal(P.setSpeed(1e9), P.MAX_STEPS_PER_FRAME);
  assert.equal(P.setSpeed(0), 1);
  assert.equal(P.setSpeed(-5), 1);
  assert.equal(P.setSpeed('abc'), 1);
  P.setSpeed(1e9);
  P.start(); P.play();
  const before = p.fe.stepCalls;
  p.sched.runFrame();
  assert.equal(p.fe.stepCalls - before, P.MAX_STEPS_PER_FRAME);
  assert.equal(P.snapshot().events, P.MAX_STEPS_PER_FRAME);
});

test('jump to end runs in slices through the scheduler, each at most SLICE_STEPS', () => {
  const p = ready({ totalSteps: 1234 });
  const P = p.A.player;
  P.start();
  const base = p.fe.stepCalls;
  assert.equal(P.jumpToEnd(), true);
  assert.equal(P.snapshot().status, 'jumping');
  assert.equal(p.fe.stepCalls, base, 'nothing runs inside jumpToEnd itself');
  const slices = [];
  while (p.sched.laters.length) {
    const b = p.fe.stepCalls;
    p.sched.runLater();
    slices.push(p.fe.stepCalls - b);
  }
  assert.deepEqual(plain(slices), [500, 500, 235]);          // 234 events, then the call that says finished
  assert.ok(slices.every((n) => n <= P.SLICE_STEPS));
  assert.equal(P.snapshot().status, 'finished');
  assert.equal(P.snapshot().events, 1234);
  assert.equal(p.sched.frames.length, 0);
});

test('pause during a jump cancels the remaining slices', () => {
  const p = ready({ totalSteps: 5000 });
  const P = p.A.player;
  P.start(); P.jumpToEnd(); p.sched.runLater();
  assert.equal(P.pause(), true);
  assert.equal(p.sched.laters.length, 0);
  assert.equal(P.snapshot().status, 'paused');
  assert.equal(P.snapshot().events, 500);
});

test('log: entries are pulled with since = last seq, never twice, shown as text', () => {
  const p = ready({ totalSteps: 10, msg: '<img src=x onerror=alert(1)>' });
  const P = p.A.player;
  P.start();
  P.stepOnce(); P.stepOnce();
  P.setSpeed(3); P.play(); p.sched.runFrame();
  assert.deepEqual(plain(p.fe.logSince), [0, 0, 1, 2]);         // start, step 1, step 2, a 3-step frame
  const e = P.snapshot().entries;
  assert.deepEqual(plain(e.map((x) => x.seq)), [1, 2, 3, 4, 5]);
  const list = p.doc.byId['whylog-list'];
  assert.equal(list.children.length, 5);
  const line = list.children[0].children;
  assert.equal(line.length, 3, 'a plain kind label, the raw kind, and the engine sentence');
  assert.equal(line[2].constructor.name, 'Text', 'the engine sentence is a text node, never parsed markup');
  assert.equal(line[2].textContent, 't=1: <img src=x onerror=alert(1)>');
  assert.equal(line[1].textContent, 'START');
  assert.equal(line[0].textContent, 'Started');
});

test('why log: only the newest MAX_ROWS rows exist as page elements', () => {
  const p = ready({ totalSteps: 5000 });
  p.A.player.start(); p.A.player.jumpToEnd();
  while (p.sched.laters.length) p.sched.runLater();
  assert.equal(p.A.player.snapshot().entries.length, 5000);
  assert.equal(p.doc.byId['whylog-list'].children.length, p.A.whylog.MAX_ROWS);
});

test('selecting a job filters the log, highlights in canvas and job list; click again clears', () => {
  const p = ready({ totalSteps: 8 });
  const P = p.A.player;
  P.start();
  p.doc.byId['job-list'].children = JOBS.map((j) => { const li = new El('li'); li.textContent = 'Job ' + j.id + ': arrives 0'; return li; });
  P.setSpeed(8); P.play(); p.sched.runFrame();
  assert.equal(p.doc.byId['whylog-list'].children.length, 8);
  P.select(2);
  const rows = p.doc.byId['whylog-list'].children;
  assert.ok(rows.length > 0 && rows.length < 8);
  assert.ok(rows.every((r) => r.getAttribute('data-job') === '2'));
  assert.match(p.doc.byId['whylog-filter'].textContent, /job 2/);
  assert.equal(p.doc.byId['whylog-clear'].hidden, false);
  assert.equal(p.doc.byId['job-list'].children[1].getAttribute('class'), 'sel');
  assert.equal(p.doc.byId['job-list'].children[0].getAttribute('class'), '');
  // canvas draws a highlight (a stroked rectangle) for the selected running job
  const ctx = p.canvas.ctx; ctx.calls.length = 0;
  P.select(2);
  assert.ok(ctx.calls.some((c) => c.op === 'strokeRect' && c.a[2] > 0), 'selected job outlined');
  // clicking a log line selects its job; the clear button resets
  p.doc.byId['whylog-list'].fire('click', { target: rows[0] });
  assert.equal(P.snapshot().selected, 2);
  p.doc.byId['whylog-clear'].click();
  assert.equal(P.snapshot().selected, null);
  assert.equal(p.doc.byId['whylog-list'].children.length, 8);
});

test('destroy-on-rerun: one live handle at a time, destroyed on restart, reset and error', () => {
  const p = ready();
  const P = p.A.player;
  for (let i = 0; i < 50; i++) { assert.equal(P.start(), true); assert.equal(p.fe.live.size, 1); }
  assert.equal(p.fe.destroyed.length, 49);
  assert.equal(P.handle(), p.fe.next - 1);
  P.reset();
  assert.equal(p.fe.live.size, 0);
  assert.equal(P.handle(), null);
  P.start();
  p.fe.failCreate = true;
  P.start();
  assert.equal(p.fe.live.size, 0);
});

test('step error mid-run is shown and the handle is destroyed', () => {
  const p = ready();
  p.A.player.start();
  p.fe.step = () => { throw new EngineError(-7, 'Out of memory.', ''); };
  p.A.player.stepOnce();
  assert.equal(p.A.player.snapshot().status, 'error');
  assert.equal(p.doc.byId['run-error'].textContent, 'Out of memory.');
  assert.equal(p.fe.live.size, 0);
});

test('mid-run add: validated, added at arrival >= now, store updated, playing resumes', () => {
  const p = ready({ totalSteps: 100 });
  const P = p.A.player;
  P.start(); P.play(); p.sched.runFrame();
  p.sched.runFrame();
  assert.equal(P.snapshot().state.now, 2);
  const res = P.addJobMidRun({ id: 9, arrival: 3, duration: 4, cpu: 2, mem: 100, priority: 1 });
  assert.equal(res.ok, true);
  assert.equal(P.snapshot().status, 'playing', 'resumed');
  assert.equal(p.A.store.get().jobs.length, 4);
  assert.equal(P.snapshot().jobs.length, 4);
  assert.equal(P.snapshot().state.total, 4);
  assert.equal(p.doc.byId['ra-error'].hidden, true);
  // the form: fields are read and the next default arrival is now + 1
  for (const [k, v] of Object.entries({ id: 10, arrival: 5, duration: 2, cpu: 1, mem: 10, priority: 0 })) p.doc.byId['ra-' + k].value = String(v);
  p.doc.byId['ra-submit'].click();
  assert.equal(p.A.store.get().jobs.length, 5);
  assert.equal(p.doc.byId['ra-id'].value, '11');
  assert.equal(p.doc.byId['ra-arrival'].value, String(P.snapshot().state.now + 1));
});

test('mid-run add errors are shown by the add form and the run survives', () => {
  const p = ready({ totalSteps: 100 });
  const P = p.A.player;
  P.start(); P.stepOnce(); P.stepOnce();
  let r = P.addJobMidRun({ id: 1, arrival: 5, duration: 1, cpu: 1, mem: 1, priority: 0 });
  assert.equal(r.ok, false);
  assert.equal(p.doc.byId['ra-error'].textContent, 'id: Job id 1 already exists.');
  r = P.addJobMidRun({ id: 20, arrival: 0, duration: 1, cpu: 1, mem: 1, priority: 0 });
  assert.match(p.doc.byId['ra-error'].textContent, /Arrival 0 is before current time 2/);
  r = P.addJobMidRun({ id: 21, arrival: 5, duration: 1, cpu: 1, mem: 1, priority: 10 });
  assert.equal(p.doc.byId['ra-error'].textContent, 'priority must be 0 to 9.');
  r = P.addJobMidRun({ id: 22, arrival: 5, duration: 1, cpu: 99, mem: 1, priority: 1 });
  assert.match(p.doc.byId['ra-error'].textContent, /needs 99 cores/);
  assert.equal(P.snapshot().status, 'paused');
  assert.equal(p.fe.live.size, 1);
  p.doc.byId['ra-id'].value = 'x';
  p.doc.byId['ra-submit'].click();
  assert.equal(p.doc.byId['ra-error'].textContent, 'id must be a whole number.');
});

test('adding a job after the run finished re-opens it', () => {
  const p = ready({ totalSteps: 2 });
  const P = p.A.player;
  P.start(); P.jumpToEnd(); p.sched.runLater();
  assert.equal(P.snapshot().status, 'finished');
  assert.equal(P.addJobMidRun({ id: 30, arrival: 5, duration: 1, cpu: 1, mem: 1, priority: 0 }).ok, true);
  assert.equal(P.snapshot().status, 'paused');
});

test('add form defaults follow the run: arrival = now + 1 and an unused id after start, step, pause, reset', () => {
  const p = ready({ totalSteps: 50 });
  const P = p.A.player;
  const form = () => [p.doc.byId['ra-id'].value, p.doc.byId['ra-arrival'].value];
  P.start();
  assert.deepEqual(plain(form()), ['4', '1']);          // jobs 1..3, now 0
  P.stepOnce(); P.stepOnce();
  assert.deepEqual(plain(form()), ['4', '3']);
  P.setSpeed(2); P.play(); p.sched.runFrame(); P.pause();
  assert.deepEqual(plain(form()), ['4', String(P.snapshot().state.now + 1)]);
  p.A.player.addJobMidRun({ id: 4, arrival: 9, duration: 1, cpu: 1, mem: 1, priority: 0 });
  assert.equal(p.doc.byId['ra-id'].value, '5');
  p.doc.activeElement = p.doc.byId['ra-arrival'];       // user typing: not overwritten
  p.doc.byId['ra-arrival'].value = '77';
  P.stepOnce();
  assert.equal(p.doc.byId['ra-arrival'].value, '77');
  p.doc.activeElement = null;
  P.reset();
  assert.deepEqual(plain(form()), ['5', '0']);
});

test('metrics are shown from the engine, null as n/a', () => {
  const p = ready();
  p.A.player.start(); p.A.player.setSpeed(6); p.A.player.play(); p.sched.runFrame();
  const texts = p.doc.byId['metrics-list'].children.map((c) => c.textContent);
  assert.ok(texts.includes('Average wait: 1.500'));
  assert.ok(texts.includes('CPU busy (utilization): no value yet (no job has finished)'));
  // Show details prints the engine's number unchanged instead of rounding to three decimals
  p.A.store.setDetails(true);
  const exact = p.doc.byId['metrics-list'].children.map((c) => c.textContent);
  assert.ok(exact.includes('Average wait: ' + String(p.A.player.snapshot().metrics.avg_wait)), exact.join('|'));
});

test('run page: the resource strip and the settings line show the engine numbers', () => {
  const p = ready();
  p.A.player.start();
  const st = p.A.player.snapshot().state;
  const want = (key, used) => key === 'cpu'
    ? used + ' of ' + st.cap.cpu + ' cores busy, ' + st.free.cpu + ' free'
    : used + ' of ' + st.cap.mem + ' MB in use, ' + st.free.mem + ' MB free';
  assert.equal(p.doc.byId['res-cpu-text'].textContent, want('cpu', st.cap.cpu - st.free.cpu));
  assert.equal(p.doc.byId['res-mem-text'].textContent, want('mem', st.cap.mem - st.free.mem));
  const s = p.A.store.get().settings;
  assert.equal(p.doc.byId['run-settings-summary'].textContent, 'Settings: \u03b1 = ' + s.alphaMilli + ', T = ' + s.threshold + ', \u03b5 = ' + s.eps);
});

test('Play, Step and Jump work from the first screen: they start the run themselves', () => {
  let p = ready({ totalSteps: 10 });
  assert.equal(p.doc.byId['run-play'].disabled, false, 'jobs are loaded, so Play is live');
  p.doc.byId['run-play'].click();
  assert.equal(p.A.player.snapshot().status, 'playing');
  p = ready({ totalSteps: 10 });
  p.doc.byId['run-step'].click();
  assert.equal(p.A.player.snapshot().events, 1);
  p = ready({ totalSteps: 10 });
  assert.equal(p.A.player.ensureRun(), true);
  assert.equal(p.A.player.snapshot().status, 'paused');
});

test('with no jobs the controls stay off and say why', () => {
  const p = ready({ totalSteps: 10 });
  p.A.store.setJobs([]);
  assert.equal(p.doc.byId['run-play'].disabled, true);
  assert.equal(p.doc.byId['run-step'].disabled, true);
  assert.equal(p.A.player.ensureRun(), false);
  assert.equal(p.doc.byId['run-error'].hidden, false);
});

test('a new job list or machine ends the old run, so Run never shows a stale board', () => {
  const p = ready({ totalSteps: 10 });
  const P = p.A.player;
  P.start(); P.stepOnce();
  assert.equal(P.snapshot().status, 'paused');
  p.A.store.setJobs(JOBS.slice(0, 1).map((j) => ({ ...j })));
  assert.equal(P.snapshot().status, 'idle', 'jobs changed');
  assert.equal(p.doc.byId['canvas-empty'].hidden, false);
  P.start(); P.stepOnce();
  p.A.store.setMachine(32, 65536);
  assert.equal(P.snapshot().status, 'idle', 'machine changed');
  assert.equal(p.fe.live.size, 0, 'no engine handle left behind');
});

test('run page: a scheduler the engine does not have yet cannot be chosen', () => {
  const p = ready();
  const opts = p.doc.byId['run-policy'].children;
  const off = opts.filter((o) => o.disabled).map((o) => o.getAttribute('value'));
  assert.deepEqual(plain(off), plain(p.A.compare.POLICIES.filter((x) => !x.available).map((x) => x.name)));
  assert.ok(opts.find((o) => o.getAttribute('value') === 'knapsack').textContent.includes('not implemented yet'));
});

test('run page: the policy list uses plain names with the technical term beside them', () => {
  const p = ready();
  const names = p.doc.byId['run-policy'].children.map((o) => o.textContent);
  assert.equal(names.length, 6);
  assert.ok(names.includes('Shortest job first (SJF)') && names.includes('First come, first served (FCFS)'));
});

test('leaving Run mode pauses; the panel is shown only in Run mode', () => {
  const p = ready({ totalSteps: 50 });
  p.A.store.setMode('run');
  assert.equal(p.doc.byId['run-panel'].hidden, false);
  p.A.player.start(); p.A.player.play();
  p.A.store.setMode('build');
  assert.equal(p.A.player.snapshot().status, 'paused');
  assert.equal(p.doc.byId['run-panel'].hidden, true);
});

// ---------- canvas ----------
const STATE = { now: 10, done: 2, total: 5, cap: { cpu: 16, mem: 32768 }, free: { cpu: 4, mem: 8192 },
  waiting: [{ id: 7, score: 6.2, priority: 2, arrival: 0, duration: 30, cpu: 8, mem: 20480 }, { id: 8, score: null, priority: 5, arrival: 1, duration: 3, cpu: 1, mem: 10 }],
  running: [{ id: 1, start: 0, finish: 40, cpu: 8, mem: 4096 }, { id: 2, start: 1, finish: 9, cpu: 4, mem: 8192 }],
  reservation: { id: 7, shadow_time: 40 } };
const VIEW = { state: STATE, jobs: [1, 2, 7, 8].map((id) => ({ id, arrival: id, duration: 5, cpu: 1, mem: 1, priority: 1 })),
  bars: { 1: { start: 0, finish: 40 }, 2: { start: 1, finish: 9 } }, selected: null, events: 7 };

test('board layout: card height is the demand share, width is the run, now is proportional', () => {
  const p = page();
  const L = p.A.canvas.layout(VIEW, 800, 420);
  const [cpu, mem] = L.lanes;
  assert.equal(L.tmax, 40);
  const a = cpu.cards.find((c) => c.id === 1), b = cpu.cards.find((c) => c.id === 2);
  assert.ok(Math.abs(a.h / cpu.h - 1 / 16) < 1e-12, 'job 1 asks for 1 of 16 cores in VIEW.jobs');
  assert.ok(Math.abs(a.w / cpu.w - 40 / 40) < 1e-12);
  assert.ok(Math.abs(b.w / cpu.w - 8 / 40) < 1e-12);
  assert.ok(Math.abs(mem.cards[0].h / mem.h - Math.max(1 / mem.h, 1 / 32768)) < 1, 'memory lane has its own scale');
  assert.ok(Math.abs((L.nowX - cpu.x) / cpu.w - 10 / 40) < 1e-12);
  const later = p.A.canvas.layout({ ...VIEW, state: { ...STATE, now: 20 } }, 800, 420);
  assert.ok(Math.abs((later.nowX - cpu.x) - 2 * (L.nowX - cpu.x)) < 1e-9);
  assert.equal(p.A.canvas.layout({ state: null, jobs: [], bars: {} }, 800, 420).lanes, null);
});

test('board layout: cards running together never overlap and stay inside the lane', () => {
  const p = page();
  const jobs = [[1, 8], [2, 4], [3, 4], [4, 8]].map(([id, cpu]) => ({ id, arrival: 0, duration: 10, cpu, mem: 1, priority: 1 }));
  const bars = { 1: { start: 0, finish: 10 }, 2: { start: 0, finish: 10 }, 3: { start: 0, finish: 10 }, 4: { start: 10, finish: 20 } };
  const L = p.A.canvas.layout({ state: STATE, jobs, bars }, 800, 420);
  const cards = L.lanes[0].cards;
  for (const c of cards) { assert.ok(c.slot >= 0 && c.slot + c.size <= 16, 'inside: ' + c.id); }
  for (const x of cards) for (const y of cards) {
    if (x.id < y.id && x.start < y.end && y.start < x.end) { assert.ok(x.slot + x.size <= y.slot || y.slot + y.size <= x.slot, x.id + ' and ' + y.id); }
  }
});

test('board draw: cards, stamped number, now rail, hit testing; no markup', () => {
  const p = page();
  const ctx = p.canvas.ctx;
  assert.equal(p.A.canvas.draw(p.canvas, VIEW), true);
  const L = p.canvas.__layout;
  const card = L.lanes[0].cards[0];
  assert.ok(ctx.calls.some((c) => c.op === 'fillRect' && Math.abs(c.a[2] - card.w) < 1e-9), 'card drawn');
  const texts = ctx.calls.filter((c) => c.op === 'fillText').map((c) => c.a[0]);
  assert.ok(texts.includes('now 10'));
  assert.ok(texts.includes('CPU') && texts.includes('Memory'));
  assert.ok(ctx.calls.some((c) => c.op === 'moveTo' && Math.abs(c.a[0] - L.nowX) < 1e-9), 'now rail');
  assert.equal(p.A.canvas.hit(p.canvas, card.x + 1, card.y + 1), card.id);
  assert.equal(p.A.canvas.hit(p.canvas, 0, 0), null);
});

test('board draw: a held card is left out until its magnet lands, but stays clickable', () => {
  const p = page();
  const ctx = p.canvas.ctx;
  const card = () => p.canvas.__layout.lanes[0].cards[0];
  p.A.canvas.draw(p.canvas, VIEW);
  const w = card().w;
  const painted = () => ctx.calls.filter((c) => c.op === 'fillRect' && Math.abs(c.a[2] - w) < 1e-9).length;
  ctx.calls.length = 0; p.A.canvas.draw(p.canvas, VIEW); const all = painted();
  ctx.calls.length = 0; p.A.canvas.draw(p.canvas, { ...VIEW, hold: { [card().id]: true } });
  assert.equal(painted(), all - 2, 'gone from both lanes');
  assert.ok(p.canvas.__regions.some((r) => r.id === card().id));
});

test('board: no 2D context returns false; 5000 cards lay out inside the board', () => {
  const p = page();
  p.canvas.getContext = () => null;
  assert.equal(p.A.canvas.draw(p.canvas, VIEW), false);
  const jobs = []; const bars = {};
  for (let i = 0; i < 5000; i++) { jobs.push({ id: i, arrival: i, duration: 1, cpu: 1, mem: 1, priority: 1 }); bars[i] = { start: i, finish: i + 1 }; }
  const L = p.A.canvas.layout({ state: STATE, jobs, bars }, 800, 420);
  assert.equal(L.lanes[0].cards.length, 5000);
  assert.ok(L.lanes[0].cards.every((c) => c.x + c.w <= L.lanes[0].x + L.lanes[0].w + 1e-6));
});

test('tray: waiting jobs in engine order with score, next and saved stamps, click selects', () => {
  const p = ready({ totalSteps: 10 });
  p.A.player.start();
  const list = p.doc.byId['tray-list'];
  const st = p.A.player.snapshot().state;
  assert.equal(list.children.length, st.waiting.length);
  assert.equal(p.doc.byId['tray-count'].textContent, '(' + st.waiting.length + ')');
  assert.deepEqual(plain(list.children.map((c) => Number(c.getAttribute('data-job')))), plain(st.waiting.map((w) => w.id)));
  const first = list.children[0], w0 = st.waiting[0];
  assert.equal(first.children[0].children[0].textContent, String(w0.id), 'stamped number');
  const texts = first.children[1].children.map((c) => c.textContent);
  assert.ok(texts.includes('Job ' + w0.id));
  assert.ok(texts.some((t) => t === 'Next' || t === 'Spot saved'));
  if (typeof w0.score === 'number') assert.ok(texts.some((t) => t.includes('score ' + w0.score.toFixed(3))));
  assert.equal(first.getAttribute('tabindex'), '0', 'one Tab stop for the list');
  list.fire('click', { target: first });
  assert.equal(p.A.player.snapshot().selected, w0.id);
  list.fire('click', { target: first });
  assert.equal(p.A.player.snapshot().selected, null);
});

function trayWith(waiting, reservation) {
  const p = ready({ totalSteps: 10 });
  p.A.player.start();
  const s = p.A.player.snapshot().state;
  s.waiting = waiting; s.reservation = reservation;
  p.A.player.select(null); p.A.player.select(waiting.length ? waiting[0].id : null);
  return p;
}
const W = (id, score) => ({ id, score, priority: 3, arrival: 0, duration: 5, cpu: 1, mem: 10 });

test('tray: a null score shows no score; the first job is Next, the reserved job is Spot saved', () => {
  const p = trayWith([W(4, null), W(7, 2.5)], { id: 7, shadow_time: 40 });
  const [a, b] = p.doc.byId['tray-list'].children;
  const texts = (li) => li.children[1].children.map((c) => c.textContent);
  assert.ok(!texts(a).join(' ').includes('score'), 'null score');
  assert.ok(texts(a).includes('Next'));
  assert.ok(texts(b).includes('Spot saved') && texts(b).join(' ').includes('score 2.500'));
  assert.equal(b.children[1].children[1].getAttribute('class'), 'stamp stamp-saved');
  assert.match(a.getAttribute('class'), /selected/);
  assert.equal(a.getAttribute('aria-pressed'), 'true');
});

test('tray: only 40 cards on the page, but the count and "more" line stay true', () => {
  const p = trayWith(Array.from({ length: 95 }, (_, i) => W(i + 1, 1)), null);
  assert.equal(p.doc.byId['tray-list'].children.length, 40);
  assert.equal(p.doc.byId['tray-count'].textContent, '(95)');
  assert.equal(p.doc.byId['tray-more'].hidden, false);
  assert.equal(p.doc.byId['tray-more'].textContent, 'and 55 more');
});

test('board click selects the card under the cursor and a second click clears it', () => {
  const p = ready({ totalSteps: 10 });
  p.A.player.start(); p.A.player.stepOnce();
  const regs = p.canvas.__regions;
  if (!regs.length) return;
  const r = regs[0];
  p.canvas.fire('click', { clientX: r.x + 1, clientY: r.y + 1 });
  assert.equal(p.A.player.snapshot().selected, r.id);
  p.canvas.fire('click', { clientX: r.x + 1, clientY: r.y + 1 });
  assert.equal(p.A.player.snapshot().selected, null);
});

// ---------- the real engine ----------
const vendor = join(web, 'vendor', 'aprm.js');
const cli = join(root, 'build', 'aprm');
if (existsSync(vendor) && readFileSync(vendor).length > 0) {
  const createAprm = require(vendor);
  const realPage = async () => {
    const p = page({ createAprm, wasm: true });
    await p.A.wasm.init();
    p.A.whylog.mount();
    p.A.player.mount();
    return p;
  };
  const drain = (p) => { let n = 0; while (p.sched.laters.length || p.sched.frames.length) { if (p.sched.frames.length) p.sched.runFrame(); else p.sched.runLater(); n++; } return n; };
  const csvRows = (text) => text.trim().split('\n').slice(1).map((l) => l.split(',').map(Number));

  for (const policy of ['fcfs', 'priority', 'sjf', 'aging']) {
    test('real engine: preset memory_hog under ' + policy + ' played to the end equals the console program', async () => {
      const p = await realPage();
      const preset = p.A.presets.load('memory_hog');
      p.A.store.setPolicies([policy]);
      const P = p.A.player;
      P.setSpeed(7);
      assert.equal(P.start(), true, P.snapshot().error);
      P.play();
      drain(p);                                          // play frames until the engine finishes
      assert.equal(P.snapshot().status, 'finished');
      const rows = p.A.wasm.results(P.handle()).map((r) => [r.id, r.arrival, r.start, r.finish, r.wait, r.turnaround, r.priority, r.cpu, r.mem]);
      if (existsSync(cli)) {
        const dir = mkdtempSync(join(tmpdir(), 'k25-'));
        const out = join(dir, 'out.csv'); const met = join(dir, 'm.json');
        const r = spawnSync(cli, ['--policy', policy, '--in', join(root, 'data', 'presets', 'memory_hog.csv'), '--out', out, '--metrics', met,
          '--cpu', String(preset.cpu_cap), '--mem', String(preset.mem_cap), '--alpha-milli', String(preset.alpha_milli), '--threshold', String(preset.threshold)]);
        assert.equal(r.status, 0, String(r.stderr));
        assert.deepEqual(plain(rows), csvRows(readFileSync(out, 'utf8')));
        const m = JSON.parse(readFileSync(met, 'utf8'));
        const mm = m.data || m;
        const live = P.snapshot().metrics;
        for (const k of ['max_wait', 'makespan', 'weighted_completion']) assert.equal(live[k], mm[k], k);
        for (const k of ['avg_wait', 'avg_turnaround']) assert.ok(Math.abs(live[k] - mm[k]) < 1e-6, k);
      } else {
        console.log('note: build/aprm missing; differential comparison skipped');
      }
      assert.equal(rows.length, preset.jobs.length);
      P.reset();
    });
  }

  test('real engine: jump to end equals frame-by-frame play (same schedule)', async () => {
    const results = [];
    for (const mode of ['play', 'jump']) {
      const p = await realPage();
      p.A.presets.load('priority_starvation');
      p.A.store.setPolicies(['aging']);
      p.A.player.start();
      if (mode === 'play') { p.A.player.setSpeed(3); p.A.player.play(); } else { p.A.player.jumpToEnd(); }
      drain(p);
      results.push(JSON.stringify(p.A.wasm.results(p.A.player.handle())));
    }
    assert.equal(results[0], results[1]);
  });

  test('real engine: a job added mid-run (arrival now+1 and arrival now) appears and is scheduled', async () => {
    const p = await realPage();
    p.A.store.setMachine(4, 1000);
    p.A.store.setJobs([{ id: 1, arrival: 0, duration: 10, cpu: 4, mem: 100, priority: 5 }, { id: 2, arrival: 1, duration: 3, cpu: 1, mem: 100, priority: 5 }]);
    p.A.store.setPolicies(['fcfs']);
    const P = p.A.player;
    P.start(); P.stepOnce(); P.stepOnce();
    const now = P.snapshot().state.now;
    assert.equal(P.addJobMidRun({ id: 3, arrival: now + 1, duration: 2, cpu: 1, mem: 100, priority: 9 }).ok, true);
    assert.equal(P.addJobMidRun({ id: 4, arrival: now, duration: 2, cpu: 1, mem: 100, priority: 9 }).ok, true);
    assert.equal(P.addJobMidRun({ id: 5, arrival: now - 1, duration: 2, cpu: 1, mem: 100, priority: 9 }).ok, false);
    assert.match(p.doc.byId['ra-error'].textContent, /before current time/);
    P.jumpToEnd(); drain(p);
    assert.equal(P.snapshot().status, 'finished');
    const res = p.A.wasm.results(P.handle());
    assert.deepEqual(plain(res.map((r) => r.id).sort()), [1, 2, 3, 4]);
    for (const r of res) assert.ok(r.start >= r.arrival);
    assert.equal(P.snapshot().state.total, 4);
  });

  test('real engine: every preset plays, steps and finishes with each drawing step not throwing', async () => {
    const p = await realPage();
    for (const preset of p.A.presets.all()) {
      p.A.presets.load(preset.name);
      p.A.store.setPolicies(['aging']);
      const P = p.A.player;
      assert.equal(P.start(), true, preset.name + ': ' + P.snapshot().error);
      P.stepOnce(); P.stepOnce();
      p.canvas.ctx.calls.length = 0;
      P.setSpeed(200); P.play(); drain(p);
      assert.equal(P.snapshot().status, 'finished', preset.name);
      assert.equal(P.snapshot().state.done, preset.jobs.length, preset.name);
      assert.ok(p.canvas.ctx.calls.length > 20, 'drawn');
    }
    p.A.player.reset();
  });

  test('real engine: 5000 jobs, jump to end in slices of at most 500 steps, handle freed on reset', async () => {
    const p = await realPage();
    const jobs = [];
    for (let i = 0; i < 5000; i++) jobs.push({ id: i + 1, arrival: Math.floor(i / 4), duration: 1 + (i % 9), cpu: 1 + (i % 3), mem: 64 + (i % 5) * 64, priority: i % 10 });
    p.A.store.setJobs(jobs);
    p.A.store.setPolicies(['aging']);
    const P = p.A.player;
    assert.equal(P.start(), true, P.snapshot().error);
    P.jumpToEnd();
    let slices = 0;
    const t0 = Date.now();
    while (p.sched.laters.length) { p.sched.runLater(); slices++; }
    assert.equal(P.snapshot().status, 'finished');
    assert.equal(P.snapshot().state.done, 5000);
    assert.ok(slices >= Math.ceil(P.snapshot().events / P.SLICE_STEPS), 'sliced: ' + slices);
    assert.ok(slices >= 2);
    console.log('     5000-job jump: ' + slices + ' slices, ' + P.snapshot().events + ' events, ' + (Date.now() - t0) + ' ms');
    const h = P.handle();
    P.reset();
    assert.throws(() => p.A.wasm.state(h));                  // the handle is really gone
  });

  test('real engine: 500 jobs, one frame at the capped speed is fast', async () => {
    const p = await realPage();
    const jobs = [];
    for (let i = 0; i < 500; i++) jobs.push({ id: i + 1, arrival: Math.floor(i / 5), duration: 1 + (i % 20), cpu: 1 + (i % 4), mem: 128 * (1 + (i % 8)), priority: i % 10 });
    p.A.store.setJobs(jobs);
    p.A.store.setPolicies(['aging']);
    const P = p.A.player;
    P.start(); P.setSpeed(1e6); P.play();
    const t0 = Date.now();
    p.sched.runFrame();
    const ms = Date.now() - t0;
    assert.equal(P.snapshot().events, P.MAX_STEPS_PER_FRAME);
    console.log('     500 jobs, one capped frame (' + P.MAX_STEPS_PER_FRAME + ' steps + redraw): ' + ms + ' ms');
    assert.ok(ms < 200, 'frame took ' + ms + ' ms');
    P.reset();
  });
} else {
  console.log('note: web/vendor/aprm.js not built (run `make wasm`); real-engine Run mode tests skipped');
}

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n' + (e && e.stack || e)); }
}
console.log(`${tests.length - failed}/${tests.length} run-mode tests passed`);
process.exit(failed ? 1 : 0);
