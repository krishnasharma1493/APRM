// test_player.mjs: tests for Run mode (K-25, event cursor K-51): player.js, runpanels.js, whylog.js, and canvas.js (still used by Compare).
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
    this.hidden = false; this.value = ''; this.disabled = false; this.style = {};
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
  const cv = byId['run-canvas'] || (byId['run-canvas'] = new El('canvas', 'run-canvas'));   // canvas.js is tested on a stand-alone canvas
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
  const s = { timers: [], delays: [], cancelled: 0 };
  s.wait = (fn, ms) => { s.timers.push(fn); s.delays.push(ms); return s.timers.length; };
  s.cancel = () => { s.cancelled++; s.timers.length = 0; s.delays.length = 0; };
  s.run = () => { const f = s.timers.shift(); s.delays.shift(); assert.ok(f, 'a timer is scheduled'); f(); };
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
    return { now: s.steps, done: s.steps >= totalSteps ? s.jobs.length : Math.min(Math.floor(s.steps / 3), Math.max(0, s.jobs.length - 1)), total: s.jobs.length, cap: { cpu: 16, mem: 32768 }, free: { cpu: 4, mem: 8192 },
      waiting: [{ id: 7, score: 6.2, priority: 2, arrival: 0, duration: 30, cpu: 8, mem: 20480 }, { id: 8, score: 5, priority: 5, arrival: 1, duration: 3, cpu: 1, mem: 10 }],
      running: [{ id: 1, start: 0, finish: 5, cpu: 8, mem: 4096 }, { id: 2, start: 1, finish: 9, cpu: 4, mem: 8192 }],
      reservation: s.steps >= 2 ? { id: 7, shadow_time: 9 } : null };
  };
  f.log = (h, since) => {
    f.logSince.push(since);
    const s = f.sims.get(h);
    const out = [];
    for (let q = since + 1; q <= 2 * s.steps; q++) out.push({ seq: q, t: Math.ceil(q / 2), kind: q % 2 ? 'SKIP' : 'BATCH_SELECT', job: (q % 2) + 1, msg: msg || ('event ' + q + ' for job ' + ((q % 2) + 1)) });
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
  p.A.runpanels.mount();
  p.A.store.setJobs(JOBS.map((j) => ({ ...j })));
  return p;
}

// ---------- static ----------
test('index.html loads runmodel, player and runpanels after whylog and before app.js', () => {
  const i = (n) => srcs.indexOf(n);
  assert.ok(i('js/canvas.js') > i('js/generator.js') && i('js/canvas.js') < i('js/whylog.js'));
  assert.ok(i('js/whylog.js') < i('js/runmodel.js') && i('js/runmodel.js') < i('js/player.js'));
  assert.ok(i('js/player.js') < i('js/runpanels.js') && i('js/runpanels.js') < i('js/app.js'));
  assert.equal(i('js/runboard.js'), -1, 'the old board is gone from the Run page');
});

// ---------- player state machine ----------
test('state machine: idle -> paused -> playing -> paused -> finished -> reset', () => {
  const p = ready({ totalSteps: 2 });
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
  p.sched.run();                            // one beat: one event
  assert.equal(P.snapshot().events, 1);
  assert.equal(p.sched.timers.length, 1, 'next beat scheduled');
  assert.equal(p.sched.delays[0], P.BEAT_MS, 'one event per 900 ms at 1x');
  assert.equal(P.pause(), true);
  assert.equal(P.snapshot().status, 'paused');
  assert.equal(p.sched.timers.length, 0, 'nothing runs while paused');
  assert.equal(P.stepOnce(), true);
  assert.equal(P.snapshot().events, 2);
  P.setSpeed(4);
  P.play();
  while (p.sched.timers.length) p.sched.run();
  assert.equal(P.snapshot().status, 'finished');
  assert.equal(P.snapshot().events, 4);
  assert.equal(P.play(), false);
  P.reset();
  assert.equal(P.snapshot().status, 'idle');
  assert.equal(p.fe.live.size, 0);
  assert.equal(p.doc.byId['wait-empty'].textContent, 'No jobs waiting.');   // the design's empty state
});

