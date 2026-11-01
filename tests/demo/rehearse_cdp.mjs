// rehearse_cdp.mjs: automated rehearsal of the website part of the demo (rows 4, 5, 6).
// Drives a real headless Chrome through the DevTools protocol. It only clicks buttons and
// reads what the page shows; it never decides which job runs. Needs Node 22+ (global WebSocket).
//
// Usage: node tests/demo/rehearse_cdp.mjs <path-to-index.html> [--offline]
// --offline starts Chrome with every external host unreachable (--host-resolver-rules).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME = process.env.CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const page = process.argv[2];
const offline = process.argv.includes('--offline');
if (!page) { console.error('usage: node rehearse_cdp.mjs <index.html> [--offline]'); process.exit(2); }

// Only real network requests count (http/https); chrome:// pages and file:// are not network.
const isNet = (u) => /^https?:/.test(u);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : '  -> ' + detail));
}

const profile = mkdtempSync(join(tmpdir(), 'aprm-demo-'));
const port = 9300 + Math.floor(Math.random() * 500);
const args = ['--headless=new', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--window-size=1400,1000'];
if (offline) { args.push('--host-resolver-rules=MAP * ~NOTFOUND'); }
if (process.env.CHROME_EXTRA_ARGS) { args.push(...process.env.CHROME_EXTRA_ARGS.split(' ').filter(Boolean)); }  // e.g. --no-sandbox on CI
const chrome = spawn(CHROME, args, { stdio: 'ignore' });

async function connect() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/json/list');
      const tabs = await r.json();
      const t = tabs.find((x) => x.type === 'page');
      if (t) { return t.webSocketDebuggerUrl; }
    } catch (e) { /* not up yet */ }
    await sleep(100);
  }
  throw new Error('Chrome did not start');
}

let ws; let nextId = 1; const pending = new Map(); const netFails = []; const consoleErrors = []; const requests = [];
function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) { throw new Error('page error: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails)); }
  return r.result.value;
}
async function waitFor(expr, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await ev(expr)) { return true; } await sleep(50); }
  return false;
}

// Small page helpers (all run inside the page and use only visible controls).
const H = `
window.__h = {
  set(id, v) { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', {bubbles:true})); e.dispatchEvent(new Event('change', {bubbles:true})); },
  click(id) { document.getElementById(id).click(); },
  mode(m) { document.querySelector('[data-mode-button="' + m + '"]').click(); },
  text(id) { const e = document.getElementById(id); return e ? e.textContent : null; },
  loadPreset(name) { this.mode('build'); document.querySelector('#preset-tiles [data-preset="' + name + '"]').click(); },
  tick(policy, on) { const c = document.querySelector('#compare-policies input[data-policy="' + policy + '"]'); c.checked = on; c.dispatchEvent(new Event('change', {bubbles:true})); },
  whyLines() { return Array.from(document.querySelectorAll('#whylog-list li')).map((l) => l.textContent); }
};`;

async function runToEnd(policy) {
  await ev(`__h.mode('run'); __h.set('run-policy', '${policy}'); __h.click('run-start'); true`);
  await ev(`__h.click('run-jump'); true`);
  const done = await waitFor(`APRM.player.snapshot().status === 'finished'`);
  return done;
}
// "Job N started" log line time for the job, from the why log the engine wrote.
const startOf = (job) => ev(`(function(){ const e = APRM.player.snapshot().entries.filter(x => /^Job ${job} started/.test(x.msg)); return e.length ? e[0].t : null; })()`);

