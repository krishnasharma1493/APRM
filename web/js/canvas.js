/* canvas.js: draws the live picture of a run (PRD section 7, K-25).
 *
 * Idea: the browser only DRAWS what the engine reported. Every number here
 * (free resources, scores, running jobs, finish times) comes from the state
 * JSON or the event log; nothing is computed that could change which job runs.
 *
 * Layers, top to bottom: clock line, CPU and memory bars (one block per running
 * job, width proportional to its demand), the waiting line in the engine's own
 * order with the live score and a lock on the reserved job, the running list,
 * and the Gantt chart (one row per job, thin line for waiting, bar for running,
 * a vertical marker for "now"). Text is drawn with fillText only (D34).
 *
 * layout() is pure arithmetic and is unit tested; draw() paints that layout.
 * Classic script: attaches APRM.canvas only.
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});

  var HEIGHT = 640;              /* css pixels */
  var MARGIN = 12;
  var LABEL_W = 56;              /* width of "CPU" / "Mem" labels */
  var ROW_H = 16;
  var WAIT_ROWS = 8;
  var RUN_ROWS = 6;
  var PALETTE_SIZE = 10;
  var PALETTE_VARS = ['--job-0', '--job-1', '--job-2', '--job-3', '--job-4', '--job-5', '--job-6', '--job-7', '--job-8', '--job-9'];
  var FALLBACK_PALETTE = ['#3A6EA5', '#C27A1A', '#2E8B6A', '#B4483C', '#8A6D2E', '#5E8FA8', '#A8567A', '#6E7F2A', '#6B7280', '#94741A'];
  var FALLBACK_COLOURS = { text: '#1B1F1D', muted: '#5B625E', border: '#CFD3D0', accent: '#0B5E6B', panel: '#FFFFFF', mark: '#B42318', font: 'system-ui, sans-serif' };

  /* Palette index of a job: only a colour choice, never a decision. */
  function paletteIndex(id) { return ((id % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE; }

  /* Hatch pattern for job `id`: 0 none, 1 slanted lines, 2 vertical lines. Skipped when the
   * 2D context cannot clip (tests). O(width / 4). */
  function drawHatch(ctx, id, x, y, w, h, ink) {
    var kind = ((id % 3) + 3) % 3;
    if (kind === 0 || w < 6 || h < 4) { return; }
    if (typeof ctx.save !== 'function' || typeof ctx.clip !== 'function') { return; }
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.strokeStyle = ink; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
    ctx.beginPath();
    for (var gx = x - (kind === 1 ? h : 0); gx < x + w; gx += 4) {
      if (kind === 1) { ctx.moveTo(gx, y + h); ctx.lineTo(gx + h, y); } else { ctx.moveTo(gx + 0.5, y); ctx.lineTo(gx + 0.5, y + h); }
    }
    ctx.stroke();
    ctx.restore();
  }

  /* Colours from the CSS variables (light and dark values live in style.css);
   * fall back to fixed values when no computed style is available. O(1). */
  function colours(el) {
    var out = { text: FALLBACK_COLOURS.text, muted: FALLBACK_COLOURS.muted, border: FALLBACK_COLOURS.border,
      accent: FALLBACK_COLOURS.accent, panel: FALLBACK_COLOURS.panel, mark: FALLBACK_COLOURS.mark, font: FALLBACK_COLOURS.font,
      jobs: FALLBACK_PALETTE.slice() };
    if (typeof getComputedStyle !== 'function' || !el) { return out; }
    try {
      var cs = getComputedStyle(el);
      var pick = function (name, fb) { var v = String(cs.getPropertyValue(name) || '').trim(); return v || fb; };
      out.text = pick('--text', out.text); out.muted = pick('--muted', out.muted);
      out.border = pick('--border', out.border); out.accent = pick('--accent', out.accent);
      out.panel = pick('--panel', out.panel); out.mark = pick('--mark', out.mark);
      for (var i = 0; i < PALETTE_SIZE; i++) { out.jobs[i] = pick(PALETTE_VARS[i], out.jobs[i]); }
      if (cs.fontFamily) { out.font = cs.fontFamily; }
    } catch (e) { /* keep the fallbacks */ }
    return out;
  }

  /* Blocks for one resource bar: running jobs left to right, each as wide as
   * its demand share of the capacity. demandKey is 'cpu' or 'mem'. O(running). */
  function bar(running, cap, demandKey, x, y, w, h) {
    var blocks = [];
    var used = 0;
    for (var i = 0; i < running.length; i++) {
      var d = running[i][demandKey];
      blocks.push({ id: running[i].id, x: x + (used / cap) * w, y: y, w: (d / cap) * w, h: h });
      used += d;
    }
    return { x: x, y: y, w: w, h: h, blocks: blocks, used: used, cap: cap };
  }

  /* Jobs in Gantt order: arrival, then id. Presentation order only. O(n log n). */
  function ganttOrder(jobs) {
    return jobs.slice().sort(function (a, b) { return a.arrival - b.arrival || a.id - b.id; });
  }

  /* Where everything goes, for a canvas of w x h css pixels.
   * view = { state, jobs, bars }. state may be null (nothing drawn then).
   * Returns plain rectangles; tests check them. O(jobs log jobs + shown rows). */
  function layout(view, w, h) {
    var st = view.state;
    var inner = Math.max(40, w - 2 * MARGIN);
    var barX = MARGIN + LABEL_W;
    var barW = Math.max(20, w - barX - MARGIN);
    var out = { w: w, h: h, bars: null, waiting: [], running: [], gantt: null, regions: [] };
    if (!st) { return out; }

    out.clockY = 20;
    out.cpuBar = bar(st.running, st.cap.cpu, 'cpu', barX, 34, barW, 18);
    out.memBar = bar(st.running, st.cap.mem, 'mem', barX, 72, barW, 18);
    out.bars = [out.cpuBar, out.memBar];

    var y = 114;
    out.waitingTitleY = y + 12;
    var nWait = Math.min(st.waiting.length, WAIT_ROWS);
    for (var i = 0; i < nWait; i++) {
      out.waiting.push({ id: st.waiting[i].id, index: i, x: MARGIN, y: y + 18 + i * ROW_H, w: inner, h: ROW_H });
    }
    out.waitingMore = st.waiting.length - nWait;
    out.waitingMoreY = y + 18 + nWait * ROW_H + 12;
    y += 18 + WAIT_ROWS * ROW_H + 16;

    out.runningTitleY = y + 12;
    var nRun = Math.min(st.running.length, RUN_ROWS);
    for (var r = 0; r < nRun; r++) {
      out.running.push({ id: st.running[r].id, index: r, x: MARGIN, y: y + 18 + r * ROW_H, w: inner, h: ROW_H });
    }
    out.runningMore = st.running.length - nRun;
    out.runningMoreY = y + 18 + nRun * ROW_H + 12;
    y += 18 + RUN_ROWS * ROW_H + 16;

    /* Gantt: the time axis runs 0..tmax; tmax is the latest time the engine
     * has told us about (now, a planned finish, a logged finish, an arrival). */
    var order = ganttOrder(view.jobs);
    var tmax = Math.max(1, st.now);
    var k;
    for (k = 0; k < order.length; k++) { if (order[k].arrival > tmax) { tmax = order[k].arrival; } }
    var ids = Object.keys(view.bars);
    for (k = 0; k < ids.length; k++) {
      var b = view.bars[ids[k]];
      if (b.finish !== undefined && b.finish > tmax) { tmax = b.finish; }
    }
    var gy = y + 18;
    var gh = Math.max(20, h - gy - 22);
    var rowH = order.length > 0 ? gh / order.length : gh;
    out.gantt = { x: barX, y: gy, w: barW, h: gh, tmax: tmax, rowH: rowH, order: order, titleY: y + 12 };
    out.nowX = barX + (st.now / tmax) * barW;
    out.axisY = gy + gh + 14;
    return out;
  }

  /* The job under a point (css pixels), or null. Rows and blocks recorded by
   * the last draw(). O(regions). */
  function hit(el, x, y) {
    var regs = (el && el.__regions) || [];
    for (var i = regs.length - 1; i >= 0; i--) {
      var g = regs[i];
      if (x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h) { return g.id; }
    }
    return null;
  }

  /* Text of a score exactly as the engine gave it (a number from the JSON);
   * only the number of decimals is fixed for display. */
  function scoreText(score) {
    return typeof score === 'number' ? score.toFixed(3) : '';
  }

  /* Paint the whole picture. el is a <canvas>. view = { state, jobs, bars,
   * selected, events }. Returns false when the canvas has no 2D context (the
   * caller then shows the text fallback). O(jobs + shown rows). */
  function draw(el, view) {
    var ctx = el && typeof el.getContext === 'function' ? el.getContext('2d') : null;
    if (!ctx) { return false; }
    var cssW = Math.max(320, Math.floor(el.clientWidth || 640));
    var dpr = (typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0) ? window.devicePixelRatio : 1;
    if (el.width !== Math.round(cssW * dpr)) { el.width = Math.round(cssW * dpr); }
    if (el.height !== Math.round(HEIGHT * dpr)) { el.height = Math.round(HEIGHT * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var col = colours(el);
    ctx.clearRect(0, 0, cssW, HEIGHT);
    ctx.font = '13px ' + col.font;
    ctx.textBaseline = 'alphabetic';
    var lay = layout(view, cssW, HEIGHT);
    el.__layout = lay;
    var regions = [];
    el.__regions = regions;
    var st = view.state;
    if (!st) { return true; }
    var sel = view.selected;
    var jobCol = function (id) { return col.jobs[paletteIndex(id)]; };
    var text = function (s, x, y, maxW, colour) {
      ctx.fillStyle = colour || col.text;
      ctx.fillText(s, x, y, maxW);
    };
    /* A job block: its colour, one of three hatch patterns (id mod 3, so colour is not the only
     * signal) and, when it is big enough, its number. Drawing only; no decisions. */
    var block = function (id, x, y, w, h) {
      ctx.fillStyle = jobCol(id);
      ctx.fillRect(x, y, w, h);
      drawHatch(ctx, id, x, y, w, h, col.panel);
      if (w >= 18 && h >= 12) { text(String(id), x + 3, y + h - 4, w - 4, col.panel); }
    };

    text('Time ' + st.now + '   events ' + view.events + '   done ' + st.done + ' of ' + st.total, MARGIN, lay.clockY, lay.w - 2 * MARGIN);

    /* resource bars */
    var names = [['CPU', lay.cpuBar, st.free.cpu, ' cores'], ['Mem', lay.memBar, st.free.mem, ' MB']];
    for (var n = 0; n < names.length; n++) {
      var bx = names[n][1];
      text(names[n][0], MARGIN, bx.y + 14, LABEL_W - 4);
      ctx.fillStyle = col.border;
      ctx.fillRect(bx.x, bx.y, bx.w, bx.h);
      for (var b = 0; b < bx.blocks.length; b++) {
        var blk = bx.blocks[b];
        block(blk.id, blk.x, blk.y, blk.w, blk.h);
        if (sel === blk.id) { ctx.strokeStyle = col.text; ctx.lineWidth = 2; ctx.strokeRect(blk.x, blk.y, blk.w, blk.h); }
        regions.push({ x: blk.x, y: blk.y, w: blk.w, h: blk.h, id: blk.id });
      }
      ctx.strokeStyle = col.muted; ctx.lineWidth = 1;
      ctx.strokeRect(bx.x, bx.y, bx.w, bx.h);
      text(names[n][2] + names[n][3] + ' free', bx.x + 4, bx.y + bx.h + 11, bx.w, col.muted);
    }

    /* waiting line, in the order the engine reported */
    text('Waiting (' + st.waiting.length + ')', MARGIN, lay.waitingTitleY, lay.w - 2 * MARGIN, col.muted);
    if (st.waiting.length === 0) { text('nobody is waiting', MARGIN + 8, lay.waitingTitleY + 18, 200, col.muted); }
    for (var i = 0; i < lay.waiting.length; i++) {
      var row = lay.waiting[i];
      var j = st.waiting[row.index];
      if (sel === j.id) { ctx.fillStyle = col.border; ctx.fillRect(row.x, row.y, row.w, row.h); }
      ctx.fillStyle = jobCol(j.id);
      ctx.fillRect(row.x + 2, row.y + 3, 8, 8);
      var locked = st.reservation && st.reservation.id === j.id;
      var line = (locked ? '[lock] ' : '') + 'Job ' + j.id + '  priority ' + j.priority +
        (typeof j.score === 'number' ? '  score ' + scoreText(j.score) : '') +
        '  needs ' + j.cpu + ' cores, ' + j.mem + ' MB';
      text(line, row.x + 16, row.y + 12, row.w - 20);
      regions.push({ x: row.x, y: row.y, w: row.w, h: row.h, id: j.id });
    }
    if (lay.waitingMore > 0) { text('and ' + lay.waitingMore + ' more', MARGIN + 16, lay.waitingMoreY, 200, col.muted); }

    /* running jobs */
    text('Running (' + st.running.length + ')', MARGIN, lay.runningTitleY, lay.w - 2 * MARGIN, col.muted);
    if (st.running.length === 0) { text('nothing is running', MARGIN + 8, lay.runningTitleY + 18, 200, col.muted); }
    for (var q = 0; q < lay.running.length; q++) {
      var rr = lay.running[q];
      var rj = st.running[rr.index];
      if (sel === rj.id) { ctx.fillStyle = col.border; ctx.fillRect(rr.x, rr.y, rr.w, rr.h); }
      ctx.fillStyle = jobCol(rj.id);
      ctx.fillRect(rr.x + 2, rr.y + 3, 8, 8);
      text('Job ' + rj.id + '  started ' + rj.start + ', finishes ' + rj.finish + '  uses ' + rj.cpu + ' cores, ' + rj.mem + ' MB', rr.x + 16, rr.y + 12, rr.w - 20);
      regions.push({ x: rr.x, y: rr.y, w: rr.w, h: rr.h, id: rj.id });
    }
    if (lay.runningMore > 0) { text('and ' + lay.runningMore + ' more', MARGIN + 16, lay.runningMoreY, 200, col.muted); }

    /* Gantt */
    var g = lay.gantt;
    text('Timeline (' + g.order.length + ' jobs)', MARGIN, g.titleY, lay.w - 2 * MARGIN, col.muted);
    ctx.strokeStyle = col.border; ctx.lineWidth = 1;
    ctx.strokeRect(g.x, g.y, g.w, g.h);
    var sx = function (t) { return g.x + (t / g.tmax) * g.w; };
    for (var k = 0; k < g.order.length; k++) {
      var jb = g.order[k];
      var ry = g.y + k * g.rowH;
      var bh = Math.max(1, Math.min(10, g.rowH - 1));
      var bb = view.bars[jb.id];
      var started = bb && bb.start !== undefined;
      var waitEnd = started ? bb.start : st.now;
      if (jb.arrival <= waitEnd) {
        ctx.fillStyle = col.muted;
        ctx.fillRect(sx(jb.arrival), ry + bh / 2, Math.max(0, sx(waitEnd) - sx(jb.arrival)), 1);
      }
      if (started) {
        var end = bb.finish !== undefined ? bb.finish : st.now;
        block(jb.id, sx(bb.start), ry, Math.max(1, sx(end) - sx(bb.start)), bh);
      }
      if (sel === jb.id) { ctx.strokeStyle = col.text; ctx.lineWidth = 1; ctx.strokeRect(g.x, ry, g.w, Math.max(1, g.rowH)); }
      if (g.rowH >= 12) { text(String(jb.id), MARGIN + LABEL_W - 24, ry + 10, 22, col.muted); }
      regions.push({ x: g.x, y: ry, w: g.w, h: Math.max(1, g.rowH), id: jb.id });
    }
    /* the "now" marker and the time axis */
    ctx.strokeStyle = col.mark; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(lay.nowX, g.y); ctx.lineTo(lay.nowX, g.y + g.h); ctx.stroke();
    text('now ' + st.now, Math.min(lay.nowX + 3, g.x + g.w - 50), g.y - 3, 70, col.mark);
    text('0', g.x, lay.axisY, 40, col.muted);
    text(String(g.tmax), g.x + g.w - 40, lay.axisY, 40, col.muted);
    return true;
  }

  APRM.canvas = {
    HEIGHT: HEIGHT,
    WAIT_ROWS: WAIT_ROWS,
    RUN_ROWS: RUN_ROWS,
    paletteIndex: paletteIndex,
    PALETTE_SIZE: PALETTE_SIZE,
    drawHatch: drawHatch,
    layout: layout,
    hit: hit,
    draw: draw
  };
})();