test('Step shows exactly one log entry; the engine is stepped only when the queued moment is used up', () => {
  const p = ready({ totalSteps: 10 });
  const P = p.A.player;
  P.start();
  assert.equal(p.fe.stepCalls, 0);
  P.stepOnce();
  assert.equal(P.snapshot().events, 1);
  assert.equal(p.fe.stepCalls, 1, 'one moment fetched');
  assert.equal(P.snapshot().pending, 1, 'its second entry waits for the next Step');
  P.stepOnce();
  assert.equal(P.snapshot().events, 2);
  assert.equal(p.fe.stepCalls, 1, 'no engine call: the entry was queued');
  P.stepOnce();
  assert.equal(p.fe.stepCalls, 2);
  assert.equal(p.doc.byId['run-event-text'].textContent, 'event 3 for job 2');
  assert.equal(p.doc.byId['run-event-kind'].textContent, 'Skipped');
});

test('at the end of each moment the view is the engine state; between entries it is derived', () => {
  const p = ready({ totalSteps: 10 });
  const P = p.A.player;
  P.start();
  P.stepOnce();
  P.stepOnce();
  const s = P.snapshot();
  assert.equal(s.state.now, s.engineState.now);
  assert.deepEqual(plain(s.state.waiting.map((w) => w.id)), plain(s.engineState.waiting.map((w) => w.id)));
  assert.deepEqual(plain(s.state.free), plain(s.engineState.free));
  assert.equal(s.state.reservation, null, 'step 1 has no saved spot in the fake engine');
});

test('start with no jobs shows an empty-state message, no engine call', () => {
  const p = ready();
  p.A.store.setJobs([]);
  p.A.player.setSource('yours');      // an empty Build list; the page itself falls back to the sample
  assert.equal(p.A.player.start(), false);
  assert.equal(p.fe.created, 0);
  assert.match(p.doc.byId['run-error'].textContent, /no jobs/i);
});

test('engine error on create is shown next to the Run button, nothing leaks', () => {
  const p = ready();
  p.fe.failCreate = true;
  assert.equal(p.A.player.start(), false);
  assert.equal(p.A.player.snapshot().status, 'error');
  assert.equal(p.doc.byId['run-error'].textContent, 'cpu must be 1 to 1000000.');
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
    const msg = p.doc.byId['run-settings-error'].textContent;
    assert.match(msg, /ε/, text);
    assert.doesNotMatch(msg, /knapsack_eps_milli/, text);
  }
});

test('speed: 0.5x, 1x, 2x, 4x only; the beat follows it; the speed buttons show the choice', () => {
  const p = ready({ totalSteps: 100 });
  const P = p.A.player;
  assert.equal(P.setSpeed(2), 2);
  assert.equal(P.setSpeed(1e9), 4);
  assert.equal(P.setSpeed(0), 0.5);
  assert.equal(P.setSpeed('abc'), 1);
  P.setSpeed(4);
  P.start(); P.play(); p.sched.run();
  assert.equal(p.sched.delays[0], Math.round(P.BEAT_MS / 4));
  const box = p.doc.byId['run-speed'];
  const b = new El('button'); b.setAttribute('data-speed', '0.5');
  box.fire('click', { target: b });
  assert.equal(P.snapshot().speed, 0.5);
  assert.equal(p.A.store.get().settings.speed, 0.5, 'remembered in the store');
});

test('Run starts a new run and plays it; Play, Step and Jump also start from the first screen', () => {
  const p = ready({ totalSteps: 10 });
  p.doc.byId['run-start'].click();
  assert.equal(p.A.player.snapshot().status, 'playing');
  const q = ready({ totalSteps: 10 });
  q.doc.byId['run-step'].click();
  assert.equal(q.A.player.snapshot().status, 'paused');
  assert.equal(q.A.player.snapshot().events, 1);
  const r = ready({ totalSteps: 10 });
  r.doc.byId['run-play'].click();
  assert.equal(r.A.player.snapshot().status, 'playing');
});

test('jump to end runs in slices through the scheduler, each at most SLICE_STEPS moments', () => {
  const p = ready({ totalSteps: 1234 });
  const P = p.A.player;
  P.start();
  const base = p.fe.stepCalls;
  assert.equal(P.jumpToEnd(), true);
  assert.equal(P.snapshot().status, 'jumping');
  assert.equal(p.fe.stepCalls, base, 'nothing runs inside jumpToEnd itself');
  const slices = [];
  while (p.sched.timers.length) { const b = p.fe.stepCalls; p.sched.run(); slices.push(p.fe.stepCalls - b); }
  assert.deepEqual(plain(slices), [500, 500, 235]);          // 234 moments, then the call that says finished
  assert.ok(slices.every((n) => n <= P.SLICE_STEPS + 1));
  assert.equal(P.snapshot().status, 'finished');
  assert.equal(P.snapshot().events, 2468, 'every entry is applied, two per moment');
});

