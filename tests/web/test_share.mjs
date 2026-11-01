// test_share.mjs: tests for shareable case links (K-36): web/js/share.js.
// Run: node tests/web/test_share.mjs
// Loads the real web/js scripts into a node:vm context with a tiny fake DOM built from the ids
// in the real index.html (same idea as test_editor.mjs). No engine is needed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(resolve(here, '..', '..'), 'web');
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
    this.hidden = false; this.value = ''; this.files = null; this.selected = false;
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
  focus() {}
  select() { this.selected = true; }
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
  return {
    byId, body: new El('body'),
    getElementById: (id) => byId[id] || null,
    createElement: (t) => new El(t),
    createTextNode: (t) => new Text(t),
    querySelectorAll: () => [],
  };
}
const srcs = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^https?:/.test(u));

// A page with the real scripts except vendor/aprm.js and app.js; mounts the Build scripts and
// share.js the way app.js does. nav: what navigator.clipboard does ('ok', 'reject' or 'none').
function page({ hash = '', clipboard = 'ok' } = {}) {
  const doc = fakeDocument();
  const winListeners = {};
  const copied = [];
  const win = {
    document: doc, console, Uint8Array, BigInt,
    Blob: class {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    location: { href: 'file:///Users/x/web/index.html' + hash, hash },
    addEventListener: (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); },
    navigator: clipboard === 'none' ? {} : {
      clipboard: { writeText: (t) => (clipboard === 'ok' ? (copied.push(t), Promise.resolve()) : Promise.reject(new Error('denied'))) },
    },
  };
  win.window = win;
  const ctx = vm.createContext(win);
  for (const s of srcs) {
    if (s.startsWith('vendor/') || s === 'js/app.js') continue;
    vm.runInContext(read(s), ctx, { filename: s });
  }
  const A = ctx.APRM;
  for (const n of ['presets', 'editor', 'generator', 'share']) if (A[n] && A[n].mount) A[n].mount();
  const hashchange = (h) => { win.location.hash = h; for (const fn of winListeners.hashchange || []) fn({}); };
  return { ctx, doc, A, win, copied, hashchange, el: (id) => doc.byId[id] };
}
const caseOf = (A) => plain(A.store.get());
const KEEP = ['machine', 'jobs', 'policies'];
const sameCase = (a, b) => {
  for (const k of KEEP) assert.deepEqual(a[k], b[k], k);
  assert.equal(a.settings.alphaMilli, b.settings.alphaMilli);
  assert.equal(a.settings.threshold, b.settings.threshold);
  assert.equal(a.settings.eps, b.settings.eps);
};
const GOOD = { id: 1, arrival: 0, duration: 5, cpu: 2, mem: 100, priority: 1 };
const rnd = (seed) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

// ---------- static ----------
test('share.js sits after compare.js and before app.js (PRD section 7 order)', () => {
  const i = srcs.indexOf('js/share.js');
  assert.ok(i > srcs.indexOf('js/compare.js') && i < srcs.indexOf('js/app.js'), String(srcs));
});

