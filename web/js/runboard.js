/* runboard.js: the Run page's analysis views fed by player.js frames (K-51).
 *
 * Idea: player.js owns the engine and calls every registered view with a frame (see player.js).
 * This file draws the waiting tray, the board canvas, the Why log, the machine lines, the saved spot
 * and the metrics from that frame, and turns clicks on them into a selection. It only reads what the
 * engine reported; it never decides which job runs.
 *
 * Classic script: attaches APRM.runboard only. mount() registers the view with APRM.player.
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});

  var TRAY_ROWS = 40;      /* cards on the page; the count above always gives the true number */
  var METRIC_KEYS = ['avg_wait', 'max_wait', 'avg_turnaround', 'weighted_completion', 'makespan', 'util_cpu', 'util_mem'];

  function byId(id) { return document.getElementById(id); }
  function clear(el) { while (el.firstChild) { el.removeChild(el.firstChild); } }
  function text(id, value) { var el = byId(id); if (el) { el.textContent = value; } }
  function detailsOn() { return !!(APRM.store && APRM.store.get().details); }

  function copyText(key, fallback, vars) {
    var C = APRM.copy;
    if (!C || !C.has(key)) { return fallback; }
    return vars ? C.fill(key, vars) : C.get(key);
  }

  /* A metric value as text. The clean view rounds to three decimals; Show details prints the
   * engine's number unchanged. null means the engine has no value yet. O(1). */
  function metricText(v) {
    if (v === null || v === undefined) { return copyText('metric.none', 'n/a (no finished job yet)'); }
    if (typeof v === 'number' && Math.floor(v) !== v && !detailsOn()) { return v.toFixed(3); }
    return String(v);
  }

  function drawMetrics(f) {
    var list = byId('metrics-list');
    var empty = byId('metrics-empty');
    if (!list) { return; }
    clear(list);
    if (!f.state || !f.metrics || f.state.done === 0) { if (empty) { empty.hidden = false; } return; }
    if (empty) { empty.hidden = true; }
    for (var i = 0; i < METRIC_KEYS.length; i++) {
      var li = document.createElement('li');
      li.textContent = copyText('metric.' + METRIC_KEYS[i], METRIC_KEYS[i]) + ': ' + metricText(f.metrics[METRIC_KEYS[i]]);
      list.appendChild(li);
    }
    var byPri = f.metrics.avg_wait_by_priority;
    if (Array.isArray(byPri)) {
      var parts = [];
      for (var q = 0; q < byPri.length; q++) { if (byPri[q] !== null && byPri[q] !== undefined) { parts.push(q + ': ' + metricText(byPri[q])); } }
      if (parts.length > 0) {
        var row = document.createElement('li');
        row.textContent = copyText('metric.by_priority', 'Average wait by priority') + ' (' + parts.join(', ') + ')';
        list.appendChild(row);
      }
    }
  }

  /* The machine in numbers, from the view: used = capacity minus free. */
  function drawResources(f) {
    var st = f.state;
    var line = function (textId, key, unitKey) {
      if (!st) { text(textId, copyText('run.res.none', '')); return; }
      var cap = st.cap[key], free = st.free[key];
      text(textId, copyText(unitKey, (cap - free) + ' of ' + cap + ', ' + free + ' free', { used: cap - free, cap: cap, free: free }));
    };
    line('res-cpu-text', 'cpu', 'run.res.cpu.text');
    line('res-mem-text', 'mem', 'run.res.mem.text');
    var card = byId('reserve-card');
    if (card) {
      var r = st ? st.reservation : null;
      card.hidden = !r;
      card.textContent = r ? copyText('run.reserve', 'Job ' + r.id + ' is reserved.', { id: r.id, t: r.shadow_time }) : '';
    }
  }

  function magnet(id, priority) {
    var pal = APRM.canvas.paletteIndex(id);
    var size = priority >= 7 ? 'l' : priority >= 4 ? 'm' : 's';
    var m = document.createElement('span');
    m.setAttribute('class', 'magnet magnet-' + pal + ' hatch-' + (((id % 3) + 3) % 3) + ' magnet-size-' + size);
    m.setAttribute('aria-hidden', 'true');
    var b = document.createElement('b');
    b.textContent = String(id);
    m.appendChild(b);
    return m;
  }

  var lastTraySig = '';

  /* The tray: waiting jobs in the order the engine reports, with its score when it gives one. */
  function drawTray(f) {
    var list = byId('tray-list');
    if (!list) { return; }
    var w = f.state ? f.state.waiting : [];
    var saved = f.state && f.state.reservation ? f.state.reservation.id : null;
    var sig = f.selected + '|' + saved + '|' + w.length;
    for (var s = 0; s < w.length && s < TRAY_ROWS; s++) { sig += ',' + w[s].id + ':' + w[s].score; }
    if (sig === lastTraySig) { return; }
    lastTraySig = sig;
    var keep = APRM.keys ? APRM.keys.focusedJob(list) : null;
    clear(list);
    text('tray-count', '(' + w.length + ')');
    var empty = byId('tray-empty');
    if (empty) { empty.hidden = w.length > 0; }
    var shown = Math.min(w.length, TRAY_ROWS);
    for (var i = 0; i < shown; i++) {
      var j = w[i];
      var li = document.createElement('li');
      li.setAttribute('data-job', String(j.id));
      li.setAttribute('class', 'tray-card' + (f.selected === j.id ? ' selected' : ''));
      li.setAttribute('tabindex', i === 0 ? '0' : '-1');
      li.setAttribute('role', 'button');
      li.setAttribute('aria-pressed', f.selected === j.id ? 'true' : 'false');
      li.appendChild(magnet(j.id, j.priority));
      var body = document.createElement('span');
      body.setAttribute('class', 'tray-body');
      var head = document.createElement('span');
      head.setAttribute('class', 'tray-head');
      head.textContent = 'Job ' + j.id;
      body.appendChild(head);
      if (saved === j.id || i === 0) {
        var stamp = document.createElement('span');
        stamp.setAttribute('class', 'stamp' + (saved === j.id ? ' stamp-saved' : ''));
        stamp.textContent = saved === j.id ? copyText('run.tray.saved', 'Spot saved') : copyText('run.tray.next', 'Next');
        body.appendChild(stamp);
      }
      var meta = document.createElement('span');
      meta.setAttribute('class', 'tray-meta');
      var words = copyText('run.tray.needs', 'priority ' + j.priority, { p: j.priority, c: j.cpu, cores: j.cpu === 1 ? 'core' : 'cores', m: j.mem });
      if (typeof j.score === 'number') { words += ', ' + copyText('run.tray.score', 'score ' + APRM.runmodel.scoreText(j.score), { s: APRM.runmodel.scoreText(j.score) }); }
      meta.textContent = words;
      body.appendChild(meta);
      li.appendChild(body);
      list.appendChild(li);
    }
    if (APRM.keys) { APRM.keys.refocus(list, keep); }
    var more = byId('tray-more');
    if (more) {
      more.hidden = w.length <= shown;
      more.textContent = copyText('run.tray.more', 'and ' + (w.length - shown) + ' more', { n: w.length - shown });
    }
  }

  function drawCanvas(f) {
    var canvasEl = byId('run-canvas');
    var empty = byId('canvas-empty');
    if (!canvasEl) { return; }
    var painted = f.state !== null && APRM.canvas.draw(canvasEl, { state: f.state, jobs: f.jobs, bars: APRM.runmodel.bars(f.hist), selected: f.selected, events: f.events, hold: {} });
    canvasEl.hidden = !painted;
    if (empty) { empty.hidden = f.state !== null && painted; }
  }

  function highlightJobList(f) {
    var list = byId('job-list');
    if (!list) { return; }
    var kids = list.children || [];
    for (var i = 0; i < kids.length; i++) {
      var on = f.selected !== null && String(kids[i].textContent).indexOf('Job ' + f.selected + ':') === 0;
      kids[i].setAttribute('class', on ? 'sel' : '');
    }
  }

  /* The view player.js calls after every change. */
  function draw(f, why) {
    if (why === 'reset' || why === 'start') { lastTraySig = ''; if (APRM.whylog) { APRM.whylog.forget(); } }
    drawTray(f);
    drawCanvas(f);
    if (APRM.whylog) { APRM.whylog.render(f.entries, f.selected); }
    drawMetrics(f);
    drawResources(f);
    highlightJobList(f);
  }

  var mounted = false;

  /* Register with the player and connect the clicks. Missing elements are skipped. */
  function mount() {
    if (mounted || !APRM.player) { return; }
    mounted = true;
    var P = APRM.player;
    var sel = function (id) { var cur = P.snapshot().selected; P.select(id === cur ? null : id); };
    var cv = byId('run-canvas');
    if (cv) {
      cv.addEventListener('click', function (ev) {
        var r = typeof cv.getBoundingClientRect === 'function' ? cv.getBoundingClientRect() : { left: 0, top: 0 };
        sel(APRM.canvas.hit(cv, ev.clientX - r.left, ev.clientY - r.top));
      });
    }
    var tray = byId('tray-list');
    if (tray) {
      tray.addEventListener('click', function (ev) {
        var t = ev.target;
        while (t && t !== tray && !(t.getAttribute && t.getAttribute('data-job'))) { t = t.parentNode; }
        var id = t && t !== tray && t.getAttribute ? t.getAttribute('data-job') : null;
        if (id !== null && id !== undefined) { sel(Number(id)); }
      });
      if (APRM.keys) { APRM.keys.rovingList(tray, sel); }
    }
    var jl = byId('job-list');
    if (jl) {
      jl.addEventListener('click', function (ev) {
        var m = /^Job (\d+):/.exec(ev.target && ev.target.textContent ? String(ev.target.textContent) : '');
        if (m) { P.select(Number(m[1])); }
      });
    }
    P.addView(draw);
    draw(P.frame(), 'reset');
  }

  APRM.runboard = { mount: mount, metricText: metricText, draw: draw };
})();
