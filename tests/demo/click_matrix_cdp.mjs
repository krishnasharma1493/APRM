// click_matrix_cdp.mjs: clicks everything on the website in real headless Chrome and writes the result (K-50).
// It opens the built file from file:// with every external host unreachable, performs each row, and checks
// the page after it: no console error, no uncaught exception, no blank panel. It never decides which job runs.
//
// Usage: node tests/demo/click_matrix_cdp.mjs <path-to-web/dist/index.html> [--out file.md] [--dark] [--width 1440]
// With build/aprm present it also compares the website with the console program, row by row, for every
// scheduler on every example.
// Exit code 1 if any row fails.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const page = process.argv[2];
const outAt = process.argv.indexOf('--out');
const out = outAt > 0 ? process.argv[outAt + 1] : null;
if (!page) { console.error('usage: node click_matrix_cdp.mjs <index.html> [--out file.md]'); process.exit(2); }
const url = pathToFileURL(resolve(page)).href;
const SCHEME = process.argv.includes('--dark') ? 'dark' : 'light';
const widthAt = process.argv.indexOf('--width');
const WIDTH = widthAt > 0 ? Number(process.argv[widthAt + 1]) : 1440;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PRESETS = ['big_job_trap', 'priority_starvation', 'memory_hog', 'sjf_starvation', 'heavy_load', 'tiny_case'];
const SCHEDULERS = ['fcfs', 'priority', 'sjf', 'aging', 'aging_reserve'];

const profile = mkdtempSync(join(tmpdir(), 'aprm-matrix-'));
const port = 9100 + Math.floor(Math.random() * 150);
const args = ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + port,
  '--user-data-dir=' + profile, '--window-size=1440,900', '--host-resolver-rules=MAP * ~NOTFOUND'];
if (process.env.CHROME_EXTRA_ARGS) { args.push(...process.env.CHROME_EXTRA_ARGS.split(' ').filter(Boolean)); }
const chrome = spawn(CHROME, args, { stdio: 'ignore' });

let ws; let nextId = 1; const pending = new Map(); const problems = [];
const send = (method, params = {}) => { const id = nextId++; ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => pending.set(id, { res, rej })); };
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) { throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text); }
  return r.result.value;
};
const waitFor = async (expr, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) { return true; } await sleep(30); } return false; };
const text = (id) => ev(`(document.getElementById('${id}') || {}).textContent || ''`);
const hidden = (id) => ev(`document.getElementById('${id}').hidden`);
const click = (id) => ev(`document.getElementById('${id}').click(); true`);
const key = async (k, code, vk) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, text: k === 'Enter' ? '\r' : undefined });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
};

async function load(hash = '', width = WIDTH) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'about:blank' });
  await send('Page.navigate', { url: url + hash });
  await waitFor(`(document.getElementById('engine-status') || {}).textContent === 'Engine ready'`);
}
const step = (m) => ev(`document.querySelector('[data-mode-button="${m}"]').click(); true`);
const preset = (name) => ev(`document.querySelector('#preset-tiles [data-preset="${name}"]').click(); true`);
const choose = (policy) => ev(`(function(){ const s = document.getElementById('run-policy'); s.value = '${policy}'; s.dispatchEvent(new Event('change', { bubbles: true })); })(); true`);
const snap = (k) => ev(`APRM.player.snapshot().${k}`);
const finished = () => waitFor(`APRM.player.snapshot().status === 'finished'`, 30000);
const setJobs = (jobs) => ev(`APRM.store.setJobs(${JSON.stringify(jobs)}); true`);
const J = (id, arrival, duration, cpu, mem, priority) => ({ id, arrival, duration, cpu, mem, priority });
const upload = (name, content) => ev(`(function(){ const f = new File([${JSON.stringify(content)}], '${name}', { type: 'text/csv' }); const d = new DataTransfer(); d.items.add(f); const i = document.getElementById('csv-file'); i.files = d.files; i.dispatchEvent(new Event('change', { bubbles: true })); })(); true`);

/* After every row: the page shows something and no panel of the current step is empty. */
const blankPanels = () => ev(`(function(){ const m = APRM.store.get().mode; const p = document.getElementById(m + '-panel'); return !p || p.hidden || p.textContent.trim().length < 20; })()`);

