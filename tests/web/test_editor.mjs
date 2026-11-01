// test_editor.mjs: tests for Build mode (K-24): editor.js, generator.js, presets.js.
// Run: node tests/web/test_editor.mjs
// Loads the real web/js scripts into a node:vm context with a tiny fake DOM built from
// the ids in the real index.html. If web/vendor/aprm.js and build/aprm exist, error
// messages are compared with the real engine and exported CSV is run through the CLI.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { parseJobs, CsvFail } from '../../wasm/csv_parse.mjs';

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
    this.hidden = false; this.value = ''; this.files = null;
  }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.children = String(v) === '' ? [] : [new Text(String(v))]; }
  get firstChild() { return this.children[0] || null; }
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { this.children.splice(this.children.indexOf(c), 1); return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  fire(type) { for (const fn of this.listeners[type] || []) fn({ currentTarget: this }); }
  click() { this.fire('click'); }
  get cls() { return this.attrs.class || ''; }
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
  const buttons = [...html.matchAll(/data-mode-button="([^"]+)"/g)].map((m) => {
    const b = new El('button'); b.setAttribute('data-mode-button', m[1]); return b;
  });
  return {
    byId, body: new El('body'),
    getElementById: (id) => byId[id] || null,
    createElement: (t) => new El(t),
    createTextNode: (t) => new Text(t),
    querySelectorAll: (sel) => (sel === '[data-mode-button]' ? buttons : []),
  };
}

const srcs = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^https?:/.test(u));

// A page with the real scripts. start=false leaves out app.js (no engine needed); the Build
// scripts are then mounted by hand, exactly as app.js does.
function page({ app = false } = {}) {
  const doc = fakeDocument();
  const win = { document: doc, console, Blob: class { constructor(p, o) { this.parts = p; this.type = o && o.type; } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }, Uint8Array, BigInt };
  win.window = win;
  const ctx = vm.createContext(win);
  for (const s of srcs) {
    if (s.startsWith('vendor/')) continue;
    if (s === 'js/app.js' && !app) continue;
    vm.runInContext(read(s), ctx, { filename: s });
  }
  const A = ctx.APRM;
  if (!app) for (const n of ['presets', 'editor', 'generator']) A[n].mount();
  return { ctx, doc, A, el: (id) => doc.byId[id] };
}
const msgs = (list) => plain(list.map((e) => e.message));

// ---------- static: the new scripts are wired in PRD order ----------
test('index.html lists presets_data, presets, editor, generator before app.js', () => {
  const want = ['js/presets_data.js', 'js/presets.js', 'js/editor.js', 'js/generator.js', 'js/app.js'];
  const at = want.map((w) => srcs.indexOf(w));
  assert.ok(at.every((i) => i >= 0), String(srcs));
  assert.deepEqual(at, [...at].sort((a, b) => a - b));
});

test('scripts attach only to window.APRM', () => {
  const { ctx } = page();
  const names = Object.getOwnPropertyNames(ctx).filter((k) => !['document', 'console', 'Blob', 'URL', 'Uint8Array', 'BigInt', 'window'].includes(k));
  assert.deepEqual(names.filter((n) => !/^[A-Z][A-Za-z0-9]*$/.test(n) || n !== 'APRM'), []);
  assert.ok(ctx.APRM.editor && ctx.APRM.generator && ctx.APRM.presets);
});

// ---------- validation messages equal the engine's ----------
const GOOD = { id: 1, arrival: 0, duration: 5, cpu: 2, mem: 100, priority: 1 };
const MACHINE = { cpu: 16, mem: 32768 };