test('pause during a jump cancels the remaining slices', () => {
  const p = ready({ totalSteps: 5000 });
  const P = p.A.player;
  P.start(); P.jumpToEnd(); p.sched.run();
  assert.equal(P.pause(), true);
  assert.equal(p.sched.timers.length, 0);
  assert.equal(P.snapshot().status, 'paused');
  assert.equal(P.snapshot().events, 1000);
});

test('log: entries are pulled with since = last seq, never twice, shown as text', () => {
  const p = ready({ totalSteps: 10, msg: '<img src=x onerror=alert(1)>' });
  const P = p.A.player;
  P.start();
  P.stepOnce(); P.stepOnce(); P.stepOnce();
  assert.deepEqual(plain(p.fe.logSince), [0, 2]);
  const e = P.snapshot().entries;
  assert.deepEqual(plain(e.map((x) => x.seq)), [1, 2, 3]);
  const list = p.doc.byId['whylog-list'];
  assert.equal(list.children.length, 3);
  const line = list.children[0].children;
  assert.equal(line.length, 3, 'the tick, the kind (with the raw kind inside), and the engine sentence');
  assert.equal(line[0].textContent, '2', 'newest first: the third entry is at tick 2');
  assert.equal(line[1].children[0].textContent, 'Skipped');
  assert.equal(line[1].children[1].textContent, 'SKIP');
  assert.equal(line[2].children[0].constructor.name, 'Text', 'the engine sentence is a text node, never parsed markup');
  assert.equal(line[2].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(list.children[2].children[0].textContent, '1', 'the oldest last');
  assert.equal(p.doc.byId['run-event-text'].textContent, '<img src=x onerror=alert(1)>', 'the banner shows the engine words as text');
});

test('why log: only the newest MAX_ROWS rows exist as page elements', () => {
  const p = ready({ totalSteps: 2500 });
  p.A.player.start(); p.A.player.jumpToEnd();
  while (p.sched.timers.length) p.sched.run();
  assert.equal(p.A.player.snapshot().entries.length, 5000);
  assert.equal(p.doc.byId['whylog-list'].children.length, p.A.whylog.MAX_ROWS);
});

test('selecting a job filters the log and highlights its table row; Show all clears', () => {
  const p = ready({ totalSteps: 8 });
  const P = p.A.player;
  P.start();
  for (let i = 0; i < 8; i++) P.stepOnce();
  assert.equal(p.doc.byId['whylog-list'].children.length, 8);
  P.select(2);
  const rows = p.doc.byId['whylog-list'].children;
  assert.ok(rows.length > 0 && rows.length < 8);
  assert.ok(rows.every((r) => r.getAttribute('data-job') === '2'));
  assert.match(p.doc.byId['whylog-clear'].textContent, /Showing job 2 only · Show all/);
  assert.equal(p.doc.byId['whylog-clear'].hidden, false);
  const rows2 = p.doc.byId['wait-body'].children;
  const selRow = rows2.find((r) => r.getAttribute('data-job') === '2');
  if (selRow) assert.equal(selRow.getAttribute('aria-current'), 'true');
  assert.ok(rows2.filter((r) => r.getAttribute('data-job') !== '2').every((r) => r.getAttribute('aria-current') === null));
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

test('mid-run add: shows the rest of the moment first, adds at arrival >= now, store updated, playing resumes', () => {
  const p = ready({ totalSteps: 100 });
  const P = p.A.player;
  P.start(); P.play(); p.sched.run(); p.sched.run(); p.sched.run();
  assert.equal(P.snapshot().state.now, 2);
  assert.equal(P.snapshot().pending, 1);
  const res = P.addJobMidRun({ id: 9, arrival: 3, duration: 4, cpu: 2, mem: 100, priority: 1 });
  assert.equal(res.ok, true);
  assert.equal(P.snapshot().pending, 0, 'the page caught up with the engine before adding');
  assert.equal(P.snapshot().status, 'playing', 'resumed');
  assert.equal(p.A.store.get().jobs.length, 4);
  assert.equal(P.snapshot().jobs.length, 4);
  assert.equal(P.snapshot().state.total, 4);
  assert.equal(p.doc.byId['ra-error'].hidden, true);
  P.pause();
  for (const [k, v] of Object.entries({ arrival: 5, duration: 2, cpu: 1, mem: 10, priority: 0 })) p.doc.byId['ra-' + k].value = String(v);
  p.doc.byId['ra-id'].value = '10';
  p.doc.byId['ra-submit'].click();
  assert.equal(p.A.store.get().jobs.length, 5);
  assert.equal(p.doc.byId['ra-id'].value, '11');
  assert.equal(p.doc.byId['ra-submit'].textContent, 'Add job 11');
  assert.equal(p.doc.byId['ra-arrival'].value, String(P.snapshot().engineState.now + 1));
  assert.equal(p.doc.byId['run-add'].hidden, true, 'the form closes after a good add');
});

test('mid-run add errors are shown by the add form and the run survives', () => {
  const p = ready({ totalSteps: 100 });
  const P = p.A.player;
  P.start(); P.stepOnce(); P.stepOnce(); P.stepOnce(); P.stepOnce();
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
  p.doc.byId['ra-duration'].value = 'x';
  p.doc.byId['ra-submit'].click();
  assert.equal(p.doc.byId['ra-error'].textContent, 'Use whole numbers only. Check “Runs for (ticks)”.');
});

test('opening the add form on the last moment shows its last entry and finishes the run', () => {
  const p = ready({ totalSteps: 1 });
  const P = p.A.player;
  P.start(); P.stepOnce();
  assert.equal(P.snapshot().pending, 1);
  p.doc.byId['run-add-open'].click();
  assert.equal(P.snapshot().pending, 0);
  assert.equal(P.snapshot().status, 'finished');
  assert.equal(p.doc.byId['run-step'].disabled, true);
});

test('adding a job after the run finished re-opens it', () => {
  const p = ready({ totalSteps: 2 });
  const P = p.A.player;
  P.start(); P.jumpToEnd(); p.sched.run();
  assert.equal(P.snapshot().status, 'finished');
  assert.equal(P.addJobMidRun({ id: 30, arrival: 5, duration: 1, cpu: 1, mem: 1, priority: 0 }).ok, true);
  assert.equal(P.snapshot().status, 'paused');
});

test('Add a job right now opens the inline form and pauses a playing run; Cancel closes it', () => {
  const p = ready({ totalSteps: 100 });
  const P = p.A.player;
  P.start(); P.play(); p.sched.run();
  p.doc.byId['run-add-open'].click();
  assert.equal(P.snapshot().status, 'paused');
  assert.equal(p.doc.byId['run-add'].hidden, false);
  assert.equal(p.doc.byId['run-add-open'].getAttribute('aria-expanded'), 'true');
  assert.match(p.doc.byId['ra-note'].textContent, /^Paused at tick 1\./);
  p.doc.byId['ra-cancel'].click();
  assert.equal(p.doc.byId['run-add'].hidden, true);
});

test('metrics are shown from the engine, null as n/a', () => {
  const p = ready({ totalSteps: 10 });
  const P = p.A.player;
  P.start(); for (let i = 0; i < 6; i++) P.stepOnce();
  const tile = (k) => p.doc.byId['metrics-list'].children.find((li) => li.getAttribute('data-metric') === k);
  assert.equal(p.doc.byId['metrics-list'].children.length, 7, 'every metric of the engine');
  assert.equal(tile('avg_wait').children[1].textContent, '1.5 ticks');
  assert.equal(tile('max_wait').children[1].textContent, '3 ticks');
  assert.equal(tile('util_mem').children[1].textContent, '50%');   // the design rounds to one decimal, drops .0
  assert.match(tile('util_cpu').children[1].textContent, /^no value yet/);
  p.A.store.setDetails(true);
  assert.equal(tile('avg_wait').children[1].textContent, '1.5 ticks', 'Show details: the engine value unchanged');
  assert.equal(tile('util_mem').children[1].textContent, '0.5');
  assert.equal(p.doc.byId['prio-list'].children.length, 10);
});

test('the head line, the settings line and the machine lines show the case and the engine numbers', () => {
  const p = ready({ totalSteps: 10 });
  assert.equal(p.doc.byId['run-dataline'].textContent, '3 jobs on 16 cores and 32768 MB (32 GB).');
  assert.equal(p.doc.byId['run-source-yours'].textContent, 'Your jobs · 3');
  assert.equal(p.doc.byId['run-settings-summary'].textContent, 'α = 0.1 (alpha_milli = 100) · T = 12 ticks · ε = 0.1');
  p.A.player.start(); p.A.player.stepOnce(); p.A.player.stepOnce();
  assert.equal(p.doc.byId['res-cpu-text'].textContent, '12 of 16 cores busy, 4 free');
  assert.equal(p.doc.byId['run-clock'].textContent, 'Time: tick 1');
  assert.equal(p.doc.byId['run-status-text'].textContent, 'Paused');
  assert.equal(p.A.player.alphaWords(1000), '1');
  assert.equal(p.A.player.alphaWords(1250), '1.25');
  assert.equal(p.A.player.alphaWords(5), '0.005');
});

test('a bad setting names the problem once and opens More settings', () => {
  const p = ready();
  p.doc.byId['run-alpha'].value = 'abc';
  p.doc.byId['run-start'].click();
  assert.equal(p.fe.created, 0);
  assert.equal(p.doc.byId['run-settings-error'].textContent, 'α must be a number above 0 and up to 1, like 0.1.');
  assert.equal(p.doc.byId['run-more'].open, true);
});

test('with no jobs the controls stay off and say why', () => {
  const p = ready();
  p.A.store.setJobs([]);
  p.A.player.setSource('yours');
  for (const id of ['run-play', 'run-step', 'run-jump', 'run-reset', 'run-add-open']) assert.equal(p.doc.byId[id].disabled, true, id);
  assert.equal(p.doc.byId['run-start'].disabled, false, 'Run stays live and explains why nothing can run');
  p.doc.byId['run-start'].click();
  assert.match(p.doc.byId['run-error'].textContent, /no jobs/i);
});

test('a new job list or machine ends the old run, so Run never shows a stale board', () => {
  const p = ready({ totalSteps: 10 });
  const P = p.A.player;
  P.start(); P.stepOnce();
  p.A.store.setJobs(JOBS.slice(0, 2).map((j) => ({ ...j })));
  assert.equal(P.snapshot().status, 'idle');
  P.start(); P.stepOnce();
  p.A.store.setMachine(8, 4096);
  assert.equal(P.snapshot().status, 'idle');
});

test('scheduler cards: six radio cards drive #run-policy; arrows move the choice; a change marks the run stale', () => {
  const p = ready({ totalSteps: 10 });
  const box = p.doc.byId['run-methods'];
  assert.deepEqual(plain(box.children.map((c) => c.getAttribute('data-policy'))), plain(p.A.player.POLICY_NAMES));
  assert.equal(box.children[0].getAttribute('role'), 'radio');
  assert.equal(box.children[0].children[1].textContent, 'First come, first served (FCFS)');
  assert.equal(box.children[0].getAttribute('aria-checked'), 'false');
  assert.equal(box.children[4].getAttribute('aria-checked'), 'true', 'the design starts on aging with EASY reservation');
  box.fire('click', { target: box.children[2] });
  assert.equal(p.A.store.get().policies[0], 'sjf');
  assert.equal(p.doc.byId['run-policy'].value, 'sjf');
  assert.equal(box.children[2].getAttribute('aria-checked'), 'true');
  assert.equal(box.children[2].getAttribute('tabindex'), '0');
  box.fire('keydown', { key: 'ArrowRight', preventDefault() {} });
  assert.equal(p.A.store.get().policies[0], 'aging');
  p.A.player.start(); p.A.player.stepOnce();
  assert.equal(p.doc.byId['run-stale'].hidden, true);
  box.fire('click', { target: box.children[5] });
  assert.equal(p.A.player.snapshot().stale, true);
  assert.equal(p.doc.byId['run-stale'].hidden, false);
  assert.equal(p.doc.byId['run-start'].textContent, 'Run again');
  assert.equal(p.A.player.snapshot().status, 'paused', 'the current run is unaffected');
  p.doc.byId['run-start'].click();
  assert.equal(p.fe.args[2], 'knapsack');
  assert.equal(p.doc.byId['run-start'].textContent, 'Run');
});

test('run page: a scheduler marked unavailable cannot be chosen', () => {
  const p = page();
  p.fe = fakeWasm(); p.A.wasm = p.fe;
  p.A.compare = { POLICIES: p.A.player.POLICY_NAMES.map((n) => ({ name: n, available: n !== 'knapsack' })) };
  p.A.player.mount();
  const opt = p.doc.byId['run-policy'].children.find((o) => o.getAttribute('value') === 'knapsack');
  assert.equal(opt.disabled, true);
  const card = p.doc.byId['run-methods'].children.find((c) => c.getAttribute('data-policy') === 'knapsack');
  assert.equal(card.disabled, true);
  p.A.player.choosePolicy('knapsack');
  assert.notEqual(p.A.store.get().policies[0], 'knapsack');
});

test('which jobs: the big case is 500 fixed jobs on 32 cores and 128 GB and ends the old run', () => {
  const p = ready({ totalSteps: 10 });
  const P = p.A.player;
  P.start();
  p.doc.byId['run-source-big'].click();
  assert.equal(P.snapshot().status, 'idle');
  assert.equal(P.snapshot().source, 'big');
  assert.equal(p.doc.byId['run-source-big'].getAttribute('aria-pressed'), 'true');
  assert.equal(p.doc.byId['run-dataline'].textContent, '500 jobs on 32 cores and 131072 MB (128 GB).');
  P.start();
  assert.deepEqual(plain(p.fe.args.slice(0, 2)), [32, 131072]);
  assert.equal(p.fe.sims.get(P.handle()).jobs.length, 500);
  const a = p.A.generator.bigCase(), b = p.A.generator.bigCase();
  assert.deepEqual(plain(a), plain(b), 'the same every time');
  assert.ok(a.jobs.every((j) => j.cpu >= 1 && j.cpu <= 10 && j.mem % 1024 === 0 && j.mem <= 24576 && j.priority >= 0 && j.priority <= 9));
  assert.equal(P.frame().large, true);
  p.doc.byId['run-source-yours'].click();
  assert.equal(P.snapshot().status, 'idle');
});

test('a big case plays by ticks: every event up to a few ticks later in one beat', () => {
  const p = ready({ totalSteps: 300 });
  p.doc.byId['run-source-big'].click();
  const P = p.A.player;
  P.start(); P.play();
  p.sched.run();
  assert.equal(p.sched.delays[0], P.LARGE_BEAT_MS);
  const n = P.snapshot().events;
  assert.ok(n > 1, 'more than one event per beat: ' + n);
  assert.ok(P.snapshot().state.now <= 4 + 1, 'about 2 x 2 ticks per beat at 1x for 500 jobs');
});

test('leaving Run mode pauses; the panel is shown only in Run mode', () => {
  const p = ready({ totalSteps: 100 });
  const P = p.A.player;
  p.A.store.setMode('run');
  assert.equal(p.doc.byId['run-panel'].hidden, false);
  P.start(); P.play();
  p.A.store.setMode('build');
  assert.equal(P.snapshot().status, 'paused');
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

test('waiting table: engine order, priority, score, saved tag; a click selects, a second clears', () => {
  const p = ready({ totalSteps: 10 });
  p.A.store.setPolicies(['aging']);
  p.A.player.start(); p.A.player.stepOnce(); p.A.player.stepOnce(); p.A.player.stepOnce(); p.A.player.stepOnce();
  const body = p.doc.byId['wait-body'];
  const st = p.A.player.snapshot().state;
  assert.equal(p.doc.byId['wait-title'].textContent, 'Waiting (' + st.waiting.length + ')');
  assert.deepEqual(plain(body.children.map((r) => Number(r.getAttribute('data-job')))), plain(st.waiting.map((w) => w.id)));
  const first = body.children[0];
  assert.equal(first.children[0].textContent, '1');
  assert.equal(first.children[1].tag, 'th', 'the job cell heads its row');
  assert.match(first.children[1].textContent, /^Job 7 · spot saved$/);
  assert.equal(first.children[3].textContent, '6.2', 'the engine score, rounded to two decimals as the design shows it');
  assert.equal(first.getAttribute('tabindex'), '0', 'one Tab stop for the table');
  body.fire('click', { target: first });
  assert.equal(p.A.player.snapshot().selected, 7);
  body.fire('click', { target: first });
  assert.equal(p.A.player.snapshot().selected, null);
  p.A.store.setDetails(true);
  const head = p.doc.byId['wait-head'].children.map((c) => c.textContent);
  assert.deepEqual(plain(head), ['Queue order', 'Job', 'Priority', 'Score', 'Sort key']);
  assert.equal(body.children[0].children[4].textContent, '−6.2, arrival 0', 'the design writes the aging key as minus the score');
});

test('running table and machine use: the engine numbers; the saved-spot card says when', () => {
  const p = ready({ totalSteps: 10 });
  p.A.player.start(); p.A.player.stepOnce(); p.A.player.stepOnce(); p.A.player.stepOnce(); p.A.player.stepOnce();
  const rows = p.doc.byId['running-body'].children;
  assert.equal(p.doc.byId['running-title'].textContent, 'Running (2)');
  assert.deepEqual(plain(rows[0].children.map((c) => c.textContent)), ['Job 1', '0', '5', '8', '4096']);
  assert.equal(p.doc.byId['res-cpu-bar'].style.transform, 'scaleX(0.7500)');
  assert.equal(p.doc.byId['reserve-card'].hidden, false);
  assert.match(p.doc.byId['reserve-line'].textContent, /^Job 7 starts by tick 9\. Until then \d+ cores and \d+ MB stay free\.$/);
});

test('tables keep only 100 rows on the page, but the heading and the note stay true', () => {
  const p = ready({ totalSteps: 10 });
  p.A.player.start(); p.A.player.stepOnce(); p.A.player.stepOnce();
  const st = p.A.player.snapshot().state;
  st.waiting = Array.from({ length: 140 }, (_, i) => ({ id: i + 100, score: null, priority: 1, arrival: 0, duration: 1, cpu: 1, mem: 1 }));
  p.A.player.select(100);
  assert.equal(p.doc.byId['wait-body'].children.length, 100);
  assert.equal(p.doc.byId['wait-title'].textContent, 'Waiting (140)');
  assert.equal(p.doc.byId['wait-more'].textContent, 'Showing the first 100 of 140.');
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
    p.A.runpanels.mount();
    return p;
  };
  const drain = (p) => { let n = 0; while (p.sched.timers.length) { p.sched.run(); n++; } return n; };
  const csvRows = (text) => text.trim().split('\n').slice(1).map((l) => l.split(',').map(Number));

  for (const policy of ['fcfs', 'priority', 'sjf', 'aging', 'aging_reserve', 'knapsack']) {
    test('real engine: preset memory_hog under ' + policy + ' played to the end equals the console program', async () => {
      const p = await realPage();
      const preset = p.A.presets.load('memory_hog');
      p.A.store.setPolicies([policy]);
      const P = p.A.player;
      P.setSpeed(4);
      assert.equal(P.start(), true, P.snapshot().error);
      P.play();
      drain(p);
      assert.equal(P.snapshot().status, 'finished');
      const rows = p.A.wasm.results(P.handle()).map((r) => [r.id, r.arrival, r.start, r.finish, r.wait, r.turnaround, r.priority, r.cpu, r.mem]);
      assert.equal(P.snapshot().events, p.A.wasm.log(P.handle(), 0).length, 'every log entry was shown, one per beat');
      if (existsSync(cli)) {
        const dir = mkdtempSync(join(tmpdir(), 'k51-'));
        const out = join(dir, 'out.csv'); const met = join(dir, 'm.json');
        const r = spawnSync(cli, ['--policy', policy === 'aging_reserve' ? 'reserve' : policy, '--in', join(root, 'data', 'presets', 'memory_hog.csv'), '--out', out, '--metrics', met,
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

  test('real engine: numbers on the page equal the engine JSON at every moment end, six presets x six schedulers', async () => {
    const p = await realPage();
    const P = p.A.player;
    let checked = 0;
    for (const preset of p.A.presets.all()) {
      for (const policy of P.POLICY_NAMES) {
        p.A.presets.load(preset.name);
        p.A.store.setPolicies([policy]);
        assert.equal(P.start(), true, preset.name + ' ' + policy);
        while (P.snapshot().status !== 'finished') {
          P.stepOnce();
          const s = P.snapshot();
          if (s.pending === 0 && s.status !== 'finished') {
            const eng = p.A.wasm.state(P.handle());
            assert.deepEqual(plain(p.A.runmodel.diff(s.state, eng)), [], preset.name + ' ' + policy + ' tick ' + eng.now);
            const used = eng.cap.cpu - eng.free.cpu;
            assert.equal(p.doc.byId['res-cpu-text'].textContent, used + ' of ' + eng.cap.cpu + ' cores busy, ' + eng.free.cpu + ' free');
            assert.equal(p.doc.byId['run-clock'].textContent, 'Time: tick ' + eng.now);
            checked++;
          }
        }
        const m = p.A.wasm.metrics(P.handle());
        assert.deepEqual(plain(P.snapshot().metrics), plain(m), 'final metrics are the engine metrics');
        assert.equal(P.snapshot().state.done, preset.jobs.length);
      }
    }
    assert.ok(checked > 200, checked + ' moment ends checked');
    P.reset();
  });

  test('real engine: pausing in the middle of a jump shows exactly the engine state', async () => {
    const p = await realPage();
    const jobs = [];
    for (let i = 0; i < 3000; i++) jobs.push({ id: i + 1, arrival: Math.floor(i / 3), duration: 1 + (i % 7), cpu: 1 + (i % 3), mem: 64, priority: i % 10 });
    p.A.store.setJobs(jobs);
    p.A.store.setPolicies(['aging']);
    const P = p.A.player;
    P.start(); P.jumpToEnd(); p.sched.run();
    assert.equal(P.snapshot().status, 'jumping');
    P.pause();
    const s = P.snapshot();
    assert.deepEqual(plain(p.A.runmodel.diff(s.state, p.A.wasm.state(P.handle()))), []);
    assert.deepEqual(plain(s.metrics), plain(p.A.wasm.metrics(P.handle())));
    P.reset();
  });

  test('real engine: jump to end equals event-by-event play (same schedule, same events)', async () => {
    const results = [];
    for (const mode of ['play', 'jump']) {
      const p = await realPage();
      p.A.presets.load('priority_starvation');
      p.A.store.setPolicies(['aging']);
      p.A.player.start();
      if (mode === 'play') { p.A.player.setSpeed(4); p.A.player.play(); } else { p.A.player.jumpToEnd(); }
      drain(p);
      results.push(JSON.stringify(p.A.wasm.results(p.A.player.handle())) + '|' + p.A.player.snapshot().events + '|' + JSON.stringify(p.A.player.snapshot().bars));
    }
    assert.equal(results[0], results[1]);
  });

  test('real engine: a job added mid-run (arrival now+1 and arrival now) appears and is scheduled', async () => {
    const p = await realPage();
    p.A.store.setMachine(4, 1000);
    p.A.store.setJobs([{ id: 1, arrival: 0, duration: 10, cpu: 4, mem: 100, priority: 5 }, { id: 2, arrival: 1, duration: 3, cpu: 1, mem: 100, priority: 5 }]);
    p.A.store.setPolicies(['fcfs']);
    const P = p.A.player;
    P.start(); P.stepOnce(); P.stepOnce(); P.stepOnce();
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
      p.A.store.setPolicies(['aging_reserve']);
      const P = p.A.player;
      assert.equal(P.start(), true, preset.name + ': ' + P.snapshot().error);
      P.stepOnce(); P.stepOnce();
      P.setSpeed(4); P.play(); drain(p);
      assert.equal(P.snapshot().status, 'finished', preset.name);
      assert.equal(P.snapshot().state.done, preset.jobs.length, preset.name);
      assert.equal(p.doc.byId['metrics-list'].children.length, 7, 'drawn');
      assert.equal(p.doc.byId['metrics-note'].textContent, 'All jobs finished');
    }
    p.A.player.reset();
  });

  test('real engine: 5000 jobs, jump to end in slices of at most 500 moments, handle freed on reset', async () => {
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
    while (p.sched.timers.length) { p.sched.run(); slices++; }
    assert.equal(P.snapshot().status, 'finished');
    assert.equal(P.snapshot().state.done, 5000);
    assert.equal(P.snapshot().events, p.A.wasm.log(P.handle(), 0).length);
    assert.ok(slices >= 2, 'sliced: ' + slices);
    console.log('     5000-job jump: ' + slices + ' slices, ' + P.snapshot().events + ' events, ' + (Date.now() - t0) + ' ms');
    const h = P.handle();
    P.reset();
    assert.throws(() => p.A.wasm.state(h));                  // the handle is really gone
  });

  test('real engine: the 500-job big case, one beat at 4x is fast', async () => {
    const p = await realPage();
    const P = p.A.player;
    P.setSource('big');
    p.A.store.setPolicies(['aging']);
    P.start(); P.setSpeed(4); P.play();
    const t0 = Date.now();
    p.sched.run(); p.sched.run();
    const ms = Date.now() - t0;
    assert.ok(P.snapshot().events > 2);
    console.log('     500 jobs, two beats at 4x: ' + ms + ' ms, ' + P.snapshot().events + ' events');
    assert.ok(ms < 400, 'beats took ' + ms + ' ms');
    P.reset();
  });

  test('real engine: once finished, Step and Jump are off and Play replays from the start (the design)', async () => {
    const p = await realPage();
    p.A.store.setJobs([{ id: 1, arrival: 0, duration: 2, cpu: 1, mem: 1, priority: 1 }]);
    p.A.store.setPolicies(['fcfs']);
    const P = p.A.player;
    P.start(); P.jumpToEnd();
    drain(p);
    assert.equal(P.snapshot().status, 'finished');
    assert.equal(p.doc.byId['run-play'].disabled, false, 'Play replays the run');
    assert.equal(p.doc.byId['run-step'].disabled, true, 'nothing left to step');
    assert.equal(p.doc.byId['run-jump'].disabled, true);
    assert.equal(p.doc.byId['run-reset'].disabled, false, 'Reset stays live');
    p.doc.byId['run-play'].click();
    assert.ok(['playing', 'paused'].includes(P.snapshot().status), 'a fresh run started');
    assert.equal(P.snapshot().events, 0, 'from the first event');
    P.reset();
    assert.equal(p.doc.byId['run-play'].disabled, false, 'jobs are loaded, so Play is live again');
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
