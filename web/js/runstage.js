/* runstage.js: the Run page's laptop, its screen, and the waiting and finished columns (K-52).
 *
 * Idea: the machine is the same laptop as on the Build page (laptop.js builds the parts), here
 * assembled: lid open, keyboard backlit while jobs run. Its screen shows the run: the CPU cores
 * coloured by the job holding them, the memory chips with each job's share, a saved spot, and one
 * tile per running job. Waiting jobs stand in line on the left, finished jobs on the right. Every
 * number comes from the player's frame, which comes from the engine; this file never decides
 * which job runs. After each event the picture moves as runanim.js says (FLIP on transform and
 * opacity). Arriving from Build, the exploded laptop closes up and glides to the middle first.
 *
 * The whole stage is decorative (aria-hidden): the tables below it are the readable source.
 * Elements are made with createElement and textContent only; colours come from CSS classes.
 *
 * Classic script: attaches APRM.runstage only. mount() registers the view with APRM.player.
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});

  var Q_MAX = 7, Q_MAX_SMALL = 6, DONE_MAX = 6, TILES_MAX = 5;
  var SCREEN_W = 600, SCREEN_H = 391;      /* the screen content is laid out at this size, then scaled */
  var LID_SCREEN_W = 382;                  /* the lid's screen opening (laptop.js: W - 18) */
  var ARRIVE = { collapse: 120, glide: 600, settle: 1380, done: 1760, glideMs: 700, layerMs: 440 };

  var ui = null;           /* the elements, made once in mount() */
  var parts = null;        /* the laptop parts from laptop.js (null when drawn flat) */
  var picture = null;      /* which cells and memory each running job is drawn on */
  var pictureCap = '';
  var geo = { w: 0, s: 1, heroX: 0, heroY: 0, h: 0, side: false, narrow: false };
  var flat = false, mq = null, arriving = false, timers = [];
  var lastFrame = null;

  function byId(id) { return document.getElementById(id); }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) { e.setAttribute('class', cls); }
    if (txt !== undefined && txt !== null) { e.textContent = String(txt); }
    return e;
  }
  function setText(e, t) { t = String(t); if (e.textContent !== t) { e.textContent = t; } }
  function copyText(key, fallback, vars) {
    var C = APRM.copy;
    if (!C || !C.has(key)) { return fallback; }
    return vars ? C.fill(key, vars) : C.get(key);
  }
  function reduced() { return !!(mq && mq.matches); }
  function tone(id) { return APRM.canvas && APRM.canvas.paletteIndex ? APRM.canvas.paletteIndex(id) : ((id % 10) + 10) % 10; }
  function plural(n, one, many) { return n === 1 ? one : many; }
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }

  /* ---------- keyed lists: reuse each job's element so it can glide ---------- */

  /* Make the children of box match items (by key), creating with make(item) and filling with
   * fill(element, item, index). Elements keep their identity, so FLIP sees them move. O(items). */
  function keyed(box, items, keyOf, make, fill) {
    var have = {};
    for (var c = box.firstChild; c; c = c.nextSibling) { if (c.__key !== undefined) { have[c.__key] = c; } }
    var keep = {};
    var prev = null;
    for (var i = 0; i < items.length; i++) {
      var k = keyOf(items[i]);
      var node = have[k];
      if (!node) { node = make(items[i]); node.__key = k; }
      keep[k] = true;
      fill(node, items[i], i);
      var want = prev ? prev.nextSibling : box.firstChild;
      if (node !== want) { box.insertBefore(node, want); }
      prev = node;
    }
    for (var key in have) { if (Object.prototype.hasOwnProperty.call(have, key) && !keep[key] && have[key].parentNode === box) { box.removeChild(have[key]); } }
  }

  /* ---------- building ---------- */

  function buildScreen() {
    var s = el('div', 'rs-screen');
    var head = el('div', 'rs-scr-head');
    var title = el('span', 'rs-scr-caps rs-muted');
    var tick = el('span', 'rs-scr-tick');
    head.appendChild(title); head.appendChild(tick);
    s.appendChild(head);
    var body = el('div', 'rs-scr-body');
    var left = el('div', 'rs-scr-left');
    var cpuLabel = el('span', 'rs-scr-caps rs-amber');
    var grid = el('div', 'rs-cells');
    var cells = [];
    for (var i = 0; i < 64; i++) {
      var cell = el('div', 'rs-cell');
      var fill = el('div', 'rs-cell-fill');
      var held = el('div', 'rs-cell-held');
      cell.appendChild(fill); cell.appendChild(held);
      grid.appendChild(cell);
      cells.push({ el: cell, fill: fill, held: held, id: null });
    }
    var moreCores = el('span', 'rs-scr-note');
    var memLabel = el('span', 'rs-scr-caps rs-sand');
    var mem = el('div', 'rs-mem');
    var slots = el('div', 'rs-mem-slots');
    for (var k = 0; k < 16; k++) { slots.appendChild(el('div', 'rs-mem-slot')); }
    var segs = el('div', 'rs-mem-segs');
    mem.appendChild(slots); mem.appendChild(segs);
    var chipNote = el('span', 'rs-scr-note');
    var spot = el('div', 'rs-spot');
    var cpuBox = el('div', 'rs-scr-group'); cpuBox.appendChild(cpuLabel); cpuBox.appendChild(grid); cpuBox.appendChild(moreCores);
    var memBox = el('div', 'rs-scr-group'); memBox.appendChild(memLabel); memBox.appendChild(mem); memBox.appendChild(chipNote);
    left.appendChild(cpuBox); left.appendChild(memBox); left.appendChild(spot);
    var right = el('div', 'rs-scr-right');
    var runLabel = el('span', 'rs-scr-caps rs-amber');
    var tiles = el('div', 'rs-tiles');
    var tilesMore = el('span', 'rs-scr-note');
    var idle = el('span', 'rs-scr-idle');
    right.appendChild(runLabel); right.appendChild(tiles); right.appendChild(tilesMore); right.appendChild(idle);
    body.appendChild(left); body.appendChild(right);
    s.appendChild(body);
    return { root: s, title: title, tick: tick, cpuLabel: cpuLabel, grid: grid, cells: cells, moreCores: moreCores, memLabel: memLabel,
      slots: slots, segs: segs, chipNote: chipNote, spot: spot, runLabel: runLabel, tiles: tiles, tilesMore: tilesMore, idle: idle };
  }

  function buildColumn(cls, labelCls) {
    var col = el('div', 'rs-col ' + cls);
    var head = el('div', 'rs-col-head');
    var label = el('span', 'label-caps ' + labelCls);
    var note = el('span', 'rs-col-note');
    head.appendChild(label); head.appendChild(note);
    var empty = el('p', 'rs-col-empty');
    var list = el('div', 'rs-list');
    var more = el('p', 'rs-col-more');
    col.appendChild(head); col.appendChild(empty); col.appendChild(list); col.appendChild(more);
    return { col: col, label: label, note: note, empty: empty, list: list, more: more };
  }

  /* ---------- geometry ---------- */

  /* Sizes for a stage this wide, following the design: the screen is about 600 to 640 px wide on a
   * desktop and the side columns sit outside it. Returns the laptop scale and anchor point. O(1). */
  function geometry(w) {
    var narrow = w < 900, side = w >= 1100;
    var center = side ? w - 2 * (248 + 32) : w;
    var screenW = narrow ? Math.min(560, (w - 32) * 0.72) : side ? Math.min(600, center - 40) : Math.min(600, (w - 64) * 0.76);
    var s = Math.max(0.5, screenW / 400);    /* the projected screen of a scale-1 laptop is about 400 px wide */
    return { w: w, s: s, screenW: screenW, narrow: narrow, side: side, heroX: w / 2, heroY: 48 + 330 * s, h: Math.round(450 * s + 48) };
  }

  function layout() {
    if (!ui) { return; }
    var w = ui.wrap.clientWidth || (window.innerWidth || 1280);
    geo = geometry(w);
    ui.wrap.setAttribute('data-side', geo.side ? 'on' : 'off');
    var sw = ui.stage.clientWidth || w;
    geo.heroX = sw / 2 + 42 * geo.s;        /* the turned lid sits left of the base centre; this centres the screen */
    ui.stage.style.height = (flat ? Math.round(geo.screenW * 1.05 * 0.72 + 60) : geo.h) + 'px';
    if (parts && !arriving) { placeHero(geo.heroX, geo.heroY, geo.s, false); }
    if (flat && ui.flat) {
      var fw = geo.screenW * 1.05;
      ui.flat.style.width = fw.toFixed(1) + 'px';
      ui.flat.style.left = (((ui.stage.clientWidth || w) - fw) / 2).toFixed(1) + 'px';
      var inner = fw * (1 - 0.035);
      ui.screen.root.style.transform = 'scale(' + (inner / SCREEN_W).toFixed(4) + ')';
    }
  }

  function placeHero(x, y, s, animate, ms) {
    var h = parts.hero.style;
    h.left = '0px'; h.top = '0px';
    h.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + s.toFixed(4) + ')';
    h.transition = animate ? 'transform ' + (ms || ARRIVE.glideMs) + 'ms cubic-bezier(0.65,0,0.35,1)' : 'none';
  }

  function setPose(name, animate, ms) {
    var ps = APRM.laptop.pose(name);
    parts.stage.style.transform = 'rotateX(' + ps.cam.rx + 'deg) rotateZ(' + ps.cam.rz + 'deg)';
    parts.stage.style.transition = animate ? 'transform ' + ARRIVE.glideMs + 'ms cubic-bezier(0.65,0,0.35,1)' : 'none';
    ['base', 'mem', 'cpu', 'keys', 'lid'].forEach(function (id) {
      parts.layers[id].style.transform = APRM.laptop.layerTransform(ps, id);
      parts.layers[id].style.transition = animate ? 'transform ' + (ms || ARRIVE.layerMs) + 'ms cubic-bezier(0.22,1,0.36,1)' : 'none';
    });
  }

  /* ---------- the Build to Run reassembly ---------- */

  /* Start the laptop where Build left it (exploded, at its place and size), close it up, glide it
   * to the middle and turn it to face the viewer, then fade the page in. Reduced motion, a flat
   * drawing or no Build laptop on screen: the page simply appears. */
  function arrive() {
    timers.forEach(clearTimeout); timers = [];
    var from = APRM.laptop.lastHero ? APRM.laptop.lastHero() : null;
    var panel = byId('run-panel');
    if (!parts || reduced() || !from || !from.exploded || !ui.wrap.getBoundingClientRect) { settle(); return; }
    layout();
    var r = ui.stage.getBoundingClientRect();
    var sx = window.scrollX || 0, sy = window.scrollY || 0;
    var x0 = from.x - (r.left + sx), y0 = from.y - (r.top + sy);
    arriving = true;
    if (panel) { panel.setAttribute('data-arriving', 'on'); }
    placeHero(x0, y0, from.scale, false);
    setPose('exploded', false);
    later(function () { setPose('collapse', true); }, ARRIVE.collapse);
    later(function () { placeHero(geo.heroX, geo.heroY, geo.s, true); setPose('assembled', true, ARRIVE.glideMs); }, ARRIVE.glide);
    later(function () { if (panel) { panel.setAttribute('data-arriving', 'off'); } }, ARRIVE.settle);
    later(function () { arriving = false; layout(); }, ARRIVE.done);
  }

  function settle() {
    timers.forEach(clearTimeout); timers = [];
    arriving = false;
    var panel = byId('run-panel');
    if (panel) { panel.setAttribute('data-arriving', 'off'); }
    if (parts) { setPose('assembled', false); }
    layout();
  }

  /* ---------- drawing ---------- */

  var SHORT = { fcfs: 'FCFS', priority: 'Priority', sjf: 'SJF', aging: 'Aging', aging_reserve: 'Aging + EASY', knapsack: 'Knapsack' };

  function drawScreen(f) {
    var S = ui.screen, st = f.state, cap = f.cap;
    var C = cap.cpu, M = cap.mem;
    var usedC = st ? C - st.free.cpu : 0, usedM = st ? M - st.free.mem : 0;
    var large = f.large;
    setText(S.title, copyText('screen.run', 'Run · ' + SHORT[f.policy], { m: copyText('screen.' + f.policy, SHORT[f.policy] || f.policy) }));
    setText(S.tick, copyText('screen.tick', 'Tick ' + (st ? st.now : 0), { t: st ? st.now : 0 }));
    setText(S.cpuLabel, copyText('screen.cpu', 'CPU', { used: usedC, cap: C }));
    /* cells: one per core up to 64, coloured by the job drawn on it */
    var nC = Math.min(C, 64), cols = nC <= 16 ? 8 : 16;
    var cellW = (300 - (cols - 1) * 4) / cols, cellH = nC <= 16 ? 26 : nC <= 32 ? 20 : 14;
    S.grid.style.setProperty('--cell-w', cellW.toFixed(2) + 'px');
    S.grid.style.setProperty('--cell-h', cellH + 'px');
    var held = APRM.runanim.heldCount(st, picture.cells);
    var heldLeft = held, resId = st && st.reservation ? st.reservation.id : null;
    for (var i = 0; i < 64; i++) {
      var c = S.cells[i];
      if (i >= nC) { c.el.hidden = true; continue; }
      c.el.hidden = false;
      var id = picture.cells[i];
      var isHeld = false;
      if (id === null && heldLeft > 0) { isHeld = true; heldLeft--; }
      var cls = 'rs-cell' + (id !== null ? ' on tone-' + tone(id) : '') + (isHeld ? ' held' : '');
      if (c.el.getAttribute('class') !== cls) { c.el.setAttribute('class', cls); }
      c.fill.setAttribute('data-pop', id !== null && c.id !== id ? '1' : '0');
      c.held.setAttribute('data-pop', isHeld && !c.wasHeld ? '1' : '0');
      setText(c.fill, id !== null && cellW >= 18 && !large ? id : '');
      setText(c.held, isHeld && cellW >= 18 ? resId : '');
      c.id = id;
      c.wasHeld = isHeld;
    }
    S.moreCores.hidden = C <= 64;
    setText(S.moreCores, copyText('screen.cores.more', '', { n: C }));
    /* memory: chips of 4096 MB, each running job's share drawn where it was placed */
    setText(S.memLabel, copyText('screen.mem', 'Memory', { used: usedM, cap: M }));
    var chips = Math.max(1, Math.min(16, Math.ceil(M / 4096))), scale = chips * 4096;   /* 1 chip = 4096 MB on the drawing */
    for (var k = 0; k < 16; k++) { S.slots.children[k].hidden = k >= chips; }
    var segs = [];
    if (st) {
      st.running.forEach(function (r) {
        (picture.segs[r.id] || []).forEach(function (g, ix) {
          if (g[0] >= scale) { return; }
          var w = (Math.min(g[1], scale) - g[0]) / scale * 100;
          segs.push({ key: 'm' + r.id + '-' + ix, id: r.id, l: g[0] / scale * 100, w: w, held: false });
        });
      });
      if (st.reservation) {
        var job = null;
        st.waiting.forEach(function (x) { if (x.id === st.reservation.id) { job = x; } });
        var need = job ? Math.min(job.mem, st.free.mem) : 0;
        for (var g2 = 0; g2 < picture.gaps.length && need > 0; g2++) {
          var gp = picture.gaps[g2], take = Math.min(need, gp[1] - gp[0]);
          if (gp[0] < scale) { segs.push({ key: 'h' + g2, id: null, l: gp[0] / scale * 100, w: (Math.min(gp[0] + take, scale) - gp[0]) / scale * 100, held: true }); }
          need -= take;
        }
      }
    }
    keyed(S.segs, segs, function (x) { return x.key; }, function () { return el('div', 'rs-seg'); }, function (n, x) {
      var cls = 'rs-seg' + (x.held ? ' held' : ' tone-' + tone(x.id));
      if (n.getAttribute('class') !== cls) { n.setAttribute('class', cls); }
      n.style.left = x.l.toFixed(3) + '%';
      n.style.width = x.w.toFixed(3) + '%';
      setText(n, !x.held && x.w > 4 && !large ? x.id : '');
    });
    setText(S.chipNote, M > 65536 ? copyText('screen.chips.over', '', { mb: M - 65536 }) : copyText('screen.chips', '', { n: chips, chips: plural(chips, 'chip', 'chips') }));
    S.spot.hidden = !(st && st.reservation);
    if (st && st.reservation) { setText(S.spot, copyText('screen.spot', '', { id: st.reservation.id, t: st.reservation.shadow_time })); }
    /* running tiles */
    var run = st ? st.running : [];
    setText(S.runLabel, copyText('screen.running', 'Running', { n: run.length }));
    keyed(S.tiles, run.slice(0, TILES_MAX), function (r) { return 'j' + r.id; }, function () {
      var t = el('div', 'rs-tile');
      var row = el('div', 'rs-tile-row');
      var badge = el('span', 'rs-badge'); var name = el('span', 'rs-tile-name'); var need = el('span', 'rs-tile-need rs-muted');
      row.appendChild(badge); row.appendChild(name); row.appendChild(need);
      var row2 = el('div', 'rs-tile-row');
      var track = el('div', 'rs-track'); var bar = el('div', 'rs-bar'); track.appendChild(bar);
      var ends = el('span', 'rs-ends rs-muted'); var tag = el('span', 'rs-tag');
      tag.setAttribute('data-mark', '1');
      row2.appendChild(track); row2.appendChild(ends); row2.appendChild(tag);
      t.appendChild(row); t.appendChild(row2);
      t.__p = { badge: badge, name: name, need: need, bar: bar, ends: ends, tag: tag };
      return t;
    }, function (t, r) {
      var p = t.__p;
      t.setAttribute('data-flip', large ? '' : 'j' + r.id);
      t.setAttribute('class', 'rs-tile' + (f.selected === r.id ? ' sel' : ''));
      p.badge.setAttribute('class', 'rs-badge tone-' + tone(r.id));
      setText(p.badge, r.id);
      setText(p.name, copyText('stage.job', 'Job ' + r.id, { id: r.id }));
      setText(p.need, copyText('screen.need', '', { c: r.cpu, cores: plural(r.cpu, 'core', 'cores'), m: r.mem }));
      var dur = Math.max(1, r.finish - r.start);
      p.bar.setAttribute('class', 'rs-bar tone-' + tone(r.id));
      p.bar.style.transform = 'scaleX(' + Math.max(0, Math.min(1, (st.now - r.start) / dur)).toFixed(3) + ')';
      setText(p.ends, copyText('screen.ends', '', { t: r.finish }));
      p.tag.hidden = !st.squeezed[r.id];
      setText(p.tag, copyText('screen.squeezed', 'squeezed in'));
    });
    S.tilesMore.hidden = run.length <= TILES_MAX;
    setText(S.tilesMore, copyText('screen.more', '', { n: run.length - TILES_MAX }));
    S.idle.hidden = run.length > 0;
    setText(S.idle, copyText('screen.idle', 'Idle.'));
  }

  /* The last SKIP sentence for a job, without its "Job N skipped:" start (the card says whose). */
  function skipWords(f, id) {
    for (var i = f.entries.length - 1; i >= 0 && i >= f.entries.length - 400; i--) {
      var e = f.entries[i];
      if (e.job === id && e.kind === 'SKIP') { return copyText('stage.skipped', 'Skipped', { why: String(e.msg).replace(/^Job \d+ skipped: /, '').replace(/\.$/, '') }); }
    }
    return copyText('stage.skipped.short', 'Skipped');
  }

  function drawQueue(f) {
    var st = f.state, Q = ui.queue;
    var waiting = st ? st.waiting : [];
    var max = geo.narrow || f.large ? Q_MAX_SMALL : Q_MAX;
    setText(Q.label, copyText('stage.waiting', 'Waiting', { n: waiting.length }));
    setText(Q.note, copyText('stage.order', '', { m: copyText('screen.' + f.policy, SHORT[f.policy] || f.policy) }));
    Q.empty.hidden = waiting.length > 0;
    setText(Q.empty, st ? copyText('stage.empty', 'No jobs waiting.') : copyText('stage.empty.before', 'Jobs line up here as they arrive.'));
    var aging = f.policy === 'aging' || f.policy === 'aging_reserve';
    var res = st && st.reservation ? st.reservation : null;
    keyed(Q.list, waiting.slice(0, max), function (j) { return 'j' + j.id; }, function () {
      var c = el('div', 'rs-card');
      var row = el('div', 'rs-card-row');
      var order = el('span', 'rs-order rs-muted'); var name = el('span', 'rs-card-name'); var pri = el('span', 'rs-pri'); var score = el('span', 'rs-score');
      row.appendChild(order); row.appendChild(name); row.appendChild(pri); row.appendChild(score);
      var need = el('div', 'rs-card-line rs-muted');
      var saved = el('div', 'rs-card-line rs-saved'); saved.setAttribute('data-mark', '1');
      var skip = el('div', 'rs-card-line rs-skip');
      var corner = el('div', 'rs-corner');
      c.appendChild(row); c.appendChild(need); c.appendChild(saved); c.appendChild(skip); c.appendChild(corner);
      c.__p = { order: order, name: name, pri: pri, score: score, need: need, saved: saved, skip: skip, corner: corner };
      return c;
    }, function (c, j, i) {
      var p = c.__p;
      var isRes = !!(res && res.id === j.id);
      var isSkip = !isRes && st.skipped[j.id] === st.now;
      var chosen = st.chosen[j.id] === st.now;
      c.setAttribute('data-flip', f.large ? '' : 'j' + j.id);
      c.setAttribute('data-job', String(j.id));
      c.setAttribute('class', 'rs-card' + (isRes ? ' saved' : '') + (isSkip ? ' skipped' : '') + (chosen ? ' chosen' : '') + (f.selected === j.id ? ' sel' : ''));
      setText(p.order, i + 1);
      setText(p.name, copyText('stage.job', 'Job ' + j.id, { id: j.id }));
      setText(p.pri, 'P' + j.priority);
      p.score.hidden = !aging || j.score === null || j.score === undefined;
      setText(p.score, aging && j.score !== null && j.score !== undefined ? APRM.runmodel.scoreText(j.score) : '');
      setText(p.need, copyText('stage.need', '', { c: j.cpu, cores: plural(j.cpu, 'core', 'cores'), m: j.mem, d: j.duration, ticks: plural(j.duration, 'tick', 'ticks') }));
      p.saved.hidden = !isRes && !chosen;
      setText(p.saved, isRes ? copyText('stage.saved', '', { t: res.shadow_time }) : chosen ? copyText('stage.chosen', '') : '');
      p.skip.hidden = !isSkip;
      setText(p.skip, isSkip ? skipWords(f, j.id) : '');
      p.corner.hidden = !isSkip;
    });
    Q.more.hidden = waiting.length <= max;
    setText(Q.more, copyText('stage.more', '', { n: waiting.length - max }));
  }

  function drawDone(f) {
    var D = ui.done, st = f.state;
    var fin = [];
    if (f.hist) {
      for (var i = f.hist.order.length - 1; i >= 0; i--) { var r = f.hist.jobs[f.hist.order[i]]; if (r.finish !== null) { fin.push(r); } }
      fin.sort(function (a, b) { return b.finish - a.finish || b.id - a.id; });
    }
    var n = st ? st.done : 0;
    setText(D.label, copyText('stage.finished', 'Finished', { n: n }));
    D.empty.hidden = n > 0;
    setText(D.empty, copyText('stage.done.empty', 'Nothing has finished yet.'));
    keyed(D.list, fin.slice(0, DONE_MAX), function (r) { return 'j' + r.id; }, function () {
      var d = el('div', 'rs-done-row');
      var name = el('span', 'rs-card-name'); var at = el('span', 'rs-muted');
      d.appendChild(name); d.appendChild(at);
      d.__p = { name: name, at: at };
      return d;
    }, function (d, r) {
      d.setAttribute('data-flip', f.large ? '' : 'j' + r.id);
      d.setAttribute('data-job', String(r.id));
      d.setAttribute('class', 'rs-done-row' + (f.selected === r.id ? ' sel' : ''));
      setText(d.__p.name, copyText('stage.job', 'Job ' + r.id, { id: r.id }));
      setText(d.__p.at, copyText('stage.at', '', { t: r.finish }));
    });
    D.more.hidden = n <= DONE_MAX;
    setText(D.more, copyText('stage.earlier', '', { n: n - DONE_MAX }));
  }

  /* The view player.js calls after every change. One event on a small case moves; anything else
   * (a jump, a big case, a reset, reduced motion) is drawn in place. */
  function draw(f, why) {
    if (!ui) { return; }
    lastFrame = f;
    var capKey = f.cap.cpu + 'x' + f.cap.mem;
    if (!picture || why === 'start' || why === 'reset' || capKey !== pictureCap || !f.state) {
      picture = APRM.runanim.emptyPicture(f.cap);
      pictureCap = capKey;
      if (parts) { APRM.laptop.paintMachine(parts, f.cap.cpu, f.cap.mem); }
    }
    var move = why === 'event' && !f.large && !reduced() && !flat && !!f.last;
    if (why === 'event' || why === 'start' || why === 'reset' || why === 'jump') { APRM.runanim.finishAll(); }
    var before = move ? APRM.runanim.capture(ui.wrap) : null;
    if (f.state) { picture = APRM.runanim.allocate(picture, f.state.running, f.cap); }
    drawScreen(f);
    drawQueue(f);
    drawDone(f);
    ui.wrap.setAttribute('data-lit', f.state && f.state.running.length > 0 ? 'on' : 'off');
    ui.wrap.setAttribute('data-status', f.status);
    if (move) { APRM.runanim.play(ui.wrap, before, f.last, f.speed, null); }
    if (why === 'status') {
      if (f.status === 'paused') { APRM.runanim.pauseAll(); }
      if (f.status === 'playing') { APRM.runanim.resumeAll(); }
    }
  }

  /* ---------- mounting ---------- */

  var mounted = false;

  function mount() {
    if (mounted || !APRM.player) { return; }
    var host = byId('run-stage');
    if (!host || !host.appendChild || typeof document.createElement !== 'function' || typeof window.addEventListener !== 'function' ||
        typeof document.createElementNS !== 'function' || typeof window.requestAnimationFrame !== 'function') { return; }   /* no real page (the Node tests) */
    mounted = true;
    try { mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null; } catch (e) { mq = null; }
    var wrap = el('div', 'rs-wrap');
    wrap.setAttribute('aria-hidden', 'true');
    var queue = buildColumn('rs-queue', 'rs-sand');
    var done = buildColumn('rs-done', 'rs-sage');
    var stage = el('div', 'rs-stage');
    var screen = buildScreen();
    ui = { host: host, wrap: wrap, stage: stage, queue: queue, done: done, screen: screen, flat: null };
    flat = !(APRM.laptop && APRM.laptop.supports3d && APRM.laptop.supports3d());
    if (!flat) {
      parts = APRM.laptop.buildParts(stage);
      parts.hero.setAttribute('class', parts.hero.getAttribute('class') + ' rs-hero');
      parts.lit.hidden = true;
      /* the design's soft shadow under the laptop and the lit key well */
      var shadow = el('div', 'lt-abs rs-shadow');
      parts.stage.insertBefore(shadow, parts.stage.firstChild);
      parts.keyBed.setAttribute('class', parts.keyBed.getAttribute('class') + ' rs-well');
      var holder = el('div', 'rs-screen-hold');
      holder.style.transform = 'scale(' + (LID_SCREEN_W / SCREEN_W).toFixed(4) + ')';
      holder.appendChild(screen.root);
      parts.screen.appendChild(holder);
      setPose('assembled', false);
    } else {
      var f2 = el('div', 'rs-flat');
      var lidF = el('div', 'rs-flat-lid');
      var scr = el('div', 'rs-flat-screen');
      scr.appendChild(screen.root);
      lidF.appendChild(scr);
      var baseF = el('div', 'rs-flat-base');
      f2.appendChild(lidF); f2.appendChild(baseF);
      stage.appendChild(f2);
      ui.flat = f2;
      wrap.setAttribute('data-flat', 'on');
    }
    wrap.appendChild(queue.col); wrap.appendChild(stage); wrap.appendChild(done.col);
    host.appendChild(wrap);
    /* clicking a card or a finished row selects that job, like a row in the tables below */
    var pick = function (ev) {
      var t = ev.target;
      while (t && t !== wrap && !(t.getAttribute && t.getAttribute('data-job'))) { t = t.parentNode; }
      if (t && t !== wrap && t.getAttribute) {
        var id = Number(t.getAttribute('data-job'));
        APRM.player.select(APRM.player.snapshot().selected === id ? null : id);
      }
    };
    wrap.addEventListener('click', pick);
    var resizing = null;
    window.addEventListener('resize', function () {
      if (resizing !== null) { return; }
      resizing = requestAnimationFrame(function () { resizing = null; layout(); if (lastFrame) { draw(lastFrame, 'details'); } });
    });
    var lastMode = APRM.store.get().mode;
    APRM.store.subscribe(function (s, changed) {
      if (changed !== 'mode') { return; }
      var from = lastMode;
      lastMode = s.mode;
      if (s.mode === 'run') {
        /* the panel is visible now: measure, then reassemble if we came from Build */
        if (from === 'build') { arrive(); } else { settle(); }
      }
    });
    APRM.player.addView(draw);
    layout();
    draw(APRM.player.frame(), 'reset');
  }

  APRM.runstage = { mount: mount, geometry: geometry, ARRIVE: ARRIVE, draw: draw, SCREEN_W: SCREEN_W, SCREEN_H: SCREEN_H };
})();