test('field messages use the same words as core/engine.c', () => {
  const { A } = page();
  const E = A.editor;
  const bad = { id: -1, arrival: 1e9 + 1, duration: 0, cpu: 0, mem: 0, priority: 10 };
  const want = {
    id: 'id must be 0 to 2147483647.', arrival: 'arrival must be 0 to 1000000000.',
    duration: 'duration must be 1 to 1000000.', cpu: 'cpu must be at least 1.',
    mem: 'mem must be at least 1.', priority: 'priority must be 0 to 9.',
  };
  for (const f of Object.keys(want)) {
    assert.equal(E.fieldProblem(f, bad[f]), want[f]);
    assert.equal(E.fieldProblem(f, GOOD[f]), null);
    assert.equal(E.fieldProblem(f, 1.5), want[f]);          // not a whole number
  }
  assert.equal(E.capacityProblem('cpu', 0), 'cpu_cap must be 1 to 1000000.');
  assert.equal(E.capacityProblem('mem', 1e9 + 1), 'mem_cap must be 1 to 1000000000.');
  assert.equal(E.capacityProblem('cpu', 16), null);
  assert.deepEqual(plain(E.jobProblems({ ...GOOD, id: 4, mem: 40960 }, MACHINE)),
    [{ field: 'mem', message: 'Job 4 needs 40960 MB; machine has 32768 MB.' }]);
  assert.deepEqual(plain(E.jobProblems({ ...GOOD, id: 4, cpu: 40 }, MACHINE)),
    [{ field: 'cpu', message: 'Job 4 needs 40 cores; machine has 16 cores.' }]);
  assert.deepEqual(plain(E.allProblems([GOOD, { ...GOOD }], MACHINE)),
    [{ index: 1, field: 'id', message: 'Job id 1 already exists.' }]);
});

const vendor = join(web, 'vendor', 'aprm.js');
const haveEngine = existsSync(vendor) && readFileSync(vendor).length > 0;
if (haveEngine) {
  test('real engine: the first message for each bad job equals aprm_last_error', async () => {
    const M = await require(vendor)();
    const { A } = page();
    const cases = [
      [{ ...GOOD, id: -1 }], [{ ...GOOD, arrival: -1 }], [{ ...GOOD, arrival: 1e9 + 1 }],
      [{ ...GOOD, duration: 0 }], [{ ...GOOD, duration: 1e6 + 1 }], [{ ...GOOD, cpu: 0 }],
      [{ ...GOOD, mem: 0 }], [{ ...GOOD, priority: -1 }], [{ ...GOOD, priority: 10 }],
      [{ ...GOOD, id: 4, cpu: 17 }], [{ ...GOOD, id: 4, mem: 40960 }],
    ];
    for (const [job] of cases) {
      const h = M._aprm_create(16, 32768, 0, 100, 50, 100);
      const rc = M._aprm_add_job(h, job.id, job.arrival, job.duration, job.cpu, job.mem, job.priority);
      assert.ok(rc < 0, JSON.stringify(job));
      const eng = JSON.parse(M.UTF8ToString(M._aprm_last_error(h))).error;
      const mine = A.editor.jobProblems(job, MACHINE)[0];
      assert.equal(mine.message, eng.message);
      assert.equal(mine.field, eng.field);
      M._aprm_destroy(h);
    }
    for (const [which, v] of [['cpu', 0], ['cpu', 1000001], ['mem', 0], ['mem', 1e9 + 1]]) {
      const h = which === 'cpu' ? M._aprm_create(v, 100, 0, 100, 50, 100) : M._aprm_create(4, v, 0, 100, 50, 100);
      assert.ok(h < 0);
      const eng = JSON.parse(M.UTF8ToString(M._aprm_last_error(0))).error;
      assert.equal(A.editor.capacityProblem(which, v), eng.message);
    }
    const h = M._aprm_create(16, 32768, 0, 100, 50, 100);
    M._aprm_add_job(h, 1, 0, 5, 2, 100, 1);
    assert.ok(M._aprm_add_job(h, 1, 0, 5, 2, 100, 1) < 0);
    assert.equal(JSON.parse(M.UTF8ToString(M._aprm_last_error(h))).error.message,
      A.editor.allProblems([GOOD, GOOD], MACHINE)[0].message);
  });
} else {
  console.log('note: web/vendor/aprm.js not built; real-engine message test skipped');
}

