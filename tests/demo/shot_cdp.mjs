// shot_cdp.mjs: screenshots of the Run page in headless Chrome, for before-and-after records (K-51).
// It only clicks and reads; it changes nothing on disk except the PNG files it writes.
//
// Usage: node tests/demo/shot_cdp.mjs <index.html> <out-dir> [prefix]
// Writes <prefix>-<state>-<width>-<theme>.png for: the first Run screen, a paused run after some
// steps, and a finished run, at 1440 and 375 px wide, in the dark and light themes.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [page, outDir, prefix = 'run'] = process.argv.slice(2);
if (!page || !outDir) { console.error('usage: node shot_cdp.mjs <index.html> <out-dir> [prefix]'); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'aprm-shot-'));
const port = 9800 + Math.floor(Math.random() * 150);
const extra = (process.env.CHROME_EXTRA_ARGS || '').split(' ').filter(Boolean);
const chrome = spawn(CHROME, ['--headless=new', '--no-first-run', '--hide-scrollbars', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, ...extra], { stdio: 'ignore' });
let ws; let nextId = 1; const pending = new Map();
const send = (method, params = {}) => { const id = nextId++; ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => pending.set(id, { res, rej })); };
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const waitFor = async (expr, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await sleep(40); } return false; };

async function shot(name, width) {
  const h = await ev('Math.ceil(document.documentElement.scrollHeight)');
  await send('Emulation.setDeviceMetricsOverride', { width, height: Math.min(h, 6000), deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(join(outDir, name + '.png'), Buffer.from(r.data, 'base64'));
  console.log('wrote ' + name + '.png');
}

async function load(width) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'about:blank' });
  await send('Page.navigate', { url: pathToFileURL(page).href });
  await waitFor(`(document.getElementById('engine-status') || {}).textContent === 'Engine ready'`);
  await ev(`try { sessionStorage.setItem('aprm-intro-seen', '1'); } catch (e) {} true`);
}

try {
  let url;
  for (let i = 0; i < 100 && !url; i++) { try { const t = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find((x) => x.type === 'page'); if (t) url = t.webSocketDebuggerUrl; } catch (e) { /* not up yet */ } await sleep(100); }
  ws = new WebSocket(url);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); if (d.error) p.rej(new Error(d.error.message)); else p.res(d.result); } };
  await send('Page.enable'); await send('Runtime.enable');
  for (const theme of ['dark', 'light']) {
    for (const width of [1440, 375]) {
      await load(width);
      await ev(`if (document.documentElement.getAttribute('data-theme') !== '${theme}') document.getElementById('theme-toggle').click(); true`);
      await ev(`document.querySelector('#preset-tiles [data-preset="memory_hog"]').click(); true`);
      await ev(`document.querySelector('[data-mode-button="run"]').click(); true`);
      await sleep(2200);
      await shot(`${prefix}-first-${width}-${theme}`, width);
      await ev(`(function(){ var s = document.getElementById('run-policy'); s.value = 'aging_reserve'; s.dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('run-start').click(); APRM.player.pause(); })(); true`);
      for (let i = 0; i < 14; i++) { await ev(`document.getElementById('run-step').click(); true`); await sleep(60); }
      await sleep(900);
      await shot(`${prefix}-paused-${width}-${theme}`, width);
      await ev(`document.getElementById('run-jump').click(); true`);
      await waitFor(`APRM.player.snapshot().status === 'finished'`, 30000);
      await sleep(900);
      await shot(`${prefix}-finished-${width}-${theme}`, width);
    }
  }
} catch (e) {
  console.error(e); process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch (e) { /* ignore */ }
  chrome.kill();
}
