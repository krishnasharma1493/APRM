/* player.js: Run mode (PRD section 7 "The run loop", K-25).
 *
 * Idea: each animation frame asks the C engine to advance a few events, then
 * redraws from what the engine reports. The page NEVER decides which job runs:
 * this file calls only the APRM.wasm wrapper (create, addJob, step, state, log,
 * metrics, destroy) and passes the answers to canvas.js and whylog.js.
 *
 * State machine (status):
 *   idle      no simulation (nothing started, or reset)
 *   paused    a simulation exists and waits
 *   playing   a frame loop runs, at most `speed` steps per frame (hard cap)
 *   jumping   "jump to end" runs in slices, one slice per scheduled callback
 *   finished  the engine said there is no more event (adding a job re-opens it)
 *   error     the engine refused something; the message is shown, handle destroyed
 *
 * Long runs cannot freeze the tab: MAX_STEPS_PER_FRAME steps per frame, and a
 * jump runs SLICE_STEPS steps per callback, redrawing once per slice.
 *
 * Handles: at most one simulation is alive. start(), reset() and every error
 * destroy the old handle first, so the 4,096 handles never leak.
 *
 * Classic script: attaches APRM.player only. Nothing runs at load time.
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});

  var MAX_STEPS_PER_FRAME = 200;
  var SLICE_STEPS = 500;
  var POLICY_NAMES = ['fcfs', 'priority', 'sjf', 'aging', 'aging_reserve', 'knapsack'];

  /* ---------- the run ---------- */

  var run = null;          /* null = idle; otherwise the data below */
  var speed = 1;           /* steps per frame, 1..MAX_STEPS_PER_FRAME */
  var status = 'idle';
  var errorText = '';
  var frameId = null;
  var laterId = null;
  var selected = null;

  /* The timers. Replaceable so tests can drive frames by hand. */
  var scheduler = {
    frame: function (fn) {
      return typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame(fn) : setTimeout(fn, 16);
    },
    cancelFrame: function (id) {
      if (typeof window.cancelAnimationFrame === 'function') { window.cancelAnimationFrame(id); } else { clearTimeout(id); }
    },
    later: function (fn) { return setTimeout(fn, 0); },
    cancelLater: function (id) { clearTimeout(id); }
  };

  function setScheduler(s) {
    scheduler = {
      frame: s.frame || scheduler.frame, cancelFrame: s.cancelFrame || scheduler.cancelFrame,
      later: s.later || scheduler.later, cancelLater: s.cancelLater || scheduler.cancelLater
    };
  }

  function byId(id) { return document.getElementById(id); }
  function clear(el) { while (el.firstChild) { el.removeChild(el.firstChild); } }

  /* Words from copy.js, with a plain fallback when copy.js is not loaded (tests of single scripts). */
  function copyText(key, fallback, vars) {
    var C = APRM.copy;
    if (!C || !C.has(key)) { return fallback; }
    return vars ? C.fill(key, vars) : C.get(key);
  }

  function detailsOn() { return !!(APRM.store && APRM.store.get().details); }

  function text(id, value) { var el = byId(id); if (el) { el.textContent = value; } }

  function showMessage(id, message) {
    var el = byId(id);
    if (!el) { return; }
    el.textContent = message || '';
    el.hidden = !message;
  }

  /* "field: message" the way the editor shows engine errors. */
  function errorMessage(err) {
    var m = err && err.message ? err.message : String(err);
    return err && err.field ? err.field + ': ' + m : m;
  }

  /* ---------- handle management ---------- */

  /* Destroy the live simulation if there is one. Never throws. O(1). */
  function destroyRun() {
    if (run !== null) {
      var h = run.handle;
      run = null;
      try { APRM.wasm.destroy(h); } catch (e) { /* already gone */ }
    }
  }

  function cancelTimers() {
    if (frameId !== null) { scheduler.cancelFrame(frameId); frameId = null; }
    if (laterId !== null) { scheduler.cancelLater(laterId); laterId = null; }
  }

  /* ---------- reading the engine ---------- */

  /* Pull only the log entries newer than the last one seen, keep them, and
   * update the Gantt bars from START and FINISH entries. O(new entries). */
  function pullLog() {
    var fresh = APRM.wasm.log(run.handle, run.lastSeq);
    for (var i = 0; i < fresh.length; i++) {
      var e = fresh[i];
      run.entries.push(e);
      if (e.seq > run.lastSeq) { run.lastSeq = e.seq; }
      if (e.kind === 'START') { barOf(e.job).start = e.t; }
      if (e.kind === 'FINISH') { barOf(e.job).finish = e.t; }
    }
    return fresh.length;
  }

  function barOf(id) {
    if (!run.bars[id]) { run.bars[id] = {}; }
    return run.bars[id];
  }

  /* Read the state JSON (and the metrics unless `light`) and remember them.
   * The planned start and finish of running jobs also feed the Gantt bars. */
  function readEngine(light) {
    run.state = APRM.wasm.state(run.handle);
    var r = run.state.running;
    for (var i = 0; i < r.length; i++) {
      var b = barOf(r[i].id);
      b.start = r[i].start;
      b.finish = r[i].finish;
    }
    if (!light) { run.metrics = APRM.wasm.metrics(run.handle); }
  }

  /* ---------- drawing ---------- */

  function view() {
    return { state: run ? run.state : null, jobs: run ? run.jobs : [], bars: run ? run.bars : {},
      selected: selected, events: run ? run.events : 0 };
  }

  var METRIC_KEYS = ['avg_wait', 'max_wait', 'avg_turnaround', 'weighted_completion', 'makespan', 'util_cpu', 'util_mem'];

  /* A metric value as text. The clean view rounds to three decimals; Show details prints the
   * engine's number unchanged. null means the engine has no value yet. */
  function metricText(v) {
    if (v === null || v === undefined) { return copyText('metric.none', 'n/a (no finished job yet)'); }
    if (typeof v === 'number' && Math.floor(v) !== v && !detailsOn()) { return v.toFixed(3); }
    return String(v);
  }

  function drawMetrics() {
    var list = byId('metrics-list');
    var empty = byId('metrics-empty');
    if (!list) { return; }
    clear(list);
    if (!run || !run.metrics || run.state.done === 0) {
      if (empty) { empty.hidden = false; }
      return;
    }
    if (empty) { empty.hidden = true; }
    for (var i = 0; i < METRIC_KEYS.length; i++) {
      var li = document.createElement('li');
      li.textContent = copyText('metric.' + METRIC_KEYS[i], METRIC_KEYS[i]) + ': ' + metricText(run.metrics[METRIC_KEYS[i]]);
      list.appendChild(li);
    }
    var byPri = run.metrics.avg_wait_by_priority;
    if (Array.isArray(byPri)) {
      var row = document.createElement('li');
      var parts = [];
      for (var q = 0; q < byPri.length; q++) { if (byPri[q] !== null && byPri[q] !== undefined) { parts.push(q + ': ' + metricText(byPri[q])); } }
      row.textContent = copyText('metric.by_priority', 'Average wait by priority') + ' (' + parts.join(', ') + ')';
      if (parts.length > 0) { list.appendChild(row); }
    }
  }

  /* The machine in numbers, straight from the state JSON: used = capacity minus free. */
  function drawResources() {
    var st = run ? run.state : null;
    var setMeter = function (fillId, textId, key, unitKey) {
      var fill = byId(fillId), label = byId(textId);
      if (!label) { return; }
      if (!st) { label.textContent = copyText('run.res.none', ''); if (fill && fill.style) { fill.style.transform = 'scaleX(0)'; } return; }
      var cap = st.cap[key], free = st.free[key], used = cap - free;
      label.textContent = copyText(unitKey, used + ' of ' + cap + ', ' + free + ' free', { used: used, cap: cap, free: free });
      if (fill && fill.style) { fill.style.transform = 'scaleX(' + (cap > 0 ? used / cap : 0) + ')'; }
    };
    setMeter('res-cpu-fill', 'res-cpu-text', 'cpu', 'run.res.cpu.text');
    setMeter('res-mem-fill', 'res-mem-text', 'mem', 'run.res.mem.text');
  }

  /* The saved spot for the long-waiting job, as the engine reports it (id and shadow time). */
  function drawReservation() {
    var card = byId('reserve-card');
    if (!card) { return; }
    var r = run && run.state ? run.state.reservation : null;
    if (!r) { card.textContent = ''; card.hidden = true; return; }
    card.textContent = copyText('run.reserve', 'Job ' + r.id + ' is reserved.', { id: r.id, t: r.shadow_time });
    card.hidden = false;
  }

  /* One line with the exact settings, always visible even when "More settings" is closed. */
  function drawSettingsLine() {
    var s = APRM.store.get().settings;
    text('run-settings-summary', copyText('run.settings', 'Settings: alpha = ' + s.alphaMilli, { alpha: s.alphaMilli, t: s.threshold, eps: s.eps }));
  }

  function clockText() {
    if (!run) { return copyText('run.clock.none', 'No run yet. Press Run.'); }
    var vars = { now: run.state.now, events: run.events, done: run.state.done, total: run.state.total };
    return copyText(detailsOn() ? 'run.clock.details' : 'run.clock', 'Time: tick ' + vars.now, vars);
  }

  function highlightJobList() {
    var list = byId('job-list');
    if (!list) { return; }
    var kids = list.children || [];
    for (var i = 0; i < kids.length; i++) {
      var on = selected !== null && String(kids[i].textContent).indexOf('Job ' + selected + ':') === 0;
      kids[i].setAttribute('class', on ? 'sel' : '');
    }
  }

  /* Redraw every view from the remembered engine answers. O(shown rows + jobs). */
  function render() {
    text('run-clock', clockText());
    text('run-status', copyText('status.' + status, status));
    var canvasEl = byId('run-canvas');
    var empty = byId('canvas-empty');
    if (canvasEl) {
      var painted = run !== null && APRM.canvas.draw(canvasEl, view());
      canvasEl.hidden = !painted;
      if (empty) {
        empty.hidden = run !== null && painted;
        empty.textContent = run !== null && !painted ? clockText() : copyText('run.canvas.empty', 'Nothing to show yet. Add jobs, then press Run.');
      }
    }
    APRM.whylog.render(run ? run.entries : [], selected);
    drawMetrics();
    drawResources();
    drawReservation();
    drawSettingsLine();
    highlightJobList();
    updateButtons();
    if (status !== 'playing') { refreshAddForm(); }
  }

  function updateButtons() {
    var play = byId('run-play');
    if (play) { play.textContent = status === 'playing' ? copyText('run.pause', 'Pause') : copyText('run.play', 'Play'); }
    var live = run !== null;
    var startBtn = byId('run-start');
    if (startBtn) { startBtn.textContent = live ? copyText('run.restart', 'Start over') : copyText('run.start', 'Run'); }
    var set = function (id, disabled) { var el = byId(id); if (el) { el.disabled = disabled; } };
    set('run-play', !live || status === 'jumping');
    set('run-step', !live || status === 'playing' || status === 'jumping');
    set('run-jump', !live || status === 'jumping' || status === 'finished');
    set('run-reset', !live);
    set('ra-submit', !live);
  }

  /* ---------- starting and stopping ---------- */

  /* Handle a failure: destroy the simulation, remember the words, show them. */
  function fail(err, target) {
    cancelTimers();
    destroyRun();
    status = 'error';
    errorText = errorMessage(err);
    showMessage(target || 'run-error', errorText);
    render();
  }

  /* Start (or restart) from the store: destroy the old simulation, create a new
   * one, add every job, read the first state. Returns true on success. O(jobs). */
  function start() {
    cancelTimers();
    destroyRun();
    selected = null;
    errorText = '';
    showMessage('run-error', '');
    showMessage('ra-error', '');
    APRM.whylog.forget();
    var st = APRM.store.get();
    if (st.jobs.length === 0) {
      status = 'idle';
      showMessage('run-error', 'There are no jobs. Add some in Build mode first.');
      render();
      return false;
    }
    var policy = st.policies[0] || 'fcfs';
    var h = null;
    try {
      h = APRM.wasm.create(st.machine.cpu, st.machine.mem, policy, st.settings.alphaMilli, st.settings.threshold, st.settings.eps);
      run = { handle: h, jobs: st.jobs.map(copyJob), entries: [], lastSeq: 0, bars: {}, events: 0, state: null, metrics: null, policy: policy };
      for (var i = 0; i < st.jobs.length; i++) {
        var j = st.jobs[i];
        try {
          APRM.wasm.addJob(h, j.id, j.arrival, j.duration, j.cpu, j.mem, j.priority);
        } catch (e) {
          if (e && !e.field) { e.message = 'Job ' + j.id + ': ' + e.message; }
          throw e;
        }
      }
      readEngine(false);
      pullLog();
    } catch (err) {
      if (run === null && h !== null) { try { APRM.wasm.destroy(h); } catch (e2) { /* ignore */ } }
      fail(err, 'run-error');
      return false;
    }
    status = 'paused';
    render();
    return true;
  }

  function copyJob(j) {
    return { id: j.id, arrival: j.arrival, duration: j.duration, cpu: j.cpu, mem: j.mem, priority: j.priority };
  }

  /* Throw the simulation away and return to the idle state. */
  function reset() {
    cancelTimers();
    destroyRun();
    selected = null;
    status = 'idle';
    errorText = '';
    showMessage('run-error', '');
    showMessage('ra-error', '');
    APRM.whylog.forget();
    render();
  }

  /* ---------- stepping ---------- */

  /* Ask the engine for up to n steps. Stops when it says finished. Pulls the
   * new log entries once at the end. Returns the number of steps taken.
   * Throws EngineError. O(n) engine steps. */
  function advance(n) {
    var taken = 0;
    var finished = false;
    while (taken < n) {
      if (APRM.wasm.step(run.handle) === 0) { finished = true; break; }
      taken++;
    }
    run.events += taken;
    pullLog();
    if (finished) { run.finished = true; }
    return taken;
  }

  /* One frame of the play loop: at most min(speed, cap) steps, then redraw. */
  function tickFrame() {
    frameId = null;
    if (status !== 'playing' || run === null) { return; }
    var n = Math.max(1, Math.min(speed, MAX_STEPS_PER_FRAME));
    try {
      advance(n);
      readEngine(false);
    } catch (err) { fail(err); return; }
    if (run.finished) { status = 'finished'; run.finished = false; render(); return; }
    render();
    frameId = scheduler.frame(tickFrame);
  }

  function play() {
    if (run === null || status === 'playing' || status === 'jumping' || status === 'finished') { return false; }
    status = 'playing';
    render();
    frameId = scheduler.frame(tickFrame);
    return true;
  }

  function pause() {
    if (status !== 'playing' && status !== 'jumping') { return false; }
    cancelTimers();
    status = 'paused';
    render();
    return true;
  }

  /* One event (one aprm_step) while paused. */
  function stepOnce() {
    if (run === null || status === 'playing' || status === 'jumping') { return false; }
    try {
      advance(1);
      readEngine(false);
    } catch (err) { fail(err); return false; }
    if (run.finished) { status = 'finished'; run.finished = false; } else { status = 'paused'; }
    render();
    return true;
  }

  /* Steps per frame, clamped to 1..MAX_STEPS_PER_FRAME. Returns the value used. */
  function setSpeed(n) {
    var v = Math.floor(Number(n));
    if (!isFinite(v) || v < 1) { v = 1; }
    speed = Math.min(v, MAX_STEPS_PER_FRAME);
    text('run-speed-out', String(speed));
    return speed;
  }

  /* Run to the end in slices of SLICE_STEPS steps, one slice per callback, so the
   * tab stays responsive even for 5,000 jobs. Pause cancels it. */
  function jumpToEnd() {
    if (run === null || status === 'jumping' || status === 'finished') { return false; }
    cancelTimers();
    status = 'jumping';
    render();
    laterId = scheduler.later(slice);
    return true;
  }

  function slice() {
    laterId = null;
    if (status !== 'jumping' || run === null) { return; }
    try {
      advance(SLICE_STEPS);
      readEngine(true);
    } catch (err) { fail(err); return; }
    if (run.finished) {
      run.finished = false;
      try { readEngine(false); } catch (err2) { fail(err2); return; }
      status = 'finished';
      render();
      return;
    }
    render();
    laterId = scheduler.later(slice);
  }

  /* ---------- selection ---------- */

  /* Select a job (or null): filters the log and highlights it in every view. */
  function select(id) {
    selected = (id === null || id === undefined || isNaN(id)) ? null : id;
    render();
  }

  /* ---------- adding a job mid-run ---------- */

  /* Pause, validate, add with arrival >= now, then resume if it was playing.
   * D59: arrival equal to now is allowed; such a job is selected after jobs
   * that already started at this time. The form's default is now + 1.
   * Returns { ok: true } or { ok: false, message, field }. */
  function addJobMidRun(job) {
    if (run === null) { return { ok: false, message: 'Press Run first.', field: '' }; }
    var wasPlaying = status === 'playing';
    if (status === 'playing' || status === 'jumping') { pause(); }
    var st = APRM.store.get();
    if (APRM.editor && typeof APRM.editor.jobProblems === 'function') {
      var ps = APRM.editor.jobProblems(job, st.machine);
      if (ps.length > 0) { showMessage('ra-error', ps[0].message); return { ok: false, message: ps[0].message, field: ps[0].field }; }
    }
    try {
      APRM.wasm.addJob(run.handle, job.id, job.arrival, job.duration, job.cpu, job.mem, job.priority);
    } catch (err) {
      /* a rejected job changes nothing (D54), so the run stays alive */
      var msg = errorMessage(err);
      showMessage('ra-error', msg);
      return { ok: false, message: msg, field: err && err.field ? err.field : '' };
    }
    showMessage('ra-error', '');
    run.jobs.push(copyJob(job));
    if (run.finished || status === 'finished') { run.finished = false; status = 'paused'; }
    var stored = APRM.store.get().jobs;
    stored.push(copyJob(job));
    try {
      readEngine(false);
    } catch (err2) { fail(err2); return { ok: false, message: errorText, field: '' }; }
    render();
    APRM.store.setJobs(stored);
    if (wasPlaying) { play(); }
    return { ok: true };
  }

  /* ---------- the page ---------- */

  function numberOf(id) {
    var el = byId(id);
    var s = el ? String(el.value).trim() : '';
    return s === '' ? NaN : Number(s);
  }

  /* Read the Run panel into the store; returns an error text or ''. */
  function readSettings() {
    var policyEl = byId('run-policy');
    var policy = policyEl && policyEl.value ? policyEl.value : 'fcfs';
    var alpha = numberOf('run-alpha');
    var thr = numberOf('run-threshold');
    var eps = numberOf('run-eps');
    if (!isFinite(alpha) || Math.floor(alpha) !== alpha) { return 'alpha_milli must be a whole number.'; }
    if (!isFinite(thr) || Math.floor(thr) !== thr) { return 'reservation threshold must be a whole number.'; }
    if (!isFinite(eps)) { return 'epsilon must be a number.'; }
    APRM.store.setPolicies([policy]);
    APRM.store.setSettings({ alphaMilli: alpha, threshold: thr, eps: eps, speed: speed });
    return '';
  }

  function onStart() {
    var bad = readSettings();
    if (bad) { showMessage('run-error', bad); return; }
    start();
  }

  function onAdd() {
    var fields = ['id', 'arrival', 'duration', 'cpu', 'mem', 'priority'];
    var job = {};
    for (var i = 0; i < fields.length; i++) {
      var n = numberOf('ra-' + fields[i]);
      if (!isFinite(n) || Math.floor(n) !== n) { showMessage('ra-error', fields[i] + ' must be a whole number.'); return; }
      job[fields[i]] = n;
    }
    var res = addJobMidRun(job);
    if (res.ok) { prepareAddForm(); }
  }

  /* Next id and arrival = now + 1 (the D59 choice) for the add form. */
  function prepareAddForm() {
    var idEl = byId('ra-id');
    var arrEl = byId('ra-arrival');
    var jobs = run ? run.jobs : APRM.store.get().jobs;
    var m = -1;
    for (var i = 0; i < jobs.length; i++) { if (jobs[i].id > m) { m = jobs[i].id; } }
    if (idEl) { idEl.value = String(m + 1); }
    if (arrEl) { arrEl.value = String(run && run.state ? run.state.now + 1 : 0); }
  }

  /* Keep the add form's defaults current (next unused id, arrival = now + 1)
   * unless the user is typing in it. Called from render() when not playing. */
  function refreshAddForm() {
    var a = typeof document !== 'undefined' ? document.activeElement : null;
    if (a && typeof a.id === 'string' && a.id.indexOf('ra-') === 0) { return; }
    prepareAddForm();
  }

  var mounted = false;

  /* Connect the Run panel, canvas click and job list click. Missing elements are skipped. */
  function mount() {
    if (mounted) { return; }
    mounted = true;
    var sel = byId('run-policy');
    if (sel && sel.children.length === 0) {
      for (var i = 0; i < POLICY_NAMES.length; i++) {
        var opt = document.createElement('option');
        opt.setAttribute('value', POLICY_NAMES[i]);
        opt.textContent = copyText('policy.' + POLICY_NAMES[i], POLICY_NAMES[i]);
        sel.appendChild(opt);
      }
    }
    var on = function (id, fn) { var el = byId(id); if (el) { el.addEventListener('click', fn); } };
    on('run-start', onStart);
    on('run-play', function () { if (status === 'playing') { pause(); } else { play(); } });
    on('run-step', stepOnce);
    on('run-jump', jumpToEnd);
    on('run-reset', reset);
    on('ra-submit', onAdd);
    var sp = byId('run-speed');
    if (sp) {
      sp.setAttribute('max', String(MAX_STEPS_PER_FRAME));
      sp.addEventListener('input', function () { setSpeed(sp.value); });
    }
    var cv = byId('run-canvas');
    if (cv) {
      cv.addEventListener('click', function (ev) {
        var r = typeof cv.getBoundingClientRect === 'function' ? cv.getBoundingClientRect() : { left: 0, top: 0 };
        var id = APRM.canvas.hit(cv, ev.clientX - r.left, ev.clientY - r.top);
        select(id === selected ? null : id);
      });
    }
    var jl = byId('job-list');
    if (jl) {
      jl.addEventListener('click', function (ev) {
        var t = ev.target && ev.target.textContent ? String(ev.target.textContent) : '';
        var m = /^Job (\d+):/.exec(t);
        if (m) { select(Number(m[1])); }
      });
    }
    APRM.store.subscribe(function (s, changed) {
      var panel = byId('run-panel');
      if (panel) { panel.hidden = s.mode !== 'run'; }
      if (changed === 'mode' && s.mode !== 'run') { pause(); }
      if (changed === 'settings' || changed === 'policies' || changed === 'mode') { syncInputs(s); }
      if (changed === 'jobs' && run === null) { render(); }
      if (changed === 'details' || changed === 'settings') { render(); }
    });
    syncInputs(APRM.store.get());
    setSpeed(APRM.store.get().settings.speed || 1);
    var spEl = byId('run-speed');
    if (spEl) { spEl.value = String(speed); }
    prepareAddForm();
    render();
  }

  /* Show the store's settings in the Run panel's inputs. */
  function syncInputs(s) {
    var set = function (id, v) { var el = byId(id); if (el && el.value !== String(v)) { el.value = String(v); } };
    set('run-alpha', s.settings.alphaMilli);
    set('run-threshold', s.settings.threshold);
    set('run-eps', s.settings.eps);
    set('run-policy', s.policies[0] || 'fcfs');
  }

  APRM.player = {
    MAX_STEPS_PER_FRAME: MAX_STEPS_PER_FRAME,
    SLICE_STEPS: SLICE_STEPS,
    POLICY_NAMES: POLICY_NAMES,
    setScheduler: setScheduler,
    start: start,
    reset: reset,
    play: play,
    pause: pause,
    stepOnce: stepOnce,
    setSpeed: setSpeed,
    jumpToEnd: jumpToEnd,
    tickFrame: tickFrame,
    addJobMidRun: addJobMidRun,
    select: select,
    mount: mount,
    handle: function () { return run ? run.handle : null; },
    snapshot: function () {
      return {
        status: status, speed: speed, selected: selected, error: errorText,
        events: run ? run.events : 0, state: run ? run.state : null, metrics: run ? run.metrics : null,
        entries: run ? run.entries : [], bars: run ? run.bars : {}, jobs: run ? run.jobs : []
      };
    }
  };
})();
