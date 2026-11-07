// check_layout_cdp.mjs: layout, keyboard and media-preference checks for the website (K-47).
// Drives real headless Chrome through the DevTools protocol; it only clicks and reads.
// Needs Node 22+ (global WebSocket) and a built web/vendor/aprm.js.
//
// Usage: node tests/demo/check_layout_cdp.mjs <path-to-index.html>
// Checks: no sideways scroll on every step at 1024, 1280 and 1440 px and at 200% zoom (640 px);
// every control reached by Tab shows a visible focus ring; reduced motion removes transitions;
// the top bar is solid; Inter Tight loads from file:// with the network off; dark is the default
// whatever the system says; the Build intro plays once and settles; the spotlight goes under more contrast.
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
  // The network is off for the whole run: everything, the font included, must come from the files.
  await send('Network.enable');
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  // 0. the embedded font loads from file:// with no network; the Build intro plays once and settles
  await load(1440);
  check('Inter Tight 800 is available with the network off', await ev(`document.fonts.ready.then(() => document.fonts.check('800 40px "Inter Tight"'))`));
  check('Inter Tight 400 is available with the network off', await ev(`document.fonts.check('400 15px "Inter Tight"')`));
  check('the hero title is drawn in Inter Tight', /Inter Tight/.test(await ev(`getComputedStyle(document.querySelector('.hero-title')).fontFamily`)));
  check('the intro is playing on the first visit (settings wait, and cannot be tabbed into)', await ev(`document.getElementById('build-panel').dataset.panel === 'out' && document.querySelector('.build-main').inert === true`));
  check('during the intro: no sideways scroll', (await hscroll()) <= 0, await hscroll());
  for (let i = 0; i < 60 && (await ev(`document.getElementById('build-panel').dataset.panel`)) !== 'in'; i++) await sleep(100);
  await sleep(700);
  check('the intro settles: settings shown, labels on, Skip hidden', await ev(`document.getElementById('build-panel').dataset.panel === 'in' && document.getElementById('build-hero').dataset.labels === 'on' && document.getElementById('hero-skip').hidden`));
  check('five laptop labels with their numbers', await ev(`[...document.querySelectorAll('.lt-label .val')].map((e) => e.textContent).join('|') === 'Build · step 1 of 3|No jobs yet|16 cores|32768 MB|1 shared machine'`));
  const clear = await ev(`(function(){ const l = document.querySelector('[data-label="keys"]').getBoundingClientRect(), d = document.querySelector('[data-part="keys"]').getBoundingClientRect(); return { label: Math.round(l.left), deck: Math.round(d.right) }; })()`);
  check('labels sit clear of the laptop (right of the keyboard deck)', clear.label >= clear.deck, JSON.stringify(clear));
  await load(1440);
  check('second visit in the same tab: no intro', (await ev(`document.getElementById('build-panel').dataset.panel`)) === 'in');
  await ev(`document.getElementById('cpu-inc').click(); document.querySelector('#mem-quick [data-mb="16384"]').click(); true`);
  check('stepper and quick choice reach the store and the labels', await ev(`APRM.store.get().machine.cpu === 17 && APRM.store.get().machine.mem === 16384 && document.querySelector('[data-label="cpu"] .val').textContent === '17 cores'`));
  await ev(`document.getElementById('cpu-slider').focus(); true`);
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'End', code: 'End', windowsVirtualKeyCode: 35 });
  check('slider: End jumps to 128 cores', (await ev(`APRM.store.get().machine.cpu`)) === 128);
  await ev(`(function(){ const i = document.getElementById('cpu-input'); i.value = '0'; i.dispatchEvent(new Event('change')); })(); true`);
  check('0 cores: message next to the field, the store keeps 128', await ev(`!document.getElementById('cpu-error').hidden && APRM.store.get().machine.cpu === 128 && document.getElementById('build-next-note').dataset.state === 'bad'`));

  // 1. no sideways scroll on each step, at laptop widths and at 200% zoom (640 css px)
  for (const width of [1440, 1280, 1024, 640, 375]) {
    await load(width);
    await ev(`document.querySelector('#preset-tiles [data-preset="tiny_case"]').click(); true`);
    check(`${width}px Build: no sideways scroll`, (await hscroll()) <= 0, await hscroll());
    await ev(`document.querySelector('#more-ways').open = true; true`);
    check(`${width}px Build with "More ways" open: no sideways scroll`, (await hscroll()) <= 0, await hscroll());
    await ev(`document.querySelector('[data-mode-button="run"]').click(); document.getElementById('run-start').click(); APRM.player.pause(); for (let i = 0; i < 12; i++) APRM.player.stepOnce(); true`);
    check(`${width}px Run: no sideways scroll`, (await hscroll()) <= 0, await hscroll());
    await ev(`document.querySelector('[data-mode-button="compare"]').click(); document.getElementById('compare-start').click(); true`);
    for (let i = 0; i < 100 && (await ev(`APRM.compare.snapshot().status`)) !== 'done'; i++) await sleep(100);
    await sleep(500);
    check(`${width}px Compare: no sideways scroll`, (await hscroll()) <= 0, await hscroll());
  }

  // 1a. on a phone every Compare number is shown, inside its row, next to its label
  await load(375);
  await ev(`document.querySelector('#preset-tiles [data-preset="tiny_case"]').click(); document.querySelector('[data-mode-button="compare"]').click(); document.getElementById('compare-start').click(); true`);
  for (let i = 0; i < 100 && (await ev(`APRM.compare.snapshot().status`)) !== 'done'; i++) await sleep(100);
  const cells = await ev(`(function(){ const box = document.querySelector('#compare-table-wrap').getBoundingClientRect(); const out = []; for (const td of document.querySelectorAll('#compare-body td')) { const r = document.createRange(); r.selectNodeContents(td); const b = r.getBoundingClientRect(); out.push({ t: td.textContent, ok: b.width > 0 && b.left >= box.left && b.right <= box.right }); } return out; })()`);
  check('375px Compare: every number is on screen inside the table', cells.length >= 14 && cells.every((c) => c.ok), cells.filter((c) => !c.ok).map((c) => c.t).join(' | ') || cells.length + ' cells');

  // 1b. on a phone the new-job row and Add job can be reached, and the top bar stays inside the screen
  await load(375);
  await ev(`document.querySelector('#preset-tiles [data-preset="heavy_load"]').click(); document.getElementById('add-submit').scrollIntoView({ block: 'center' }); true`);
  await sleep(300);
  check('375px: Add job is the top element at its own position', await ev(`(function(){ const b = document.getElementById('add-submit'); const r = b.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b; })()`));
  await ev(`document.querySelector('[data-mode-button="run"]').click(); true`);
  const fit = await ev(`(function(){ const out = []; for (const c of document.querySelectorAll('#run-methods [data-policy]')) { const r = c.getBoundingClientRect(); if (c.scrollWidth > c.clientWidth + 1 || r.right > document.documentElement.clientWidth) out.push(c.getAttribute('data-policy')); } return { cards: document.querySelectorAll('#run-methods [data-policy]').length, over: out }; })()`);
  check('375px: every scheduler card shows its whole name on screen', fit.cards === 6 && fit.over.length === 0, JSON.stringify(fit));
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
  const key = async (k, code, vk) => {
    const text = k === 'Enter' ? '\r' : undefined;      // a real Enter carries text; that is what presses a button
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, text });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
  };
  await ev(`document.querySelector('[data-mode-button="run"]').click(); document.getElementById('run-start').click(); APRM.player.pause(); document.activeElement.blur(); true`);
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

  // 3b. the theme button turns the dark default into warm paper and survives a reload
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await load(1280);
  const dark = await ev(`getComputedStyle(document.body).backgroundColor`);
  await ev(`document.getElementById('theme-toggle').click(); true`);
  const paper = await ev(`getComputedStyle(document.body).backgroundColor`);
  check('theme button: dark void to warm paper', dark === 'rgb(12, 12, 13)' && paper === 'rgb(245, 241, 232)', dark + ' -> ' + paper);
  check('the button now offers the dark theme', (await ev(`document.getElementById('theme-toggle').textContent`)) === 'Dark theme');
  check('the laptop screen stays dark on warm paper', (await ev(`getComputedStyle(document.querySelector('.lt-lit')).backgroundColor`)) === 'rgb(12, 12, 13)');
  await send('Page.navigate', { url: pathToFileURL(page).href });
  for (let i = 0; i < 100 && !(await ev(`(document.getElementById('engine-status')||{}).textContent === 'Engine ready'`)); i++) await sleep(100);
  check('the choice is remembered after a reload', (await ev(`getComputedStyle(document.body).backgroundColor`)) === 'rgb(245, 241, 232)');
  await ev(`localStorage.removeItem('aprm.theme'); true`);
  await load(1280);

  // 3c. with nothing saved, the site is dark whatever the system says
  for (const scheme of ['light', 'dark']) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await load(1280);
    check(`${scheme} system, nothing saved: starts dark with the Light theme button`, (await ev(`document.documentElement.getAttribute('data-theme')`)) === 'dark' && (await ev(`getComputedStyle(document.body).backgroundColor`)) === 'rgb(12, 12, 13)' && (await ev(`document.getElementById('theme-toggle').textContent`)) === 'Light theme');
  }
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await load(1280);

  // 3d. keyboard on job rows: Enter filters, focus stays on the list, Esc shows all again
  await load(1280);
  await ev(`document.querySelector('#preset-tiles [data-preset="heavy_load"]').click(); document.querySelector('[data-mode-button="run"]').click(); document.getElementById('run-start').click(); APRM.player.pause(); for (let i = 0; i < 16; i++) APRM.player.stepOnce(); document.querySelector('#wait-body tr').focus(); true`);
  await key('Enter', 'Enter', 13);
  check('Enter on a waiting-table row selects that job', (await ev(`APRM.player.snapshot().selected`)) !== null);
  check('focus stays on a table row after the pick', await ev(`document.activeElement.parentNode === document.getElementById('wait-body')`));
  await key('Escape', 'Escape', 27);
  check('Esc on a table row clears the selection', (await ev(`APRM.player.snapshot().selected`)) === null);

  // 3e. the demo path by keyboard alone, in day and night, with no console error (PRD 10A rows 4 to 6)
  const tabTo = async (expr) => {
    for (let i = 0; i < 120; i++) {
      if (await ev(`document.activeElement === (${expr})`)) { return true; }
      await pressTab();
    }
    return false;
  };
  for (const scheme of ['light', 'dark']) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await load(1366);
    await ev(`window.addEventListener('error', (e) => { (window.__errs = window.__errs || []).push(String(e.message)); }); document.activeElement.blur(); true`);
    const q = (sel) => `document.querySelector('${sel}')`;
    const failed = [];
    const need = (name, ok) => { if (!ok) { failed.push(name); } };
    need('reach the example', await tabTo(q('#preset-tiles [data-preset=memory_hog]')));
    await key('Enter', 'Enter', 13);
    need('load the example', (await ev(`APRM.store.get().jobs.length`)) === 12);
    need('reach step 2', await tabTo(q('[data-mode-button=run]')));
    await key('Enter', 'Enter', 13);
    need('open step 2', (await ev(`APRM.store.get().mode`)) === 'run');
    need('reach Run', await tabTo(q('#run-start')));
    await key('Enter', 'Enter', 13);
    need('Run plays', ['playing', 'finished'].includes(await ev(`APRM.player.snapshot().status`)));
    await ev(`document.activeElement.blur(); true`);
    await key(' ', 'Space', 32);
    need('Space pauses', (await ev(`APRM.player.snapshot().status`)) === 'paused');
    const before = await ev(`APRM.player.snapshot().events`);
    await key('ArrowRight', 'ArrowRight', 39);
    await key('ArrowRight', 'ArrowRight', 39);
    need('step twice', (await ev(`APRM.player.snapshot().events`)) === before + 2);
    need('reach Jump to end', await tabTo(q('#run-jump')));
    await key('Enter', 'Enter', 13);
    for (let i = 0; i < 100 && (await ev(`APRM.player.snapshot().status`)) !== 'finished'; i++) await sleep(50);
    need('finish the run', (await ev(`APRM.player.snapshot().status`)) === 'finished');
    need('reach step 3', await tabTo(q('[data-mode-button=compare]')));
    await key('Enter', 'Enter', 13);
    need('reach Compare', await tabTo(q('#compare-start')));
    await key('Enter', 'Enter', 13);
    for (let i = 0; i < 100 && (await ev(`APRM.compare.snapshot().status`)) !== 'done'; i++) await sleep(50);
    need('finish Compare', (await ev(`APRM.compare.snapshot().status`)) === 'done');
    const errs = await ev(`window.__errs || []`);
    check(`${scheme}: the demo path runs by keyboard alone with no page error`, failed.length === 0 && errs.length === 0, failed.concat(errs).join(' | '));
  }
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await load(1280);

  // 4. media preferences: measure before and after, with the colour scheme pinned
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  const base = await ev(`(function(){ const b = getComputedStyle(document.querySelector('.btn')); const t = getComputedStyle(document.querySelector('.topbar')); const c = getComputedStyle(document.querySelector('.module')); return { dur: parseFloat(b.transitionDuration) * 1000, blur: t.backdropFilter || t.webkitBackdropFilter || 'none', bg: t.backgroundColor, border: c.borderTopColor, spot: getComputedStyle(document.querySelector('.lt-spot')).display }; })()`);
  check('baseline: buttons have a transition, the top bar is solid with no blur, the hairline is #2A2A2E, the spotlight shows', base.dur > 1 && base.blur === 'none' && base.bg === 'rgb(12, 12, 13)' && base.border === 'rgb(42, 42, 46)' && base.spot !== 'none', JSON.stringify(base));
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  const dur = await ev(`parseFloat(getComputedStyle(document.querySelector('.btn')).transitionDuration) * 1000`);
  check('reduced motion: button transitions are removed', dur <= 1, dur + ' ms');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-transparency', value: 'reduce' }] });
  const bg = await ev(`getComputedStyle(document.querySelector('.topbar')).backdropFilter`);
  check('reduced transparency: the top bar has no blur', bg === 'none' || bg === '', bg);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-contrast', value: 'more' }] });
  const bd = await ev(`getComputedStyle(document.querySelector('.module')).borderTopColor`);
  check('increased contrast: dividers become the stronger stone', bd === 'rgb(117, 113, 106)', bd);
  check('increased contrast: the Build spotlight is removed', (await ev(`getComputedStyle(document.querySelector('.lt-spot')).display`)) === 'none');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await ev(`sessionStorage.removeItem('aprm-intro-seen'); true`);
  await load(1280);
  await sleep(600);
  check('reduced motion: the intro is a short cross-fade (settings shown within 0.6 s, no glide)', await ev(`document.getElementById('build-panel').dataset.panel === 'in'`));

  // 5. The Run laptop (K-52): the reassembly from Build, idle when paused, reduced motion, flat, phone width
  await send('Emulation.setEmulatedMedia', { features: [] });
  await load(1440);
  await ev(`document.querySelector('#preset-tiles [data-preset="memory_hog"]').click(); true`);
  await sleep(4200);                                   // the Build intro has ended
  await ev(`document.querySelector('[data-next="run"]').click(); true`);
  const mid = await ev(`document.getElementById('run-panel').getAttribute('data-arriving')`);
  await sleep(1900);
  const after = await ev(`(function(){ const p = document.getElementById('run-panel'); const lid = document.querySelector('#run-stage .lt-layer:last-child'); return { arriving: p.getAttribute('data-arriving'), lid: lid ? lid.style.transform : '', aria: document.querySelector('.rs-wrap').getAttribute('aria-hidden') }; })()`);
  check('Build to Run: the laptop reassembles first (page faded), then settles assembled with the lid at 114 degrees', mid === 'on' && after.arriving === 'off' && /rotateX\(114deg\)/.test(after.lid), JSON.stringify({ mid, after }));
  check('the Run laptop is decoration only (aria-hidden); the tables are the readable source', after.aria === 'true');
  await ev(`document.getElementById('run-start').click(); true`);
  await sleep(2500);
  const playing = await ev(`(function(){ const s = APRM.player.snapshot(); const w = s.state.waiting.length, r = s.state.running.length; return { w, r, cards: document.querySelectorAll('.rs-queue .rs-card').length, tiles: document.querySelectorAll('.rs-tile').length, tick: document.querySelector('.rs-scr-tick').textContent, now: s.state.now }; })()`);
  check('playing: cards and tiles follow the engine (waiting and running counts, the tick)', playing.cards === Math.min(7, playing.w) && playing.tiles === Math.min(5, playing.r) && playing.tick === 'Tick ' + playing.now, JSON.stringify(playing));
  await ev(`APRM.player.pause(); true`);
  await sleep(1200);
  check('paused: no animation is running and no beat is scheduled', (await ev(`document.getAnimations().filter((a) => a.playState === 'running').length`)) === 0 && (await ev(`APRM.player.snapshot().status`)) === 'paused');
  const ev1 = await ev(`APRM.player.snapshot().events`);
  await sleep(1000);
  check('paused: nothing changes while waiting', (await ev(`APRM.player.snapshot().events`)) === ev1);
  for (const w of [375, 1440]) {
    await load(w);
    await ev(`document.querySelector('#preset-tiles [data-preset="heavy_load"]').click(); document.querySelector('[data-mode-button="run"]').click(); document.getElementById('run-start').click(); APRM.player.pause(); for (let i = 0; i < 30; i++) APRM.player.stepOnce(); true`);
    await sleep(500);
    check(`${w}px Run with the laptop: no sideways scroll`, (await hscroll()) <= 0, await hscroll());
  }
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await load(1440);
  await ev(`document.querySelector('#preset-tiles [data-preset="memory_hog"]').click(); document.querySelector('[data-next="run"]').click(); true`);
  check('reduced motion: Run appears at once, without the reassembly', (await ev(`document.getElementById('run-panel').getAttribute('data-arriving')`)) !== 'on');
  await ev(`document.getElementById('run-start').click(); APRM.player.pause(); APRM.player.stepOnce(); APRM.player.stepOnce(); true`);
  await sleep(100);   /* the site's reduced-motion rule cuts every CSS transition to 0.01 ms; only script motion could remain */
  const moving = await ev(`document.getAnimations().filter((a) => !(a instanceof CSSTransition)).map((a) => (a.transitionProperty || a.animationName || 'web') + '@' + (a.effect && a.effect.target ? a.effect.target.className : ''))`);
  check('reduced motion: an event moves nothing', moving.length === 0, JSON.stringify(moving));
  await send('Emulation.setEmulatedMedia', { features: [] });
  const flatScript = await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.CSS = { supports: function () { return false; } }; window.addEventListener('error', function (e) { (window.__errs = window.__errs || []).push(String(e.message)); });` });
  await load(1440);
  await ev(`document.querySelector('#preset-tiles [data-preset="memory_hog"]').click(); document.querySelector('[data-mode-button="run"]').click(); document.getElementById('run-start').click(); APRM.player.pause(); for (let i = 0; i < 6; i++) APRM.player.stepOnce(); true`);
  const flatInfo = await ev(`({ flat: !!document.querySelector('.rs-flat .rs-screen'), hero: !!document.querySelector('#run-stage .lt-hero'), tiles: document.querySelectorAll('.rs-flat .rs-tile').length, running: APRM.player.snapshot().state.running.length, tick: document.querySelector('.rs-flat .rs-scr-tick').textContent, now: APRM.player.snapshot().state.now, errs: (window.__errs || []).length })`);
  check('without 3D transforms: a flat laptop with the same screen drawing the run, no error', flatInfo.flat && !flatInfo.hero && flatInfo.running > 0 && flatInfo.tiles === Math.min(5, flatInfo.running) && flatInfo.tick === 'Tick ' + flatInfo.now && flatInfo.errs === 0, JSON.stringify(flatInfo));
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: flatScript.identifier });

  // 6. The heat-strip timeline (K-53): hover card, click selects, grouping and zoom on the big case, 5,000 rows
  await load(1440);
  await ev(`document.querySelector('#preset-tiles [data-preset="memory_hog"]').click(); document.querySelector('[data-mode-button="run"]').click(); document.getElementById('run-start').click(); APRM.player.pause(); for (let i = 0; i < 20; i++) APRM.player.stepOnce(); document.getElementById('run-strip').scrollIntoView({ block: 'center' }); true`);
  await sleep(2000);   /* the Build to Run reassembly keeps the page inert for about 1.4 s */
  const cell = await ev(`(function(){ const c = document.getElementById('strip-canvas'); const s = c.__strip; const r = document.getElementById('strip-scroll').getBoundingClientRect(); return { x: r.left + s.geo.labelW + s.geo.cellW * 2 + 2, y: r.top + 2, rows: s.rows.length, jobs: APRM.player.snapshot().jobs.length }; })()`);
  check('timeline: one row for every job from the start', cell.rows === cell.jobs, JSON.stringify(cell));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cell.x, y: cell.y });
  await sleep(150);
  const tip = await ev(`(function(){ const t = document.getElementById('strip-tip'); return { shown: !t.hidden, text: t.textContent }; })()`);
  check('timeline: pointing at a cell shows a card with the job and tick', tip.shown && /^Job 1 · tick 2/.test(tip.text), JSON.stringify(tip));
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cell.x, y: cell.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cell.x, y: cell.y, button: 'left', clickCount: 1 });
  check('timeline: clicking a row selects that job everywhere', (await ev(`APRM.player.snapshot().selected`)) === 1 && /job 1/.test(await ev(`document.getElementById('whylog-filter').textContent`)));
  check('timeline: a short run already fits at full cell size, so both zoom buttons are off', await ev(`document.getElementById('strip-zoom-in').disabled && document.getElementById('strip-zoom-out').disabled`));
  await ev(`document.getElementById('run-source-big').click(); document.getElementById('run-start').click(); document.getElementById('run-jump').click(); true`);
  for (let i = 0; i < 100 && (await ev(`APRM.player.snapshot().status`)) !== 'finished'; i++) await sleep(50);
  await sleep(300);
  const big = await ev(`({ g: document.getElementById('strip-group').textContent, w: document.getElementById('strip-scroll').scrollWidth, cw: document.getElementById('strip-scroll').clientWidth })`);
  await ev(`document.getElementById('strip-zoom-in').click(); document.getElementById('strip-zoom-in').click(); true`);
  await sleep(300);
  const zoomed = await ev(`({ g: document.getElementById('strip-group').textContent, w: document.getElementById('strip-scroll').scrollWidth })`);
  check('timeline, 500 jobs: cells group ticks to fit, zoom in widens it and it pans by scrolling', /1 cell = \d+ ticks/.test(big.g) && big.w <= big.cw + 8 && zoomed.w > big.w * 3, JSON.stringify({ big, zoomed }));
  const zcap = await ev(`(function(){ const zi = document.getElementById('strip-zoom-in'); for (let i = 0; i < 12; i++) zi.click(); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r({ inOff: zi.disabled, outOff: document.getElementById('strip-zoom-out').disabled, zoom: APRM.strip.view().zoom })))); })()`);
  check('timeline, 500 jobs: zoom in stops at 28 px per tick (the button turns off), zoom out stays on', zcap.inOff && !zcap.outOff && zcap.zoom > 4, JSON.stringify(zcap));
  await ev(`document.getElementById('strip-zoom-fit').click(); true`);
  await load(1440);
  await ev(`(function(){ const jobs = []; for (let i = 0; i < 5000; i++) jobs.push({ id: i + 1, arrival: Math.floor(i / 4), duration: 1 + (i % 9), cpu: 1 + (i % 3), mem: 64, priority: i % 10 }); APRM.store.setJobs(jobs); document.querySelector('[data-mode-button="run"]').click(); document.getElementById('run-start').click(); document.getElementById('run-jump').click(); })(); true`);
  for (let i = 0; i < 200 && (await ev(`APRM.player.snapshot().status`)) !== 'finished'; i++) await sleep(50);
  const ms = await ev(`new Promise((done) => { const s = document.getElementById('strip-scroll'); s.scrollIntoView(); const t0 = performance.now(); s.scrollTop = 12000; requestAnimationFrame(() => requestAnimationFrame(() => done(Math.round(performance.now() - t0)))); })`);
  check('timeline, 5,000 jobs: scrolling to row 3000 redraws within two frames budget (< 100 ms)', ms < 100, ms + ' ms');
} finally { chrome.kill(); }
const failed = results.filter((r) => !r).length;
console.log(failed === 0 ? 'ALL PASS (' + results.length + ')' : failed + ' FAILED of ' + results.length);
process.exit(failed === 0 ? 0 : 1);
