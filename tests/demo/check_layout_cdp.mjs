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
const hscroll = () => ev(`Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.body.clientWidth)`);
async function pressTab() {
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
}

try {
  let url; for (let i = 0; i < 100; i++) { try { const t = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find((x) => x.type === 'page'); if (t) { url = t.webSocketDebuggerUrl; break; } } catch (e) { /* not up yet */ } await sleep(100); }
  ws = new WebSocket(url); await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); } };
  await send('Page.enable'); await send('Runtime.enable');

  // 1. no sideways scroll on each step, at laptop widths and at 200% zoom (640 css px)
  for (const width of [1440, 1280, 1024, 640, 375]) {
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

  // 1b. on a phone the new-job row and Add job can be reached, and the top bar stays inside the screen
  await load(375);
  await ev(`document.querySelector('#preset-tiles [data-preset="heavy_load"]').click(); document.getElementById('add-submit').scrollIntoView({ block: 'center' }); true`);
  await sleep(300);
  check('375px: Add job is the top element at its own position', await ev(`(function(){ const b = document.getElementById('add-submit'); const r = b.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b; })()`));
  for (const w of [1366, 375]) {
    await load(w);
    const gap = await ev(`document.documentElement.clientWidth - document.getElementById('theme-toggle').getBoundingClientRect().right`);
    check(`${w}px: the theme button keeps a right margin`, gap >= 8, gap);
  }

  // 2. keyboard: every control reached by Tab, on each step, shows a visible focus ring
  async function tabWalk(label, minStops) {
    await ev(`document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); true`);
    const seen = [];
    for (let i = 0; i < 60; i++) {
      await pressTab();
      const info = await ev(`(function(){ const e = document.activeElement; if (!e || e === document.body) return null; const ring = (c) => c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) >= 2; const isSwitch = e.id === 'details-switch'; const ok = isSwitch ? ring(getComputedStyle(e.nextElementSibling)) : ring(getComputedStyle(e)); return { id: e.id || e.tagName + ':' + (e.textContent||'').slice(0,20), ok }; })()`);
      if (info) seen.push(info);
    }
    const bad = seen.filter((x) => !x.ok);
    check(`${label}: Tab reaches the controls (at least ${minStops} stops)`, seen.length >= minStops, seen.length + ' stops');
    check(`${label}: every focused control shows a focus ring of at least 2 px (the switch shows it on its track)`, bad.length === 0, bad.map((x) => x.id).join(', '));
  }
  await load(1280);
  await ev(`document.querySelector('#preset-tiles [data-preset="tiny_case"]').click(); true`);
  await tabWalk('Build', 20);
  await ev(`document.querySelector('[data-mode-button="run"]').click(); document.getElementById('run-start').click(); true`);
  await tabWalk('Run', 12);
  await ev(`document.querySelector('[data-mode-button="compare"]').click(); true`);
  await tabWalk('Compare', 8);

  // 3. Space and Right arrow act on the Run step, and do nothing while a button has focus
  const key = async (k, code, vk) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk }); };
  await ev(`document.querySelector('[data-mode-button="run"]').click(); document.getElementById('run-start').click(); document.activeElement.blur(); true`);
  let n = await ev(`APRM.player.snapshot().events`);
  await key('ArrowRight', 'ArrowRight', 39);
  check('Right arrow steps one event on the Run step', (await ev(`APRM.player.snapshot().events`)) === n + 1);
  n = await ev(`APRM.player.snapshot().events`);
  await ev(`document.getElementById('run-reset').focus(); true`);
  await key('ArrowRight', 'ArrowRight', 39);
  check('Right arrow does nothing while a button has focus', (await ev(`APRM.player.snapshot().events`)) === n);
  await ev(`document.activeElement.blur(); true`);
  await key(' ', 'Space', 32);
  check('Space starts playing on the Run step', ['playing', 'finished'].includes(await ev(`APRM.player.snapshot().status`)));
  await key(' ', 'Space', 32);

  // 3b. the day and night button changes the page colours and survives a reload
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await load(1280);
  const day = await ev(`getComputedStyle(document.body).backgroundColor`);
  await ev(`document.getElementById('theme-toggle').click(); true`);
  const night = await ev(`getComputedStyle(document.body).backgroundColor`);
  check('day and night button: the page background changes', day === 'rgb(242, 243, 241)' && night === 'rgb(18, 21, 19)', day + ' -> ' + night);
  check('the button now offers day mode', (await ev(`document.getElementById('theme-toggle').textContent`)) === 'Day mode');
  await send('Page.navigate', { url: pathToFileURL(page).href });
  for (let i = 0; i < 100 && !(await ev(`(document.getElementById('engine-status')||{}).textContent === 'Engine ready'`)); i++) await sleep(100);
  check('the choice is remembered after a reload', (await ev(`getComputedStyle(document.body).backgroundColor`)) === 'rgb(18, 21, 19)');
  await ev(`localStorage.removeItem('aprm.theme'); true`);
  await load(1280);                                   // back to the system (day) look for the checks below

  // 3c. with nothing saved, a dark system starts in night mode
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await load(1280);
  check('dark system, nothing saved: starts at night with the Day mode button', (await ev(`document.documentElement.getAttribute('data-theme')`)) === 'dark' && (await ev(`document.getElementById('theme-toggle').textContent`)) === 'Day mode');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await load(1280);

  // 4. media preferences: measure before and after, with the colour scheme pinned
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  const base = await ev(`(function(){ const b = getComputedStyle(document.querySelector('.btn')); const t = getComputedStyle(document.querySelector('.topbar')); const c = getComputedStyle(document.querySelector('.card')); return { dur: parseFloat(b.transitionDuration) * 1000, blur: t.backdropFilter || t.webkitBackdropFilter, border: c.borderTopColor }; })()`);
  check('baseline: buttons have a transition, the top bar is blurred, the hairline is the light grey', base.dur > 1 && base.blur !== 'none' && base.border === 'rgb(207, 211, 208)', JSON.stringify(base));
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  const dur = await ev(`parseFloat(getComputedStyle(document.querySelector('.btn')).transitionDuration) * 1000`);
  check('reduced motion: button transitions are removed', dur <= 1, dur + ' ms');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-transparency', value: 'reduce' }] });
  const bg = await ev(`getComputedStyle(document.querySelector('.topbar')).backdropFilter`);
  check('reduced transparency: the top bar has no blur', bg === 'none' || bg === '', bg);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-contrast', value: 'more' }] });
  const bd = await ev(`getComputedStyle(document.querySelector('.card')).borderTopColor`);
  check('increased contrast: borders are darker than the normal hairline', bd === 'rgb(91, 98, 94)', bd);
} finally { chrome.kill(); }
const failed = results.filter((r) => !r).length;
console.log(failed === 0 ? 'ALL PASS (' + results.length + ')' : failed + ' FAILED of ' + results.length);
process.exit(failed === 0 ? 0 : 1);