test('share.js uses textContent only: no innerHTML, eval, Function, fetch, inline handlers', () => {
  for (const f of ['js/share.js', 'index.html']) {
    const t = read(f);
    for (const re of [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /\beval\s*\(/, /new\s+Function/, /\bfetch\s*\(/, /XMLHttpRequest/, /document\.write/, /\bon[a-z]+\s*=\s*["']/i, /JSON\.parse/]) {
      assert.ok(!re.test(t), `${re} in ${f}`);
    }
  }
});

test('share.js attaches APRM.share only and its handles exist in index.html', () => {
  const { ctx, el } = page();
  assert.deepEqual(Object.getOwnPropertyNames(ctx).filter((k) => /^(share|APRM)$/i.test(k)), ['APRM']);
  assert.ok(ctx.APRM.share && typeof ctx.APRM.share.encode === 'function');
  for (const id of ['share-copy', 'share-link', 'share-status', 'share-error']) assert.ok(el(id), id);
  assert.equal(el('share-link').tag, 'input');
  assert.ok(/id="share-link"[^>]*\breadonly\b/.test(html));
});

test('the size limit is stated in code', () => {
  assert.match(read('js/share.js'), /MAX_HASH_CHARS\s*=\s*8192/);
});

// ---------- round trip ----------
test('roundtrip: every preset survives share then open', () => {
  const { A } = page();
  const names = A.presets.all().map((p) => p.name);
  assert.equal(names.length, 6);
  for (const name of names) {
    A.presets.load(name);
    A.store.setPolicies(['aging_reserve']);
    A.store.setSettings({ eps: 0.25 });
    const before = caseOf(A);
    const enc = A.share.encode(A.share.caseFromStore());
    assert.ok(enc.ok, name + ': ' + enc.message);
    assert.ok(enc.hash.length <= 8192 && enc.hash.startsWith('#'), name);
    // a fresh page opens the link
    const q = page({ hash: enc.hash });
    sameCase(caseOf(q.A), before);
    assert.match(q.el('share-status').textContent, /Loaded/);
    assert.equal(q.el('share-error').hidden, true);
  }
});

test('roundtrip: policies list, boundary values and an empty job list', () => {
  const { A } = page();
  const c = {
    machine: { cpu: 1000000, mem: 1000000000 },
    settings: { alphaMilli: 10000, threshold: 1000000, eps: 1 },
    policies: ['fcfs', 'aging', 'knapsack'],
    jobs: [{ id: 2147483647, arrival: 1000000000, duration: 1000000, cpu: 1000000, mem: 1000000000, priority: 9 },
           { id: 0, arrival: 0, duration: 1, cpu: 1, mem: 1, priority: 0 }],
  };
  for (const cc of [c, { ...c, jobs: [], settings: { alphaMilli: 0, threshold: 0, eps: 0.01 } }]) {
    const enc = A.share.encode(cc);
    assert.ok(enc.ok, enc.message);
    const dec = A.share.decode(enc.hash);
    assert.ok(dec.ok, dec.message);
    assert.deepEqual(plain(dec.case), plain(cc));
  }
});

test('the hash is plain URL-safe text', () => {
  const { A } = page();
  A.presets.load('tiny_case');
  const enc = A.share.encode(A.share.caseFromStore());
  assert.match(enc.hash, /^#aprm1=[A-Za-z0-9_-]+$/);
});

// ---------- size limit ----------
test('oversized: a case that does not fit is refused with a CSV hint; a long hash is rejected unread', () => {
  const { A } = page();
  const jobs = [];
  for (let i = 0; i < 800; i++) jobs.push({ ...GOOD, id: i, mem: 100 + i });
  const enc = A.share.encode({ machine: { cpu: 16, mem: 32768 }, settings: { alphaMilli: 100, threshold: 50, eps: 0.1 }, policies: ['fcfs'], jobs });
  assert.equal(enc.ok, false);
  assert.match(enc.message, /too large/i);
  assert.match(enc.message, /Export jobs\.csv/);
  const dec = A.share.decode('#aprm1=' + 'A'.repeat(9000));
  assert.equal(dec.ok, false);
  assert.match(dec.message, /too long/i);
  // exactly at the limit is looked at (and rejected as garbled, not as too long)
  const atLimit = A.share.decode('#aprm1=' + 'A'.repeat(8192 - 7));
  assert.equal(atLimit.ok, false);
  assert.ok(!/too long/i.test(atLimit.message));
  const over = A.share.decode('#aprm1=' + 'A'.repeat(8192 - 7 + 1));
  assert.match(over.message, /too long/i);
});

test('oversized link in the page: error shown, state unchanged, page alive', () => {
  const q = page({ hash: '#aprm1=' + 'A'.repeat(100000) });
  assert.equal(q.el('share-error').hidden, false);
  assert.match(q.el('share-error').textContent, /too long/i);
  assert.equal(q.A.store.get().jobs.length, 0);
});

// ---------- tampering, same messages as the editor ----------
const encodeText = (A, text) => '#aprm1=' + Buffer.from(text, 'latin1').toString('base64url');
const HEAD = '1,16,32768,100,50,100,fcfs';

test('valid hand-made text decodes (the format is what the notes say)', () => {
  const { A } = page();
  const d = A.share.decode(encodeText(A, HEAD + '\n1,0,5,2,100,1\n2,3,4,1,50,0\n'));
  assert.ok(d.ok, d.message);
  assert.deepEqual(plain(d.case.jobs), [GOOD, { id: 2, arrival: 3, duration: 4, cpu: 1, mem: 50, priority: 0 }]);
  assert.deepEqual(plain(d.case.settings), { alphaMilli: 100, threshold: 50, eps: 0.1 });
});

test('tampered job rows give the editor/CSV reader message, with the line number', () => {
  const { A } = page();
  const E = A.editor;
  const cases = [
    ['1,0,5,2,100,10', 'priority'], ['1,0,0,2,100,1', 'duration'], ['1,0,5,0,100,1', 'cpu'],
    ['1,1000000001,5,2,100,1', 'arrival'], ['-1,0,5,2,100,1', 'id'], ['a,0,5,2,100,1', 'id'],
    ['1,0,5,2,100', ''], ['1,0,5,2,100,1,7', ''], ['99999999999999999999,0,5,2,100,1', 'id'],
    ['1,0,5,2,100,1ÿ', 'priority'], ['', ''],
  ];
  for (const [row, col] of cases) {
    const d = A.share.decode(encodeText(A, HEAD + '\n' + row + '\n'));
    assert.equal(d.ok, false, row);
    const csv = E.parseCsv(E.HEADER + '\n' + row + '\n', 5000);
    assert.ok(csv.errors.length > 0, row);
    assert.ok(d.message.includes(csv.errors[0].message), row + ' -> ' + d.message + ' vs ' + csv.errors[0].message);
    if (col) assert.ok(d.message.includes('column ' + col), d.message);
  }
});

test('duplicate ids and jobs that do not fit the machine use the editor words', () => {
  const { A } = page();
  const E = A.editor;
  let d = A.share.decode(encodeText(A, HEAD + '\n1,0,5,2,100,1\n1,0,5,2,100,1\n'));
  assert.equal(d.ok, false);
  assert.ok(d.message.includes(E.allProblems([GOOD, GOOD], { cpu: 16, mem: 32768 })[0].message), d.message);
  d = A.share.decode(encodeText(A, HEAD + '\n4,0,5,17,100,1\n'));
  assert.ok(d.message.includes('Job 4 needs 17 cores; machine has 16 cores.'), d.message);
  d = A.share.decode(encodeText(A, HEAD + '\n4,0,5,1,40960,1\n'));
  assert.ok(d.message.includes('Job 4 needs 40960 MB; machine has 32768 MB.'), d.message);
});

test('machine and settings use the engine words', () => {
  const { A } = page();
  const E = A.editor;
  const t = (head) => A.share.decode(encodeText(A, head + '\n1,0,5,1,100,1\n'));
  assert.ok(t('1,0,32768,100,50,100,fcfs').message.includes(E.capacityProblem('cpu', 0)));
  assert.ok(t('1,1000001,32768,100,50,100,fcfs').message.includes('cpu_cap must be 1 to 1000000.'));
  assert.ok(t('1,16,0,100,50,100,fcfs').message.includes(E.capacityProblem('mem', 0)));
  assert.ok(t('1,16,1000000001,100,50,100,fcfs').message.includes('mem_cap must be 1 to 1000000000.'));
  assert.ok(t('1,16,32768,10001,50,100,fcfs').message.includes('alpha_milli must be 0 to 10000.'));
  assert.ok(t('1,16,32768,100,1000001,100,fcfs').message.includes('reserve_threshold must be 0 to 1000000.'));
  assert.ok(t('1,16,32768,100,50,9,fcfs').message.includes('knapsack_eps must be 0.01 to 1.'));
  assert.ok(t('1,16,32768,100,50,1001,fcfs').message.includes('knapsack_eps must be 0.01 to 1.'));
  assert.match(t('1,16,32768,100,50,100,nope').message, /Unknown policy/);
  assert.match(t('1,16,32768,100,50,100,fcfs+fcfs').message, /policy/i);
  assert.match(t('1,16,32768,100,50,100,').message, /policy/i);
  assert.match(t('2,16,32768,100,50,100,fcfs').message, /version/i);
  assert.match(t('1,16,32768,100,50,100').message, /settings line/i);
  assert.match(t('1,1e3,32768,100,50,100,fcfs').message, /settings line/i);
  assert.match(t('1,-1,32768,100,50,100,fcfs').message, /settings line/i);
  assert.match(t('1,99999999999999999999,32768,100,50,100,fcfs').message, /settings line|cpu_cap/);
  assert.match(t('__proto__,16,32768,100,50,100,fcfs').message, /settings line|version/i);
});

test('too many jobs: the PRD section 3 website limit applies', () => {
  const { A } = page();
  // 5001 tiny rows would exceed the size limit first; call the validator path through parseCsv's limit.
  const rows = [];
  for (let i = 0; i < 700; i++) rows.push(i + ',0,1,1,1,0');
  const d = A.share.decode(encodeText(A, HEAD + '\n' + rows.join('\n') + '\n'));
  assert.equal(d.ok, false);
  assert.match(d.message, /too long/i);
  assert.ok(A.editor.MAX_JOBS_WEB === 5000);
  assert.match(read('js/share.js'), /MAX_JOBS_WEB/);
});

test('not our link: wrong prefix, bad characters, bad length, empty payload', () => {
  const { A } = page();
  for (const h of ['#hello', '#aprm2=AAAA', '#aprm1=', '#aprm1=A', '#aprm1=AAAAA', '#aprm1=AA AA', '#aprm1=AA+/', '#aprm1=%41%41', '#aprm1==AAA', '#__proto__', '#aprm1=__proto__']) {
    const d = A.share.decode(h);
    assert.equal(d.ok, false, h);
    assert.ok(typeof d.message === 'string' && d.message.length > 0, h);
  }
  assert.deepEqual(plain(A.share.decode('')), { ok: true, empty: true });
  assert.deepEqual(plain(A.share.decode('#')), { ok: true, empty: true });
});

test('hostile values never reach the store and never pollute prototypes', () => {
  const q = page();
  const { A } = q;
  const before = caseOf(A);
  for (const text of [HEAD + '\n__proto__,0,5,2,100,1\n', HEAD + '\nconstructor,0,5,2,100,1\n', '{"__proto__":{"x":1}}',
    HEAD + '\n1,0,5,2,100,1\n{"__proto__":{"polluted":1}}\n']) {
    q.hashchange(encodeText(A, text));
    assert.equal(q.el('share-error').hidden, false);
  }
  assert.equal(({}).polluted, undefined);
  assert.equal(({}).x, undefined);
  assert.deepEqual(caseOf(A), before);
});

test('an invalid link leaves the old case alone and shows the reason; a good one then loads', () => {
  const q = page();
  q.A.presets.load('tiny_case');
  const before = caseOf(q.A);
  q.hashchange(encodeText(q.A, HEAD + '\n1,0,5,2,100,10\n'));
  assert.equal(q.el('share-error').hidden, false);
  assert.match(q.el('share-error').textContent, /column priority: must be 0 to 9/);
  assert.deepEqual(caseOf(q.A), before);
  q.hashchange(encodeText(q.A, HEAD + '\n7,0,5,2,100,1\n'));
  assert.equal(q.el('share-error').hidden, true);
  assert.deepEqual(plain(q.A.store.get().jobs), [{ ...GOOD, id: 7 }]);
  q.hashchange('');
  assert.equal(q.el('share-error').hidden, true);
});

test('startup with a bad hash: page still mounts, store usable, error shown', () => {
  const q = page({ hash: '#aprm1=!!!!' });
  assert.equal(q.el('share-error').hidden, false);
  assert.ok(q.el('preset-select').children.length > 0);
  q.A.presets.load('tiny_case');
  assert.ok(q.A.store.get().jobs.length > 0);
});

// ---------- the safety nets themselves (each fails if the guarded code is removed) ----------
test('decode catches an unexpected throw from the reader and returns a clean error', () => {
  const { A } = page();
  const h = encodeText(A, HEAD + '\n1,0,5,2,100,1\n');
  assert.ok(A.share.decode(h).ok);
  const real = A.editor.parseCsv;
  A.editor.parseCsv = () => { throw new Error('boom'); };
  let d;
  assert.doesNotThrow(() => { d = A.share.decode(h); });
  assert.equal(d.ok, false);
  assert.match(d.message, /could not be read/);
  A.editor.parseCsv = real;
});

test('a valid link whose loading throws shows an error and does not escape', () => {
  const q = page();
  const h = encodeText(q.A, HEAD + '\n1,0,5,2,100,1\n');
  const real = q.A.store.setJobs;
  q.A.store.setJobs = () => { throw new Error('boom'); };
  let d;
  assert.doesNotThrow(() => { d = q.A.share.loadFromHash(h); });
  assert.equal(d.ok, false);
  assert.equal(q.el('share-error').hidden, false);
  assert.match(q.el('share-error').textContent, /could not be loaded/);
  q.A.store.setJobs = real;
});

test('settings line is strict: spaces, signs, long numbers, upper case, trailing text', () => {
  const { A } = page();
  const t = (head) => A.share.decode(encodeText(A, head + '\n1,0,5,1,100,1\n'));
  for (const head of [' 1,16,32768,100,50,100,fcfs', '1,16,32768,100,50,100,fcfs ', '1,16,32768,100,50,100,FCFS',
    '1,16,32768,100,50,100,fcfs,x', '1,16,32768,00000000100,50,100,fcfs', '1,16,32768,100,50,100,fc fs', '1,+16,32768,100,50,100,fcfs']) {
    const d = t(head);
    assert.equal(d.ok, false, head);
    assert.match(d.message, /settings line/, head);
  }
  assert.equal(t('1,16,32768,100,50,100,fcfs').ok, true);
});

test('prefix and alphabet checks run before any decoding', () => {
  const { A } = page();
  const body = Buffer.from(HEAD + '\n1,0,5,2,100,1\n', 'latin1').toString('base64url');
  assert.equal(A.share.decode('#aprm1=' + body).ok, true);
  assert.match(A.share.decode('#aprm0=' + body).message, /not a shared-case link/);
  assert.match(A.share.decode('aprm1=' + body).message, /not a shared-case link/);
  assert.match(A.share.decode('#aprm1=' + body + '+').message, /damaged/);
  assert.match(A.share.decode('#aprm1=' + body.slice(0, 4) + '.' + body.slice(5)).message, /damaged/);
  assert.match(A.share.decode('#aprm1=' + body + '=').message, /damaged/);
});

// ---------- fuzz ----------
test('fuzz: random strings and mutations of valid hashes never throw; result is a valid case or a clean error', () => {
  const { A } = page();
  const E = A.editor;
  const r = rnd(20260101);
  A.presets.load('heavy_load');
  const valid = A.share.encode(A.share.caseFromStore()).hash;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_=+/%#.,;:{}"\'\\ \n\u0000ÿ☃';
  const check = (h) => {
    let d;
    assert.doesNotThrow(() => { d = A.share.decode(h); }, String(JSON.stringify(h)).slice(0, 80));
    assert.ok(d && typeof d.ok === 'boolean');
    if (d.ok && !d.empty) {
      const c = d.case;
      assert.equal(E.capacityProblem('cpu', c.machine.cpu), null);
      assert.equal(E.capacityProblem('mem', c.machine.mem), null);
      assert.deepEqual(plain(E.allProblems(c.jobs, c.machine)), []);
      assert.ok(c.jobs.length <= 5000);
    } else if (!d.ok) {
      assert.ok(typeof d.message === 'string' && d.message.length > 0 && d.message.length < 1000, h);
    }
  };
  for (let i = 0; i < 2500; i++) {
    let s = '';
    const n = Math.floor(r() * 60);
    for (let k = 0; k < n; k++) s += alphabet[Math.floor(r() * alphabet.length)];
    check(r() < 0.5 ? '#aprm1=' + s : s);
  }
  for (let i = 0; i < 2500; i++) {
    const a = valid.split('');
    const edits = 1 + Math.floor(r() * 4);
    for (let k = 0; k < edits; k++) {
      const p = 7 + Math.floor(r() * (a.length - 7));
      const op = r();
      if (op < 0.4) a[p] = alphabet[Math.floor(r() * alphabet.length)];
      else if (op < 0.7) a.splice(p, 1);
      else a.splice(p, 0, alphabet[Math.floor(r() * alphabet.length)]);
    }
    check(a.join(''));
  }
  // mutations of the decoded text re-encoded: exercises the validators, not just base64
  const text = Buffer.from(valid.slice(7), 'base64url').toString('latin1');
  for (let i = 0; i < 1500; i++) {
    const a = text.split('');
    for (let k = 0; k < 1 + Math.floor(r() * 3); k++) {
      const p = Math.floor(r() * a.length);
      a[p] = '0123456789,\n-+x _'[Math.floor(r() * 17)];
    }
    check('#aprm1=' + Buffer.from(a.join(''), 'latin1').toString('base64url'));
  }
  // extreme inputs
  for (const h of [null, undefined, 5, {}, [], '#aprm1=' + '\u0000'.repeat(50), '#' + 'x'.repeat(1e6)]) check(h);
});

// ---------- the button ----------
test('Share button copies the link with the clipboard API and shows it', async () => {
  const q = page();
  q.A.presets.load('tiny_case');
  q.el('share-copy').click();
  await new Promise((r) => setTimeout(r, 5));
  const link = q.el('share-link').value;
  assert.ok(link.startsWith('file:///Users/x/web/index.html#aprm1='), link);
  assert.deepEqual(q.copied, [link]);
  assert.match(q.el('share-status').textContent, /copied/i);
  assert.equal(q.el('share-error').hidden, true);
  // opening the copied link elsewhere gives the same case
  const q2 = page({ hash: link.slice(link.indexOf('#')) });
  sameCase(caseOf(q2.A), caseOf(q.A));
});

test('Share button falls back to selecting the text when the clipboard is missing or refuses', async () => {
  for (const clipboard of ['none', 'reject']) {
    const q = page({ clipboard });
    q.A.presets.load('tiny_case');
    q.el('share-copy').click();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(q.el('share-link').selected, true, clipboard);
    assert.match(q.el('share-status').textContent, /Press (Ctrl|Cmd)/i);
    assert.ok(q.el('share-link').value.includes('#aprm1='));
  }
});

test('Share button on an empty or invalid case, or one too large, shows an error and no link', () => {
  const q = page();
  q.el('share-copy').click();
  assert.equal(q.el('share-error').hidden, false);               // no jobs: nothing to share
  assert.equal(q.el('share-link').value, '');
  const jobs = [];
  for (let i = 0; i < 800; i++) jobs.push({ ...GOOD, id: i, mem: 100 + i });
  q.A.store.setJobs(jobs);
  q.el('share-copy').click();
  assert.match(q.el('share-error').textContent, /Export jobs\.csv/);
  assert.equal(q.el('share-link').value, '');
  q.A.store.setJobs([{ ...GOOD, priority: 12 }]);
  q.el('share-copy').click();
  assert.match(q.el('share-error').textContent, /priority must be 0 to 9/);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n' + (e && e.stack || e)); }
}
console.log(`${tests.length - failed}/${tests.length} share tests passed`);
process.exit(failed ? 1 : 0);