// ---------- CSV: same reader behaviour as core/csv.c (via csv_parse.mjs) ----------
const PIN = [627073, 2735, 527447];
const H = 'id,arrival,duration,cpu,mem,priority\n';
test('parseCsv: first error equals the C reader (csv_parse.mjs) on a corpus', () => {
  const { A } = page();
  const corpus = [
    '', 'id\n', H.replace('id,', 'ID,'), H, H + '1,0,5,2,100,1\n', H + '1,0,5,2,100,1', H + '1,0,5,2,100,1\r\n2,1,5,2,100,1\r\n',
    H + '1,0,5,2,100\n', H + '1,0,5,2,100,1,7\n', H + 'a,0,5,2,100,1\n', H + '1,0,5,2,100,10\n',
    H + '1,0,0,2,100,1\n', H + '1,0,5,0,100,1\n', H + '1,0,5,2,0,1\n', H + '-1,0,5,2,100,1\n', H + '1, 0,5,2,100,1\n',
    H + '1,0,5,2,100,1\n\n', H + '1,0,5,2,100,1\n2,0,5,2,100,1\n3,0,x,2,100,1\n', H + '99999999999999999999,0,5,2,100,1\n',
    H + '1,1000000001,5,2,100,1\n', H + '1,0,5,2,100,1\n1,0,5,2,100,1\n', H + 'x'.repeat(300) + '\n', 'x'.repeat(300) + '\n',
    H + '1,0,5,2,100,+1\n', H + '1,0,5,2,100,1\r', H + '\r\n',
  ];
  for (const text of corpus) {
    let c = null;
    try { parseJobs(text, 5000); } catch (e) { if (e instanceof CsvFail) c = e; else throw e; }
    const mine = A.editor.parseCsv(text, 5000);
    if (c === null) assert.equal(mine.errors.length, 0, JSON.stringify(text));
    else {
      assert.ok(mine.errors.length > 0, JSON.stringify(text));
      assert.equal(mine.errors[0].code, c.code, JSON.stringify(text));
      assert.equal(mine.errors[0].line, c.line);
      assert.equal(mine.errors[0].column, c.column);
      assert.equal(mine.errors[0].message, c.message.replace(/^[A-Z_]+: /, ''));
    }
  }
  // limit
  const rows = H + '1,0,5,2,100,1\n2,0,5,2,100,1\n3,0,5,2,100,1\n';
  let lim = null; try { parseJobs(rows, 2); } catch (e) { lim = e; }
  const mine = A.editor.parseCsv(rows, 2);
  assert.equal(mine.errors[0].message, lim.message.replace(/^[A-Z_]+: /, ''));
  assert.equal(mine.jobs.length, 2);
});

test('bad-rows: three bad rows are all listed with line numbers, none dropped silently', () => {
  const { A, el } = page();
  const text = H + '1,0,5,2,100,1\n2,0,5,2,100,12\nx,0,5,2,100,1\n4,0,5,2,100,1\n5,0,5,2\n6,0,5,2,100,1\n';
  const res = A.editor.importText(text, text.length);
  assert.equal(res.ok, false);
  assert.equal(res.imported, 3);
  assert.deepEqual(msgs(res.errors), [
    'Line 3, column priority: must be 0 to 9.', 'Line 4, column id: not a number.', 'Line 6: expected 6 columns, found 4.']);
  assert.equal(A.store.get().jobs.length, 3);
  assert.match(res.message, /3 bad rows were not imported/);
});

test('big-file: a 2 MB file is rejected with a message; exactly 1 MB is not', () => {
  const { A } = page();
  A.store.setJobs([GOOD]);
  const big = H + '1,0,5,2,100,1\n'.repeat(150000);
  assert.ok(big.length > 2 * 1024 * 1024 - 100);
  const res = A.editor.importText(big, 2 * 1024 * 1024);
  assert.equal(res.ok, false);
  assert.equal(res.tooBig, true);
  assert.match(res.message, /limit is 1048576 bytes \(1 MB\)/);
  assert.equal(A.store.get().jobs.length, 1, 'table unchanged');
  assert.equal(A.editor.importText(H, 1048576).tooBig, false);
  assert.equal(A.editor.importText(H, 1048577).tooBig, true);
});

test('row limit: more than 5000 jobs gives LIMIT_REACHED text and stops', () => {
  const { A } = page();
  let t = H;
  for (let i = 0; i < 5001; i++) t += `${i},0,1,1,1,0\n`;
  const res = A.editor.importText(t, t.length);
  assert.equal(res.imported, 5000);
  assert.deepEqual(msgs(res.errors), ['Line 5002: more than 5000 jobs.']);
});

