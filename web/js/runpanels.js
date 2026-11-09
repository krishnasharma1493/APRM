/* runpanels.js: the readable analysis under the Run laptop (K-54).
 *
 * Idea: everything the laptop shows, as text a screen reader and a viva examiner can read: machine
 * use with exact numbers, the saved spot, the waiting jobs in the engine's order (with score and,
 * with Show details, the sort key), the running jobs, the Why log and "How it went" (every metric of
 * the engine's metrics JSON, including the average wait by priority). Every number is the engine's;
 * the clean view only rounds (to three decimals, or a percent), Show details prints the engine's
 * value unchanged. A row selects its job in every view (Enter or click; arrow keys move).
 *
 * Classic script: attaches APRM.runpanels only. mount() registers the view with APRM.player.
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});

  var ROWS_MAX = 100;   /* table rows on the page; the heading always gives the true count */
  var AGING = { aging: true, aging_reserve: true };

  function byId(id) { return document.getElementById(id); }
  function clear(el) { while (el.firstChild) { el.removeChild(el.firstChild); } }
  function setText(id, t) { var e = byId(id); if (e && e.textContent !== String(t)) { e.textContent = String(t); } }
  function detailsOn() { return !!(APRM.store && APRM.store.get().details); }
  function copyText(key, fallback, vars) {
    var C = APRM.copy;
    if (!C || !C.has(key)) { return fallback; }
    return vars ? C.fill(key, vars) : C.get(key);
  }

  /* ---------- numbers as text ---------- */

  /* A number with at most three decimals, trailing zeros dropped (13.083, 19.25, 6). O(1). */
  function short(v) {
    var s = (Math.round(v * 1000) / 1000).toFixed(3);
    return s.replace(/\.?0+$/, '');
  }

  /* Rounded the design's way: r1 to one decimal, r2 to two, trailing zeros dropped (7.2, 8, 4.67). O(1). */
  function r1(v) { return String(Math.round(v * 10) / 10); }
  function r2(v) { return String(Math.round(v * 100) / 100); }

  /* A metric for people: null says why there is no value; the clean view rounds as the design shows
   * it (one decimal, a percent for a share); Show details prints the engine's number unchanged, so
   * it can be checked against the metrics JSON. kind: 'ticks' | 'plain' | 'share'. O(1). */
  function metricText(v, kind) {
    if (v === null || v === undefined) { return copyText('metric.none', 'no value yet'); }
    if (detailsOn()) { return String(v) + (kind === 'ticks' ? ' ' + copyText('unit.ticks', 'ticks') : ''); }   /* the engine's exact value (D87) */
    if (kind === 'share') { return r1(v * 100) + '%'; }
    return kind === 'ticks' ? r1(v) + ' ' + copyText('unit.ticks', 'ticks') : r1(v);
  }

  /* The key the waiting jobs are listed by, written as the design writes it (the policy's own
   * comparison, earlier arrival and lower id break ties). Aging shows the score the engine's
   * integer key K = 1000 x priority - alpha_milli x arrival orders by. O(1). */
  function sortKey(policy, alphaMilli, j) {
    switch (policy) {
      case 'fcfs': return copyText('key.fcfs', '', { a: j.arrival, id: j.id });
      case 'priority': return copyText('key.priority', '', { p: j.priority, a: j.arrival, id: j.id });
      case 'sjf': return copyText('key.sjf', '', { d: j.duration, a: j.arrival, id: j.id });
      case 'aging':
      case 'aging_reserve': return copyText('key.aging', '', { s: j.score === null || j.score === undefined ? '' : r2(j.score), a: j.arrival });
      default: return copyText('key.knapsack', '');
    }
  }

  var METRICS = [
    ['avg_wait', 'ticks', 'how.avg_wait'], ['max_wait', 'ticks', 'how.max_wait'], ['avg_turnaround', 'ticks', 'how.avg_turnaround'],
    ['weighted_completion', 'plain', 'how.weighted_completion'], ['makespan', 'ticks', 'how.makespan'],
    ['util_cpu', 'share', 'how.util_cpu'], ['util_mem', 'share', 'how.util_mem']
  ];

  /* ---------- drawing ---------- */

  function drawMachine(f) {
    var st = f.state, cap = st ? st.cap : f.cap;
    var line = function (key, textId, barId, unitKey) {
      var c = cap[key], free = st ? st.free[key] : c, used = c - free;
      setText(textId, copyText(unitKey, used + ' of ' + c, { used: used, cap: c, free: free }));
      var bar = byId(barId);
      if (bar && bar.style) { bar.style.transform = 'scaleX(' + (c > 0 ? used / c : 0).toFixed(4) + ')'; }
    };
    line('cpu', 'res-cpu-text', 'res-cpu-bar', 'run.res.cpu.text');
    line('mem', 'res-mem-text', 'res-mem-bar', 'run.res.mem.text');
    setText('machine-tick', copyText('run.machine.tick', '', { t: st ? st.now : 0 }));
    var card = byId('reserve-card');
    var r = st ? st.reservation : null;
    if (card) { card.hidden = !r; }
    var top = byId('an-top');
    if (top) { top.setAttribute('data-two', r ? 'on' : 'off'); }
    if (r) {
      /* the design's "held" amounts: what the saved job needs, up to what is free now (engine numbers) */
      var rj = null;
      for (var i = 0; i < st.waiting.length; i++) { if (st.waiting[i].id === r.id) { rj = st.waiting[i]; } }
      var hc = rj ? Math.min(rj.cpu, st.free.cpu) : 0, hm = rj ? Math.min(rj.mem, st.free.mem) : 0;
      setText('reserve-line', copyText('run.reserve', '', { id: r.id, t: r.shadow_time, c: hc, m: hm }));
      setText('reserve-note', copyText('run.reserve.note', '', { id: r.id, t: r.shadow_time }));
    }
  }

  /* One table row that selects its job; the first row is the one Tab stop of the table. */
  function row(id, cells, selected, first, jobCol) {
    var tr = document.createElement('tr');
    tr.setAttribute('data-job', String(id));
    tr.setAttribute('tabindex', first ? '0' : '-1');
    if (selected) { tr.setAttribute('aria-current', 'true'); tr.setAttribute('class', 'sel'); }
    for (var i = 0; i < cells.length; i++) {
      var td = document.createElement(i === jobCol ? 'th' : 'td');
      if (i === jobCol) { td.setAttribute('scope', 'row'); }
      var c = cells[i];
      if (c && typeof c === 'object') {
        td.textContent = c.t;
        if (c.tag) { var s = document.createElement('span'); s.setAttribute('class', 'row-tag'); s.textContent = c.tag; td.appendChild(s); }
        if (c.cls) { td.setAttribute('class', c.cls); }
      } else { td.textContent = String(c); }
      tr.appendChild(td);
    }
    return tr;
  }

  var lastWait = '', lastRun = '';

  function drawWaiting(f) {
    var st = f.state;
    var w = st ? st.waiting : [];
    var aging = !!AGING[f.policy], det = detailsOn();
    setText('wait-title', copyText('run.wait.title', 'Waiting', { n: w.length }));
    var sig = f.events + '|' + f.selected + '|' + det + '|' + f.policy + '|' + w.length + '|' + (st ? st.now : -1) + '|' + (st && st.reservation ? st.reservation.id : '');
    if (sig === lastWait) { return; }
    lastWait = sig;
    var table = byId('wait-table');
    if (table && table.setAttribute) { table.setAttribute('data-details', det ? 'on' : 'off'); table.setAttribute('data-score', aging ? 'on' : 'off'); }
    var head = byId('wait-head');
    if (head) {
      clear(head);
      var cols = ['run.col.order', 'run.col.job', 'run.col.priority'];
      if (aging) { cols.push('run.col.score'); }
      if (det) { cols.push('run.col.key'); }
      cols.forEach(function (k) { var th = document.createElement('th'); th.setAttribute('scope', 'col'); th.textContent = copyText(k, k); head.appendChild(th); });
    }
    var body = byId('wait-body');
    if (!body) { return; }
    var keep = APRM.keys ? APRM.keys.focusedJob(body) : null;
    clear(body);
    var n = Math.min(w.length, ROWS_MAX);
    for (var i = 0; i < n; i++) {
      var j = w[i];
      var saved = !!(st.reservation && st.reservation.id === j.id);
      var cells = [i + 1, { t: copyText('stage.job', 'Job ' + j.id, { id: j.id }), tag: saved ? copyText('run.tag.saved', 'spot saved') : '' }, j.priority];
      if (aging) { cells.push({ t: j.score === null || j.score === undefined ? '' : r2(j.score), cls: 'num amber' }); }
      if (det) { cells.push({ t: sortKey(f.policy, f.settings.alphaMilli, j), cls: 'muted' }); }
      body.appendChild(row(j.id, cells, f.selected === j.id, i === 0, 1));
    }
    if (APRM.keys) { APRM.keys.refocus(body, keep); }
    var wt = byId('wait-table');
    if (wt && wt.parentNode && wt.parentNode.hidden !== undefined) { wt.parentNode.hidden = w.length === 0; }
    var empty = byId('wait-empty');
    if (empty) { empty.hidden = w.length > 0; empty.textContent = st ? copyText('run.wait.empty', 'No jobs waiting.') : copyText('run.wait.before', 'Nothing to show yet. Press Run.'); }
    var more = byId('wait-more');
    if (more) { more.hidden = w.length <= ROWS_MAX; more.textContent = copyText('run.rows.more', '', { n: ROWS_MAX, total: w.length }); }
  }

  function drawRunning(f) {
    var st = f.state;
    var r = st ? st.running : [];
    setText('running-title', copyText('run.running.title', 'Running', { n: r.length }));
    var sig = f.events + '|' + f.selected + '|' + r.length + '|' + (st ? st.now : -1);
    if (sig === lastRun) { return; }
    lastRun = sig;
    var body = byId('running-body');
    if (!body) { return; }
    var keep = APRM.keys ? APRM.keys.focusedJob(body) : null;
    clear(body);
    var n = Math.min(r.length, ROWS_MAX);
    for (var i = 0; i < n; i++) {
      var x = r[i];
      body.appendChild(row(x.id, [{ t: copyText('stage.job', 'Job ' + x.id, { id: x.id }), tag: st.squeezed[x.id] ? copyText('run.tag.squeezed', 'squeezed in') : '' },
        x.start, x.finish, x.cpu, x.mem], f.selected === x.id, i === 0, 0));
    }
    if (APRM.keys) { APRM.keys.refocus(body, keep); }
    var rt = byId('running-table');
    if (rt && rt.parentNode && rt.parentNode.hidden !== undefined) { rt.parentNode.hidden = r.length === 0; }
    var empty = byId('running-empty');
    if (empty) { empty.hidden = r.length > 0; empty.textContent = copyText('run.running.empty', 'Nothing running.'); }
    var more = byId('running-more');
    if (more) { more.hidden = r.length <= ROWS_MAX; more.textContent = copyText('run.rows.more', '', { n: ROWS_MAX, total: r.length }); }
  }

  function drawMetrics(f) {
    var list = byId('metrics-list'), empty = byId('metrics-empty'), prioBox = byId('prio-box'), prio = byId('prio-list');
    if (!list) { return; }
    clear(list);
    var m = f.metrics, st = f.state;
    var have = !!(st && m && st.done > 0);
    if (empty) {
      empty.hidden = have;
      empty.textContent = st ? copyText('run.metrics.first', 'Shown once the first job finishes.') : copyText('run.metrics.empty', 'Numbers appear once some jobs have finished.');
    }
    if (prioBox) { prioBox.hidden = !have; }
    var note = byId('metrics-note');
    if (note) {
      var all = have && st.done >= st.total;
      note.textContent = !have ? '' : all ? copyText('run.metrics.all', 'All jobs finished') : copyText('run.metrics.sofar', '', { n: st.done, total: st.total });
      note.setAttribute('data-all', all ? 'on' : 'off');
    }
    if (!have) { if (prio) { clear(prio); } return; }
    for (var i = 0; i < METRICS.length; i++) {
      var key = METRICS[i][0];
      var li = document.createElement('li');
      li.setAttribute('data-metric', key);
      var label = document.createElement('span');
      label.setAttribute('class', 'tile-label');
      label.textContent = copyText('metric.' + key, key);
      var value = document.createElement('span');
      value.setAttribute('class', 'tile-value');
      var v = metricText(m[key], METRICS[i][1]);
      if (key === 'makespan' && st.done < st.total) { v = copyText('run.metric.sofar', v); }
      value.textContent = v;
      li.appendChild(label);
      li.appendChild(value);
      var how = document.createElement('span');
      how.setAttribute('class', 'tile-how detail-only');
      how.textContent = copyText(METRICS[i][2], '', { cpu: st.cap.cpu, mem: st.cap.mem, span: st.done >= st.total && typeof m.makespan === 'number' ? m.makespan : st.now });
      li.appendChild(how);
      list.appendChild(li);
    }
    if (prio) {
      clear(prio);
      var by = Array.isArray(m.avg_wait_by_priority) ? m.avg_wait_by_priority : [];
      for (var p = 0; p < 10; p++) {
        var t = document.createElement('li');
        var a = document.createElement('span'); a.setAttribute('class', 'tile-label'); a.textContent = 'P' + p;
        var b = document.createElement('span'); b.setAttribute('class', 'tile-value');
        b.textContent = by[p] === null || by[p] === undefined ? copyText('run.prio.none', '—') : (detailsOn() ? String(by[p]) : r1(by[p]));
        t.appendChild(a); t.appendChild(b);
        prio.appendChild(t);
      }
    }
  }

  /* The view player.js calls after every change. */
  function draw(f, why) {
    if (why === 'reset' || why === 'start') { lastWait = ''; lastRun = ''; if (APRM.whylog) { APRM.whylog.forget(); } }
    if (why === 'details') { lastWait = ''; if (APRM.whylog) { APRM.whylog.forget(); } }
    drawMachine(f);
    drawWaiting(f);
    drawRunning(f);
    if (APRM.whylog) { APRM.whylog.render(f.entries, f.selected); }
    drawMetrics(f);
  }

  var mounted = false;

  /* Register with the player; rows select their job by click or Enter, arrow keys move. */
  function mount() {
    if (mounted || !APRM.player) { return; }
    mounted = true;
    var P = APRM.player;
    var pick = function (id) { P.select(P.snapshot().selected === id ? null : id); };
    ['wait-body', 'running-body'].forEach(function (id) {
      var body = byId(id);
      if (!body) { return; }
      body.addEventListener('click', function (ev) {
        var t = ev.target;
        while (t && t !== body && !(t.getAttribute && t.getAttribute('data-job'))) { t = t.parentNode; }
        if (t && t !== body && t.getAttribute) { pick(Number(t.getAttribute('data-job'))); }
      });
      if (APRM.keys) { APRM.keys.rovingList(body, pick); }
    });
    P.addView(draw);
    draw(P.frame(), 'reset');
  }

  APRM.runpanels = { mount: mount, metricText: metricText, sortKey: sortKey, short: short, r1: r1, r2: r2, draw: draw };
})();
