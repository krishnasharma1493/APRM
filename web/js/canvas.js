/* canvas.js: the planning board (PRD section 7, K-49).
 *
 * Idea: the machine is a board with two lanes, CPU above memory, on one time axis. Each job the engine
 * has started is a card: as wide as its run, as tall as its share of that resource. Everything shown
 * comes from the engine's state JSON and log; this file only places cards and never decides anything.
 * Colours come from the CSS variables, so the board follows light and dark.
 *
 * Classic script: attaches APRM.canvas only. Nothing runs at load time.
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});

  var HEIGHT = 360;              /* css pixels */
  var MARGIN = 8;
  var LABEL_W = 56;              /* width of the "CPU" / "Memory" labels */
  var TOP = 16;                  /* room for the "now" label */
  var GAP = 14;                  /* between the lanes */
  var AXIS_H = 24;               /* room for the time labels */
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

  /* Stack jobs in one lane, as planning-board cards. A card sits at the lowest free height for its
   * whole span of time. Only a drawing choice: the engine already decided when each job runs and
   * resources are interchangeable, so the height means nothing but "these fit together". A card that
   * finds no contiguous gap (fragments can occur) is drawn against the top edge. O(n * cards in use). */
  function stack(cards, cap) {
    var active = [];
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      active = active.filter(function (o) { return o.end > c.start; });
      var tries = [0];
      for (var a = 0; a < active.length; a++) { tries.push(active[a].slot + active[a].size); }
      tries.sort(function (x, y) { return x - y; });
      var slot = -1;
      for (var t = 0; t < tries.length && slot < 0; t++) {
        var y0 = tries[t], free = y0 + c.size <= cap;
        for (var k = 0; k < active.length && free; k++) {
          if (y0 < active[k].slot + active[k].size && active[k].slot < y0 + c.size) { free = false; }
        }
        if (free) { slot = y0; }
      }
      c.slot = slot >= 0 ? slot : Math.max(0, cap - c.size);
      active.push(c);
    }
    return cards;
  }

  /* A tick step that gives labels about `room` pixels apart: 1, 2 or 5 times a power of ten. O(1). */
  function niceStep(tmax, width, room) {
    var raw = tmax / Math.max(1, width / room);
    var mag = Math.pow(10, Math.floor(Math.log(Math.max(raw, 1)) / Math.LN10));
    var n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  }

  /* One lane's cards as rectangles. key is 'cpu' or 'mem'. Time runs left to right on the shared axis. */
  function laneCards(view, key, cap, lane, sx, now) {
    var byId = {}, list = [], i;
    for (i = 0; i < view.jobs.length; i++) { byId[view.jobs[i].id] = view.jobs[i]; }
    var ids = Object.keys(view.bars);
    for (i = 0; i < ids.length; i++) {
      var b = view.bars[ids[i]], job = byId[ids[i]];
      if (!job || b.start === undefined) { continue; }
      list.push({ id: job.id, start: b.start, end: b.finish !== undefined ? b.finish : now, size: job[key] });
    }
    list.sort(function (p, q) { return p.start - q.start || p.id - q.id; });
    stack(list, cap);
    for (i = 0; i < list.length; i++) {
      var c = list[i];
      c.x = sx(c.start);
      c.w = Math.max(1, sx(c.end) - c.x);
      c.x = Math.min(c.x, lane.x + lane.w - c.w);          /* a 1-pixel card at the far end stays on the board */
      c.h = Math.max(1, (c.size / cap) * lane.h);
      c.y = lane.y + lane.h - ((c.slot + c.size) / cap) * lane.h;
    }
    return list;
  }

  /* Where everything goes, for a canvas of w x h css pixels: the CPU lane over the memory lane over
   * one time axis. view = { state, jobs, bars }; state may be null (nothing drawn then).
   * Returns plain rectangles; tests check them. O(jobs log jobs). */
  function layout(view, w, h) {
    var st = view.state;
    var out = { w: w, h: h, lanes: null };
    if (!st) { return out; }
    var tmax = Math.max(1, st.now), k;
    for (k = 0; k < view.jobs.length; k++) { if (view.jobs[k].arrival > tmax) { tmax = view.jobs[k].arrival; } }
    var ids = Object.keys(view.bars);
    for (k = 0; k < ids.length; k++) {
      var b = view.bars[ids[k]];
      if (b.finish !== undefined && b.finish > tmax) { tmax = b.finish; }
    }
    var x = LABEL_W, gw = Math.max(20, w - x - MARGIN);
    var laneH = Math.max(40, (h - TOP - AXIS_H - GAP) / 2);
    var sx = function (t) { return x + (t / tmax) * gw; };
    var cpu = { key: 'cpu', cap: st.cap.cpu, x: x, y: TOP, w: gw, h: laneH };
    var mem = { key: 'mem', cap: st.cap.mem, x: x, y: TOP + laneH + GAP, w: gw, h: laneH };
    cpu.cards = laneCards(view, 'cpu', st.cap.cpu, cpu, sx, st.now);
    mem.cards = laneCards(view, 'mem', st.cap.mem, mem, sx, st.now);
    out.lanes = [cpu, mem];
    out.tmax = tmax;
    out.nowX = sx(st.now);
    out.step = niceStep(tmax, gw, 80);
    out.sx = sx;
    out.axisY = mem.y + mem.h + 16;
    return out;
  }

  /* The job under a point (css pixels), or null. Cards recorded by the last draw(). O(regions). */
  function hit(el, x, y) {
    var regs = (el && el.__regions) || [];
    for (var i = regs.length - 1; i >= 0; i--) {
      var g = regs[i];
      if (x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h) { return g.id; }
    }
    return null;
  }

  /* Draw the board. Returns false when the page has no 2D canvas. O(cards). */
  function draw(el, view) {
    var ctx = el && typeof el.getContext === 'function' ? el.getContext('2d') : null;
    if (!ctx) { return false; }
    var cssW = Math.max(300, Math.floor(el.clientWidth || 640));
    var dpr = (typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0) ? window.devicePixelRatio : 1;
    if (el.width !== Math.round(cssW * dpr)) { el.width = Math.round(cssW * dpr); }
    if (el.height !== Math.round(HEIGHT * dpr)) { el.height = Math.round(HEIGHT * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var col = colours(el);
    ctx.clearRect(0, 0, cssW, HEIGHT);
    ctx.font = '12px ' + col.font;
    ctx.textBaseline = 'alphabetic';
    var lay = layout(view, cssW, HEIGHT);
    el.__layout = lay;
    var regions = [];
    el.__regions = regions;
    if (!view.state) { return true; }
    var sel = view.selected;
    var text = function (s, x, y, maxW, colour) { ctx.fillStyle = colour || col.text; ctx.fillText(s, x, y, maxW); };

    for (var n = 0; n < lay.lanes.length; n++) {
      var lane = lay.lanes[n];
      /* the printed board: ground, capacity rule, a hairline at every time label */
      ctx.fillStyle = col.panel;
      ctx.fillRect(lane.x, lane.y, lane.w, lane.h);
      ctx.strokeStyle = col.border; ctx.lineWidth = 1;
      ctx.beginPath();
      for (var t = lay.step; t < lay.tmax; t += lay.step) { ctx.moveTo(lay.sx(t) + 0.5, lane.y); ctx.lineTo(lay.sx(t) + 0.5, lane.y + lane.h); }
      ctx.stroke();
      ctx.strokeRect(lane.x + 0.5, lane.y + 0.5, lane.w - 1, lane.h - 1);
      text(lane.key === 'cpu' ? 'CPU' : 'Memory', 0, lane.y + 12, LABEL_W - 4, col.text);
      text(String(lane.cap), 0, lane.y + 27, LABEL_W - 4, col.muted);
      text('0', 0, lane.y + lane.h, LABEL_W - 4, col.muted);
      for (var c = 0; c < lane.cards.length; c++) {
        var card = lane.cards[c];
        ctx.fillStyle = col.jobs[paletteIndex(card.id)];
        ctx.fillRect(card.x, card.y, card.w, card.h);
        drawHatch(ctx, card.id, card.x, card.y, card.w, card.h, col.panel);
        ctx.strokeStyle = col.panel; ctx.lineWidth = 1;
        ctx.strokeRect(card.x + 0.5, card.y + 0.5, Math.max(0, card.w - 1), Math.max(0, card.h - 1));
        if (card.w >= 22 && card.h >= 16) {
          /* the stamped number: dark or light ink is never in doubt on its own small plate */
          var label = String(card.id), pw = ctx.measureText ? ((ctx.measureText(label) || {}).width || 8) + 6 : 14;
          ctx.fillStyle = col.panel;
          ctx.fillRect(card.x + 3, card.y + 3, Math.min(pw, card.w - 6), 14);
          text(label, card.x + 6, card.y + 14, card.w - 10, col.text);
        }
        if (sel === card.id) { ctx.strokeStyle = col.text; ctx.lineWidth = 2; ctx.strokeRect(card.x, card.y, card.w, card.h); }
        regions.push({ x: card.x, y: card.y, w: card.w, h: card.h, id: card.id });
      }
    }

    /* the time axis, and the teal "now" rail across both lanes */
    var first = lay.lanes[0], last = lay.lanes[1];
    for (var v = 0; v <= lay.tmax; v += lay.step) { text(String(v), Math.min(lay.sx(v), cssW - 30), lay.axisY, 40, col.muted); }
    ctx.strokeStyle = col.accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(lay.nowX, first.y); ctx.lineTo(lay.nowX, last.y + last.h); ctx.stroke();
    text('now ' + view.state.now, Math.min(lay.nowX + 4, cssW - 60), first.y - 3, 70, col.accent);
    return true;
  }

  APRM.canvas = {
    HEIGHT: HEIGHT,
    paletteIndex: paletteIndex,
    PALETTE_SIZE: PALETTE_SIZE,
    drawHatch: drawHatch,
    layout: layout,
    hit: hit,
    draw: draw
  };
})();
