/* compare.js: Compare mode (PRD section 7, K-27).
 *
 * Idea: the same C engine runs once per ticked scheduler, on exactly the same
 * jobs and machine. Differences between the columns come only from the policy.
 * This file never decides which job runs: it calls only the APRM.wasm wrapper
 * (create, addJob, step, results, metrics, destroy) and draws the answers.
 *
 * Steps of one comparison:
 *   1. create one engine handle per ticked policy and add the same jobs to each;
 *   2. run every handle to the end in slices (SLICE_STEPS engine steps per handle
 *      per scheduled callback), so a 5,000-job case never freezes the tab;
 *   3. read metrics and results from each handle, then destroy every handle
 *      (also on error and on cancel), so the 4,096-handle limit never fills up;
 *   4. show a metrics table (always), side-by-side timelines, and Chart.js bar
 *      charts. Chart.js is loaded lazily, the first time Compare mode opens: a
 *      classic script element is injected with the pinned URL, an integrity hash
 *      and crossorigin (D33). Build and Run mode make no network request. If the
 *      load fails, is blocked by the hash, or times out, window.Chart does not
 *      exist and the table stays: nothing else depends on the network. A failed
 *      load is never retried.
 *
 * Text from the engine is always put on the page with textContent.
 * Classic script: attaches APRM.compare only. Nothing runs at load time.
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});

  var SLICE_STEPS = 500;
  var DASH = '—'; /* shown for a null metric (D62: no finished job, or makespan 0) */
  var MIN_POLICIES = 2;
  var BOARD_HEIGHT = 260;    /* css pixels, each finished board */

  /* The ONE place the pinned Chart.js file is named (version, URL, SRI hash).
   * Verified for K-27 and recorded in docs/TOOLCHAIN.md. */
  var CHART_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js';
  var CHART_INTEGRITY = 'sha384-jb8JQMbMoBUzgWatfe6COACi2ljcDdZQ2OxczGA3bGNeWe+6DChMTBJemed7ZnvJ';
  var CHART_TIMEOUT_MS = 10000;

  /* name: what the engine is told; label: what the page shows. A policy with
   * available false is listed but cannot be ticked (none at present). */
  var POLICIES = [
    { name: 'fcfs', label: 'fcfs', available: true },
    { name: 'priority', label: 'priority', available: true },
    { name: 'sjf', label: 'sjf', available: true },
    { name: 'aging', label: 'aging', available: true },
    { name: 'aging_reserve', label: 'reserve', available: true },
    { name: 'knapsack', label: 'knapsack', available: true }
  ];
  var DEFAULT_SELECTED = ['fcfs', 'aging'];

  /* Metrics shown in the table: key in the metrics JSON, heading. */
  var METRIC_COLUMNS = [
    ['avg_wait', 'Avg wait'], ['max_wait', 'Max wait'], ['avg_turnaround', 'Avg turnaround'],
    ['weighted_completion', 'Weighted completion'], ['makespan', 'Makespan'],
    ['util_cpu', 'CPU utilisation'], ['util_mem', 'Memory utilisation']
  ];
  /* Metrics drawn as bar charts (one chart each). */
  var CHART_METRICS = ['avg_wait', 'max_wait', 'avg_turnaround', 'makespan'];

  var selected = DEFAULT_SELECTED.slice();
  var status = 'idle';       /* idle | running | done | error */
  var errorText = '';
  var runs = [];             /* live: [{policy, handle, finished, events}] */
  var model = null;          /* after a run: {jobs, tmax, columns:[{policy, metrics, rows}]} */
  var charts = [];           /* live Chart.js objects, destroyed before every redraw */
  var laterId = null;
  var token = 0;             /* bumps on every start/cancel, so old slices stop */
  var stale = false;
  var mounted = false;
  var chartLoad = 'none';    /* none | loading | loaded | failed (failed is final: no retry) */
  var chartTimer = null;

  /* Replaceable so tests can run the slices by hand. */
  var scheduler = {
    later: function (fn) { return setTimeout(fn, 0); },
    cancelLater: function (id) { clearTimeout(id); },
    timeout: function (fn, ms) { return setTimeout(fn, ms); },
    cancelTimeout: function (id) { clearTimeout(id); }
  };
  function setScheduler(s) {
    scheduler = {
      later: s.later || scheduler.later, cancelLater: s.cancelLater || scheduler.cancelLater,
      timeout: s.timeout || scheduler.timeout, cancelTimeout: s.cancelTimeout || scheduler.cancelTimeout
    };
  }

  /* ---------- Chart.js, loaded once, lazily ---------- */

  function chartSettled(state) {
    if (chartLoad === 'loaded' || chartLoad === 'failed') { return; }
    chartLoad = state;
    if (chartTimer !== null) { scheduler.cancelTimeout(chartTimer); chartTimer = null; }
    if (status === 'done') { drawCharts(); }
  }

  /* Start loading Chart.js if that has not been tried yet. Never fetch, never
   * retry: one script element, ever. O(1). */
  function ensureChart() {
    if (chartLoad !== 'none') { return; }
    if (typeof window.Chart === 'function') { chartLoad = 'loaded'; return; }
    var host = document.head || document.documentElement || document.body;
    if (!host || typeof document.createElement !== 'function') { chartLoad = 'failed'; return; }
    chartLoad = 'loading';
    try {
      var el = document.createElement('script');
      el.setAttribute('src', CHART_URL);
      el.setAttribute('integrity', CHART_INTEGRITY);
      el.setAttribute('crossorigin', 'anonymous');
      el.onload = function () { chartSettled(typeof window.Chart === 'function' ? 'loaded' : 'failed'); };
      el.onerror = function () { chartSettled('failed'); };
      host.appendChild(el);
      chartTimer = scheduler.timeout(function () { chartTimer = null; chartSettled('failed'); }, CHART_TIMEOUT_MS);
    } catch (e) {
      chartLoad = 'failed';
    }
  }

  function byId(id) { return document.getElementById(id); }
  function clear(el) { while (el.firstChild) { el.removeChild(el.firstChild); } }
  function text(id, value) { var el = byId(id); if (el) { el.textContent = value; } }

  function showMessage(id, message) {
    var el = byId(id);
    if (!el) { return; }
    el.textContent = message || '';
    el.hidden = !message;
  }

  function errorMessage(err) {
    var m = err && err.message ? err.message : String(err);
    return err && err.field && m.indexOf(err.field) !== 0 ? err.field + ': ' + m : m;
  }

  /* Words from copy.js, with a fallback when copy.js is not loaded. */
  function words(key, fallback, vars) {
    var C = APRM.copy;
    if (!C || !C.has(key)) { return fallback; }
    return vars ? C.fill(key, vars) : C.get(key);
  }

  /* Short plain name with the technical term beside it, for table rows, timelines and charts. */
  function labelOf(name) {
    return words('short.' + name, name);
  }

  /* The longer plain name used in the picker. */
  function pickerLabel(p) {
    return words('policy.' + p.name, p.label) + (p.available ? '' : words('policy.knapsack.soon', ' (not implemented yet)'));
  }

  /* ---------- handles ---------- */

  /* Destroy every live handle. Never throws. O(handles). */
  function destroyAll() {
    var list = runs;
    runs = [];
    for (var i = 0; i < list.length; i++) {
      try { APRM.wasm.destroy(list[i].handle); } catch (e) { /* already gone */ }
    }
  }

  function cancelTimer() {
    if (laterId !== null) { scheduler.cancelLater(laterId); laterId = null; }
  }

  function destroyCharts() {
    var list = charts;
    charts = [];
    for (var i = 0; i < list.length; i++) {
      try { list[i].destroy(); } catch (e) { /* ignore */ }
    }
  }

  /* Stop a running comparison and free its handles. Safe to call at any time. */
  function cancel() {
    token++;
    cancelTimer();
    destroyAll();
    if (status === 'running') { status = 'idle'; render(); }
  }

  /* ---------- selection ---------- */

  /* Set the ticked policies (names). Unknown or unavailable names are ignored.
   * Returns the list kept, in the fixed policy order. */
  function setSelected(names) {
    var keep = [];
    for (var i = 0; i < POLICIES.length; i++) {
      if (POLICIES[i].available && names.indexOf(POLICIES[i].name) >= 0) { keep.push(POLICIES[i].name); }
    }
    selected = keep;
    var boxes = byId('compare-policies');
    if (boxes && boxes.children) {
      for (var k = 0; k < boxes.children.length; k++) {
        var input = boxes.children[k].firstChild;
        if (input && input.getAttribute && input.getAttribute('data-policy')) {
          input.checked = keep.indexOf(input.getAttribute('data-policy')) >= 0;
        }
      }
    }
    return keep.slice();
  }

  /* ---------- running ---------- */

  function fail(err) {
    token++;
    cancelTimer();
    destroyAll();
    status = 'error';
    errorText = errorMessage(err);
    model = null;
    render();
    return false;
  }

  /* Start a comparison from the store. Returns true when it began. O(policies * jobs). */
  function start() {
    token++;
    cancelTimer();
    destroyAll();
    errorText = '';
    stale = false;
    model = null;
    ensureChart();
    var st = APRM.store.get();
    if (st.jobs.length === 0) {
      status = 'idle';
      errorText = words('compare.error.nojobs', 'There are no jobs. Add some in Build mode first.');
      render();
      return false;
    }
    if (selected.length < MIN_POLICIES) {
      status = 'idle';
      errorText = words('compare.error.pick', 'Tick at least two schedulers to compare.');
      render();
      return false;
    }
    try {
      for (var p = 0; p < selected.length; p++) {
        var h = APRM.wasm.create(st.machine.cpu, st.machine.mem, selected[p], st.settings.alphaMilli, st.settings.threshold, st.settings.eps);
        runs.push({ policy: selected[p], handle: h, finished: false, events: 0 });
        for (var i = 0; i < st.jobs.length; i++) {
          var j = st.jobs[i];
          try {
            APRM.wasm.addJob(h, j.id, j.arrival, j.duration, j.cpu, j.mem, j.priority);
          } catch (e) {
            if (e && !e.field) { e.message = 'Job ' + j.id + ': ' + e.message; }
            throw e;
          }
        }
      }
    } catch (err) {
      return fail(err);
    }
    model = { jobs: st.jobs.map(copyJob), cap: { cpu: st.machine.cpu, mem: st.machine.mem }, tmax: 0, columns: [] };
    status = 'running';
    render();
    scheduleSlice(token);
    return true;
  }

  function copyJob(j) {
    return { id: j.id, arrival: j.arrival, duration: j.duration, cpu: j.cpu, mem: j.mem, priority: j.priority };
  }

  function scheduleSlice(t) {
    laterId = scheduler.later(function () {
      laterId = null;
      if (t === token) { slice(t); }
    });
  }

  /* One slice: up to SLICE_STEPS engine steps on every unfinished handle. */
  function slice(t) {
    var allDone = true;
    try {
      for (var r = 0; r < runs.length; r++) {
        var run = runs[r];
        for (var n = 0; n < SLICE_STEPS && !run.finished; n++) {
          if (APRM.wasm.step(run.handle) === 0) { run.finished = true; } else { run.events++; }
        }
        if (!run.finished) { allDone = false; }
      }
    } catch (err) {
      fail(err);
      return;
    }
    if (t !== token) { return; }
    if (allDone) { finish(); } else { renderStatus(); scheduleSlice(t); }
  }

  var EXACT_MAX_JOBS = 9;

  /* The exact solver's answer for the same jobs: {totalWait} on success, {tooBig: true} above 9
   * jobs, {error: text} if the engine refused. The exact solver minimises total wait (PRD section 5).
   * Called before the handles are destroyed. Never throws. */
  function readExact(handle, nJobs) {
    if (nJobs > EXACT_MAX_JOBS) { return { tooBig: true }; }
    try {
      var r = APRM.wasm.exact(handle);
      if (r && typeof r.total_wait === 'number') { return { totalWait: r.total_wait }; }
      return { error: 'no answer' };
    } catch (e) {
      return { error: errorMessage(e) };
    }
  }

  /* Total wait of one column: the sum of (start - arrival) over the engine's result rows. O(rows). */
  function totalWait(col) {
    var arrival = {};
    for (var i = 0; i < model.jobs.length; i++) { arrival[model.jobs[i].id] = model.jobs[i].arrival; }
    var sum = 0;
    for (var k = 0; k < col.rows.length; k++) { sum += col.rows[k].start - arrival[col.rows[k].id]; }
    return sum;
  }

  /* The exact line: the best possible total wait and how far each scheduler is above it. */
  function exactText() {
    var ex = model ? model.exact : null;
    if (!ex) { return ''; }
    if (ex.tooBig) { return words('compare.exact.big', 'The exact best order is only worked out for 9 jobs or fewer.'); }
    if (ex.error) { return words('compare.exact.failed', 'The exact best order could not be worked out: ' + ex.error, { why: ex.error }); }
    var out = words('compare.exact.line', 'Exact best order: total wait ' + ex.totalWait + '.', { t: ex.totalWait });
    for (var c = 0; c < model.columns.length; c++) {
      var nm = labelOf(model.columns[c].policy);
      if (model.columns[c].rows.length !== model.jobs.length) { out += ' ' + words('compare.exact.partial', nm + ' did not finish every job, so its gap is not shown.', { name: nm }); continue; }
      var d = totalWait(model.columns[c]) - ex.totalWait;
      out += ' ' + (d === 0 ? words('compare.exact.same', nm + ' matches it.', { name: nm }) : words('compare.exact.gap', nm + ' is ' + d + ' above it.', { name: nm, d: d }));
    }
    return out;
  }

  /* Read every answer, then destroy every handle (always). */
  function finish() {
    var columns = [];
    var tmax = 0;
    try {
      for (var r = 0; r < runs.length; r++) {
        var metrics = APRM.wasm.metrics(runs[r].handle);
        var rows = APRM.wasm.results(runs[r].handle);
        columns.push({ policy: runs[r].policy, metrics: metrics, rows: rows, events: runs[r].events });
        for (var k = 0; k < rows.length; k++) { if (rows[k].finish > tmax) { tmax = rows[k].finish; } }
      }
    } catch (err) {
      fail(err);
      return;
    }
    /* The solver depends only on the jobs, so any handle (here the first, already run to the end) gives the same answer. */
    model.exact = readExact(columns.length > 0 ? runs[0].handle : 0, model.jobs.length);
    destroyAll();
    model.columns = columns;
    model.tmax = tmax;
    status = 'done';
    render();
  }

  /* ---------- drawing ---------- */

  function metricText(v) {
    if (v === null || v === undefined) { return DASH; }
    return (typeof v === 'number' && Math.floor(v) !== v) ? v.toFixed(3) : String(v);
  }

  function cell(tag, value, cls) {
    var c = document.createElement(tag);
    c.textContent = value;
    if (cls) { c.setAttribute('class', cls); }
    return c;
  }

  /* Lower is better for waits, turnaround, weighted completion and makespan; higher for utilization. */
  var HIGHER_IS_BETTER = { util_cpu: true, util_mem: true };

  /* True when value v is the best of that metric among the columns, and the columns differ.
   * The word "Best" is shown by CSS from data-best, so the cell text stays the engine's number. O(columns). */
  function isBest(key, v) {
    if (typeof v !== 'number' || model === null) { return false; }
    var vals = [];
    for (var i = 0; i < model.columns.length; i++) {
      var x = model.columns[i].metrics[key];
      if (typeof x === 'number') { vals.push(x); }
    }
    if (vals.length < 2) { return false; }
    var best = HIGHER_IS_BETTER[key] ? Math.max.apply(null, vals) : Math.min.apply(null, vals);
    var worst = HIGHER_IS_BETTER[key] ? Math.min.apply(null, vals) : Math.max.apply(null, vals);
    return best !== worst && v === best;
  }

  /* One or two sentences from the makespans the engine reported: who finished first and how much
   * longer the slowest took. Names only; no scheduling happens here. Returns '' when no run finished anything. */
  function verdictText() {
    var cols = model ? model.columns : [];
    var ok = cols.filter(function (c) { return typeof c.metrics.makespan === 'number'; });
    if (ok.length < 2 || ok.length < cols.length) { return ''; }   /* a column with no value: say nothing rather than guess */
    var best = Math.min.apply(null, ok.map(function (c) { return c.metrics.makespan; }));
    var worst = Math.max.apply(null, ok.map(function (c) { return c.metrics.makespan; }));
    var winners = ok.filter(function (c) { return c.metrics.makespan === best; });
    var names = winners.map(function (c) { return labelOf(c.policy); });
    var joined = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
    var line;
    if (winners.length === ok.length) { return words('compare.verdict.tie', names.join(', ') + ' tied at tick ' + best + '.', { names: joined, t: best }); }
    if (winners.length === 1) { line = words('compare.verdict.best', names[0] + ' finished first, at tick ' + best + '.', { name: names[0], t: best }); }
    else { line = words('compare.verdict.tie', joined + ' tied for first at tick ' + best + '.', { names: joined, t: best }); }
    var slows = ok.filter(function (c) { return c.metrics.makespan === worst; }).map(function (c) { return labelOf(c.policy); });
    var slowName = slows.length > 1 ? slows.slice(0, -1).join(', ') + ' and ' + slows[slows.length - 1] : slows[0];
    var gap = worst - best;
    return line + ' ' + words('compare.verdict.later', slowName + ' took ' + gap + ' ticks longer.', { name: slowName, d: gap, ticks: gap === 1 ? 'tick' : 'ticks' });
  }

  /* The metrics table: one row per policy. Always drawn when a run is done. */
  function drawTable() {
    var body = byId('compare-body');
    var head = byId('compare-head');
    var wrap = byId('compare-table-wrap');
    if (!body || !head) { return; }
    clear(head); clear(body);
    var show = status === 'done' && model !== null;
    if (wrap) { wrap.hidden = !show; }
    if (!show) { return; }
    var hr = document.createElement('tr');
    hr.appendChild(cell('th', words('compare.col.scheduler', 'Scheduler')));
    for (var m = 0; m < METRIC_COLUMNS.length; m++) { hr.appendChild(cell('th', words('metric.' + METRIC_COLUMNS[m][0], METRIC_COLUMNS[m][1]))); }
    head.appendChild(hr);
    for (var c = 0; c < model.columns.length; c++) {
      var col = model.columns[c];
      var tr = document.createElement('tr');
      tr.setAttribute('data-policy', col.policy);
      tr.appendChild(cell('th', labelOf(col.policy)));
      for (var k = 0; k < METRIC_COLUMNS.length; k++) {
        var v = col.metrics[METRIC_COLUMNS[k][0]];
        var td = cell('td', metricText(v), (v === null || v === undefined) ? 'na' : '');
        td.setAttribute('data-label', words('metric.' + METRIC_COLUMNS[k][0], METRIC_COLUMNS[k][1]));
        if (isBest(METRIC_COLUMNS[k][0], v)) {
          td.setAttribute('data-best', words('compare.best', 'Best'));
          td.setAttribute('class', (td.getAttribute('class') ? td.getAttribute('class') + ' ' : '') + 'best');
        }
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
  }

  /* Colours from the CSS variables, with fixed fallbacks. */
  function themeColours() {
    var out = { text: '#1B1F1D', muted: '#5B625E', border: '#CFD3D0', accent: '#0B5E6B', jobs: ['#3A6EA5', '#C27A1A', '#2E8B6A', '#B4483C', '#8A6D2E', '#5E8FA8', '#A8567A', '#6E7F2A', '#6B7280', '#94741A'] };
    if (typeof getComputedStyle !== 'function' || !document.documentElement) { return out; }
    try {
      var cs = getComputedStyle(document.documentElement);
      var pick = function (n, fb) { var v = String(cs.getPropertyValue(n) || '').trim(); return v || fb; };
      out.text = pick('--text', out.text); out.muted = pick('--muted', out.muted); out.border = pick('--border', out.border); out.accent = pick('--accent', out.accent);
      for (var i = 0; i < 10; i++) { out.jobs[i] = pick('--job-' + i, out.jobs[i]); }
    } catch (e) { /* keep the fallbacks */ }
    return out;
  }

  /* One finished board, in the same form as the Run page: the engine's start and finish times, on the
   * time scale shared by every board, so the pictures can be compared by eye. Returns false with no canvas. */
  function drawTimeline(canvas, jobs, rows, tmax, finished) {
    var bars = {};
    for (var i = 0; i < rows.length; i++) { bars[rows[i].id] = { start: rows[i].start, finish: rows[i].finish }; }
    var st = { now: tmax, cap: model.cap, free: model.cap, waiting: [], running: [], reservation: null, done: rows.length, total: jobs.length };
    return APRM.canvas.draw(canvas, { state: st, jobs: jobs, bars: bars, selected: null, events: 0, hideNow: true, endMark: finished, tmax: tmax }, BOARD_HEIGHT);
  }

  function drawTimelines() {
    var box = byId('compare-timelines');
    if (!box) { return; }
    clear(box);
    if (status !== 'done' || model === null) { return; }
    var boards = [];
    for (var c = 0; c < model.columns.length; c++) {
      var col = model.columns[c];
      var fig = document.createElement('figure');
      fig.setAttribute('class', 'compare-fig');
      var cap = document.createElement('figcaption');
      cap.textContent = words('compare.timeline.cap', labelOf(col.policy) + ' (makespan ' + metricText(col.metrics.makespan) + ')', { name: labelOf(col.policy), t: metricText(col.metrics.makespan) });
      var cv = document.createElement('canvas');
      cv.setAttribute('role', 'img');
      cv.setAttribute('aria-label', words('compare.timeline.aria', 'Timeline of every job under ' + labelOf(col.policy), { name: labelOf(col.policy) }));
      fig.appendChild(cap);
      fig.appendChild(cv);
      box.appendChild(fig);
      boards.push({ cv: cv, rows: col.rows, finished: col.metrics.makespan });
    }
    /* Draw after every board is in the page: each one's width depends on how many share the row. */
    for (var b = 0; b < boards.length; b++) { drawTimeline(boards[b].cv, model.jobs, boards[b].rows, model.tmax, boards[b].finished); }
  }

  /* Bar charts, only if Chart.js loaded. Any failure falls back to the table. */
  function drawCharts() {
    var box = byId('compare-charts');
    var note = byId('compare-chart-note');
    destroyCharts();
    if (box) { clear(box); }
    if (!box || !note) { return; }
    if (status !== 'done' || model === null) { note.hidden = true; return; }
    if (typeof window.Chart !== 'function' && chartLoad === 'loading') {
      note.textContent = words('compare.chart.loading', 'Chart.js is still loading. The table above has the numbers; the charts appear when it arrives.');
      note.hidden = false;
      return;
    }
    if (typeof window.Chart !== 'function') {
      note.textContent = words('compare.chart.failed', 'Charts are unavailable because Chart.js could not be loaded (no network, or the file was blocked). The table above has the same numbers.');
      note.hidden = false;
      return;
    }
    var col = themeColours();
    try {
      var labels = model.columns.map(function (c) { return labelOf(c.policy).split(' ('); });   /* two short lines, never slanted */
      for (var m = 0; m < CHART_METRICS.length; m++) {
        var key = CHART_METRICS[m];
        var title = '';
        for (var t = 0; t < METRIC_COLUMNS.length; t++) { if (METRIC_COLUMNS[t][0] === key) { title = words('metric.' + key, METRIC_COLUMNS[t][1]); } }
        var holder = document.createElement('div');
        holder.setAttribute('class', 'compare-chart');
        var cv = document.createElement('canvas');
        cv.setAttribute('role', 'img');
        cv.setAttribute('aria-label', words('compare.chart.aria', 'Bar chart of ' + title + ' per scheduler', { title: title }));
        holder.appendChild(cv);
        box.appendChild(holder);
        var data = model.columns.map(function (c) { var v = c.metrics[key]; return (typeof v === 'number') ? v : null; });
        charts.push(new window.Chart(cv, {
          type: 'bar',
          data: { labels: labels, datasets: [{ label: title, data: data, backgroundColor: col.accent }] },
          options: {
            animation: false, responsive: true, maintainAspectRatio: false, color: col.text,
            plugins: { legend: { display: false }, title: { display: true, text: title + ' (ticks)', color: col.text } },
            scales: {
              x: { ticks: { color: col.muted, maxRotation: 0, minRotation: 0, autoSkip: false }, grid: { color: col.border } },
              y: { beginAtZero: true, ticks: { color: col.muted }, grid: { color: col.border } }
            }
          }
        }));
      }
      note.hidden = true;
    } catch (e) {
      destroyCharts();
      clear(box);
      note.textContent = words('compare.chart.error', 'Charts could not be drawn. The table above has the same numbers.', { why: (e && e.message ? e.message : 'unknown problem') });
      note.hidden = false;
    }
  }

  function renderStatus() {
    var line = words('compare.status.idle', 'Idle. Tick two or more schedulers and press Compare.');
    if (status === 'running') {
      var events = 0;
      for (var i = 0; i < runs.length; i++) { events += runs[i].events; }
      line = words('compare.status.running', 'Running ' + runs.length + ' schedulers: ' + events + ' events so far.', { n: runs.length, events: events });
    } else if (status === 'done') {
      line = words('compare.status.done', 'Done.', { n: model.columns.length, jobs: model.jobs.length }) + (stale ? words('compare.status.stale', ' The jobs or settings changed since; press Compare again.') : '');
    } else if (status === 'error') {
      line = words('compare.status.error', 'The comparison stopped.');
    }
    text('compare-status', line);
  }

  function updateButtons() {
    var go = byId('compare-start');
    if (go) { go.disabled = status === 'running'; }
  }

  /* Redraw everything from the remembered answers. */
  function render() {
    renderStatus();
    showMessage('compare-error', errorText);
    var empty = byId('compare-empty');
    if (empty) { empty.hidden = status === 'done'; }
    drawTable();
    drawTimelines();
    drawCharts();
    var exact = byId('compare-exact');
    if (exact) {
      exact.hidden = status !== 'done';
      exact.textContent = status === 'done' ? exactText() : '';
    }
    var verdict = byId('compare-verdict');
    if (verdict) {
      var v = status === 'done' ? verdictText() : '';
      verdict.textContent = v;
      verdict.hidden = v === '';
    }
    updateButtons();
  }

  /* ---------- page wiring ---------- */

  function mount() {
    if (mounted) { return; }
    mounted = true;
    var box = byId('compare-policies');
    if (box) {
      POLICIES.forEach(function (p) {
        var label = document.createElement('label');
        var input = document.createElement('input');
        input.setAttribute('type', 'checkbox');
        input.setAttribute('data-policy', p.name);
        input.checked = p.available && selected.indexOf(p.name) >= 0;
        input.disabled = !p.available;
        if (p.available) {
          input.addEventListener('change', function () {
            var now = [];
            var boxes = box.children;
            for (var i = 0; i < boxes.length; i++) {
              var inp = boxes[i].firstChild;
              if (inp && inp.checked) { now.push(inp.getAttribute('data-policy')); }
            }
            selected = now;
          });
        }
        label.appendChild(input);
        label.appendChild(document.createTextNode(' ' + pickerLabel(p)));
        box.appendChild(label);
      });
    }
    var go = byId('compare-start');
    if (go) { go.addEventListener('click', start); }
    APRM.store.subscribe(function (s, changed) {
      var panel = byId('compare-panel');
      if (panel) { panel.hidden = s.mode !== 'compare'; }
      if (s.mode === 'compare') { ensureChart(); }
      if (changed === 'theme' && status === 'done' && s.mode === 'compare') { render(); }
      if (changed === 'mode' && s.mode !== 'compare') { destroyCharts(); }
      if (changed === 'mode' && s.mode === 'compare' && status === 'done') { drawCharts(); }
      if (changed === 'mode' && s.mode !== 'compare' && status === 'running') { cancel(); }
      if ((changed === 'jobs' || changed === 'machine' || changed === 'settings') && status === 'done' && !stale) {
        stale = true;
        renderStatus();
      }
    });
    render();
  }

  APRM.compare = {
    SLICE_STEPS: SLICE_STEPS,
    POLICIES: POLICIES,
    METRIC_COLUMNS: METRIC_COLUMNS,
    mount: mount,
    start: start,
    ensureChart: ensureChart,
    CHART_URL: CHART_URL,
    CHART_INTEGRITY: CHART_INTEGRITY,
    chartState: function () { return chartLoad; },
    cancel: cancel,
    setSelected: setSelected,
    setScheduler: setScheduler,
    liveHandles: function () { return runs.map(function (r) { return r.handle; }); },
    snapshot: function () {
      return {
        status: status, error: errorText, selected: selected.slice(), stale: stale,
        columns: model ? model.columns : [], jobs: model ? model.jobs : [], tmax: model ? model.tmax : 0,
        charts: charts.length
      };
    }
  };
})();
