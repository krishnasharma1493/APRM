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
  cv.clientWidth = 800; cv.width = 640; cv.height = 640;
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

test('epsilon text uses the console grammar; bad text names epsilon, no engine call (D72)', () => {
  const good = [['0.1', 0.1], ['1', 1], ['0.01', 0.01], ['0.125', 0.125], ['01.5', null], ['0.5', 0.5]];
  for (const [text, want] of good) {
    const p = ready();
    p.doc.byId['run-eps'].value = text;
    if (want === null) { p.doc.byId['run-start'].click(); assert.equal(p.fe.created, 0, text); continue; }
    p.doc.byId['run-start'].click();
    assert.equal(p.fe.created, 1, text);
    assert.equal(p.fe.args[5], want, text);
  }
  for (const text of ['.5', '1e-1', '0.1234', '2', '0', '0.001', '-0.1', '', '0.', '1.0.0', 'abc', '0x1']) {
    const p = ready();
    p.doc.byId['run-eps'].value = text;
    p.doc.byId['run-start'].click();
    assert.equal(p.fe.created, 0, 'no engine call for "' + text + '"');
    const msg = p.doc.byId['run-error'].textContent;
    assert.match(msg, /epsilon/i, text);
    assert.doesNotMatch(msg, /knapsack_eps_milli/, text);
  }
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
  assert.equal(list.children[0].textContent, 't=1: <img src=x onerror=alert(1)>');
  assert.equal(list.children[0].children[0].constructor.name, 'Text');
  assert.equal(list.children[0].children.length, 1, 'only a text node, no parsed markup');
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
  assert.ok(texts.includes('CPU utilisation: n/a (no finished job yet)'));
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

test('canvas layout: bars are proportional to usage, now marker is proportional to now', () => {
  const p = page();
  const L = p.A.canvas.layout(VIEW, 800, 640);
  const [a, b] = L.cpuBar.blocks;
  assert.equal(a.w / b.w, 2);                                   // 8 cores vs 4 cores
  assert.ok(Math.abs(a.w / L.cpuBar.w - 8 / 16) < 1e-12);
  assert.ok(Math.abs(L.memBar.blocks[0].w / L.memBar.w - 4096 / 32768) < 1e-12);
  assert.ok(Math.abs(b.x - (a.x + a.w)) < 1e-9, 'blocks are side by side');
  assert.ok(a.w + b.w <= L.cpuBar.w);
  const g = L.gantt;
  assert.equal(g.tmax, 40);
  assert.ok(Math.abs((L.nowX - g.x) / g.w - 10 / 40) < 1e-12);
  const later = p.A.canvas.layout({ ...VIEW, state: { ...STATE, now: 20 } }, 800, 640);
  assert.ok(Math.abs((later.nowX - g.x) - 2 * (L.nowX - g.x)) < 1e-9);
  assert.equal(L.waiting.length, 2);
  assert.equal(p.A.canvas.layout({ state: null, jobs: [], bars: {} }, 800, 640).bars, null);
});

test('canvas draw: fillRect widths, text via fillText with live score and lock, no markup', () => {
  const p = page();
  const ctx = p.canvas.ctx;
  assert.equal(p.A.canvas.draw(p.canvas, VIEW), true);
  const rects = ctx.calls.filter((c) => c.op === 'fillRect');
  const L = p.canvas.__layout;
  assert.ok(rects.some((c) => Math.abs(c.a[2] - L.cpuBar.blocks[0].w) < 1e-9 && c.a[3] === 18));
  const texts = ctx.calls.filter((c) => c.op === 'fillText').map((c) => c.a[0]);
  assert.ok(texts.some((t) => t.includes('Job 7') && t.includes('score 6.200') && t.startsWith('[lock]')), 'score and lock: ' + texts);
  assert.ok(texts.some((t) => t.startsWith('Job 8') && !t.includes('score')), 'null score shows no score');
  assert.ok(texts.some((t) => t.startsWith('Time 10')));
  assert.ok(texts.includes('now 10'));
  assert.ok(ctx.calls.some((c) => c.op === 'moveTo' && Math.abs(c.a[0] - L.nowX) < 1e-9), 'now marker line');
  // hit testing
  const blk = L.cpuBar.blocks[0];
  assert.equal(p.A.canvas.hit(p.canvas, blk.x + 1, blk.y + 1), 1);
  assert.equal(p.A.canvas.hit(p.canvas, 0, 0), null);
});

test('canvas draw: no 2D context returns false; many jobs shrink rows instead of overflowing', () => {
  const p = page();
  p.canvas.getContext = () => null;
  assert.equal(p.A.canvas.draw(p.canvas, VIEW), false);
  const jobs = []; const bars = {};
  for (let i = 0; i < 5000; i++) { jobs.push({ id: i, arrival: i, duration: 1, cpu: 1, mem: 1, priority: 1 }); bars[i] = { start: i, finish: i + 1 }; }
  const L = p.A.canvas.layout({ state: STATE, jobs, bars }, 800, 640);
  assert.ok(L.gantt.rowH * 5000 <= L.gantt.h + 1e-6);
});

test('canvas click selects the job under the cursor and a second click clears it', () => {
  const p = ready({ totalSteps: 10 });
  p.A.player.start();
  const L = p.canvas.__layout;
  const row = L.waiting[0];
  p.canvas.fire('click', { clientX: row.x + 5, clientY: row.y + 5 });
  assert.equal(p.A.player.snapshot().selected, 7);
  p.canvas.fire('click', { clientX: row.x + 5, clientY: row.y + 5 });
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
