/* laptop.js: the exploded laptop on the Build page.
 *
 * Idea: the machine you are describing, drawn as a laptop pulled apart into five layers so each
 * setting has a part to point at. The CPU socket shows one cell per core (an 8 x 8 grid, up to 64),
 * the memory carrier one chip per 4096 MB (16 slots), and the keyboard stands for the job list.
 * Pointing at a part lights its setting on the right and the other way round; clicking a part
 * jumps to its setting. A short intro plays once per visit: closed, lid opens, glides left,
 * explodes, then the settings fade in. Reduced motion replaces all of it with a cross-fade.
 *
 * The drawing is decorative (aria-hidden); the labels beside it are real text with the exact
 * numbers. Elements are created with createElement and textContent only; colours come from CSS
 * classes using tokens.css; this file only sets geometry, transforms, opacity and text.
 * If the browser has no 3D transforms the drawing is left out and the labels show as a list.
 * Pure presentation: it reads the store and never decides which job runs.
 *
 * Classic script: attaches APRM.laptop only.
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});

  var W = 400, D = 272;                                          /* footprint of every layer, px */
  var EXPLODED_Z = { base: 0, mem: 70, cpu: 170, keys: 272, lid: 322 };
  var CLOSED_Z = { base: 0, mem: 2, cpu: 4.5, keys: 8, lid: 9.5 };
  var ORDER = ['base', 'mem', 'cpu', 'keys', 'lid'];               /* bottom to top */
  var CAMERA = { rx: 54, rz: -32 };                               /* direction 1a: three-quarter float */
  var FRONT = { rx: 60, rz: 0 };                                  /* the intro starts facing the front */
  var LINKED = { cpu: true, mem: true, keys: true };              /* parts tied to a setting */
  var SEEN_KEY = 'aprm-intro-seen';
  var EASE_OUT = 'cubic-bezier(0.22,1,0.36,1)';
  /* Intro timeline (ms from start), slow enough to follow: the lid opens, the laptop glides left,
   * then the layers separate one by one from the bottom up. */
  var INTRO = { open: 300, lidMs: 1100, slide: 1500, glideMs: 900, explode: 2300, explodeMs: 900, layerGap: 90,
    labelsDelay: 700, labelsMs: 400, panel: 3000, done: 3500, litDelay: 450, litMs: 600 };
  var KEY_ROWS = [
    { h: 10, keys: rowOf('              '.split('')) },
    { h: 19, keys: rowOf('`1234567890-='.split('')).concat([{ w: 1.5, l: 'del' }]) },
    { h: 19, keys: [{ w: 1.5, l: 'tab' }].concat(rowOf('QWERTYUIOP[]\\'.split(''))) },
    { h: 19, keys: [{ w: 1.8, l: 'caps' }].concat(rowOf('ASDFGHJKL;\''.split('')), [{ w: 1.8, l: 'enter' }]) },
    { h: 19, keys: [{ w: 2.3, l: 'shift' }].concat(rowOf('ZXCVBNM,./'.split('')), [{ w: 2.3, l: 'shift' }]) },
    { h: 19, keys: [{ w: 1, l: 'fn' }, { w: 1, l: 'ctrl' }, { w: 1, l: 'alt' }, { w: 1.3, l: '' }, { w: 5.2, l: '' },
      { w: 1.3, l: '' }, { w: 1, l: 'alt' }, { w: 1, l: '‹' }, { w: 1, l: 'ˆ' }, { w: 1, l: '›' }] }
  ];

  function rowOf(chars) { return chars.map(function (c) { return { w: 1, l: c.trim() }; }); }
  function byId(id) { return document.getElementById(id); }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function two(x) { return String(Math.round(x * 100) / 100); }

  /* ---------- pure picture rules (tested in tests/web/test_laptop.mjs) ---------- */

  /* Which CPU cells are drawn: one per core up to 64, filling the 8 x 8 socket in reading order. O(1). */
  function coreCells(cores) { return Math.max(0, Math.min(64, cores)); }

  /* How the memory is drawn: full chips of 4096 MB, then one chip filled to the remainder; above
   * 65536 MB all 16 chips are full and the rest is said in words. Returns {full, frac, over}. O(1). */
  function memChips(mb) {
    if (mb > 65536) { return { full: 16, frac: 0, over: true }; }
    var units = mb / 4096, full = Math.floor(units);
    return { full: full, frac: units - full, over: false };
  }

  /* The extra words when the picture cannot show everything. O(1). */
  function cpuTag(cores) { return cores > 64 ? 'grid × ' + two(cores / 64) + ' = ' + cores + ' cores' : ''; }
  function memTag(mb) { return mb > 65536 ? '+ ' + two((mb - 65536) / 1024) + ' GB more' : ''; }

  /* The five label texts for a state. Returns {lid, keys, cpu, mem, base}, each {title, val, sub, tag}. O(jobs). */
  function labelTexts(st) {
    var C = APRM.copy, cores = st.machine.cpu, mem = st.machine.mem, n = st.jobs.length;
    var size = APRM.machine ? APRM.machine.sizeText(mem) : mem + ' MB';
    var work = 0;
    for (var i = 0; i < n; i++) { work += (st.jobs[i].cpu || 0) * (st.jobs[i].duration || 0); }
    var chips = APRM.machine ? APRM.machine.chipWords(mem) : '';
    return {
      lid: { title: C.get('hero.lid'), val: C.get('hero.lid.val'), sub: 'Layer 5 of 5 · exploded offset ' + EXPLODED_Z.lid + ' px', tag: '' },
      keys: { title: C.get('hero.keys'), val: n ? plural(n, 'job') : C.get('hero.keys.none'), sub: n ? plural(n, 'job') + ' · ' + work + ' core·ticks of work' : C.get('hero.keys.none'), tag: '' },
      cpu: { title: 'CPU · ' + plural(cores, 'core'), val: cores + ' cores', sub: '1 cell = 1 core · 8 × 8 socket, ' + coreCells(cores) + ' of 64 filled', tag: cpuTag(cores) },
      mem: { title: 'Memory · ' + size, val: mem + ' MB', sub: '1 chip = 4096 MB · ' + chips, tag: memTag(mem) },
      base: { title: C.get('hero.base'), val: C.get('hero.base.val'), sub: cores + ' cores and ' + mem + ' MB in total', tag: '' }
    };
  }

  /* ---------- building the drawing ---------- */

  /* A positioned div with classes and a box: [left, top, width, height] in px (any may be null). */
  function box(cls, rect, extra) {
    var el = document.createElement('div');
    el.setAttribute('class', 'lt-abs ' + (cls || ''));
    var s = el.style;
    if (rect) {
      if (rect[0] !== null) { s.left = rect[0] + 'px'; }
      if (rect[1] !== null) { s.top = rect[1] + 'px'; }
      if (rect[2] !== null) { s.width = rect[2] + 'px'; }
      if (rect[3] !== null) { s.height = rect[3] + 'px'; }
    }
    if (extra) { for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) { s[k] = extra[k]; } } }
    return el;
  }

  function anchor(part, x, y) {
    var a = box('lt-anchor', [x, y, 1, 1]);
    a.setAttribute('data-anchor', part);
    return a;
  }

  /* Parts the store changes later are kept here: layers, cells, chips, outlines, the lit screen. */
  var parts = null;

  /* Build every node once (64 cells and 16 chips are pre-made and only toggled). O(1). */
  function build(stage) {
    var p = { layers: {}, cells: [], chips: [], outlines: {}, shakes: {}, hits: {} };
    var hero = box('lt-hero');
    var spot = box('lt-spot');
    var tilt = box('lt-tilt lt-p3');
    var st = box('lt-stage lt-p3', [-200, -136, W, D]);
    hero.appendChild(spot); hero.appendChild(tilt); tilt.appendChild(st);
    p.hero = hero; p.tilt = tilt; p.stage = st;

    /* Bottom case: tray, vents, feet, front and side rims */
    var base = box('lt-layer lt-p3', [0, 0, W, D]);
    var shell = box('lt-metal', [0, 0, W, D], { borderRadius: '12px' });
    shell.appendChild(box('lt-tray', [8, 8, W - 16, D - 16], { borderRadius: '7px' }));
    var vents = box('', [150, 236, 100, 14], { display: 'flex', gap: '3px' });
    for (var v = 0; v < 12; v++) { var vent = document.createElement('div'); vent.setAttribute('class', 'lt-void'); vent.style.flex = '1 1 0'; vent.style.borderRadius = '1px'; vents.appendChild(vent); }
    shell.appendChild(vents);
    [[26, 24], [W - 50, 24], [26, D - 32], [W - 50, D - 32]].forEach(function (f) { shell.appendChild(box('lt-void', [f[0], f[1], 24, 8], { borderRadius: '4px' })); });
    base.appendChild(shell);
    base.appendChild(box('lt-rim', [10, D, 380, 9], { transformOrigin: '50% 0', transform: 'rotateX(90deg)' }));
    base.appendChild(box('lt-side', [0, 10, 9, 252], { transformOrigin: '0 50%', transform: 'rotateY(-90deg)' }));
    base.appendChild(anchor('base', 396, 268));
    p.layers.base = base;

    /* Memory carrier: 16 slots in two rows of 8, a chip in each slot that is filled */
    var mem = box('lt-layer lt-p3', [0, 0, W, D]);
    var memShake = box('lt-p3', [20, 136, 360, 120]);
    var memHit = box('lt-board', [0, 0, 360, 120], { borderRadius: '6px' });
    memHit.setAttribute('data-part', 'mem');
    memShake.appendChild(memHit);
    for (var c = 0; c < 16; c++) {
      var cx = 11.5 + (c % 8) * 43, cy = c < 8 ? 22 : 68;
      memShake.appendChild(box('lt-slot', [cx, cy, 36, 30], { pointerEvents: 'none' }));
      var chip = box('', [cx, cy, 36, 30], { pointerEvents: 'none' });
      chip.appendChild(box('lt-chip-frame', [0, 0, 36, 30]));
      var fill = box('lt-chip-fill', [0, 0, 36, 30]);
      var pinsTop = document.createElement('div'); pinsTop.setAttribute('class', 'lt-pins'); pinsTop.style.top = '2px';
      var pinsBottom = document.createElement('div'); pinsBottom.setAttribute('class', 'lt-pins'); pinsBottom.style.bottom = '2px';
      fill.appendChild(pinsTop); fill.appendChild(pinsBottom);
      chip.appendChild(fill);
      memShake.appendChild(chip);
      p.chips.push({ el: chip, fill: fill });
    }
    var memLine = box('lt-outline', [-6, -6, 372, 132], { borderRadius: '10px' });
    memShake.appendChild(memLine);
    memShake.appendChild(anchor('mem', 358, 118));
    mem.appendChild(memShake);
    p.layers.mem = mem; p.outlines.mem = memLine; p.shakes.mem = memShake; p.hits.mem = memHit;

    /* Logic board with the CPU socket: 64 dashed slots and 64 cells */
    var cpu = box('lt-layer lt-p3', [0, 0, W, D]);
    var cpuShake = box('lt-p3', [12, 12, 376, 248]);
    var cpuHit = box('lt-board lt-p3', [0, 0, 376, 248], { borderRadius: '8px' });
    cpuHit.setAttribute('data-part', 'cpu');
    cpuHit.appendChild(traces());
    cpuHit.appendChild(box('lt-chip', [286, 112, 30, 20], { borderRadius: '2px' }));
    cpuHit.appendChild(box('lt-edge', [324, 114, 10, 6], { borderRadius: '1px' }));
    cpuHit.appendChild(box('lt-edge', [324, 124, 10, 6], { borderRadius: '1px' }));
    cpuHit.appendChild(box('lt-chip', [20, 186, 16, 28], { borderRadius: '2px' }));
    var socket = box('lt-socket lt-p3', [54, 140, 96, 96], { borderRadius: '4px' });
    for (var s = 0; s < 64; s++) { socket.appendChild(box('lt-cell-slot', [8 + (s % 8) * 10, 8 + Math.floor(s / 8) * 10, 8, 8])); }
    for (var k = 0; k < 64; k++) {
      var cell = box('lt-cell', [8 + (k % 8) * 10, 8 + Math.floor(k / 8) * 10, 8, 8]);
      socket.appendChild(cell);
      p.cells.push({ el: cell, x: 8 + (k % 8) * 10, y: 8 + Math.floor(k / 8) * 10 });
    }
    cpuHit.appendChild(socket);
    cpuShake.appendChild(cpuHit);
    var cpuLine = box('lt-outline', [-6, -6, 388, 260], { borderRadius: '12px' });
    cpuShake.appendChild(cpuLine);
    cpuShake.appendChild(anchor('cpu', 374, 246));
    cpu.appendChild(cpuShake);
    p.layers.cpu = cpu; p.outlines.cpu = cpuLine; p.shakes.cpu = cpuShake; p.hits.cpu = cpuHit; p.socket = socket;

    /* Keyboard deck: key bed, trackpad, notch */
    var keys = box('lt-layer', [0, 0, W, D]);
    var deck = box('lt-metal lt-board', [0, 0, W, D], { borderRadius: '12px' });
    deck.setAttribute('data-part', 'keys');
    var bed = box('lt-void', [28, 22, 344, 136], { borderRadius: '6px', padding: '4px', display: 'flex', flexDirection: 'column', gap: '3px', boxSizing: 'border-box' });
    KEY_ROWS.forEach(function (row) {
      var r = document.createElement('div');
      r.style.display = 'flex'; r.style.gap = '3px'; r.style.height = row.h + 'px';
      row.keys.forEach(function (key) {
        var kd = document.createElement('div');
        kd.setAttribute('class', 'lt-key');
        kd.style.flex = key.w + ' 1 0px';
        kd.textContent = key.l;
        r.appendChild(kd);
      });
      bed.appendChild(r);
    });
    deck.appendChild(bed);
    deck.appendChild(box('lt-tray', [116, 168, 168, 92], { borderRadius: '7px' }));
    deck.appendChild(box('lt-rim', [120, 0, 160, 3], { borderRadius: '0 0 2px 2px', borderBottom: '0' }));
    keys.appendChild(deck);
    var keysLine = box('lt-outline', [-6, -6, 412, 284], { borderRadius: '16px' });
    keys.appendChild(keysLine);
    keys.appendChild(anchor('keys', 396, 268));
    p.layers.keys = keys; p.outlines.keys = keysLine; p.hits.keys = deck;

    /* Lid: an outer face and the screen face (turned 180 degrees), both one-sided */
    var lid = box('lt-layer lt-p3', [0, 0, W, D], { transformOrigin: '50% 0' });
    lid.appendChild(box('lt-metal lt-face', [0, 0, W, D], { borderRadius: '12px' }));
    var inner = box('lt-metal lt-face', [0, 0, W, D], { borderRadius: '12px', transform: 'rotateX(180deg)' });
    var screen = box('lt-screen', [9, 9, W - 18, D - 23], { borderRadius: '4px' });
    var lit = document.createElement('div');
    lit.setAttribute('class', 'lt-lit');
    var top = document.createElement('div'); top.setAttribute('class', 'row');
    var a1 = document.createElement('span'); a1.textContent = 'APRM';
    var a2 = document.createElement('span'); a2.textContent = '1 Build · 2 Run · 3 Compare';
    top.appendChild(a1); top.appendChild(a2);
    var mid = document.createElement('div');
    var big = document.createElement('div'); big.setAttribute('class', 'big'); big.textContent = 'Build';
    var small = document.createElement('div'); small.setAttribute('class', 'small'); small.textContent = 'Describe the machine and its jobs';
    mid.appendChild(big); mid.appendChild(small);
    var bars = document.createElement('div'); bars.setAttribute('class', 'bars');
    for (var b = 0; b < 3; b++) { bars.appendChild(document.createElement('span')); }
    lit.appendChild(top); lit.appendChild(mid); lit.appendChild(bars);
    screen.appendChild(lit);
    inner.appendChild(screen);
    lid.appendChild(inner);
    lid.appendChild(anchor('lid', 396, 4));
    p.layers.lid = lid; p.lit = lit;

    ORDER.forEach(function (id) { st.appendChild(p.layers[id]); });
    stage.appendChild(hero);
    return p;
  }

  /* The thin circuit traces on the logic board, as SVG paths. */
  function traces() {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '376'); svg.setAttribute('height', '248');
    svg.setAttribute('class', 'lt-abs');
    var g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'lt-trace'); g.setAttribute('fill', 'none'); g.setAttribute('stroke-width', '1');
    ['M150 152 H226 V40 H340', 'M150 162 H236 V52 H352', 'M150 172 H246 V64 H352', 'M150 204 H256 V214 H344',
      'M150 214 H246 V226 H332', 'M150 224 H236 V238 H320', 'M74 140 V20 H200', 'M88 140 V30 H210',
      'M102 140 V40 H196', 'M54 160 H24', 'M54 176 H24'].forEach(function (d) {
      var path = document.createElementNS(NS, 'path'); path.setAttribute('d', d); g.appendChild(path);
    });
    svg.appendChild(g);
    return svg;
  }

  /* The leader-line layer and the five labels. Labels for linked parts are pointer targets. */
  function buildLabels(col, labelsBox) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'lt-leaders');
    svg.setAttribute('aria-hidden', 'true');
    var lines = {}, dots = {}, labels = {};
    ['lid', 'keys', 'cpu', 'mem', 'base'].forEach(function (id) {
      var path = document.createElementNS(NS, 'path'); svg.appendChild(path); lines[id] = path;
      var dot = document.createElementNS(NS, 'circle'); dot.setAttribute('r', '2'); svg.appendChild(dot); dots[id] = dot;
      var l = document.createElement('div');
      l.setAttribute('class', 'lt-label' + (LINKED[id] ? ' interactive' : ''));
      l.setAttribute('data-label', id);
      var t = document.createElement('div'); t.setAttribute('class', 'label-caps');
      var v = document.createElement('div'); v.setAttribute('class', 'val');
      var tag = document.createElement('div'); tag.setAttribute('class', 'tag'); tag.hidden = true;
      var sub = document.createElement('div'); sub.setAttribute('class', 'sub detail-only');
      l.appendChild(t); l.appendChild(v); l.appendChild(tag); l.appendChild(sub);
      labels[id] = { el: l, title: t, val: v, tag: tag, sub: sub };
      labelsBox.appendChild(l);
    });
    col.insertBefore(svg, labelsBox);
    return { svg: svg, box: labelsBox, lines: lines, dots: dots, labels: labels };
  }

  /* ---------- state and drawing ---------- */

  var view = {
    phase: 'exploded',      /* closed | open | slide | exploded */
    instant: true,          /* no transitions for the next draw (first paint, skip) */
    intro: false,           /* the intro is running */
    panelIn: true,          /* the settings panel is shown */
    hl: null,               /* highlighted part: cpu | mem | keys | null */
    prevCores: 16, prevMem: 32768, cores: 16, mem: 32768,
    flat: false
  };
  var hero = null, labelsUi = null, timers = [], mq = null;

  function reducedMotion() { return !!(mq && mq.matches); }
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function twoFrames(fn) { requestAnimationFrame(function () { requestAnimationFrame(fn); }); }
  function narrow() { return window.innerWidth < 900; }

  /* Set every transform, opacity and transition from `view`. O(64 + 16). */
  function draw() {
    if (!parts || !hero) { return; }
    var rm = reducedMotion(), ph = view.phase, ex = ph === 'exploded', small = narrow();
    var colW = hero.offsetWidth || window.innerWidth;
    var colH = small ? 460 : (hero.offsetHeight || 900);
    var w = window.innerWidth;
    var gap = small ? 0.72 : 1;
    /* Wide: the laptop gets the column minus room for the label column (about 250 px). */
    var sc = Math.max(0.36, Math.min(small ? Math.min(0.6, w / 700) : Math.min(1, (colW - 250) / 560), colH / (small ? 720 : 960)));
    var heroPct = small ? 0.5 : (w < 1360 ? 0.37 : 0.42);
    var shiftX = (ph === 'closed' || ph === 'open') && !small ? (w * 0.5 - colW * heroPct) : 0;
    var shiftY = (ex ? (124 * gap + 112) : (ph === 'closed' ? 0 : 62)) * sc;
    var moving = !view.instant && !rm;

    var h = parts.hero.style;
    h.left = (heroPct * 100) + '%';
    h.transform = 'translate(' + shiftX.toFixed(1) + 'px,' + shiftY.toFixed(1) + 'px) scale(' + sc.toFixed(3) + ')';
    var glide = view.intro ? INTRO.glideMs : 440;
    h.transition = moving ? 'transform ' + glide + 'ms cubic-bezier(0.33,0,0.15,1), opacity 300ms linear' : 'opacity 300ms linear';
    /* Closed and opening, the laptop faces the front; it turns to the three-quarter view as it glides left. */
    var cam = (ph === 'closed' || ph === 'open') ? FRONT : CAMERA;
    parts.stage.style.transform = 'rotateX(' + cam.rx + 'deg) rotateZ(' + cam.rz + 'deg)';
    parts.stage.style.transition = moving && view.intro ? 'transform ' + INTRO.glideMs + 'ms cubic-bezier(0.33,0,0.15,1)' : 'none';

    var hl = view.hl;
    ORDER.forEach(function (id, i) {
      var z = ex ? EXPLODED_Z[id] * gap + (!rm && hl === id ? 18 : 0) : CLOSED_Z[id];
      var t = 'translate3d(0px,0px,' + z.toFixed(1) + 'px)';
      if (id === 'lid') { t += ' rotateX(' + (ph === 'closed' ? 0 : ex ? 100 : 108) + 'deg)'; }
      var tr = 'none';
      if (moving) {
        if (view.intro) {
          /* Top-down stagger: each layer starts after the one above it, so a rising layer never
           * catches up with (and passes through) the layer above while that one is still closed. */
          tr = (id === 'lid' && (ph === 'open' || ph === 'slide')) ? 'transform ' + INTRO.lidMs + 'ms cubic-bezier(0.45,0,0.15,1)' : 'transform ' + INTRO.explodeMs + 'ms ' + EASE_OUT + ' ' + ((ORDER.length - 1 - i) * INTRO.layerGap) + 'ms';
        } else { tr = 'transform 320ms cubic-bezier(0.3,1.15,0.5,1)'; }
      }
      parts.layers[id].style.transform = t;
      parts.layers[id].style.transition = tr;
    });
    for (var o in parts.outlines) { if (Object.prototype.hasOwnProperty.call(parts.outlines, o)) { parts.outlines[o].classList.toggle('on', hl === o); } }
    parts.socket.classList.toggle('lit', hl === 'cpu');
    parts.lit.style.opacity = ph === 'closed' ? '0' : '1';
    parts.lit.style.transition = moving ? 'opacity ' + INTRO.litMs + 'ms linear ' + INTRO.litDelay + 'ms' : 'none';
    if (labelsUi) {
      var lt = view.intro && moving ? 'opacity ' + INTRO.labelsMs + 'ms linear ' + INTRO.labelsDelay + 'ms' : 'opacity 160ms linear';
      labelsUi.svg.style.transition = lt;
      labelsUi.box.style.transition = lt;
    }

    drawCells(moving, rm);
    drawChips(moving, rm);

    hero.setAttribute('data-labels', ex ? 'on' : 'off');
    hero.setAttribute('data-intro-line', (ph === 'closed' || ph === 'open') && view.intro ? 'on' : 'off');
    var panel = byId('build-panel');
    if (panel) { panel.setAttribute('data-panel', view.panelIn ? 'in' : 'out'); }
    var skip = byId('hero-skip'), replay = byId('hero-replay');
    if (skip) { skip.hidden = !view.intro; }
    if (replay) { replay.hidden = view.intro || view.flat; }
    startMeasure(view.intro ? INTRO.explodeMs + 5 * INTRO.layerGap + 200 : 900);
  }

  /* One cell or chip. A piece that is changing gets a transition; once it settles, the transition and
   * the inline opacity are taken off again, so resting pieces need no compositing layers of their own
   * (80 small layers would cost memory and time on every frame of the parallax). O(1). */
  var settleTimer = null;
  function setPiece(el, on, animate, delay) {
    el.style.transition = animate ? 'transform 380ms ' + EASE_OUT + ' ' + delay + 'ms, opacity 220ms linear ' + delay + 'ms' : 'none';
    el.style.opacity = on ? (animate ? '1' : '') : '0';
    if (animate) {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(settlePieces, 1200);     /* after the longest delay (700 ms) plus 380 ms */
    }
  }

  /* When the springs have finished, take the transitions and the opacity off the pieces at rest. */
  function settlePieces() {
    if (!parts) { return; }
    parts.cells.concat(parts.chips).forEach(function (c) {
      c.el.style.transition = 'none';
      if (c.el.style.opacity === '1') { c.el.style.opacity = ''; }
    });
  }

  /* Cores fill the socket in reading order; changed cells spring in (or out) one after another. */
  function drawCells(moving, rm) {
    var n = coreCells(view.cores), pc = coreCells(view.prevCores);
    var lo = Math.min(pc, n), hi = Math.max(pc, n), grow = n > pc, step = Math.min(45, 700 / Math.max(1, hi - lo));
    for (var i = 0; i < 64; i++) {
      var c = parts.cells[i], on = i < n;
      var d = (i >= lo && i < hi) ? Math.round((grow ? i - lo : hi - 1 - i) * step) : 0;
      var z = rm || on ? 0 : 24;
      /* In place: no transform at all (the cell's left and top place it); the lift is used only while a
       * cell is away or arriving, so 64 resting cells do not each become a separate 3D plane. */
      c.el.style.transform = z ? 'translate3d(0px,0px,' + z + 'px)' : 'none';
      setPiece(c.el, on, moving && i >= lo && i < hi, d);
    }
  }

  /* One chip per 4096 MB, the last one filled to the remainder; chips drop in 45 ms apart. */
  function drawChips(moving, rm) {
    var m = memChips(view.mem), pm = memChips(view.prevMem);
    var cnt = m.full + (m.frac > 0 ? 1 : 0), pcnt = pm.full + (pm.frac > 0 ? 1 : 0);
    var lo = Math.min(pcnt, cnt), hi = Math.max(pcnt, cnt), grow = cnt > pcnt;
    for (var i = 0; i < 16; i++) {
      var c = parts.chips[i];
      var f = i < m.full ? 1 : (i === m.full && m.frac > 0 ? m.frac : 0), on = f > 0;
      var d = (i >= lo && i < hi) ? (grow ? i - lo : hi - 1 - i) * 45 : 0;
      c.el.style.transform = rm || on ? 'none' : 'translate3d(0px,0px,30px)';   /* no transform in place, as for cells */
      setPiece(c.el, on, moving && i >= lo && i < hi, d);
      c.fill.style.transform = on && f < 1 ? 'scaleX(' + f.toFixed(3) + ')' : 'none';   /* part-filled chip */
      c.fill.style.transition = moving ? 'transform 300ms ' + EASE_OUT : 'none';
    }
  }

  /* Fill the labels from the state, and mark the highlighted one. O(jobs). */
  function drawLabels(st) {
    if (!labelsUi) { return; }
    var texts = labelTexts(st);
    for (var id in labelsUi.labels) {
      if (!Object.prototype.hasOwnProperty.call(labelsUi.labels, id)) { continue; }
      var L = labelsUi.labels[id], t = texts[id];
      L.title.textContent = t.title;
      L.val.textContent = t.val;
      L.sub.textContent = t.sub;
      L.tag.textContent = t.tag;
      L.tag.hidden = !t.tag;
      L.el.classList.toggle('on', view.hl === id && !!LINKED[id]);
    }
    startMeasure(800);
  }

  /* ---------- leader lines ---------- */

  var measureUntil = 0, measureFrame = null;

  /* Re-measure every frame for `ms` milliseconds (while transitions run), then stop. */
  function startMeasure(ms) {
    measureUntil = Math.max(measureUntil, Date.now() + ms);
    if (measureFrame !== null) { return; }
    var loop = function () {
      measureFrame = null;
      try { measure(); } catch (e) { /* a layout read failed: try again next change */ }
      if (Date.now() < measureUntil) { measureFrame = requestAnimationFrame(loop); }
    };
    measureFrame = requestAnimationFrame(loop);
  }

  /* Put each label in one column right of the laptop, pushed down to avoid overlaps, and draw its
   * line from the part's front-right corner. Skipped on narrow screens (labels become a list). O(5 log 5). */
  function measure() {
    if (!hero || !labelsUi || narrow() || view.flat || !hero.offsetWidth) { return; }
    var cr = hero.getBoundingClientRect();
    var pts = [];
    var ids = ['lid', 'keys', 'cpu', 'mem', 'base'];
    for (var i = 0; i < ids.length; i++) {
      var a = parts.stage.querySelector('[data-anchor="' + ids[i] + '"]');
      if (!a) { return; }
      var r = a.getBoundingClientRect();
      pts.push({ id: ids[i], x: r.left - cr.left, y: r.top - cr.top, h: labelsUi.labels[ids[i]].el.offsetHeight });
    }
    var lx = -Infinity;
    pts.forEach(function (p) { lx = Math.max(lx, p.x); });
    var widest = 0;
    ids.forEach(function (id) { widest = Math.max(widest, labelsUi.labels[id].el.offsetWidth); });
    /* 56 px clears the deck corner beyond the anchor; the column stays inside the hero by the real label width. */
    lx = Math.min(lx + 56, hero.offsetWidth - widest - 16);
    var sorted = pts.slice().sort(function (p, q) { return p.y - q.y; });
    var prev = -1e9;
    sorted.forEach(function (p) { var ty = p.y - 14; if (ty < prev + 10) { ty = prev + 10; } p.ty = ty; prev = ty + p.h; });
    pts.forEach(function (p) {
      labelsUi.labels[p.id].el.style.transform = 'translate(' + lx.toFixed(1) + 'px,' + p.ty.toFixed(1) + 'px)';
      var ly = p.ty + 14;
      labelsUi.lines[p.id].setAttribute('d', 'M' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ' L' + (lx - 14).toFixed(1) + ' ' + ly.toFixed(1) + ' L' + (lx - 2).toFixed(1) + ' ' + ly.toFixed(1));
      labelsUi.dots[p.id].setAttribute('cx', p.x.toFixed(1));
      labelsUi.dots[p.id].setAttribute('cy', p.y.toFixed(1));
    });
  }

  /* ---------- the intro ---------- */

  /* Play the intro (timings in INTRO): closed, the lid opens, the laptop glides left, the layers
   * separate, then the labels and the settings fade in. Reduced motion: a 300 ms cross-fade instead. */
  function runIntro() {
    clearTimers();
    try { window.sessionStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* storage blocked: the intro may play again */ }
    if (parts) { parts.tilt.style.transform = ''; }
    if (reducedMotion()) {
      view.phase = 'exploded'; view.instant = true; view.panelIn = false; view.intro = true;
      parts.hero.style.opacity = '0';
      draw();
      twoFrames(function () { view.instant = false; view.panelIn = true; parts.hero.style.opacity = '1'; draw(); });
      later(function () { view.intro = false; draw(); }, 400);
      return;
    }
    view.phase = 'closed'; view.instant = true; view.panelIn = false; view.intro = true;
    draw();
    twoFrames(function () {
      view.instant = false;
      later(function () { view.phase = 'open'; draw(); }, INTRO.open);
      later(function () { view.phase = 'slide'; draw(); }, INTRO.slide);
      later(function () { view.phase = 'exploded'; draw(); }, INTRO.explode);
      later(function () { view.panelIn = true; draw(); }, INTRO.panel);
      later(function () { view.intro = false; draw(); }, INTRO.done);
    });
  }

  /* Jump to the end of the intro without transitions. */
  function skip() {
    clearTimers();
    view.phase = 'exploded'; view.instant = true; view.panelIn = true; view.intro = false;
    if (parts) { parts.hero.style.opacity = '1'; }
    draw();
    twoFrames(function () { view.instant = false; draw(); });
  }

  /* ---------- linking parts and settings ---------- */

  /* Highlight a part and its setting card (or none). */
  function setHl(id) {
    if (view.hl === id) { return; }
    view.hl = id;
    ['cpu', 'mem', 'keys'].forEach(function (k) {
      var card = byId('setting-' + k);
      if (card) { card.classList.toggle('is-hl', id === k); }
    });
    draw();
    drawLabels(APRM.store.get());
  }

  /* Scroll to a part's setting and put the cursor in its first field. */
  function focusSetting(id) {
    var card = byId('setting-' + id);
    if (!card) { return; }
    if (card.scrollIntoView) { card.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' }); }
    var f = card.querySelector('[data-focus]');
    if (f && f.focus) { f.focus({ preventScroll: true }); }
    setHl(id);
  }

  /* A refused value: the part shakes once and keeps the last good picture. */
  function shake(part) {
    if (!parts || reducedMotion()) { return; }
    var el = parts.shakes[part] || (part === 'keys' ? parts.layers.keys : null);
    if (el && el.animate) {
      el.animate([{ transform: 'translateX(0px)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(4px)' },
        { transform: 'translateX(-2px)' }, { transform: 'translateX(0px)' }], { duration: 320, easing: 'cubic-bezier(0.3,0,0.3,1)' });
    }
  }

  function wireLinks() {
    ['cpu', 'mem', 'keys'].forEach(function (id) {
      var hit = parts && parts.hits[id];
      if (hit) {
        hit.addEventListener('pointerenter', function () { setHl(id); });
        hit.addEventListener('pointerleave', function () { setHl(null); });
        hit.addEventListener('click', function () { focusSetting(id); });
      }
      var L = labelsUi.labels[id].el;
      L.addEventListener('pointerenter', function () { setHl(id); });
      L.addEventListener('pointerleave', function () { setHl(null); });
      L.addEventListener('click', function () { focusSetting(id); });
      var card = byId('setting-' + id);
      if (card) {
        card.addEventListener('pointerenter', function () { setHl(id); });
        card.addEventListener('pointerleave', function () { setHl(null); });
        card.addEventListener('focusin', function () { setHl(id); });
        card.addEventListener('focusout', function () { setHl(null); });
      }
    });
    /* Pointer parallax: at most 2.5 degrees up or down and 3 degrees sideways. */
    hero.addEventListener('pointermove', function (ev) {
      if (view.phase !== 'exploded' || reducedMotion() || narrow() || view.flat) { return; }
      var r = hero.getBoundingClientRect();
      var nx = ((ev.clientX - r.left) / r.width - 0.5) * 2, ny = ((ev.clientY - r.top) / r.height - 0.5) * 2;
      parts.tilt.style.transform = 'rotateX(' + (-ny * 2.5).toFixed(2) + 'deg) rotateY(' + (nx * 3).toFixed(2) + 'deg)';
      startMeasure(700);
    });
    hero.addEventListener('pointerleave', function () { parts.tilt.style.transform = ''; startMeasure(700); });
  }

  /* ---------- mounting ---------- */

  var mounted = false;

  /* True in a real browser with 3D transforms. */
  function supports3d() {
    return typeof CSS === 'undefined' || !CSS.supports || CSS.supports('transform-style', 'preserve-3d');
  }

  /* Build the drawing and connect it to the store. Does nothing without a real DOM (the Node tests). */
  function mount() {
    if (mounted) { return; }
    var stage = byId('laptop-stage');
    hero = byId('build-hero');
    var labelsBox = byId('hero-labels');
    if (!stage || !hero || !labelsBox || !stage.style || typeof document.querySelector !== 'function' ||
        typeof window.requestAnimationFrame !== 'function' || typeof document.createElementNS !== 'function') { return; }
    mounted = true;
    try { mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null; } catch (e) { mq = null; }
    view.flat = !supports3d();
    hero.classList.toggle('flat', view.flat);
    var st0 = APRM.store.get();
    view.cores = view.prevCores = st0.machine.cpu;
    view.mem = view.prevMem = st0.machine.mem;
    parts = build(stage);
    labelsUi = buildLabels(hero, labelsBox);
    wireLinks();
    var skipBtn = byId('hero-skip'), replayBtn = byId('hero-replay');
    if (skipBtn) { skipBtn.addEventListener('click', skip); }
    if (replayBtn) { replayBtn.addEventListener('click', runIntro); }

    APRM.store.subscribe(function (st, changed) {
      if (changed === 'machine') {
        view.prevCores = view.cores; view.prevMem = view.mem;
        view.cores = st.machine.cpu; view.mem = st.machine.mem;
        draw();
      }
      if (changed === 'mode' && st.mode === 'build') { draw(); }
      if (changed === 'machine' || changed === 'jobs' || changed === 'details' || changed === 'mode') { drawLabels(st); }
    });
    var resizing = null;
    window.addEventListener('resize', function () {
      if (resizing !== null) { return; }
      resizing = requestAnimationFrame(function () { resizing = null; view.instant = true; draw(); twoFrames(function () { view.instant = false; }); });
    });
    if (document.fonts && document.fonts.ready) { document.fonts.ready.then(function () { startMeasure(300); }); }

    drawLabels(st0);
    var seen = false;
    try { seen = window.sessionStorage.getItem(SEEN_KEY) === '1'; } catch (e) { seen = true; }
    if (!seen && !view.flat && st0.mode === 'build') { runIntro(); }
    else { draw(); twoFrames(function () { view.instant = false; }); }
  }

  APRM.laptop = {
    INTRO: INTRO,
    FRONT: FRONT,
    CAMERA: CAMERA,
    coreCells: coreCells,
    memChips: memChips,
    cpuTag: cpuTag,
    memTag: memTag,
    labelTexts: labelTexts,
    shake: shake,
    replay: function () { if (mounted) { runIntro(); } },
    skip: function () { if (mounted) { skip(); } },
    mount: mount
  };
})();
