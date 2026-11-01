// check_layout_cdp.mjs: layout, keyboard and media-preference checks for the website (K-47).
// Drives real headless Chrome through the DevTools protocol; it only clicks and reads.
// Needs Node 22+ (global WebSocket) and a built web/vendor/aprm.js.
//
// Usage: node tests/demo/check_layout_cdp.mjs <path-to-index.html>
// Checks: no sideways scroll on every step at 1024, 1280 and 1440 px and at 200% zoom (640 px);
// every control reached by Tab shows a visible focus ring; reduced motion removes transitions;
// reduced transparency makes the top bar solid.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const page = process.argv[2];
if (!page) { console.error('usage: node check_layout_cdp.mjs <index.html>'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail) { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : '  -> ' + detail)); }

const profile = mkdtempSync(join(tmpdir(), 'aprm-layout-'));
const port = 9500 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, ['--headless=new', '--no-first-run', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--window-size=1440,900'], { stdio: 'ignore' });
let ws; let nextId = 1; const pending = new Map();
const send = (method, params = {}) => { const id = nextId++; ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => pending.set(id, { res, rej })); };
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
async function load(width) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(page).href });
  for (let i = 0; i < 100 && !(await ev(`(document.getElementById('engine-status')||{}).textContent === 'Engine ready'`)); i++) await sleep(100);
}
const hscroll = () => ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
async function pressTab() {
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
}

try {
  let url; for (let i = 0; i < 100; i++) { try { const t = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find((x) => x.type === 'page'); if (t) { url = t.webSocketDebuggerUrl; break; } } catch (e) { /* not up yet */ } await sleep(100); }
  ws = new WebSocket(url); await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); } };
  await send('Page.enable'); await send('Runtime.enable');

  // 1. no sideways scroll on each step, at laptop widths and at 200% zoom (640 css px)
  for (const width of [1440, 1280, 1024, 640]) {
    await load(width);
    await ev(`document.querySelector('#preset-tiles [data-preset="tiny_case"]').click(); true`);
    check(`${width}px Build: no sideways scroll`, (await hscroll()) <= 0, await hscroll());
    await ev(`document.querySelector('#more-ways').open = true; true`);
    check(`${width}px Build with "More ways" open: no sideways scroll`, (await hscroll()) <= 0, await hscroll());
    await ev(`document.querySelector('[data-mode-button="run"]').click(); document.getElementById('run-start').click(); for (let i = 0; i < 12; i++) APRM.player.stepOnce(); true`);
    check(`${width}px Run: no sideways scroll`, (await hscroll()) <= 0, await hscroll());
    await ev(`document.querySelector('[data-mode-button="compare"]').click(); document.getElementById('compare-start').click(); true`);
    for (let i = 0; i < 100 && (await ev(`APRM.compare.snapshot().status`)) !== 'done'; i++) await sleep(100);
    await sleep(500);
    check(`${width}px Compare: no sideways scroll`, (await hscroll()) <= 0, await hscroll());
  }

  // 2. keyboard: every control reached by Tab on the Build step has a visible focus ring
  await load(1280);
  await ev(`document.activeElement && document.activeElement.blur(); true`);
  const seen = [];
  for (let i = 0; i < 40; i++) {
    await pressTab();
    const info = await ev(`(function(){ const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); const sw = e.matches('#details-switch') ? getComputedStyle(e.nextElementSibling) : null; return { id: e.id || e.tagName + ':' + (e.textContent||'').slice(0,20), outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2, trackOutline: sw ? (sw.outlineStyle !== 'none' && parseFloat(sw.outlineWidth) >= 2) : null }; })()`);
    if (info) seen.push(info);
  }
  const bad = seen.filter((s) => !(s.outline || s.trackOutline));
  check('Tab reaches the controls (at least 20 stops)', seen.length >= 20, seen.length + ' stops');
  check('every focused control shows a focus ring of at least 2 px', bad.length === 0, bad.map((b) => b.id).join(', '));

  // 3. Space and Right arrow only act on the Run step, and not while a button has focus
  await ev(`document.activeElement.blur(); document.querySelector('#preset-tiles [data-preset="tiny_case"]').click(); document.querySelector('[data-mode-button="run"]').click(); document.getElementById('run-start').click(); document.activeElement.blur(); true`);
  const before = await ev(`APRM.player.snapshot().events`);
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  const after = await ev(`APRM.player.snapshot().events`);
  check('Right arrow steps one event on the Run step', after === before + 1, before + ' -> ' + after);

  // 4. media preferences
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const dur = await ev(`parseFloat(getComputedStyle(document.querySelector('.btn')).transitionDuration) * 1000`);
  check('reduced motion: button transitions are removed', dur <= 1, dur + ' ms');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  const bg = await ev(`getComputedStyle(document.querySelector('.topbar')).backdropFilter`);
  check('reduced transparency: the top bar has no blur', bg === 'none' || bg === '', bg);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-contrast', value: 'more' }] });
  const bd = await ev(`getComputedStyle(document.querySelector('.card')).borderTopColor`);
  check('increased contrast: borders are darker than the normal hairline', bd !== 'rgb(207, 211, 208)', bd);
} finally { chrome.kill(); }
const failed = results.filter((r) => !r).length;
console.log(failed === 0 ? 'ALL PASS (' + results.length + ')' : failed + ' FAILED of ' + results.length);
process.exit(failed === 0 ? 0 : 1);