const rows = [];
async function row(pageName, control, input, expected, source, fn) {
  const before = problems.length;
  let actual, ok;
  try {
    const r = await fn();
    ok = r === true || (Array.isArray(r) && r[0] === true);
    actual = Array.isArray(r) ? String(r[1]) : (r === true ? 'as expected' : String(r));
  } catch (e) { ok = false; actual = 'script error: ' + e.message.split('\n')[0]; }
  await sleep(10);
  if (problems.length > before) { ok = false; actual += ' | console: ' + problems.slice(before).join(' ; '); }
  try { if (await blankPanels()) { ok = false; actual += ' | blank panel'; } } catch (e) { ok = false; actual += ' | page gone: ' + e.message.split('\n')[0]; }
  rows.push({ page: pageName, control, input, expected, source, actual, status: ok ? 'PASS' : 'FAIL' });
  if (!ok) { console.log('FAIL ' + pageName + ' / ' + control + ' / ' + input + ' -> ' + actual); }
}

async function main() {
  let wsUrl;
  for (let i = 0; i < 100 && !wsUrl; i++) {
    try { const t = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find((x) => x.type === 'page'); if (t) { wsUrl = t.webSocketDebuggerUrl; } } catch (e) { /* not up yet */ }
    await sleep(100);
  }
  ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); if (d.error) { p.rej(new Error(JSON.stringify(d.error))); } else { p.res(d.result); } return; }
    if (d.method === 'Runtime.exceptionThrown') { problems.push('exception: ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split('\n')[0]); }
    if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) { problems.push(d.params.type + ': ' + d.params.args.map((a) => a.value || a.description).join(' ')); }
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') { problems.push('log: ' + d.params.entry.text); }
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: SCHEME }] });
  await load();

  // --- Build
  await row('Build', 'Page load', 'file://, network off', 'Engine starts, six example tiles, empty state', 'PRD 7, 8', async () => (await ev(`document.querySelectorAll('#preset-tiles button').length`)) === 6 && !(await hidden('table-empty')));
  for (const p of PRESETS) {
    await row('Build', 'Example tile', p, 'Machine, settings and jobs loaded; rows drawn', 'BLUEPRINT 5', async () => { await preset(p); return (await ev(`APRM.store.get().jobs.length`)) > 0 && (await ev(`document.querySelectorAll('#job-body tr').length === APRM.store.get().jobs.length`)); });
  }
  await row('Build', 'Add job', 'valid row', 'Job added, next id offered', 'BLUEPRINT 5', async () => { await load(); await click('add-submit'); return (await ev(`APRM.store.get().jobs.length`)) === 1 && (await ev(`document.getElementById('add-id').value`)) === '2'; });
  await row('Build', 'Add job', 'duplicate id', 'Refused, plain message beside the field', 'PRD 7 UI states', async () => { await ev(`document.getElementById('add-id').value = '1'; true`); await click('add-submit'); return [/already exists/.test(await text('add-error')), await text('add-error')]; });
  await row('Build', 'Add job', 'priority 99', 'Refused with range message', 'PRD 3', async () => { await ev(`document.getElementById('add-id').value = '5'; document.getElementById('add-priority').value = '99'; true`); await click('add-submit'); return [/priority must be 0 to 9/.test(await text('add-error')), await text('add-error')]; });
  await row('Build', 'Add job', 'letters in a field', 'Refused, not a number', 'PRD 3', async () => { await ev(`document.getElementById('add-priority').value = 'abc'; true`); await click('add-submit'); return [/not a number/.test(await text('add-error')), await text('add-error')]; });
  await row('Build', 'Add job', 'needs more cores than the machine', 'Refused with the machine limit', 'PRD 3', async () => { await ev(`document.getElementById('add-priority').value = '5'; document.getElementById('add-cpu').value = '99'; true`); await click('add-submit'); return [/needs 99 cores/.test(await text('add-error')), await text('add-error')]; });
  await row('Build', 'Edit a cell', 'duration 7', 'Job updated', 'BLUEPRINT 5', async () => { await ev(`(function(){ const c = document.querySelector('#job-body tr').children[2].querySelector('input'); c.value = '7'; c.dispatchEvent(new Event('change', { bubbles: true })); })(); true`); return (await ev(`APRM.store.get().jobs[0].duration`)) === 7; });
  await row('Build', 'Delete', 'first row', 'Row removed, empty state back', 'BLUEPRINT 5', async () => { await ev(`document.querySelector('#job-body tr .btn').click(); true`); return (await ev(`APRM.store.get().jobs.length`)) === 0 && !(await hidden('table-empty')); });
  await row('Build', 'More ways to add jobs', 'click', 'Opens in one click', 'K-49', async () => { await ev(`document.querySelector('#more-ways summary').click(); true`); return ev(`document.getElementById('more-ways').open`); });
  await row('Build', 'Machine cores', '0', 'Message beside the field', 'PRD 3', async () => { await ev(`(function(){ const c = document.getElementById('cpu-input'); c.value = '0'; c.dispatchEvent(new Event('input', { bubbles: true })); c.dispatchEvent(new Event('change', { bubbles: true })); })(); true`); return [!(await hidden('cpu-error')), await text('cpu-error')]; });
  await row('Build', 'Machine cores', 'restore 16', 'Message clears', 'PRD 3', async () => { await ev(`(function(){ const c = document.getElementById('cpu-input'); c.value = '16'; c.dispatchEvent(new Event('input', { bubbles: true })); c.dispatchEvent(new Event('change', { bubbles: true })); })(); true`); return hidden('cpu-error'); });
  await row('Build', 'Make random jobs', 'seed 42', '12 jobs, same every time', 'PRD 3', async () => { await click('gen-run'); const a = await ev(`JSON.stringify(APRM.store.get().jobs)`); await click('gen-run'); return (await ev(`APRM.store.get().jobs.length`)) === 12 && a === (await ev(`JSON.stringify(APRM.store.get().jobs)`)); });
  await row('Build', 'New seed', 'click', 'Seed changes', 'PRD 3', async () => { const a = await ev(`document.getElementById('gen-seed').value`); await click('gen-newseed'); return a !== (await ev(`document.getElementById('gen-seed').value`)); });
  await row('Build', 'Random seed', 'letters', 'Plain message', 'PRD 3', async () => { await ev(`document.getElementById('gen-seed').value = 'x'; true`); await click('gen-run'); return [!(await hidden('gen-error')), await text('gen-error')]; });
  const header = 'id,arrival,duration,cpu,mem,priority\n';
  await row('Build', 'CSV import', 'good file', 'Jobs replaced', 'PRD 8', async () => { await upload('jobs.csv', header + '1,0,5,2,100,3\n2,1,5,2,100,4\n'); return waitFor(`APRM.store.get().jobs.length === 2`, 3000); });
  await row('Build', 'CSV import', 'bad rows', 'Bad rows listed, none silently dropped', 'PRD 8', async () => { await upload('jobs.csv', header + '1,0,5,2,100,3\n2,x,5,2,100,4\n3,0,5,2,100,99\n'); await waitFor(`!document.getElementById('csv-errors').hidden`, 3000); return [(await ev(`document.querySelectorAll('#csv-errors li').length`)) >= 2, await text('csv-errors')]; });
  await row('Build', 'CSV import', 'over 1 MB', 'Refused with a message', 'PRD 8', async () => { await load(); await preset('tiny_case'); await upload('big.csv', header + 'x'.repeat(1100000)); const ok = await waitFor(`/1 MB|too large|too big/i.test(document.getElementById('csv-status').textContent + document.getElementById('csv-errors').textContent)`, 3000); return [ok && (await ev(`APRM.store.get().jobs.length`)) === 8, await text('csv-status')]; });
  await row('Build', 'CSV import', 'empty file', 'Refused with a message', 'PRD 8', async () => { await upload('empty.csv', ''); await sleep(200); const s = (await text('csv-status')) + (await text('csv-errors')); return [/header|empty/i.test(s), s]; });
  await row('Build', 'CSV export', 'with jobs', 'Download starts, message shown', 'BLUEPRINT 5', async () => { await load(); await preset('tiny_case'); await click('csv-export'); return /Exported 8 jobs/.test(await text('csv-status')); });
  await row('Build', 'CSV export', 'no jobs', 'Plain message', 'PRD 7', async () => { await load(); await click('csv-export'); return [/empty/.test(await text('csv-status')), await text('csv-status')]; });
  await row('All', 'Next buttons', 'Build then Run then Compare then back', 'Each moves one step', 'K-43', async () => { await ev(`document.querySelector('[data-next="run"]').click(); true`); const a = await ev(`APRM.store.get().mode`); await ev(`document.querySelector('[data-next="compare"]').click(); true`); const b = await ev(`APRM.store.get().mode`); await ev(`document.querySelector('[data-next="build"]').click(); true`); return a === 'run' && b === 'compare' && (await ev(`APRM.store.get().mode`)) === 'build'; });
  await row('All', 'Show details', 'on', 'Limit and raw kinds appear', 'K-43', async () => { await ev(`document.getElementById('details-switch').click(); true`); return ev(`APRM.store.get().details && document.documentElement.getAttribute('data-details') === 'on'`); });
  await row('All', 'Show details', 'off', 'Clean view', 'K-43', async () => { await ev(`document.getElementById('details-switch').click(); true`); return !(await ev(`APRM.store.get().details`)); });
  await row('All', 'Day and night button', 'twice', 'Colours change, then back', 'K-48', async () => { const a = await ev(`getComputedStyle(document.body).backgroundColor`); await click('theme-toggle'); const b = await ev(`getComputedStyle(document.body).backgroundColor`); await click('theme-toggle'); return a !== b && a === (await ev(`getComputedStyle(document.body).backgroundColor`)); });

  // --- Run: every scheduler on every preset
  for (const p of PRESETS) {
    for (const s of SCHEDULERS) {
      await row('Run', 'Scheduler x example', s + ' on ' + p, 'Runs to the end; all jobs finish; board and metrics drawn', 'BLUEPRINT 5', async () => {
        await load(); await preset(p); await step('run'); await choose(s); await click('run-start'); await click('run-jump');
        if (!(await finished())) { return [false, 'status ' + (await snap('status'))]; }
        const st = await ev(`JSON.stringify(APRM.player.snapshot().state)`); const j = JSON.parse(st);
        const m = await ev(`document.querySelectorAll('#metrics-list li').length`);
        return [j.done === j.total && j.waiting.length === 0 && j.running.length === 0 && m >= 7 && !(await hidden('run-canvas')), 'done ' + j.done + '/' + j.total];
      });
    }
  }
  await row('Run', 'Knapsack option', 'open the list', 'Greyed out until K-34 lands', 'PR #120, PR #95', async () => { await load(); return ev(`document.querySelector('#run-policy option[value="knapsack"]').disabled`); });
  await row('Compare', 'Knapsack option', 'open the list', 'Greyed out until K-34 lands', 'PR #120, PR #95', async () => ev(`document.querySelector('#compare-policies input[data-policy="knapsack"]').disabled`));

  // --- Run controls in order
  await load(); await preset('heavy_load'); await step('run');
  await row('Run', 'Run', 'first press', 'Paused at the start; Play enabled', 'PRD 7', async () => { await click('run-start'); return (await snap('status')) === 'paused' && !(await ev(`document.getElementById('run-play').disabled`)); });
  await row('Run', 'Step', 'once', 'One event', 'PRD 7', async () => { const a = await snap('events'); await click('run-step'); return (await snap('events')) === a + 1; });
  await row('Run', 'Play', 'click', 'Status playing, label Pause', 'PRD 7', async () => { await click('run-play'); return (await snap('status')) === 'playing' && (await text('run-play')) === 'Pause'; });
  await row('Run', 'Pause', 'click', 'Stops', 'PRD 7', async () => { await click('run-play'); const s = await snap('status'); const a = await snap('events'); await sleep(120); return s === 'paused' && (await snap('events')) === a; });
  await row('Run', 'Speed slider', '50', 'Speed changes, readout follows', 'PRD 7', async () => { await ev(`(function(){ const r = document.getElementById('run-speed'); r.value = '50'; r.dispatchEvent(new Event('input', { bubbles: true })); })(); true`); return (await snap('speed')) === 50 && (await text('run-speed-out')) === '50'; });
  await row('Run', 'Add a job right now', 'valid', 'Accepted, then scheduled', 'PRD 7', async () => {
    await ev(`document.getElementById('run-add').open = true; document.getElementById('run-speed').value = '1'; document.getElementById('run-speed').dispatchEvent(new Event('input', { bubbles: true })); true`);
    await ev(`document.getElementById('ra-id').value = '500'; true`); await click('ra-submit');
    if (!(await hidden('ra-error'))) { return [false, await text('ra-error')]; }
    await click('run-jump'); await finished();
    return ev(`APRM.player.snapshot().bars[500] && APRM.player.snapshot().bars[500].start !== undefined`);
  });
  await row('Run', 'Add a job right now', 'duplicate id', 'Refused in plain words', 'PRD 7', async () => { await ev(`document.getElementById('ra-id').value = '500'; true`); await click('ra-submit'); return [!(await hidden('ra-error')), await text('ra-error')]; });
  await row('Run', 'Reset', 'click', 'Back to no run; board empty message', 'PRD 7', async () => { await click('run-reset'); return (await snap('status')) === 'idle' && !(await hidden('canvas-empty')); });

  // --- First screen, and a new case during a run
  await row('Run', 'Play', 'from the first screen', 'Starts and plays', 'K-50 #123', async () => { await load(); await preset('heavy_load'); await step('run'); if (await ev(`document.getElementById('run-play').disabled`)) { return [false, 'disabled']; } await click('run-play'); return ['playing', 'finished'].includes(await snap('status')); });
  await row('Run', 'Step', 'from the first screen', 'Starts and takes one event', 'K-50 #123', async () => { await load(); await preset('heavy_load'); await step('run'); await click('run-step'); return (await snap('events')) === 1; });
  await row('Run', 'Space', 'from the first screen', 'Starts and plays', 'K-50 #123', async () => { await load(); await preset('heavy_load'); await step('run'); await ev(`document.activeElement.blur(); true`); await key(' ', 'Space', 32); return ['playing', 'finished'].includes(await snap('status')); });
  await row('Run', 'New example', 'loaded while a run exists', 'Old run ends; no stale board', 'K-50 #122', async () => { await load(); await preset('tiny_case'); await step('run'); await click('run-start'); await click('run-step'); await step('build'); await preset('big_job_trap'); await step('run'); return (await snap('status')) === 'idle' && !(await hidden('canvas-empty')); });
  for (const [id, value, good, why] of [['run-alpha', '99999', '100', /alpha_milli must be 0 to 10000/], ['run-alpha', 'abc', '100', /whole number/], ['run-threshold', '-1', '50', /reserve_threshold must be/], ['run-eps', '5', '0.1', /knapsack_eps must be/]]) {
    await row('Run', 'More settings', id + ' = ' + value, 'Plain message; More settings opens; Run works after fixing it', 'PRD 3, K-50 #124', async () => {
      await load(); await preset('tiny_case'); await step('run');
      await ev(`document.getElementById('${id}').value = '${value}'; true`); await click('run-start');
      const m = await text('run-error'), open = await ev(`document.getElementById('run-more').open`);
      await ev(`document.getElementById('${id}').value = '${good}'; true`); await click('run-start');
      return [why.test(m) && m.startsWith('Check More settings.') && open && (await snap('status')) === 'paused' && (await hidden('run-error')), m];
    });
  }
  await row('Run', 'Tray card', 'click, then again', 'Selects the job, log filters, second click clears', 'BLUEPRINT 5', async () => { await load(); await preset('memory_hog'); await step('run'); await click('run-start'); for (let i = 0; i < 8; i++) { await click('run-step'); } await ev(`document.querySelector('#tray-list li').click(); true`); const on = await snap('selected'); const filt = !(await hidden('whylog-filter')); await ev(`document.querySelector('#tray-list li').click(); true`); return on !== null && filt && (await snap('selected')) === null; });
  await row('Run', 'Why log line', 'click, then Show all jobs', 'Filters to that job, then clears', 'BLUEPRINT 5', async () => { await ev(`document.querySelector('#whylog-list li').click(); true`); const on = await snap('selected'); await click('whylog-clear'); return on !== null && (await snap('selected')) === null; });
  await row('Run', 'Board card', 'click', 'Selects the job', 'BLUEPRINT 5', async () => { const r = await ev(`(function(){ const c = document.getElementById('run-canvas'); const g = c.__regions[0]; const b = c.getBoundingClientRect(); return { x: b.left + g.x + g.w / 2, y: b.top + g.y + g.h / 2 }; })()`); await ev(`document.getElementById('run-canvas').dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: ${r.x}, clientY: ${r.y} })); true`); return (await snap('selected')) !== null; });
  await row('Run', 'All jobs', 'click', 'Opens the job list', 'K-49', async () => { await ev(`document.querySelector('.tray details summary').click(); true`); return ev(`document.querySelector('.tray details').open && document.querySelectorAll('#job-list li').length === 12`); });
  await row('Run', 'Add a job right now', 'bad priority', 'Refused in plain words, run continues', 'PRD 7', async () => { await ev(`document.getElementById('run-add').open = true; document.getElementById('ra-priority').value = '99'; true`); await click('ra-submit'); const m = await text('ra-error'); await ev(`document.getElementById('ra-priority').value = '5'; true`); return [m.length > 0 && (await snap('status')) !== 'error', m]; });
  await row('Run', 'Show details', 'during a finished run', 'Exact engine numbers, raw kinds shown', 'K-49', async () => { await load(); await preset('memory_hog'); await step('run'); await click('run-start'); await click('run-jump'); await finished(); await click('details-switch'); const m = await ev(`APRM.player.snapshot().metrics.avg_wait`); const shown = await text('metrics-list'); await click('details-switch'); return [shown.includes(String(m)), String(m)]; });
  await row('Compare', 'Stale note', 'jobs changed after comparing', 'Says press Compare again', 'K-27', async () => { await load(); await preset('tiny_case'); await step('compare'); await click('compare-start'); await waitFor(`APRM.compare.snapshot().status === 'done'`); await step('build'); await preset('memory_hog'); await step('compare'); return /press Compare again/.test(await text('compare-status')); });

  // --- Run controls out of order
  await row('Run', 'Step', 'after the run finished', 'Ignored, no error', 'K-50', async () => { await click('run-start'); await click('run-jump'); await finished(); const a = await snap('events'); await ev(`(function(){ const b = document.getElementById('run-step'); b.disabled = false; b.click(); })(); true`); return (await snap('status')) === 'finished' && (await snap('events')) === a; });
  await row('Run', 'Play', 'after the run finished', 'Stays finished', 'K-50', async () => { await click('run-play'); return (await snap('status')) === 'finished'; });
  await row('Run', 'Run', 'double click', 'One clean new run', 'K-50', async () => { await ev(`(function(){ const b = document.getElementById('run-start'); b.click(); b.click(); })(); true`); return (await snap('status')) === 'paused' && (await snap('events')) === 0; });
  await row('Run', 'Play', 'double click', 'Toggles twice, stays consistent', 'K-50', async () => { await ev(`(function(){ const b = document.getElementById('run-play'); b.click(); b.click(); })(); true`); return (await snap('status')) === 'paused'; });
  await row('Run', 'Reset', 'mid-run while playing', 'Stops at once, no error', 'K-50', async () => { await click('run-play'); await sleep(40); await click('run-reset'); return (await snap('status')) === 'idle'; });
  await row('Run', 'Reset', 'twice', 'Second is disabled, no error', 'K-50', async () => { const off = await ev(`document.getElementById('run-reset').disabled`); await ev(`(function(){ const b = document.getElementById('run-reset'); b.disabled = false; b.click(); })(); true`); return off && (await snap('status')) === 'idle'; });
  await row('Run', 'Change scheduler', 'during a paused run', 'Current run unaffected; next Run uses the new one', 'K-50', async () => { await click('run-start'); await click('run-step'); await choose('sjf'); const ok = (await snap('status')) === 'paused'; await click('run-start'); return ok && (await ev(`APRM.player.snapshot().status`)) === 'paused'; });
  await row('Run', 'Leave the page', 'to Build during play', 'Pauses', 'K-25', async () => { await click('run-play'); await step('build'); const s = await snap('status'); await step('run'); return ['paused', 'finished'].includes(s); });
  await row('Run', 'Reload', 'mid-run', 'Page comes back clean', 'K-50', async () => { await send('Page.reload'); await sleep(200); await waitFor(`(document.getElementById('engine-status') || {}).textContent === 'Engine ready'`); return (await snap('status')) === 'idle'; });
  await row('Run', 'Jump to end', 'during play', 'Finishes', 'PRD 8', async () => { await preset('heavy_load'); await step('run'); await click('run-start'); await click('run-play'); await click('run-jump'); return finished(); });

  // --- Edge inputs
  await row('Run', 'Run', 'no jobs', 'Plain message, no engine error', 'PRD 7', async () => { await load(); await step('run'); await click('run-start'); return [!(await hidden('run-error')), await text('run-error')]; });
  await row('Compare', 'Compare', 'no jobs', 'Plain message', 'PRD 7', async () => { await step('compare'); await click('compare-start'); return [!(await hidden('compare-error')), await text('compare-error')]; });
  await row('Compare', 'Compare', 'one scheduler ticked', 'Plain message', 'PRD 7', async () => { await load(); await preset('tiny_case'); await step('compare'); await ev(`document.querySelector('#compare-policies input[data-policy="aging"]').click(); true`); await click('compare-start'); return [!(await hidden('compare-error')), await text('compare-error')]; });
  await row('Run', 'Edge', 'one job', 'Runs to the end', 'K-50', async () => { await load(); await setJobs([J(1, 0, 3, 1, 10, 1)]); await step('run'); await click('run-start'); await click('run-jump'); return finished(); });
  await row('Run', 'Edge', 'ties: same arrival and priority', 'Lower id first (hard rule 5)', 'Hard rule 5', async () => { await load(); await ev(`APRM.store.setMachine(1, 100); true`); await setJobs([J(2, 0, 3, 1, 10, 1), J(1, 0, 3, 1, 10, 1)]); await step('run'); await click('run-start'); await click('run-jump'); await finished(); return ev(`APRM.player.snapshot().bars[1].start === 0 && APRM.player.snapshot().bars[2].start === 3`); });
  await row('Run', 'Edge', 'job larger than the machine', 'Plain refusal, page usable', 'PRD 7', async () => { await load(); await ev(`APRM.store.setMachine(2, 100); true`); await setJobs([J(1, 0, 3, 8, 10, 1)]); await step('run'); await click('run-start'); return [!(await hidden('run-error')), await text('run-error')]; });
  await row('Run', 'Edge', 'largest case: 5000 jobs', 'Finishes without freezing', 'PRD 3, 8', async () => { await load(); const jobs = Array.from({ length: 5000 }, (_, i) => J(i + 1, i % 200, 1 + i % 5, 1, 10, i % 10)); await setJobs(jobs); await step('run'); await click('run-start'); await click('run-jump'); return [await waitFor(`APRM.player.snapshot().status === 'finished'`, 60000), await text('run-clock')]; });
  await row('Compare', 'Edge', 'largest case: 5000 jobs', 'Finishes without freezing', 'PRD 3, 8', async () => { await step('compare'); await click('compare-start'); return waitFor(`APRM.compare.snapshot().status === 'done'`, 90000); });

  // --- Compare
  for (const p of PRESETS) {
    await row('Compare', 'All five schedulers', p, 'Table, boards, verdict or tie, exact line', 'BLUEPRINT 5', async () => {
      await load(); await preset(p); await step('compare');
      await ev(`APRM.compare.setSelected(${JSON.stringify(SCHEDULERS)}); document.getElementById('compare-start').click(); true`);
      if (!(await waitFor(`APRM.compare.snapshot().status === 'done'`))) { return [false, 'not done']; }
      const n = await ev(`document.querySelectorAll('#compare-body tr').length`), b = await ev(`document.querySelectorAll('#compare-timelines canvas').length`);
      return [n === 5 && b === 5 && (await text('compare-exact')).length > 0, (await text('compare-verdict')) + ' ' + (await text('compare-exact'))];
    });
  }
  await row('Compare', 'Charts disclosure', 'open', 'Four charts drawn from the bundled library', 'PRD 8', async () => { await ev(`document.querySelector('.compare-more summary').click(); true`); await sleep(150); return (await ev(`APRM.compare.chartState()`)) === 'loaded' && (await ev(`document.querySelectorAll('#compare-charts canvas').length`)) === 4; });

  // --- URL hash (only with the share feature)
  if (await ev(`!!APRM.share`)) {
    await row('Build', 'Share', 'copy link, open it', 'Same case loads', 'BLUEPRINT 5', async () => { await load(); await preset('tiny_case'); await ev(`document.querySelector('#more-ways').open = true; true`); await click('share-copy'); const link = await ev(`document.getElementById('share-link').value`); const h = link.slice(link.indexOf('#')); await load(h); return (await ev(`APRM.store.get().jobs.length`)) === 8; });
    await row('Build', 'URL hash', 'corrupt', 'Plain message, page works', 'PRD 8', async () => { await load('#aprm1=!!!!'); return [!(await hidden('share-error')), await text('share-error')]; });
    await row('Build', 'URL hash', 'oversized', 'Refused as too long', 'PRD 8', async () => { await load('#aprm1=' + 'A'.repeat(20000)); return [/too long/.test(await text('share-error')), (await text('share-error')).slice(0, 80)]; });
    await row('Build', 'URL hash', 'names knapsack', 'Falls back; Run still works', 'PR #98', async () => { await load(); const h = await ev(`APRM.share.encode({ machine: { cpu: 4, mem: 1024 }, settings: { alphaMilli: 100, threshold: 50, eps: 0.1 }, policies: ['knapsack'], jobs: [{ id: 1, arrival: 0, duration: 1, cpu: 1, mem: 1, priority: 1 }] }).hash`); await load(h); await step('run'); await click('run-start'); await click('run-jump'); return finished(); });
  }

  // --- The website against the console program, row by row
  const aprm = resolve(page, '..', '..', '..', 'build', 'aprm');
  const root = resolve(page, '..', '..', '..');
  let haveCli = false; try { haveCli = spawnSync(aprm, ['--help']).status !== null; } catch (e) { haveCli = false; }
  if (haveCli) {
    for (const p of PRESETS) {
      await load(); await preset(p); await step('compare');
      const cfg = await ev(`JSON.stringify(APRM.presets.find('${p}'))`); const c = JSON.parse(cfg);
      await ev(`APRM.compare.setSelected(${JSON.stringify(SCHEDULERS)}); document.getElementById('compare-start').click(); true`);
      await waitFor(`APRM.compare.snapshot().status === 'done'`);
      const cols = JSON.parse(await ev(`JSON.stringify(APRM.compare.snapshot().columns)`));
      for (const col of cols) {
        await row('Engine', 'Website = console program', col.policy + ' on ' + p, 'Every job: same start and finish; same makespan', 'K-50 step 4', async () => {
          const csv = join(profile, p + '-' + col.policy + '.csv');
          const r = spawnSync(aprm, ['--policy', col.policy === 'aging_reserve' ? 'reserve' : col.policy, '--in', join(root, 'data', 'presets', p + '.csv'), '--out', csv, '--cpu', String(c.cpu_cap), '--mem', String(c.mem_cap), '--alpha-milli', String(c.alpha_milli), '--threshold', String(c.threshold)], { encoding: 'utf8' });
          if (r.status !== 0) { return [false, 'console program: ' + r.stderr]; }
          const lines = readFileSync(csv, 'utf8').trim().split('\n').slice(1).map((l) => l.split(',').map(Number));
          const web = {}; for (const w of col.rows) { web[w.id] = w; }
          const bad = lines.filter((l) => !web[l[0]] || web[l[0]].start !== l[2] || web[l[0]].finish !== l[3]);
          const maxFinish = Math.max(...lines.map((l) => l[3]));
          return [bad.length === 0 && lines.length === col.rows.length && col.metrics.makespan === maxFinish, lines.length + ' rows compared, ' + bad.length + ' differ'];
        });
      }
    }
  } else {
    await row('Engine', 'Website = console program', 'all', 'build/aprm present', 'K-50 step 4', async () => [false, 'build/aprm not found: run make first']);
  }

  // --- Keyboard
  await row('Run', 'Keyboard', 'Space, Right arrow, Esc', 'Play or pause, step, clear', 'BLUEPRINT 5', async () => { await load(); await preset('heavy_load'); await step('run'); await click('run-start'); await ev(`document.activeElement.blur(); true`); await key('ArrowRight', 'ArrowRight', 39); const a = await snap('events'); await key(' ', 'Space', 32); const s = await snap('status'); await key(' ', 'Space', 32); const t = await snap('status'); await ev(`APRM.player.select(APRM.player.snapshot().jobs[0].id); document.activeElement.blur(); true`); const on = await snap('selected'); await key('Escape', 'Escape', 27); return a === 1 && s === 'playing' && t === 'paused' && on !== null && (await snap('selected')) === null; });
}

let code = 0;
try { await main(); } catch (e) { console.log('driver stopped: ' + e.message); code = 1; } finally { chrome.kill(); }
const fails = rows.filter((r) => r.status !== 'PASS');
console.log(rows.length + ' rows, ' + fails.length + ' failed');
if (out) {
  const esc = (s) => String(s).replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 160);
  const lines = ['# K-50 click matrix', '', 'Generated by `tests/demo/click_matrix_cdp.mjs`: real headless Chrome, the built file from `file://`, external hosts unreachable. Each row also fails on any console error, uncaught exception or blank panel.', '', rows.length + ' rows, ' + fails.length + ' failed.', '', '| Page | Control | Input | Expected | Source | Actual | Status |', '| --- | --- | --- | --- | --- | --- | --- |'];
  for (const r of rows) { lines.push('| ' + [r.page, r.control, r.input, r.expected, r.source, r.actual, r.status].map(esc).join(' | ') + ' |'); }
  writeFileSync(out, lines.join('\n') + '\n');
}
process.exit(fails.length || code ? 1 : 0);
