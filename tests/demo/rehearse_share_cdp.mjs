// rehearse_share_cdp.mjs: real-Chrome check of shareable case links (K-36), over file://.
// Drives a real headless Chrome through the DevTools protocol. It only clicks buttons and
// reads what the page shows; it never decides which job runs. Needs Node 22+ (global WebSocket).
//
// Usage: node tests/demo/rehearse_share_cdp.mjs <path-to-index.html> [--offline]
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


// Share links in a real browser (K-36): opens file:// pages with a hash and reads what the page shows.
const text = (id) => ev(`(function(){ const e = document.getElementById('${id}'); return e ? e.textContent : null; })()`);
const nav = async (u) => { await send('Page.navigate', { url: u }); await sleep(600); await waitFor(`document.readyState === 'complete' && !!window.APRM && !!APRM.share`); };
try {
  const url = await connect();
  ws = new WebSocket(url);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); return; }
    if (d.method === 'Network.requestWillBeSent') { requests.push(d.params.request.url); }
    if (d.method === 'Runtime.exceptionThrown') { consoleErrors.push('EXC ' + JSON.stringify(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text)); }
  };
  await send('Network.enable'); await send('Runtime.enable'); await send('Page.enable');
  const base = pathToFileURL(page).href;
  await nav(base);
  check('page is served from file://', (await ev('location.protocol')) === 'file:');
  check('no hash: no share message, page loads', (await ev(`document.getElementById('share-error').hidden`)) === true);

  // Share a preset, then open the link in a "new tab" (a fresh navigation).
  await ev(`document.getElementById('preset-select').value = 'memory_hog'; document.getElementById('preset-load').click(); true`);
  const before = await ev(`JSON.stringify(APRM.store.get(), (k, v) => k === 'engine' ? undefined : v)`);
  await ev(`document.getElementById('share-copy').click(); true`);
  await waitFor(`document.getElementById('share-link').value !== ''`);
  const link = await ev(`document.getElementById('share-link').value`);
  console.log('     link (' + link.length + ' chars): ' + link.slice(0, 90) + '...');
  check('link starts with file:// and #aprm1=', link.startsWith('file://') && link.includes('#aprm1='));
  check('share status says copied or press Ctrl+C', /copied|Press Ctrl/.test(await text('share-status')), await text('share-status'));
  await nav('about:blank');
  await nav(link);
  const after = await ev(`JSON.stringify(APRM.store.get(), (k, v) => k === 'engine' ? undefined : v)`);
  check('new tab opened from the link has the same case', after === before && JSON.parse(after).jobs.length === 12);
  check('page shows the loaded status', /Loaded the shared case: 12 jobs/.test(await text('share-status')), await text('share-status'));
  check('machine text matches', (await text('machine-text')).includes('CPU 8 cores, memory 8192 MB'), await text('machine-text'));

  // Tamper with the hash by hand: change one character in the middle.
  const tampered = link.slice(0, link.length - 12) + (link[link.length - 12] === 'A' ? 'B' : 'A') + link.slice(link.length - 11);
  await nav('about:blank'); await nav(tampered);
  const err1 = await text('share-error');
  console.log('     tampered: ' + err1);
  check('tampered link: clear error or still a valid case, page alive', (await ev(`document.getElementById('share-error').hidden`)) === false || (await ev(`APRM.store.get().jobs.length`)) > 0);
  await nav('about:blank'); await nav(base + '#aprm1=' + 'Zm9v');
  const err2 = await text('share-error');
  console.log('     garbled: ' + err2);
  check('garbled link: error text shown, no jobs loaded, controls still work', /settings line/.test(err2) && (await ev(`APRM.store.get().jobs.length`)) === 0 && (await ev(`document.getElementById('preset-load').click(); true`)) === true);
  await nav('about:blank'); await nav(base + '#aprm1=' + 'A'.repeat(20000));
  check('oversized link: rejected as too long', /too long/.test(await text('share-error')), (await text('share-error')).slice(0, 80));
  // bad row, same words as the CSV importer
  const bad = Buffer.from('1,16,32768,100,50,100,fcfs\n1,0,5,2,100,10\n', 'latin1').toString('base64url');
  await nav('about:blank'); await nav(base + '#aprm1=' + bad);
  check('bad row gives the CSV words', /Line 2, column priority: must be 0 to 9\./.test(await text('share-error')), await text('share-error'));
  // hashchange in the same tab
  const good = Buffer.from('1,16,32768,100,50,100,aging\n7,0,5,2,100,1\n', 'latin1').toString('base64url');
  await ev(`location.hash = '#aprm1=${good}'; true`);
  check('hashchange in the same tab loads the new case', await waitFor(`APRM.store.get().jobs.length === 1 && APRM.store.get().jobs[0].id === 7`));
  check('engine still comes up with a case from a link', await waitFor(`document.getElementById('engine-status').textContent === 'Engine ready'`));
  check('no uncaught page exceptions', consoleErrors.length === 0, JSON.stringify(consoleErrors));
  check('no network request from the page except the pinned chart script (none at start-up)', requests.filter(isNet).length === 0, JSON.stringify(requests.filter(isNet)));
} catch (e) {
  check('share rehearsal ran to the end', false, e.message);
} finally {
  try { ws && ws.close(); } catch (e) { /* ignore */ }
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