try {
  const url = await connect();
  ws = new WebSocket(url);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); return; }
    if (d.method === 'Network.requestWillBeSent') { requests.push(d.params.request.url); }
    if (d.method === 'Network.loadingFailed') { netFails.push(d.params.errorText + ' ' + (d.params.blockedReason || '')); }
    if (d.method === 'Runtime.exceptionThrown') { consoleErrors.push('EXC ' + JSON.stringify(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text)); }
  };
  await send('Network.enable'); await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: pathToFileURL(page).href });

  // --- Start-up
  check('engine ready', await waitFor(`document.getElementById('engine-status').textContent === 'Engine ready'`),
    await ev(`document.getElementById('engine-status').textContent`));
  await ev(H + ' true');
  check('page is served from file://', (await ev('location.protocol')) === 'file:');
  check('Build/Run start-up makes no network request', requests.filter(isNet).length === 0, JSON.stringify(requests.filter(isNet)));

  // --- Row 4: big-job trap, FCFS vs ours in Compare
  await ev(`__h.loadPreset('big_job_trap'); true`);
  check('row 4: big_job_trap loads 10 jobs on 10 cores / 10240 MB', (await ev(`APRM.store.get().jobs.length`)) === 10 && (await ev(`__h.text('machine-text')`)).includes('CPU 10 cores, memory 10240 MB'), await ev(`__h.text('machine-text')`));
  await ev(`__h.mode('compare'); __h.tick('aging', false); __h.tick('aging_reserve', true); true`);
  await ev(`__h.click('compare-start'); true`);
  check('row 4: Compare finishes', await waitFor(`APRM.compare.snapshot().status === 'done'`));
  const cmp = await ev(`APRM.compare.snapshot().columns.map(c => ({p: c.policy, avg: c.metrics.avg_wait, max: c.metrics.max_wait, mk: c.metrics.makespan}))`);
  console.log('     compare columns: ' + JSON.stringify(cmp));
  check('row 4: fcfs and reserve both avg_wait 17.1, max_wait 19, makespan 22 (the trap is not fixed online)', cmp.length === 2 && cmp.every((c) => Math.abs(c.avg - 17.1) < 1e-9 && c.max === 19 && c.mk === 22));
  const tableRows = await ev(`document.querySelectorAll('#compare-body tr').length`);
  check('row 4: metrics table shown', tableRows > 0, tableRows + ' rows');
  await waitFor(`APRM.compare.chartState() !== 'loading'`, 14000); // Chart.js has a 10 s timeout
  const note = (await ev(`document.getElementById('compare-chart-note').hidden`)) ? '(hidden)' : await ev(`__h.text('compare-chart-note')`);
  const chartState = await ev(`APRM.compare.chartState()`);
  console.log('     chart state: ' + chartState + '; note: ' + note);
  check('row 4: charts loaded, or table fallback with a message', chartState === 'loaded' || (chartState === 'failed' && /could not load|could not be loaded|unavailable/i.test(note || '')), chartState);
  // The built single file (make web) carries the chart library, so offline it still draws charts; the
  // unbuilt web/index.html loads it from the CDN and offline falls back to the table with a message.
  if (offline) { check('offline: charts drawn from the bundled library, or the table fallback with a message', chartState === 'loaded' || (chartState === 'failed' && /could not load/.test(note || '')), chartState); }
  check('row 4: exact-optimum row explains the 9-job limit (big_job_trap has 10 jobs)', /only worked out for 9 jobs or fewer/.test(await ev(`__h.text('compare-exact')`)));

  // --- Row 5: memory hog, aging vs aging + reservation, why log
  await ev(`__h.loadPreset('memory_hog'); true`);
  const s5 = await ev(`JSON.stringify(APRM.store.get().settings)`);
  console.log('     memory_hog settings: ' + s5);
  check('row 5: aging run finishes', await runToEnd('aging'));
  const agingStart = await startOf(3);
  const agingMetrics = await ev(`JSON.stringify(APRM.player.snapshot().metrics)`);
  console.log('     aging: job 3 starts at ' + agingStart + '; metrics ' + agingMetrics);
  check('row 5: aging starts job 3 at t=36', agingStart === 36, agingStart);
  check('row 5: reserve run finishes', await runToEnd('aging_reserve'));
  const resStart = await startOf(3);
  console.log('     aging_reserve: job 3 starts at ' + resStart);
  check('row 5: aging + reservation starts job 3 at t=12', resStart === 12, resStart);
  const lines = await ev(`__h.whyLines().filter(l => /Job 3 /.test(l))`);
  console.log('     why log lines naming job 3: ' + JSON.stringify(lines));
  check('row 5: why log shows "Job 3 reserved: start guaranteed at t=12."', lines.some((l) => /Job 3 reserved: start guaranteed at t=12/.test(l)));
  await ev(`APRM.player.select(3); true`);
  const filtered = await ev(`__h.whyLines().every(l => /Job 3 /.test(l)) && __h.whyLines().length`);
  check('row 5: selecting job 3 filters the why log to job 3', !!filtered && (await ev(`!document.getElementById('whylog-clear').hidden`)), filtered);
  await ev(`__h.click('whylog-clear'); true`);

  // --- Row 6: examiner builds a case / adds a job mid-run
  await ev(`__h.loadPreset('heavy_load'); true`);
  check('row 6: heavy_load loads 12 jobs', (await ev(`APRM.store.get().jobs.length`)) === 12);
  await ev(`__h.set('add-id','50'); __h.set('add-arrival','3'); __h.set('add-duration','4'); __h.set('add-cpu','2'); __h.set('add-mem','2048'); __h.set('add-priority','9'); __h.click('add-submit'); true`);
  check('row 6: Build mode adds a 13th job', (await ev(`APRM.store.get().jobs.length`)) === 13);
  await ev(`__h.mode('run'); __h.set('run-policy','aging'); __h.click('run-start'); true`);
  for (let i = 0; i < 5; i++) { await ev(`__h.click('run-step'); true`); }
  const nowBefore = await ev(`APRM.player.snapshot().state.now`);
  await ev(`__h.set('ra-id','99'); __h.set('ra-duration','3'); __h.set('ra-cpu','1'); __h.set('ra-mem','1024'); __h.click('ra-submit'); true`);
  check('row 6: mid-run add of job 99 accepted (no error shown)', (await ev(`document.getElementById('ra-error').hidden`)) === true && (await ev(`APRM.player.snapshot().jobs.some(j => j.id === 99)`)), 'now=' + nowBefore);
  await ev(`__h.click('run-jump'); true`);
  check('row 6: run with the extra job finishes', await waitFor(`APRM.player.snapshot().status === 'finished'`));
  const m99 = await startOf(99);
  console.log('     job 99 started at ' + m99);
  check('row 6: job 99 got a start time', m99 !== null, m99);
  // bad input is refused with a message and the run survives
  await ev(`__h.set('ra-id','99'); __h.click('ra-submit'); true`);
  check('row 6: duplicate id refused with a visible message', (await ev(`document.getElementById('ra-error').hidden`)) === false, await ev(`__h.text('ra-error')`));

  // --- Whole-run diagnostics
  const real = requests.filter(isNet);
  console.log('     non-file requests: ' + JSON.stringify(real));
  console.log('     failed loads: ' + JSON.stringify(netFails));
  console.log('     uncaught exceptions: ' + JSON.stringify(consoleErrors));
  check('no uncaught page exceptions', consoleErrors.length === 0);
  if (/[\\/]dist[\\/]index\.html$/.test(page)) { check('built single file: no network request at all', real.length === 0, JSON.stringify(real)); }
} catch (e) {
  check('rehearsal script ran to the end', false, e.message);
} finally {
  try { ws && ws.close(); } catch (e) { /* ignore */ }
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