test('roundtrip: export then import gives the same case, in PRD section 5 format', () => {
  const { A } = page();
  const jobs = [
    { id: 7, arrival: 3, duration: 9, cpu: 4, mem: 2048, priority: 9 },
    { id: 0, arrival: 0, duration: 1, cpu: 1, mem: 1, priority: 0 },
    { id: 2147483647, arrival: 1000000000, duration: 1000000, cpu: 16, mem: 32768, priority: 5 },
  ];
  const text = A.editor.exportCsv(jobs);
  assert.equal(text, 'id,arrival,duration,cpu,mem,priority\n7,3,9,4,2048,9\n0,0,1,1,1,0\n2147483647,1000000000,1000000,16,32768,5\n');
  const res = A.editor.importText(text, text.length);
  assert.equal(res.ok, true);
  assert.deepEqual(plain(A.store.get().jobs), jobs);
  assert.equal(A.editor.exportCsv(A.store.get().jobs), text);
  assert.equal(A.editor.exportCsv([]), 'id,arrival,duration,cpu,mem,priority\n');
  // Windows line ends import too
  const crlf = A.editor.importText(text.replace(/\n/g, '\r\n'), text.length);
  assert.equal(crlf.ok, true);
  assert.deepEqual(plain(A.store.get().jobs), jobs);
});

test('bytes: latin1 decoding keeps one character per byte', () => {
  const { A } = page();
  const s = A.editor.bytesToLatin1(Buffer.from([0x69, 0xc3, 0xa9, 0x0a]));
  assert.equal(s.length, 4);
  assert.equal(A.editor.bytesToLatin1(new Uint8Array(20000).fill(65)).length, 20000);
});

