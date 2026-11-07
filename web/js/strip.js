/* strip.js: the heat-strip timeline on the Run page (K-53).
 *
 * Idea: one row per job, one column per tick (or per group of ticks when the run is long). A cell
 * says what the job was doing then: waiting (hatched), waiting with a saved spot (outlined), running
 * (amber), finished (grey), with a notch where the engine skipped it. Everything comes from the
 * job history the player keeps from engine log entries (runmodel.record), up to the event shown.
 *
 * Rows are drawn on one canvas that stays in view while a scrolling box underneath gives the full
 * size, so only the rows and columns on screen are drawn: 5,000 jobs cost the same as 50. Zoom
 * changes the tick width; scrolling pans. Pointing at a cell shows a card with the exact numbers;
 * clicking a row selects that job everywhere. Show details adds CPU and memory use bands and the
 * saved-spot diamonds.
 *
 * Pure functions (geometry, cellState, skippedIn, sortRows, hit, usage) are tested in
 * tests/web/test_strip.mjs. The canvas is aria-hidden: the tables beside it are the readable source.
 *
 * Classic script: attaches APRM.strip only. mount() registers the view with APRM.player.
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});

  var NICE = [2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
  var STEPS = [1, 2, 4, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
  var MAX_VIEW_H = 380;
  var NONE = 0, WAIT = 1, RUN = 2, SAVED = 3, DONE = 4;

  /* ---------- pure geometry ---------- */

  /* Sizes for n rows over `ticks` ticks in a view w px wide at a zoom (1 = fit). Rows are 16 px with
   * labels up to 40 jobs, 6 px up to 200, 4 px above. A cell is at least 6 px wide: below that,
   * cells group 2, 5, 10, ... ticks. Returns { rowH, labelW, g, cellW, cols, ticks, bottomH, cw, ch, vh }. O(1). */
  function geometry(n, ticks, w, zoom, details) {
    var rowH = n <= 40 ? 16 : n <= 200 ? 6 : 4;
    var labelW = rowH >= 10 ? 64 : 0;
    ticks = Math.max(1, ticks);
    var avail = Math.max(100, w - labelW - 8);
    var base = avail / ticks * Math.max(1, zoom);
    var g = 1, cellW = Math.min(28, base);
    if (base < 6) {
      g = NICE[NICE.length - 1];
      for (var i = 0; i < NICE.length; i++) { if (base * NICE[i] >= 6) { g = NICE[i]; break; } }
      cellW = base * g;
    }
    var cols = Math.ceil(ticks / g);
    var bottomH = 24 + (details ? 28 : 0);
    var ch = n * rowH + bottomH;
    /* zooming further than 28 px per tick changes nothing, so the zoom stops there */
    var maxZoom = Math.max(1, 28 * ticks / avail);
    return { rowH: rowH, labelW: labelW, g: g, cellW: cellW, cols: cols, ticks: ticks, bottomH: bottomH,
      cw: Math.ceil(labelW + cols * cellW + 8), ch: ch, vh: Math.min(ch, MAX_VIEW_H), maxZoom: maxZoom };
  }

  /* Ticks the strip spans: up to the latest arrival, planned finish or the clock, plus one. O(jobs). */
  function span(hist, jobs, now) {
    var t = now;
    for (var i = 0; i < jobs.length; i++) { if (jobs[i].arrival > t) { t = jobs[i].arrival; } }
    if (hist) {
      for (var k = 0; k < hist.order.length; k++) {
        var r = hist.jobs[hist.order[k]];
        if (r.start !== null) { var f = r.finish !== null ? r.finish : r.start + r.duration; if (f > t) { t = f; } }
      }
    }
    return t + 1;
  }

  /* The first skip tick in [s0, s1], or -1. Skips are kept in increasing order. O(log skips). */
  function skippedIn(rec, s0, s1) {
    var a = rec.skips, lo = 0, hi = a.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (a[mid] < s0) { lo = mid + 1; } else { hi = mid; } }
    return lo < a.length && a[lo] <= s1 ? a[lo] : -1;
  }

  /* Ticks shared by [s0, s1] and [a, b] (inclusive). O(1). */
  function overlap(s0, s1, a, b) { return Math.max(0, Math.min(s1, b) - Math.max(s0, a) + 1); }

  /* What a job did over ticks s0..s1, as known at the clock `now`: the state that covers most of the
   * span (ties: finished, then running, then saved, then waiting). 0 = nothing yet. O(1). */
  function cellState(rec, s0, s1, now) {
    var INF = Infinity;
    var A = rec.arrived !== null ? rec.arrived : INF;
    var S = rec.start !== null ? rec.start : INF;
    var F = rec.finish !== null ? rec.finish : INF;
    var R = rec.resAt !== null ? rec.resAt : INF;
    var hiT = Math.min(s1, now);
    if (s0 > hiT) { return NONE; }
    var wEnd = Math.min(S, F) - 1;
    var w = overlap(s0, hiT, A, wEnd), ws = overlap(s0, hiT, Math.max(A, R), wEnd), ru = overlap(s0, hiT, S, F - 1), fi = overlap(s0, hiT, F, INF);
    var best = NONE, n = 0;
    if (fi > n) { n = fi; best = DONE; }
    if (ru > n) { n = ru; best = RUN; }
    if (ws > n) { n = ws; best = SAVED; }
    if (w - ws > n) { best = WAIT; }
    return best;
  }

  /* One row per job of the run: its history record, or an empty one for a job the log has not named yet. O(jobs). */
  function rowsFor(jobs, hist) {
    return jobs.map(function (j) {
      var r = hist && hist.jobs[j.id];
      return r || { id: j.id, arrival: j.arrival, duration: j.duration, cpu: j.cpu, mem: j.mem, priority: j.priority,
        arrived: null, start: null, finish: null, skips: [], resAt: null, resBy: null, squeezed: false, chosen: null };
    });
  }

  /* Rows in the chosen order: job number, arrival, priority (highest first) or longest wait so far.
   * rows: from rowsFor() (or a history, for the tests). O(n log n). */
  function sortRows(hist, by, now, rows) {
    rows = rows ? rows.slice() : hist ? hist.order.map(function (id) { return hist.jobs[id]; }) : [];
    var wait = function (r) { return r.arrived === null ? -1 : (r.start !== null ? r.start : now) - r.arrived; };
    var f = {
      id: function (a, b) { return a.id - b.id; },
      arr: function (a, b) { return a.arrival - b.arrival || a.id - b.id; },
      pri: function (a, b) { return b.priority - a.priority || a.id - b.id; },
      wait: function (a, b) { return wait(b) - wait(a) || a.id - b.id; }
    }[by] || function (a, b) { return a.id - b.id; };
    return rows.sort(f);
  }

  /* The rows and columns on screen for a scroll position. O(1). */
  function visible(geo, n, scrollLeft, scrollTop, viewW, viewH) {
    var rowsH = viewH - geo.bottomH;
    return {
      r0: Math.max(0, Math.floor(scrollTop / geo.rowH)), r1: Math.min(n, Math.ceil((scrollTop + rowsH) / geo.rowH)),
      c0: Math.max(0, Math.floor(scrollLeft / geo.cellW)), c1: Math.min(geo.cols, Math.ceil((scrollLeft + viewW - geo.labelW) / geo.cellW))
    };
  }

  /* The row and column under a point of the view (x, y from its top left), or null. O(1). */
  function hit(geo, rows, x, y, scrollLeft, scrollTop, viewH) {
    if (y < 0 || y > viewH - geo.bottomH || x < geo.labelW) { return null; }
    var row = Math.floor((y + scrollTop) / geo.rowH);
    if (row < 0 || row >= rows.length) { return null; }
    var col = Math.floor((x + scrollLeft - geo.labelW) / geo.cellW);
    if (col < 0 || col >= geo.cols) { return null; }
    return { rec: rows[row], row: row, col: col, t0: col * geo.g, t1: col * geo.g + geo.g - 1 };
  }

  /* CPU and memory in use per tick from 0 to now, from the history (running time of each job). O(jobs + now). */
  function usage(hist, now) {
    var n = now + 2, dc = new Array(n + 1).fill(0), dm = new Array(n + 1).fill(0);
    if (hist) {
      for (var i = 0; i < hist.order.length; i++) {
        var r = hist.jobs[hist.order[i]];
        if (r.start === null || r.start > now) { continue; }
        var e = Math.min(r.finish !== null ? r.finish : now + 1, now + 1);
        dc[r.start] += r.cpu; dc[e] -= r.cpu; dm[r.start] += r.mem; dm[e] -= r.mem;
      }
    }
    var c = new Array(n).fill(0), m = new Array(n).fill(0), sc = 0, sm = 0;
    for (var t = 0; t < n; t++) { sc += dc[t]; sm += dm[t]; c[t] = sc; m[t] = sm; }
    return { c: c, m: m };
  }

  /* ---------- the view ---------- */

  var ui = null;
  var view = { zoom: 1, sortBy: 'id' };
  var last = null;          /* the last frame */
  var cache = null;         /* rows, geometry and usage for the last frame */
  var colours = null;

  function byId(id) { return document.getElementById(id); }
  function copyText(key, fallback, vars) {
    var C = APRM.copy;
    if (!C || !C.has(key)) { return fallback; }
    return vars ? C.fill(key, vars) : C.get(key);
  }
  function detailsOn() { return !!(APRM.store && APRM.store.get().details); }

  /* Colours from the tokens (CSS variables); read again when the theme changes. */
  function readColours() {
    var out = { amber: '', sand: '', hair: '', done: '', bg: '', surface: '', raised: '', text: '', muted: '', hatch: '', font: '' };
    try {
      var cs = getComputedStyle(document.documentElement);
      var pick = function (n) { return String(cs.getPropertyValue(n) || '').trim(); };
      out.amber = pick('--amber'); out.sand = pick('--sand'); out.hair = pick('--hairline'); out.done = pick('--strip-done');
      out.bg = pick('--bg'); out.surface = pick('--surface'); out.raised = pick('--raised'); out.text = pick('--text');
      out.muted = pick('--muted'); out.waitFill = pick('--strip-wait'); out.hatch = pick('--strip-hatch');
      out.font = getComputedStyle(document.body).fontFamily || 'sans-serif';
    } catch (e) { /* keep empty: the canvas keeps its defaults */ }
    out.pattern = null;
    return out;
  }

  function hatchPattern(ctx) {
    if (colours.pattern) { return colours.pattern; }
    try {
      var o = document.createElement('canvas');
      o.width = 6; o.height = 6;
      var x = o.getContext('2d');
      x.fillStyle = colours.waitFill; x.fillRect(0, 0, 6, 6);
      x.strokeStyle = colours.hatch; x.lineWidth = 1;
      x.beginPath(); x.moveTo(-1, 7); x.lineTo(7, -1); x.moveTo(-1, 1); x.lineTo(1, -1); x.moveTo(5, 7); x.lineTo(7, 5); x.stroke();
      colours.pattern = ctx.createPattern(o, 'repeat');
    } catch (e) { colours.pattern = colours.waitFill; }
    return colours.pattern;
  }

  /* Rows, geometry and the time span for a frame; kept until the frame or the view changes. */
  function prepare(f) {
    var now = f.state ? f.state.now : 0;
    var key = f.events + '|' + view.sortBy + '|' + view.zoom + '|' + (detailsOn() ? 1 : 0) + '|' + (ui.scroll.clientWidth || 0) + '|' + f.jobs.length + '|' + now;
    if (cache && cache.key === key && cache.hist === f.hist) { return cache; }
    var rows = sortRows(f.hist, view.sortBy, now, rowsFor(f.jobs, f.hist));
    var ticks = span(f.hist, f.jobs, now);
    var geo = geometry(f.jobs.length, ticks, ui.scroll.clientWidth || 800, view.zoom, detailsOn());
    cache = { key: key, hist: f.hist, rows: rows, geo: geo, now: now, use: null };
    return cache;
  }

  function draw() {
    if (!ui || !last) { return; }
    var f = last;
    var live = !!(f.state && f.hist && f.events > 0);
    ui.empty.hidden = live;
    ui.scroll.hidden = !live;
    if (!live) { ui.group.textContent = ''; return; }
    var P = prepare(f), G = P.geo, rows = P.rows, now = P.now;
    ui.group.textContent = G.g === 1 ? copyText('strip.group.one', '1 cell = 1 tick') : copyText('strip.group', '', { g: G.g });
    ui.scroll.style.height = G.vh + 'px';
    ui.spacer.style.width = G.cw + 'px';
    ui.spacer.style.height = G.ch + 'px';
    var cv = ui.canvas, sc = ui.scroll;
    var vw = sc.clientWidth, vh = sc.clientHeight;
    if (!vw || !vh || typeof cv.getContext !== 'function') { return; }
    var dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(vw * dpr) || cv.height !== Math.round(vh * dpr)) {
      cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
      cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
    }
    var ctx = cv.getContext('2d');
    if (!ctx) { return; }
    if (!colours) { colours = readColours(); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    var sl = sc.scrollLeft, st = sc.scrollTop;
    var V = visible(G, rows.length, sl, st, vw, vh);
    var rowsH = vh - G.bottomH;
    var gap = G.rowH >= 10 ? 3 : G.rowH >= 5 ? 1 : 0;
    var cgap = G.cellW >= 6 ? 1 : 0;
    var hatch = hatchPattern(ctx);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, vw, rowsH); ctx.clip();
    for (var r = V.r0; r < V.r1; r++) {
      var J = rows[r];
      var y = r * G.rowH - st, h = G.rowH - gap, sel = f.selected === J.id;
      if (sel) { ctx.fillStyle = colours.raised; ctx.fillRect(0, y - 1, vw, G.rowH + 1); }
      for (var c = V.c0; c < V.c1; c++) {
        var s0 = c * G.g;
        if (s0 > now) { break; }
        var s1 = Math.min(now, s0 + G.g - 1);
        var x = G.labelW + c * G.cellW - sl, w = G.cellW - cgap;
        var s = cellState(J, s0, s1, now);
        if (!s) { continue; }
        ctx.fillStyle = s === RUN ? colours.amber : s === DONE ? colours.done : hatch;
        ctx.fillRect(x, y, w, h);
        if (s === SAVED && w >= 3) { ctx.strokeStyle = colours.amber; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
        if ((s === WAIT || s === SAVED) && skippedIn(J, s0, s1) >= 0) {
          var nn = Math.min(5, Math.max(2, w * 0.45));
          ctx.fillStyle = colours.bg;
          ctx.beginPath(); ctx.moveTo(x + w - nn, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + nn); ctx.fill();
        }
      }
      if (J.resAt !== null && J.resBy !== null && J.resBy !== undefined && detailsOn()) {
        var dx = G.labelW + (J.resBy / G.g) * G.cellW - sl, cy = y + h / 2, d = Math.max(3, Math.min(6, h / 2));
        ctx.fillStyle = colours.amber;
        ctx.beginPath(); ctx.moveTo(dx, cy - d); ctx.lineTo(dx + d, cy); ctx.lineTo(dx, cy + d); ctx.lineTo(dx - d, cy); ctx.fill();
      }
      if (G.labelW) {
        ctx.fillStyle = sel ? colours.raised : colours.surface;
        ctx.fillRect(0, y - 1, G.labelW, G.rowH + 1);
        ctx.fillStyle = sel ? colours.amber : colours.muted;
        ctx.font = '500 11px ' + colours.font;
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(copyText('stage.job', 'Job ' + J.id, { id: J.id }), G.labelW - 8, y + h / 2);
      }
    }
    ctx.restore();
    /* now line */
    var nx = G.labelW + ((now + 1) / G.g) * G.cellW - sl;
    if (nx >= G.labelW) { ctx.fillStyle = colours.text; ctx.fillRect(Math.round(nx) - 1, 0, 2, rowsH); }   /* never over the labels */
    /* bottom: use bands (details) and the tick axis */
    var by = rowsH;
    ctx.fillStyle = colours.surface;
    ctx.fillRect(0, by, vw, G.bottomH);
    if (detailsOn()) {
      if (!P.use) { P.use = usage(f.hist, now); }
      var U = P.use, bh = 11, cap = f.cap;
      for (var c2 = V.c0; c2 < V.c1; c2++) {
        var a0 = c2 * G.g;
        if (a0 > now) { break; }
        var a1 = Math.min(now, a0 + G.g - 1), uc = 0, um = 0;
        for (var q = a0; q <= a1; q++) { uc += U.c[q] || 0; um += U.m[q] || 0; }
        var cnt = a1 - a0 + 1, bx = G.labelW + c2 * G.cellW - sl, bw = G.cellW - cgap;
        var hc = bh * (uc / cnt) / cap.cpu, hm = bh * (um / cnt) / cap.mem;
        ctx.fillStyle = colours.amber; ctx.fillRect(bx, by + 4 + bh - hc, bw, hc);
        ctx.fillStyle = colours.sand; ctx.fillRect(bx, by + 17 + bh - hm, bw, hm);
      }
      if (G.labelW) {
        ctx.fillStyle = colours.surface; ctx.fillRect(0, by, G.labelW, 28);
        ctx.font = '500 10px ' + colours.font; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillStyle = colours.amber; ctx.fillText(copyText('run.res.cpu', 'CPU'), G.labelW - 8, by + 10);
        ctx.fillStyle = colours.sand; ctx.fillText(copyText('run.res.mem', 'Memory'), G.labelW - 8, by + 23);
      }
    }
    var ay = vh - 24;
    ctx.fillStyle = colours.hair;
    ctx.fillRect(G.labelW, ay, vw - G.labelW, 1);
    var pxT = G.cellW / G.g, step = STEPS[STEPS.length - 1] * 2;
    for (var k = 0; k < STEPS.length; k++) { if (STEPS[k] * pxT >= 44) { step = STEPS[k]; break; } }
    ctx.font = '500 11px ' + colours.font; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = colours.muted;
    for (var tq = Math.ceil((sl / pxT) / step) * step; tq <= G.ticks; tq += step) {
      var tx = G.labelW + tq * pxT - sl;
      if (tx > vw) { break; }
      if (tx < G.labelW) { continue; }
      ctx.fillRect(tx, ay, 1, 4);
      ctx.fillText(String(tq), tx, ay + 6);
    }
    cv.__strip = { geo: G, rows: rows };
    zoomButtons(G);
  }

  /* Zoom in stops at 28 px per tick, zoom out at "fit": the buttons say so by being off. */
  function zoomButtons(G) {
    var zin = byId('strip-zoom-in'), zout = byId('strip-zoom-out');
    if (G && view.zoom > G.maxZoom) { view.zoom = G.maxZoom; }
    if (zin) { zin.disabled = !G || view.zoom >= G.maxZoom - 1e-9; }
    if (zout) { zout.disabled = view.zoom <= 1; }
  }

  /* The hover card: the job, the tick span, what it did, its demand, and the exact score or saved spot. */
  function tipLines(f, h, now) {
    var J = h.rec, t1 = Math.min(h.t1, now);
    var s = cellState(J, h.t0, t1, now);
    var name = ['strip.state.none', 'strip.state.wait', 'strip.state.run', 'strip.state.saved', 'strip.state.done'][s];
    var lines = [
      { t: copyText(h.t0 === t1 ? 'strip.tip.tick' : 'strip.tip.ticks', '', { id: J.id, a: h.t0, b: t1 }), cls: 'tip-head' },
      { t: copyText(name, '') + (skippedIn(J, h.t0, t1) >= 0 ? copyText('strip.tip.skipped', '') : ''), cls: s === RUN ? 'tip-run' : s === DONE ? 'tip-done' : 'tip-wait' },
      { t: copyText('strip.tip.needs', '', { p: J.priority, c: J.cpu, m: J.mem }), cls: 'tip-muted' }
    ];
    var aging = f.policy === 'aging' || f.policy === 'aging_reserve';
    if (aging && (s === WAIT || s === SAVED)) {
      var sc = APRM.runmodel.score(f.policy, f.settings.alphaMilli, J.priority, J.arrival, t1);
      lines.push({ t: copyText('strip.tip.score', '', { s: APRM.runmodel.scoreText(sc), t: t1 }), cls: 'tip-amber' });
    }
    if (J.resAt !== null && J.resBy !== null && J.resBy !== undefined) { lines.push({ t: copyText('strip.tip.saved', '', { a: J.resAt, b: J.resBy }), cls: 'tip-amber' }); }
    return lines;
  }

  function showTip(ev) {
    if (!last || !ui.canvas.__strip) { return hideTip(); }
    var r = ui.scroll.getBoundingClientRect();
    var x = ev.clientX - r.left, y = ev.clientY - r.top;
    var S = ui.canvas.__strip;
    var h = hit(S.geo, S.rows, x, y, ui.scroll.scrollLeft, ui.scroll.scrollTop, ui.scroll.clientHeight);
    var now = last.state ? last.state.now : 0;
    if (!h || h.t0 > now) { return hideTip(); }
    var tip = ui.tip;
    while (tip.firstChild) { tip.removeChild(tip.firstChild); }
    tipLines(last, h, now).forEach(function (l) {
      var d = document.createElement('div');
      d.setAttribute('class', l.cls);
      d.textContent = l.t;
      tip.appendChild(d);
    });
    var box = ui.root.getBoundingClientRect();
    var tx = r.left - box.left + x + 14, ty = r.top - box.top + y + 14;
    if (tx > ui.root.clientWidth - 240) { tx -= 254; }
    tip.style.transform = 'translate(' + Math.round(tx) + 'px,' + Math.round(ty) + 'px)';
    tip.hidden = false;
  }
  function hideTip() { if (ui && ui.tip) { ui.tip.hidden = true; } }

  var pending = null;
  function schedule() {
    if (pending !== null) { return; }
    pending = requestAnimationFrame(function () { pending = null; draw(); });
  }

  /* The view player.js calls after every change. */
  function onFrame(f, why) {
    last = f;
    if (ui) {   /* the empty state follows at once; the drawing waits for the next frame */
      var live = !!(f.state && f.hist && f.events > 0);
      ui.empty.hidden = live;
      ui.scroll.hidden = !live;
    }
    if (why === 'reset' || why === 'start') { cache = null; if (ui) { ui.scroll.scrollLeft = 0; ui.scroll.scrollTop = 0; } }
    if (why === 'details' || why === 'mode') { colours = null; cache = null; }
    hideTip();
    schedule();
  }

  /* Zoom between 1 (fit) and the 28 px-per-tick cap of the current run. */
  function setZoom(z) {
    var cap = cache && cache.geo ? cache.geo.maxZoom : 64;
    view.zoom = Math.max(1, Math.min(cap, z));
    cache = null;
    schedule();
  }

  var mounted = false;

  function mount() {
    if (mounted || !APRM.player) { return; }
    var root = byId('run-strip');
    if (!root || typeof window.requestAnimationFrame !== 'function' || typeof window.addEventListener !== 'function' || typeof getComputedStyle !== 'function') { return; }
    mounted = true;
    ui = { root: root, scroll: byId('strip-scroll'), canvas: byId('strip-canvas'), spacer: byId('strip-spacer'),
      empty: byId('strip-empty'), group: byId('strip-group'), tip: byId('strip-tip') };
    var on = function (id, fn) { var e = byId(id); if (e) { e.addEventListener('click', fn); } };
    on('strip-zoom-in', function () { setZoom(view.zoom * 2); });
    on('strip-zoom-out', function () { setZoom(view.zoom / 2); });
    on('strip-zoom-fit', function () { setZoom(1); });
    var sort = byId('strip-sort');
    if (sort) { sort.addEventListener('change', function () { view.sortBy = sort.value; cache = null; schedule(); }); }
    ui.scroll.addEventListener('scroll', function () { hideTip(); schedule(); });
    ui.scroll.addEventListener('mousemove', showTip);
    ui.scroll.addEventListener('mouseleave', hideTip);
    ui.scroll.addEventListener('click', function (ev) {
      if (!ui.canvas.__strip) { return; }
      var r = ui.scroll.getBoundingClientRect();
      var S = ui.canvas.__strip;
      var h = hit(S.geo, S.rows, ev.clientX - r.left, ev.clientY - r.top, ui.scroll.scrollLeft, ui.scroll.scrollTop, ui.scroll.clientHeight);
      if (!h) { return; }
      var cur = APRM.player.snapshot().selected;
      APRM.player.select(cur === h.rec.id ? null : h.rec.id);
    });
    window.addEventListener('resize', function () { cache = null; schedule(); });
    try {
      var hc = window.matchMedia ? window.matchMedia('(prefers-contrast: more)') : null;
      if (hc && hc.addEventListener) { hc.addEventListener('change', function () { colours = null; schedule(); }); }
    } catch (e) { /* no media queries: colours stay as read */ }
    APRM.player.addView(onFrame);
    onFrame(APRM.player.frame(), 'reset');
  }

  APRM.strip = {
    geometry: geometry, span: span, rowsFor: rowsFor, cellState: cellState, skippedIn: skippedIn, sortRows: sortRows,
    visible: visible, hit: hit, usage: usage, setZoom: setZoom, mount: mount,
    view: function () { return { zoom: view.zoom, sortBy: view.sortBy }; },
    STATES: { NONE: NONE, WAIT: WAIT, RUN: RUN, SAVED: SAVED, DONE: DONE }
  };
})();