const cli = join(root, 'build', 'aprm');
if (existsSync(cli)) {
  test('exported CSV is read by build/aprm (the C reader) and gives one result row per job', () => {
    const { A } = page();
    const dir = mkdtempSync(join(tmpdir(), 'aprm-k24-'));
    for (const name of ['big_job_trap', 'priority_starvation', 'memory_hog', 'sjf_starvation', 'heavy_load', 'tiny_case']) {
      const p = A.presets.load(name);
      const jobs = A.store.get().jobs;
      writeFileSync(join(dir, name + '.csv'), A.editor.exportCsv(jobs));
      const r = spawnSync(cli, ['--in', join(dir, name + '.csv'), '--out', join(dir, name + '.out.csv'),
        '--policy', 'fcfs', '--cpu', String(p.cpu_cap), '--mem', String(p.mem_cap)], { encoding: 'utf8' });
      assert.equal(r.status, 0, name + ': ' + r.stderr);
      const out = readFileSync(join(dir, name + '.out.csv'), 'utf8').trim().split('\n');
      assert.equal(out.length, jobs.length + 1, name);
      // and the web export is byte-identical to the committed master CSV of the preset
      const master = join(root, 'data', 'presets', name + '.csv');
      if (existsSync(master)) assert.equal(A.editor.exportCsv(jobs), readFileSync(master, 'utf8'), name);
    }
    // a generated case runs too
    A.store.setJobs(A.generator.generate({ seed: 5, count: 40 }, { cpu: 16, mem: 32768 }));
    writeFileSync(join(dir, 'gen.csv'), A.editor.exportCsv(A.store.get().jobs));
    const r = spawnSync(cli, ['--in', join(dir, 'gen.csv'), '--out', join(dir, 'gen.out.csv')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });
} else {
  console.log('note: build/aprm not built; CLI round-trip test skipped');
}

// ---------- the table (UI) ----------
test('over-capacity: a job with mem > capacity gets a red cell and the engine message', () => {
  const { A, el } = page();
  A.store.setJobs([{ ...GOOD, id: 4, mem: 40960 }, { ...GOOD, id: 5 }]);
  const rows = el('job-body').children;
  assert.equal(rows.length, 2);
  const memCell = rows[0].children[4];
  assert.equal(memCell.cls, 'cell-error');
  assert.equal(memCell.children[0].cls, 'cell-error');
  assert.equal(memCell.getAttribute('title'), 'Job 4 needs 40960 MB; machine has 32768 MB.');
  assert.equal(rows[0].children[6].textContent, 'Job 4 needs 40960 MB; machine has 32768 MB.');
  assert.equal(rows[0].children[3].cls, '');
  assert.equal(rows[1].children[6].textContent, '');
  assert.match(el('table-summary').textContent, /1 problem marked in red/);
  // raising the capacity clears it
  el('mem-input').value = '65536'; el('mem-input').fire('change');
  assert.equal(A.store.get().machine.mem, 65536);
  assert.equal(el('job-body').children[0].children[4].cls, '');
});

test('capacity inputs: bad values show the message next to the field and do not reach the store', () => {
  const { A, el } = page();
  el('cpu-input').value = '0'; el('cpu-input').fire('change');
  assert.equal(el('cpu-error').textContent, 'cpu_cap must be 1 to 1000000.');
  assert.equal(el('cpu-error').hidden, false);
  assert.equal(A.store.get().machine.cpu, 16);
  el('cpu-input').value = 'abc'; el('cpu-input').fire('change');
  assert.equal(el('cpu-error').textContent, 'cpu_cap must be a whole number.');
  el('cpu-input').value = '8'; el('cpu-input').fire('change');
  assert.equal(el('cpu-error').hidden, true);
  assert.equal(A.store.get().machine.cpu, 8);
});

test('add job: valid job is added; invalid ones show messages and are not added', () => {
  const { A, el } = page();
  const set = (o) => { for (const k of Object.keys(o)) el('add-' + k).value = String(o[k]); };
  set({ id: 1, arrival: 0, duration: 5, cpu: 2, mem: 100, priority: 1 });
  assert.equal(A.editor.addFromForm(), true);
  assert.equal(A.store.get().jobs.length, 1);
  assert.equal(el('add-id').value, '2');                    // next free id offered
  set({ id: 1 });
  assert.equal(A.editor.addFromForm(), false);
  assert.equal(el('add-error').textContent, 'Job id 1 already exists.');
  assert.equal(el('add-id').cls, 'cell-error');
  set({ id: 2, priority: 10, cpu: 99 });
  assert.equal(A.editor.addFromForm(), false);
  assert.match(el('add-error').textContent, /priority must be 0 to 9\./);
  assert.match(el('add-error').textContent, /Job 2 needs 99 cores; machine has 16 cores\./);
  assert.equal(el('add-priority').cls, 'cell-error');
  set({ priority: 'x', cpu: 1 });
  assert.equal(A.editor.addFromForm(), false);
  assert.equal(el('add-error').textContent, 'priority: not a number.');
  assert.equal(A.store.get().jobs.length, 1);
});

test('edit and delete: a cell edit updates the store, junk text stays in the cell with a message', () => {
  const { A, el } = page();
  A.store.setJobs([{ ...GOOD, id: 1 }, { ...GOOD, id: 2 }]);
  let cell = el('job-body').children[0].children[2].children[0];
  cell.value = '9'; cell.fire('change');
  assert.equal(A.store.get().jobs[0].duration, 9);
  cell = el('job-body').children[0].children[2].children[0];
  cell.value = 'zz'; cell.fire('change');
  assert.equal(A.store.get().jobs[0].duration, 9, 'store keeps the last good value');
  const row = el('job-body').children[0];
  assert.equal(row.children[2].children[0].value, 'zz');
  assert.equal(row.children[2].cls, 'cell-error');
  assert.equal(row.children[6].textContent, 'duration: not a number.');
  cell = row.children[5].children[0];
  cell.value = '11'; cell.fire('change');                  // out of range is kept and flagged
  assert.equal(A.store.get().jobs[0].priority, 11);
  assert.equal(el('job-body').children[0].children[6].textContent.includes('priority must be 0 to 9.'), true);
  el('job-body').children[1].children[7].children[0].click();
  assert.deepEqual(plain(A.store.get().jobs.map((j) => j.id)), [1]);
  assert.equal(A.store.get().jobs.length, 1);
  A.store.setJobs([]);
  assert.equal(el('table-empty').hidden, false);
  assert.equal(el('job-body').children.length, 0);
});

test('markup in text stays text: preset text and messages never become elements', () => {
  const { A, el } = page();
  const res = A.editor.importText(H + '<img src=x onerror=alert(1)>,0,5,2,100,1\n', 1000);
  assert.equal(res.errors[0].message, 'Line 2, column id: not a number.');   // fixed words, the file text is not echoed
  assert.ok(!res.message.includes('<'));
  // a typed cell value is only ever put in a text input's value and a text node
  A.store.setJobs([GOOD]);
  const cell = el('job-body').children[0].children[0].children[0];
  cell.value = '<b>x</b>'; cell.fire('change');
  const row = el('job-body').children[0];
  assert.equal(row.children[0].children[0].value, '<b>x</b>');
  assert.equal(row.children[6].textContent, 'id: not a number.');
  for (const c of row.children) assert.ok(c.children.every((k) => k.tag !== 'b'));
});

test('file input: size check happens before reading; a file is read as bytes and shown', async () => {
  const { A, el, ctx } = page();
  ctx.FileReader = class {
    readAsArrayBuffer(f) { this.result = f.bytes; setTimeout(() => this.onload(), 0); }
  };
  const input = el('csv-file');
  input.files = [{ size: 3 * 1024 * 1024, bytes: null }];
  input.fire('change');
  assert.match(el('csv-status').textContent, /limit is 1048576 bytes/);
  const text = H + '1,0,5,2,100,1\nq,0,5,2,100,1\n';
  input.files = [{ size: text.length, bytes: Buffer.from(text, 'latin1') }];
  input.fire('change');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(A.store.get().jobs.length, 1);
  assert.equal(el('csv-status').cls, 'status-bad');
  assert.equal(el('csv-errors').hidden, false);
  assert.deepEqual(plain(el('csv-errors').children.map((c) => c.textContent)), ['Line 3, column id: not a number.']);
});

test('hostile 1 MB files: stored errors are capped, every bad row is still counted and announced', () => {
  const { A, el, ctx } = page();
  ctx.FileReader = class { readAsArrayBuffer(f) { this.result = f.bytes; setTimeout(() => this.onload(), 0); } };
  const cases = [['newlines', '\n', 1048576 - H.length], ['x lines', 'x\n', (1048576 - H.length) >> 1]];
  for (const [name, unit, reps] of cases) {
    const text = H + unit.repeat(reps);
    const t0 = Date.now();
    const res = A.editor.importText(text, text.length);
    assert.ok(Date.now() - t0 < 3000, name + ': bounded time');
    assert.equal(res.errorCount, reps, name + ': all bad rows counted');
    assert.equal(res.errors.length, 1000, name + ': stored errors capped');
    assert.equal(res.ok, false);
    assert.match(res.message, new RegExp(reps + ' bad rows were not imported'));
    A.store.setJobs([]);
  }
  const text = H + 'x\n'.repeat(5000);
  const res = A.editor.importText(text, text.length);
  const doc = el('csv-errors');
  // show it through the file path
  const input = el('csv-file');
  input.files = [{ size: text.length, bytes: Buffer.from(text, 'latin1') }];
  return new Promise((done) => { input.fire('change'); setTimeout(() => {
    const kids = doc.children.map((c) => c.textContent);
    assert.equal(kids.length, 201);
    assert.equal(kids[200], '... and 4800 more bad rows not shown.');
    assert.equal(res.errorCount, 5000);
    done();
  }, 10); });
});

test('export button: refuses an empty table and out-of-range jobs, else offers jobs.csv', () => {
  const { A, el } = page();
  el('csv-export').click();
  assert.match(el('csv-status').textContent, /empty/);
  A.store.setJobs([{ ...GOOD, priority: 12 }]);
  el('csv-export').click();
  assert.match(el('csv-status').textContent, /out of range/);
  A.store.setJobs([GOOD]);
  el('csv-export').click();
  assert.equal(el('csv-status').textContent, 'Exported 1 jobs to jobs.csv.');
});

// ---------- presets ----------
test('presets-load: every one of the six loads capacities, settings and jobs, as a copy', () => {
  const { A, el } = page();
  const names = ['big_job_trap', 'priority_starvation', 'memory_hog', 'sjf_starvation', 'heavy_load', 'tiny_case'];
  assert.deepEqual(plain(A.presets.all().map((p) => p.name).sort()), [...names].sort());
  const select = el('preset-select');
  assert.equal(select.children.length, 6);
  for (const name of names) {
    const p = A.presets.find(name);
    select.value = name; select.fire('change');
    assert.equal(el('preset-desc').textContent, p.description);
    el('preset-load').click();
    const st = A.store.get();
    assert.equal(st.machine.cpu, p.cpu_cap, name);
    assert.equal(st.machine.mem, p.mem_cap, name);
    assert.equal(st.settings.alphaMilli, p.alpha_milli);
    assert.equal(st.settings.threshold, p.threshold);
    assert.equal(st.jobs.length, p.jobs.length);
    assert.equal(el('job-body').children.length, p.jobs.length, 'table rows');
    assert.equal(el('cpu-input').value, String(p.cpu_cap));
    assert.deepEqual(plain(A.editor.allProblems(st.jobs, st.machine)), [], name + ' has no problems');
  }
  assert.equal(A.presets.load('nope'), null);
  // a preset is copied: editing the table never changes the preset data
  A.presets.load('tiny_case');
  const cell = el('job-body').children[0].children[2].children[0];
  const before = A.presets.find('tiny_case').jobs[0].duration;
  cell.value = '77'; cell.fire('change');
  assert.equal(A.presets.find('tiny_case').jobs[0].duration, before);
});

test('presets-load through app.js: the picker is filled when the page starts', async () => {
  const { A, el } = page({ app: true });
  assert.equal(el('preset-select').children.length, 6);
  el('preset-load').click();
  assert.ok(A.store.get().jobs.length > 0);
  A.store.setMode('run');
  assert.equal(el('build-panel').hidden, true);
  A.store.setMode('build');
  assert.equal(el('build-panel').hidden, false);
});

// ---------- generator ----------
test('generator: same seed gives the same jobs, other seeds differ, all jobs fit', () => {
  const { A } = page();
  const g = A.generator;
  const s = { seed: 123, count: 50, maxArrival: 40, maxDuration: 12, cpuPct: 50, memPct: 25 };
  const a = plain(g.generate(s, MACHINE));
  assert.deepEqual(plain(g.generate(s, MACHINE)), a);
  assert.notDeepEqual(plain(g.generate({ ...s, seed: 124 }, MACHINE)), a);
  assert.equal(a.length, 50);
  assert.deepEqual(plain(a.map((j) => j.id)), Array.from({ length: 50 }, (_, i) => i + 1));
  for (const j of a) {
    assert.deepEqual(plain(A.editor.jobProblems(j, MACHINE)), []);
    assert.ok(j.arrival <= 40 && j.duration <= 12 && j.cpu <= 8 && j.mem <= 8192);
  }
  // pinned values: the PRNG is fixed (mulberry32), so the output must never drift
  const r = g.mulberry32(1);
  assert.deepEqual([r(), r(), r()].map((x) => Math.floor(x * 1e6)), PIN);
  assert.deepEqual(plain(g.generate({ seed: 7, count: 3 }, MACHINE)), plain(g.generate({ seed: 7, count: 3 }, MACHINE)));
  // out-of-range settings are clamped, not trusted
  assert.equal(g.generate({ seed: 1, count: 9999 }, MACHINE).length, 200);
  assert.equal(g.generate({ seed: 1, count: -3 }, MACHINE).length, 1);
  assert.equal(g.nextSeed(42), g.nextSeed(42));
  assert.notEqual(g.nextSeed(42), 42);
});

test('generator UI: seed is visible, button fills the table, bad seed shows a message', () => {
  const { A, el } = page();
  assert.equal(el('gen-seed').value, '42');
  el('gen-run').click();
  const first = plain(A.store.get().jobs);
  assert.equal(first.length, 12);
  el('gen-run').click();
  assert.deepEqual(plain(A.store.get().jobs), first, 'same seed, same jobs');
  el('gen-newseed').click();
  assert.notEqual(el('gen-seed').value, '42');
  el('gen-run').click();
  assert.notDeepEqual(plain(A.store.get().jobs), first);
  el('gen-seed').value = '-4'; el('gen-run').click();
  assert.match(el('gen-error').textContent, /seed must be a whole number/);
  el('gen-count').value = '5'; el('gen-count').fire('input');
  assert.equal(el('gen-count-out').textContent, '5');
});

test('generator.js never uses Math.random and never touches the engine', () => {
  const g = read('js/generator.js');
  assert.ok(!/Math\.random/.test(g));
  assert.ok(!/APRM\.wasm/.test(g));
});

// ---------- grep safety for the new files ----------
test('new scripts use textContent only: no innerHTML, eval, Function, fetch, modules', () => {
  for (const f of ['js/editor.js', 'js/generator.js', 'js/presets.js', 'index.html']) {
    const t = read(f);
    for (const re of [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /\beval\s*\(/, /new\s+Function/, /\bfetch\s*\(/, /XMLHttpRequest/, /document\.write/, /\bon[a-z]+\s*=\s*["']/i]) {
      assert.ok(!re.test(t), `${re} in ${f}`);
    }
  }
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n' + (e && e.stack || e)); }
}
console.log(`${tests.length - failed}/${tests.length} editor tests passed`);
process.exit(failed ? 1 : 0);
