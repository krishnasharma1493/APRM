/* player.js: Run mode (PRD section 7 "The run loop"; K-25, redesigned in K-51).
 *
 * Idea: the C engine runs the schedule; this file only asks it to advance and shows what it reports.
 * The engine is stepped one moment at a time (aprm_step). A moment can write several log entries;
 * the page shows them one per Step, so Step = exactly one event. Between the entries of a moment the
 * view is built by runmodel.js from the engine's previous state and the entries so far; after the
 * moment's last entry the view IS the engine's state JSON (runmodel.snap). Metrics are the engine's,
 * read at each moment end. The page NEVER decides which job runs.
 *
 * State machine (status):
 *   idle      no simulation (nothing started, or reset)
 *   paused    a simulation exists and waits
 *   playing   a timer shows one event per beat (small cases) or a few ticks per beat (big cases)
 *   jumping   "jump to end" runs in slices, one slice per scheduled callback
 *   finished  every job has finished (adding a job re-opens the run)
 *   error     the engine refused something; the message is shown, handle destroyed
 *
 * Nothing runs while paused, idle or finished: the only timer is the play beat or a jump slice.
 * Handles: at most one simulation is alive; start(), reset() and every error destroy the old one.
 *
 * Views register with addView(fn); fn(frame, why) is called after every change with a read-only
 * frame (see frame()) and a reason: 'start', 'event', 'events', 'jump', 'select', 'reset',
 * 'settings', 'details', 'add', 'error', 'status' (play, pause or speed), 'mode' (the Run step opened). Elements are made with createElement and textContent only.
 *
 * Classic script: attaches APRM.player only. Nothing runs at load time.
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});

  var POLICY_NAMES = ['fcfs', 'priority', 'sjf', 'aging', 'aging_reserve', 'knapsack'];
  var SPEEDS = [0.5, 1, 2, 4];
  var LARGE = 40;              /* more jobs than this: play by ticks, without per-event motion */
  var BEAT_MS = 900;           /* one event per beat at 1x on a small case */
  var LARGE_BEAT_MS = 120;     /* a big case advances a few ticks every beat */
  var MAX_EVENTS_PER_BEAT = 2000;
  var SLICE_STEPS = 500;       /* engine moments per jump slice */
  var MAX_STEPS_PER_FRAME = 200;   /* the most engine moments one beat of a big case may fetch */

  /* ---------- the run ---------- */

  var run = null;          /* null = idle; otherwise see start() */
  var speed = 1;           /* 0.5, 1, 2 or 4 */
  var status = 'idle';
  var errorText = '';
  var timerId = null;
  var selected = null;
  var source = 'sample';   /* 'yours' = the Build jobs, 'sample' = the design's 8 jobs, 'big' = the 500-job big case */
  var stale = false;       /* the scheduler or a setting changed after this run started */
  var views = [];

  /* The timers. Replaceable so tests can run beats and slices by hand. */
  var scheduler = {
    wait: function (fn, ms) { return setTimeout(fn, ms); },
    cancel: function (id) { clearTimeout(id); }
  };

  function setScheduler(s) {
    scheduler = { wait: s.wait || scheduler.wait, cancel: s.cancel || scheduler.cancel };
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
  function text(id, value) { var el = byId(id); if (el && el.textContent !== value) { el.textContent = value; } }

  function showMessage(id, message) {
    var el = byId(id);
    if (!el) { return; }
    el.textContent = message || '';
    el.hidden = !message;
  }

  var SETTING_FIELDS = ['alpha_milli', 'reserve_threshold', 'knapsack_eps'];

  /* A setting is wrong: open More settings, where it can be fixed, and say so before the engine's sentence. */
  function settingsWords(sentence) {
    var more = byId('run-more');
    if (more) { more.open = true; }
    return copyText('run.error.settings', '', { why: sentence }) || sentence;
  }

  function errorMessage(err) {
    var m = err && err.message ? err.message : String(err);
    if (err && SETTING_FIELDS.indexOf(err.field) >= 0) { return settingsWords(m); }
    /* The engine's sentence usually starts with the field already: do not say it twice. */
    return err && err.field && m.indexOf(err.field) !== 0 ? err.field + ': ' + m : m;
  }

  /* ---------- the case the run uses ---------- */

  /* The machine and jobs of the chosen source. Returns { cpu, mem, jobs } (copies). O(jobs). */
  function caseOf(src) {
    if (src === 'big' && APRM.generator && APRM.generator.bigCase) { return APRM.generator.bigCase(); }
    if (src === 'sample' && APRM.generator && APRM.generator.sampleCase) { return APRM.generator.sampleCase(); }
    var st = APRM.store.get();
    return { cpu: st.machine.cpu, mem: st.machine.mem, jobs: st.jobs.map(copyJob) };
  }

  function copyJob(j) {
    return { id: j.id, arrival: j.arrival, duration: j.duration, cpu: j.cpu, mem: j.mem, priority: j.priority };
  }

  /* The whole run's length, told by the engine itself: a second handle with the same machine,
   * scheduler and jobs runs to the end, and its metrics give the makespan and its log the number of
   * events. The timeline uses it to span the whole run from the first event, as the design does,
   * and Show details says "event N of M". JavaScript only reads the answers. Returns
   * { makespan, events } or null when the engine fails. O(engine run). */
  function preview(cpu, mem, policy, settings, jobs) {
    var h = null;
    try {
      h = APRM.wasm.create(cpu, mem, policy, settings.alphaMilli, settings.threshold, settings.eps);
      for (var i = 0; i < jobs.length; i++) {
        var j = jobs[i];
        APRM.wasm.addJob(h, j.id, j.arrival, j.duration, j.cpu, j.mem, j.priority);
      }
      var guard = 0;
      while (APRM.wasm.step(h) === 1 && guard++ < 10000000) { /* the engine schedules; we only wait */ }
      var m = APRM.wasm.metrics(h);
      var lg = APRM.wasm.log(h, 0);
      var events = 0;
      for (var k = 0; k < lg.length; k++) { if (lg[k].seq > events) { events = lg[k].seq; } }
      return { makespan: m && typeof m.makespan === 'number' ? m.makespan : null, events: events };
    } catch (e) {
      return null;
    } finally {
      if (h !== null) { try { APRM.wasm.destroy(h); } catch (e2) { /* ignore */ } }
    }
  }

  /* The current run's { makespan, events } from preview(), computed once per run on first use;
   * null with no run or when the engine could not tell. O(engine run) once, then O(1). */
  function planOf() {
    if (run === null) { return null; }
    if (run.plan === undefined) { run.plan = preview(run.cpu, run.mem, run.policy, run.settings, run.jobs); }
    return run.plan;
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
    if (timerId !== null) { scheduler.cancel(timerId); timerId = null; }
  }

  /* ---------- reading the engine ---------- */

  /* One engine moment: aprm_step, its new log entries, and (unless light) the state and metrics
   * at its end. The entries go to the queue of events not shown yet; each knows its moment.
   * A light read still takes the state when the moment saves a spot (for its shadow time).
   * Returns the number of new entries, or -1 when the engine had nothing left. Throws EngineError. */
  function fetchMoment(light) {
    if (APRM.wasm.step(run.handle) === 0) { run.engineDone = true; return -1; }
    var fresh = APRM.wasm.log(run.handle, run.lastSeq);
    var hasReserve = false;
    for (var i = 0; i < fresh.length; i++) {
      if (fresh[i].seq > run.lastSeq) { run.lastSeq = fresh[i].seq; }
      if (fresh[i].kind === 'RESERVE') { hasReserve = true; }
    }
    var m = { state: null, metrics: null };
    if (!light || hasReserve) { m.state = APRM.wasm.state(run.handle); }
    if (!light) { m.metrics = APRM.wasm.metrics(run.handle); }
    run.moments++;
    if (fresh.length === 0) {           /* a knapsack window with nothing to choose: only the clock moved */
      if (m.state) { APRM.runmodel.snap(run.view, m.state); run.state = m.state; }
      if (m.metrics) { run.metrics = m.metrics; }
      return 0;
    }
    for (var k = 0; k < fresh.length; k++) {
      run.queue.push({ e: fresh[k], m: m, last: k === fresh.length - 1 });
    }
    return fresh.length;
  }

  /* Show the next queued entry: apply it, record it, and at its moment's end snap to the engine. O(n). */
  function showNext() {
    var q = run.queue.shift();
    var e = q.e;
    APRM.runmodel.apply(run.view, e, { jobs: run.byId, policy: run.policy, alphaMilli: run.settings.alphaMilli, end: q.m.state });
    APRM.runmodel.record(run.hist, e, run.byId, run.view);
    run.entries.push(e);
    run.last = e;
    if (q.last) {
      if (q.m.state) { APRM.runmodel.snap(run.view, q.m.state); run.state = q.m.state; }
      if (q.m.metrics) { run.metrics = q.m.metrics; }
    }
    return e;
  }

  /* True when every job has finished and nothing is left to show. O(1). */
  function allShown() {
    return run.queue.length === 0 && run.view.done >= run.view.total;
  }

  /* Make sure at least one entry is queued, stepping the engine (full reads) as needed.
   * Returns false when the run has nothing more to show. Throws EngineError. */
  function ensureQueued() {
    var guard = 0;
    while (run.queue.length === 0) {
      if (run.engineDone || run.view.done >= run.view.total) { return false; }
      if (fetchMoment(false) < 0) { return false; }
      if (++guard > 1000000) { return false; }
    }
    return true;
  }

  /* ---------- the frame every view reads ---------- */

  function frame() {
    return {
      status: status, speed: speed, selected: selected, error: errorText, source: source, stale: stale,
      large: run ? run.jobs.length > LARGE : (source === 'big' || APRM.store.get().jobs.length > LARGE),
      events: run ? run.entries.length : 0,
      plan: run && run.plan !== undefined ? run.plan : null,
      state: run ? run.view : null,
      engineState: run ? run.state : null,
      metrics: run ? run.metrics : null,
      entries: run ? run.entries : [],
      last: run ? run.last : null,
      hist: run ? run.hist : null,
      jobs: run ? run.jobs : [],
      byId: run ? run.byId : {},
      policy: run ? run.policy : chosenPolicy(),
      settings: run ? run.settings : APRM.store.get().settings,
      cap: run ? { cpu: run.cpu, mem: run.mem } : (function () { var c = caseOf(source); return { cpu: c.cpu, mem: c.mem }; })(),
      pending: run ? run.queue.length : 0
    };
  }

  function chosenPolicy() {
    var p = APRM.store.get().policies;
    return p && p[0] ? p[0] : 'fcfs';
  }

  /* ---------- drawing ---------- */

  /* Redraw the shell and tell every view. why says what changed (see the header). */
  function render(why) {
    var f = frame();
    drawShell(f);
    for (var i = 0; i < views.length; i++) {
      try { views[i](f, why || 'event'); } catch (e) { if (window.console && console.error) { console.error(e); } }
    }
  }

  function addView(fn) { views.push(fn); }

  /* The head line, scheduler cards, settings line, bar, status pill, clock and event banner. */
  function drawShell(f) {
    var c = run ? null : caseOf(source);
    var n = run ? run.jobs.length : c.jobs.length;
    var cpu = run ? run.cpu : c.cpu, mem = run ? run.mem : c.mem;
    var gb = Math.round(mem / 1024 * 100) / 100;
    var line = copyText('run.dataline', n + ' jobs on ' + cpu + ' cores and ' + mem + ' MB.', { n: n, jobs: n === 1 ? 'job' : 'jobs', cpu: cpu, cores: cpu === 1 ? 'core' : 'cores', mem: mem, gb: gb });
    if (run && run.added > 0) { line += ' ' + copyText('run.dataline.added', '', { n: run.added }); }
    text('run-dataline', line);

    var yours = byId('run-source-yours');
    if (yours) {
      var st = APRM.store.get();
      yours.textContent = copyText('run.source.yours', 'Your jobs', { n: st.jobs.length });
      yours.setAttribute('aria-pressed', source === 'yours' ? 'true' : 'false');
      yours.hidden = st.jobs.length === 0;       /* the design shows it only when Build has jobs */
    }
    var sample = byId('run-source-sample');
    if (sample) { sample.setAttribute('aria-pressed', source === 'sample' ? 'true' : 'false'); }
    var big = byId('run-source-big');
    if (big) { big.setAttribute('aria-pressed', source === 'big' ? 'true' : 'false'); }

    var pol = chosenPolicy();
    var mbox = byId('run-methods');
    var cards = mbox && mbox.children ? mbox.children : [];
    for (var i = 0; i < cards.length; i++) {
      var on = cards[i].getAttribute('data-policy') === pol;
      cards[i].setAttribute('aria-checked', on ? 'true' : 'false');
      cards[i].setAttribute('tabindex', on ? '0' : '-1');
    }
    drawSettingsLine();

    var startBtn = byId('run-start');
    if (startBtn) { startBtn.textContent = stale && run ? copyText('run.again', 'Run again') : copyText('run.start', 'Run'); }
    var stEl = byId('run-stale');
    if (stEl) { stEl.hidden = !(stale && run); }

    var pill = byId('run-status');
    if (pill) {
      pill.setAttribute('data-status', status);
      text('run-status-text', copyText('status.' + status, status));
    }
    text('run-clock', copyText('run.tick', 'Time: tick ' + (run ? run.view.now : 0), { now: run ? run.view.now : 0 }));
    var sbox = byId('run-speed');
    var spd = sbox && sbox.children ? sbox.children : [];
    for (var s = 0; s < spd.length; s++) { spd[s].setAttribute('aria-pressed', Number(spd[s].getAttribute('data-speed')) === speed ? 'true' : 'false'); }

    drawEvent(f);
    updateButtons();
    if (status !== 'playing') { refreshAddForm(); }
  }

  var KIND_WORD = { ARRIVE: 'kind.ARRIVE', START: 'kind.START', SKIP: 'kind.SKIP', RESERVE: 'kind.RESERVE',
    BACKFILL: 'kind.BACKFILL', FINISH: 'kind.FINISH', BATCH_SELECT: 'kind.BATCH_SELECT' };

  /* The banner under the stage: the newest event in the engine's own words. */
  function drawEvent(f) {
    var box = byId('run-event');
    if (!box) { return; }
    var e = f.last;
    var kindEl = byId('run-event-kind');
    var textEl = byId('run-event-text');
    var rawEl = byId('run-event-raw');
    var idle = byId('run-event-idle');
    if (idle) {
      idle.hidden = !!e;
      idle.textContent = run ? copyText('run.event.ready', 'Press Play to start, or Step to see one event.') : copyText('run.event.none', 'Press Run.');
    }
    if (kindEl) { kindEl.hidden = !e; kindEl.textContent = e ? copyText(KIND_WORD[e.kind] || 'kind.other', e.kind) : ''; kindEl.setAttribute('data-kind', e ? e.kind : ''); }
    if (textEl) { textEl.hidden = !e; textEl.textContent = e ? e.msg : ''; }
    if (rawEl) {
      rawEl.hidden = !e || !detailsOn();
      var pl = e && detailsOn() ? planOf() : null;
      rawEl.textContent = e ? copyText('run.event.raw', '', { kind: e.kind, n: f.events, total: pl && pl.events ? Math.max(pl.events, f.events) : f.events, t: e.t }) : '';
    }
    box.setAttribute('data-kind', e ? e.kind : '');
  }

  /* One line with the exact settings, always visible even when "More settings" is closed. */
  function drawSettingsLine() {
    var s = APRM.store.get().settings;
    text('run-settings-summary', copyText('run.settings', 'alpha = ' + s.alphaMilli, { alpha: alphaWords(s.alphaMilli), milli: s.alphaMilli, t: s.threshold, eps: s.eps }));
  }

  /* alpha_milli as a decimal for people (100 -> 0.1), from integers. */
  function alphaWords(milli) {
    var whole = Math.floor(milli / 1000), frac = String(milli % 1000);
    while (frac.length < 3) { frac = '0' + frac; }
    frac = frac.replace(/0+$/, '');
    return frac ? whole + '.' + frac : String(whole);
  }

  function updateButtons() {
    var play = byId('run-play');
    if (play) { play.textContent = status === 'playing' ? copyText('run.pause', 'Pause') : copyText('run.play', 'Play'); }
    var live = run !== null;
    var hasJobs = live || caseOf(source).jobs.length > 0;      /* Play, Step and Jump start the run themselves */
    var set = function (id, disabled) { var el = byId(id); if (el) { el.disabled = disabled; } };
    set('run-play', (!live && !hasJobs) || status === 'jumping');
    set('run-step', (!live && !hasJobs) || status === 'playing' || status === 'jumping' || status === 'finished');
    set('run-jump', (!live && !hasJobs) || status === 'jumping' || status === 'finished');
    set('run-reset', !live);
    set('ra-submit', !live);
    set('run-add-open', !live);
    /* A button that just became disabled drops keyboard focus; Reset keeps it on the controls. */
    var focused = document.activeElement;
    var resetBtn = byId('run-reset');
    if (focused && focused.disabled && resetBtn && !resetBtn.disabled) { resetBtn.focus(); }
  }

  /* ---------- starting and stopping ---------- */

  /* Handle a failure: destroy the simulation, remember the words, show them. */
  function fail(err, target) {
    cancelTimers();
    destroyRun();
    status = 'error';
    errorText = errorMessage(err);
    showMessage(target || 'run-error', errorText);
    render('error');
  }

  /* Start (or restart) from the chosen source: destroy the old simulation, create a new one, add
   * every job, read the first state. Paused before the first event. Returns true on success. O(jobs). */
  /* override: { cpu, mem, jobs } to run instead of the chosen source (Play after the end replays
   * the run just shown, jobs added during it included). */
  function start(override) {
    cancelTimers();
    destroyRun();
    selected = null;
    errorText = '';
    stale = false;
    showMessage('run-error', '');
    showMessage('ra-error', '');
    var c = override && override.jobs ? override : caseOf(source);
    if (c.jobs.length === 0) {
      status = 'idle';
      showMessage('run-error', copyText('run.nojobs', 'There are no jobs. Add some in Build mode first.'));
      render('reset');
      return false;
    }
    var st = APRM.store.get();
    var policy = chosenPolicy();
    var settings = { alphaMilli: st.settings.alphaMilli, threshold: st.settings.threshold, eps: st.settings.eps };
    var h = null;
    try {
      h = APRM.wasm.create(c.cpu, c.mem, policy, settings.alphaMilli, settings.threshold, settings.eps);
      var byIdMap = {};
      for (var b = 0; b < c.jobs.length; b++) { byIdMap[c.jobs[b].id] = c.jobs[b]; }
      run = { handle: h, jobs: c.jobs, byId: byIdMap, cpu: c.cpu, mem: c.mem, policy: policy, settings: settings,
        queue: [], entries: [], last: null, lastSeq: 0, moments: 0, engineDone: false, added: 0,
        view: null, state: null, metrics: null, hist: APRM.runmodel.history() };
      for (var i = 0; i < c.jobs.length; i++) {
        var j = c.jobs[i];
        try {
          APRM.wasm.addJob(h, j.id, j.arrival, j.duration, j.cpu, j.mem, j.priority);
        } catch (e) {
          if (e && !e.field) { e.message = 'Job ' + j.id + ': ' + e.message; }
          throw e;
        }
      }
      run.state = APRM.wasm.state(h);
      run.view = APRM.runmodel.fromState(run.state);
      run.metrics = APRM.wasm.metrics(h);
      run.plan = undefined;       /* asked for by planOf() when a view needs the whole run's length */
    } catch (err) {
      if (run === null && h !== null) { try { APRM.wasm.destroy(h); } catch (e2) { /* ignore */ } }
      fail(err, 'run-error');
      return false;
    }
    status = 'paused';
    render('start');
    return true;
  }

  /* Throw the simulation away and return to the first screen. */
  function reset() {
    cancelTimers();
    destroyRun();
    selected = null;
    status = 'idle';
    errorText = '';
    stale = false;
    showMessage('run-error', '');
    showMessage('ra-error', '');
    render('reset');
  }

  /* ---------- stepping ---------- */

  /* Show one event. Returns the entry, or null when nothing is left (status becomes finished). */
  function advanceOne() {
    if (!ensureQueued()) { status = 'finished'; return null; }
    var e = showNext();
    if (allShown()) { status = 'finished'; }
    return e;
  }

  /* One event while paused. */
  function stepOnce() {
    if (run === null || status === 'playing' || status === 'jumping' || status === 'finished') { updateButtons(); return false; }
    var e;
    try { e = advanceOne(); } catch (err) { fail(err); return false; }
    if (status !== 'finished') { status = 'paused'; }
    render(e ? 'event' : 'events');
    return true;
  }

  function isLarge() { return run !== null && run.jobs.length > LARGE; }

  /* How many ticks one beat of a big case moves: 2 per beat at 1x, more for very big cases. */
  function ticksPerBeat() {
    return Math.max(1, Math.round(2 * speed * Math.max(1, run.jobs.length / 250)));
  }

  /* One beat of the play loop. Small case: one event. Big case: every event up to a few ticks later. */
  function beat() {
    timerId = null;
    if (status !== 'playing' || run === null) { return; }
    var why = 'event';
    try {
      if (isLarge()) {
        why = 'events';
        var target = run.view.now + ticksPerBeat();
        var shown = 0, moments = 0;
        while (shown < MAX_EVENTS_PER_BEAT && moments < MAX_STEPS_PER_FRAME) {
          if (run.queue.length === 0) {
            if (run.engineDone || run.view.done >= run.view.total) { break; }
            var got = fetchMoment(false);
            moments++;
            if (got < 0) { break; }
            continue;
          }
          if (run.queue[0].e.t > target && shown > 0) { break; }
          showNext();
          shown++;
        }
        if (allShown() || (run.engineDone && run.queue.length === 0)) { status = 'finished'; }
      } else {
        advanceOne();
      }
    } catch (err) { fail(err); return; }
    render(why);
    if (status === 'playing') { timerId = scheduler.wait(beat, isLarge() ? LARGE_BEAT_MS : Math.round(BEAT_MS / speed)); }
  }

  function play() {
    if (run === null || status === 'playing' || status === 'jumping' || status === 'finished') { updateButtons(); return false; }
    status = 'playing';
    render('status');
    timerId = scheduler.wait(beat, 0);
    return true;
  }

  function pause() {
    if (status !== 'playing' && status !== 'jumping') { return false; }
    cancelTimers();
    status = 'paused';
    render('status');
    return true;
  }

  /* 0.5, 1, 2 or 4 (the nearest allowed value). Returns the value used. */
  function setSpeed(n) {
    var v = Number(n);
    var best = 1, gap = Infinity;
    for (var i = 0; i < SPEEDS.length; i++) {
      var d = Math.abs(SPEEDS[i] - v);
      if (isFinite(d) && d < gap) { gap = d; best = SPEEDS[i]; }
    }
    speed = best;
    if (APRM.store) { APRM.store.setSettings({ speed: speed }); }
    render('status');
    return speed;
  }

  /* Run to the end in slices of SLICE_STEPS moments, one slice per callback, so the tab stays
   * responsive even for 5,000 jobs. Every entry is still applied (the timeline needs them). */
  function jumpToEnd() {
    if (run === null || status === 'jumping' || status === 'finished') { return false; }
    cancelTimers();
    status = 'jumping';
    render('status');
    timerId = scheduler.wait(slice, 0);
    return true;
  }

  function slice() {
    timerId = null;
    if (status !== 'jumping' || run === null) { return; }
    try {
      var n = 0;
      while (run.queue.length > 0) { showNext(); }
      while (n < SLICE_STEPS && !run.engineDone && run.view.done < run.view.total) {
        if (fetchMoment(true) < 0) { break; }
        while (run.queue.length > 0) { showNext(); }
        n++;
      }
      if (run.engineDone || run.view.done >= run.view.total) {
        run.state = APRM.wasm.state(run.handle);
        APRM.runmodel.snap(run.view, run.state);
        run.metrics = APRM.wasm.metrics(run.handle);
        status = 'finished';
        render('jump');
        return;
      }
      /* between slices the page shows the engine's own state, so a pause mid-jump is exact */
      run.state = APRM.wasm.state(run.handle);
      APRM.runmodel.snap(run.view, run.state);
      run.metrics = APRM.wasm.metrics(run.handle);
    } catch (err) { fail(err); return; }
    render('jump');
    timerId = scheduler.wait(slice, 0);
  }

  /* ---------- selection ---------- */

  /* Select a job (or null): every view highlights it and the Why log shows only its lines. */
  function select(id) {
    selected = (id === null || id === undefined || isNaN(id)) ? null : Number(id);
    render('select');
  }

  /* ---------- adding a job mid-run ---------- */

  /* Pause, show what the engine already decided, validate, add with arrival >= now, then resume if it
   * was playing. D59: arrival equal to now is allowed; such a job is selected after jobs that already
   * started at this time. Returns { ok: true } or { ok: false, message, field }. */
  function addJobMidRun(job) {
    if (run === null) { return { ok: false, message: copyText('run.add.first', 'Press Run first.'), field: '' }; }
    var wasPlaying = status === 'playing';
    if (status === 'playing' || status === 'jumping') { pause(); }
    while (run.queue.length > 0) { showNext(); }     /* the page now shows exactly where the engine is */
    if (allShown()) { status = 'finished'; }
    var machine = { cpu: run.cpu, mem: run.mem };
    if (APRM.editor && typeof APRM.editor.jobProblems === 'function') {
      var ps = APRM.editor.jobProblems(job, machine);
      if (ps.length > 0) { showMessage('ra-error', ps[0].message); render('add'); return { ok: false, message: ps[0].message, field: ps[0].field }; }
    }
    try {
      APRM.wasm.addJob(run.handle, job.id, job.arrival, job.duration, job.cpu, job.mem, job.priority);
    } catch (err) {
      /* a rejected job changes nothing (D54), so the run stays alive */
      var msg = errorMessage(err);
      showMessage('ra-error', msg);
      render('add');
      return { ok: false, message: msg, field: err && err.field ? err.field : '' };
    }
    showMessage('ra-error', '');
    var copy = copyJob(job);
    run.jobs.push(copy);
    run.plan = undefined;
    run.byId[copy.id] = copy;
    run.added++;
    try {
      run.state = APRM.wasm.state(run.handle);
      APRM.runmodel.snap(run.view, run.state);
      run.metrics = APRM.wasm.metrics(run.handle);
    } catch (err2) { fail(err2); return { ok: false, message: errorText, field: '' }; }
    run.engineDone = false;
    if (status === 'finished') { status = 'paused'; }
    if (source === 'yours') {
      var stored = APRM.store.get().jobs;
      stored.push(copyJob(job));
      ownChange = true;           /* the run's own mid-run add, not a new case */
      APRM.store.setJobs(stored);
      ownChange = false;
    }
    render('add');
    if (wasPlaying) { play(); }
    return { ok: true };
  }

  /* ---------- the page ---------- */

  /* Arriving on Run: Build's jobs when there are some (as the design does after Build), the
   * sample otherwise. A run in progress keeps its source. O(1). */
  function enterRun(s) {
    if (run !== null) { return; }
    if (s.jobs.length > 0 && source !== 'big') { source = 'yours'; }
    if (s.jobs.length === 0 && source === 'yours') { source = 'sample'; useSampleSettings(); }
  }

  var ownChange = false;

  function numberOf(id) {
    var el = byId(id);
    var s = el ? String(el.value).trim() : '';
    return s === '' ? NaN : Number(s);
  }

  /* Epsilon text, with the same grammar as the console program's --eps (D72):
   * digits, optionally a point and 1 to 3 digits; no sign, exponent, leading or
   * trailing point; 0.01 to 1. Returns the number (0.1) or an error text. */
  /* A decimal with at most three places as thousandths, from the text alone (no floating point):
   * "0.1" -> 100. Returns the integer or null when the text is not such a number. O(1). */
  function milliFromText(t) {
    var m = /^(\d{1,9})(?:\.(\d{1,3}))?$/.exec(t);
    if (!m) { return null; }
    return Number(m[1]) * 1000 + Number((m[2] || '').padEnd(3, '0'));
  }

  /* The settings rules: alpha 0 to 10 (PRD section 3), epsilon above 0 and up to 1 (0.01 at least),
   * T a whole number of ticks. The engine checks its own limits again. */
  function epsFromText(t) {
    var milli = milliFromText(t);
    if (milli === null || milli < 1 || milli > 1000) { return copyText('run.err.eps', 'epsilon must be above 0 and up to 1.'); }
    if (milli < 10) { return copyText('run.err.eps.min', 'epsilon must be at least 0.01.'); }
    return milli / 1000;
  }

  /* Read the settings inputs into the store; returns an error text or ''. */
  function readSettings() {
    var policyEl = byId('run-policy');
    var policy = policyEl && policyEl.value ? policyEl.value : chosenPolicy();
    var alphaText = byId('run-alpha') ? String(byId('run-alpha').value).trim() : '';
    var alpha = milliFromText(alphaText);
    var thr = numberOf('run-threshold');
    var epsText = byId('run-eps') ? String(byId('run-eps').value).trim() : '';
    var eps = epsFromText(epsText);
    if (alpha === null || alpha > 10000) { return copyText('run.err.alpha', 'alpha must be a number from 0 to 10.'); }   /* PRD section 3: alpha_milli 0 to 10,000 */
    if (!isFinite(thr) || Math.floor(thr) !== thr || thr < 0) { return copyText('run.err.t', 'T must be a whole number of ticks, 0 or more.'); }
    if (typeof eps === 'string') { return eps; }
    selfChange = true;
    APRM.store.setPolicies([policy]);
    APRM.store.setSettings({ alphaMilli: alpha, threshold: thr, eps: eps, speed: speed });
    selfChange = false;
    return '';
  }

  var selfChange = false;

  /* Make sure a run exists: from the first screen, Play, Step and Space simply begin. True when one does. */
  function ensureRun() {
    if (run === null) { onStart(false); }
    return run !== null;
  }

  /* Run (and Run again): read the settings, start a new run, and play it unless asked not to. */
  function onStart(andPlay) {
    var bad = readSettings();
    if (bad) { showMessage('run-settings-error', bad); settingsWords(bad); return; }
    showMessage('run-settings-error', '');
    if (start() && andPlay !== false) { play(); }
  }

  /* Play after the end: the same machine, scheduler, settings and jobs (added ones too), from the
   * first event, as the design replays its run. */
  function replay() {
    if (run === null) { onStart(true); return; }
    var c = { cpu: run.cpu, mem: run.mem, jobs: run.jobs.map(copyJob) };
    var bad = readSettings();
    if (bad) { showMessage('run-settings-error', bad); settingsWords(bad); return; }
    showMessage('run-settings-error', '');
    var added = run.added;
    if (start(c)) { run.added = added; play(); }
  }

  var ADD_FIELDS = ['arrival', 'duration', 'cpu', 'mem', 'priority'];

  function onAdd() {
    var job = { id: numberOf('ra-id') };
    if (!isFinite(job.id)) { job.id = nextId(); }
    for (var i = 0; i < ADD_FIELDS.length; i++) {
      var n = numberOf('ra-' + ADD_FIELDS[i]);
      if (!isFinite(n) || Math.floor(n) !== n) {
        showMessage('ra-error', copyText('run.add.whole', ADD_FIELDS[i] + ' must be a whole number.', { field: copyText('run.add.' + ADD_FIELDS[i], ADD_FIELDS[i]) }));
        return;
      }
      job[ADD_FIELDS[i]] = n;
    }
    var res = addJobMidRun(job);
    if (res.ok) {
      prepareAddForm();
      openAdd(false);
      if (APRM.app && APRM.app.toast) { APRM.app.toast(copyText('run.add.done', 'Job added.', { id: job.id, t: job.arrival })); }
    }
  }

  function nextId() {
    var jobs = run ? run.jobs : caseOf(source).jobs;
    var m = 0;
    for (var i = 0; i < jobs.length; i++) { if (jobs[i].id > m) { m = jobs[i].id; } }
    return m + 1;
  }

  /* Next id and arrival = now + 1 (the D59 choice) for the add form. */
  function prepareAddForm() {
    var idEl = byId('ra-id');
    var arrEl = byId('ra-arrival');
    if (idEl) { idEl.value = String(nextId()); }
    if (arrEl) { arrEl.value = String(run && run.state ? run.state.now + 1 : 0); }
    text('ra-submit', copyText('run.add.submit', 'Add job', { id: nextId() }));
    text('ra-note', copyText('run.add.note', '', { now: run && run.state ? run.state.now : 0 }));
  }

  /* Keep the add form's defaults current unless the user is typing in it. */
  function refreshAddForm() {
    var a = typeof document !== 'undefined' ? document.activeElement : null;
    if (a && typeof a.id === 'string' && a.id.indexOf('ra-') === 0) { return; }
    prepareAddForm();
  }

  /* Open or close the inline add form; opening pauses first so the clock stands still. */
  function openAdd(on) {
    var box = byId('run-add');
    var btn = byId('run-add-open');
    if (!box) { return; }
    if (on && status === 'playing') { pause(); }
    if (on && run) { while (run.queue.length > 0) { showNext(); } if (allShown()) { status = 'finished'; } render('event'); }
    box.hidden = !on;
    if (btn) { btn.setAttribute('aria-expanded', on ? 'true' : 'false'); }
    if (on) { prepareAddForm(); var first = byId('ra-arrival'); if (first && first.focus) { first.focus(); } }
    else { showMessage('ra-error', ''); }
  }

  /* Choose a scheduler: the store keeps it; a run already made with another one is marked stale. */
  function choosePolicy(name) {
    if (POLICY_NAMES.indexOf(name) < 0 || !policyAvailable(name)) { return; }
    var sel = byId('run-policy');
    if (sel) { sel.value = name; }
    selfChange = true;
    APRM.store.setPolicies([name]);
    selfChange = false;
    if (run && run.policy !== name) { stale = true; }
    if (run && run.policy === name) { stale = false; }
    render('settings');
  }

  /* Switch between your jobs and the big case: the old run ends. */
  function setSource(src) {
    if (src !== 'yours' && src !== 'sample' && src !== 'big') { return; }
    if (src === source) { return; }
    source = src;
    if (src === 'sample') { useSampleSettings(); }
    reset();
  }

  /* The Sample case is the design's case: like a preset it brings its own threshold (T = 12), so its
   * job 3 gets a saved spot; the store's default stays the PRD's T = 50 (D87). */
  function useSampleSettings() {
    var S = APRM.generator && APRM.generator.SAMPLE;
    if (S && S.threshold !== undefined && APRM.store.get().settings.threshold !== S.threshold) {
      APRM.store.setSettings({ threshold: S.threshold });
    }
  }

  /* False for a scheduler the engine does not have yet (compare.js keeps the list). */
  function policyAvailable(name) {
    var list = APRM.compare && APRM.compare.POLICIES ? APRM.compare.POLICIES : [];
    for (var i = 0; i < list.length; i++) { if (list[i].name === name) { return list[i].available; } }
    return true;
  }

  /* The six scheduler cards (radio buttons) and the hidden select they drive. */
  function buildMethods() {
    var sel = byId('run-policy');
    if (sel && sel.children.length === 0) {
      for (var i = 0; i < POLICY_NAMES.length; i++) {
        var opt = document.createElement('option');
        opt.setAttribute('value', POLICY_NAMES[i]);
        opt.textContent = copyText('policy.' + POLICY_NAMES[i], POLICY_NAMES[i]);
        if (!policyAvailable(POLICY_NAMES[i])) {
          opt.disabled = true;
          opt.setAttribute('disabled', 'disabled');
          opt.textContent = copyText('short.' + POLICY_NAMES[i], POLICY_NAMES[i]) + copyText('policy.knapsack.soon', '');
        }
        sel.appendChild(opt);
      }
    }
    var box = byId('run-methods');
    if (!box || box.children.length > 0) { return; }
    for (var k = 0; k < POLICY_NAMES.length; k++) {
      var name = POLICY_NAMES[k];
      var b = document.createElement('button');
      b.setAttribute('type', 'button');
      b.setAttribute('role', 'radio');
      b.setAttribute('class', 'method');
      b.setAttribute('data-policy', name);
      b.setAttribute('aria-checked', 'false');
      var dot = document.createElement('span');
      dot.setAttribute('class', 'method-dot');
      dot.setAttribute('aria-hidden', 'true');
      var words = document.createElement('span');
      words.setAttribute('class', 'method-words');
      var plainName = document.createElement('span');
      plainName.textContent = copyText('method.' + name, name);
      var term = document.createElement('span');
      term.setAttribute('class', 'method-term');
      term.textContent = ' (' + copyText('term.' + name, name) + ')';
      words.appendChild(plainName); words.appendChild(term);
      b.appendChild(dot); b.appendChild(words);
      if (!policyAvailable(name)) { b.disabled = true; }
      box.appendChild(b);
    }
  }

  var mounted = false;

  /* Connect the Run panel. Missing elements are skipped. */
  function mount() {
    if (mounted) { return; }
    mounted = true;
    buildMethods();
    var on = function (id, fn) { var el = byId(id); if (el) { el.addEventListener('click', fn); } };
    on('run-start', function () { onStart(true); });
    /* Play after the end replays the run from the start, as the design does (the engine runs it again). */
    on('run-play', function () { if (status === 'playing') { pause(); } else if (status === 'finished') { replay(); } else if (ensureRun()) { play(); } });
    on('run-step', function () { if (ensureRun()) { stepOnce(); } });
    on('run-jump', function () { if (ensureRun()) { jumpToEnd(); } });
    on('run-reset', reset);
    on('ra-submit', onAdd);
    on('ra-cancel', function () { openAdd(false); });
    on('run-add-open', function () { var box = byId('run-add'); openAdd(!!(box && box.hidden)); });
    on('run-source-yours', function () { setSource('yours'); });
    on('run-source-sample', function () { setSource('sample'); });
    on('run-source-big', function () { setSource('big'); });
    var spd = byId('run-speed');
    if (spd) {
      spd.addEventListener('click', function (ev) {
        var t = ev.target;
        while (t && t !== spd && !(t.getAttribute && t.getAttribute('data-speed'))) { t = t.parentNode; }
        if (t && t !== spd && t.getAttribute) { setSpeed(Number(t.getAttribute('data-speed'))); }
      });
    }
    var methods = byId('run-methods');
    if (methods) {
      methods.addEventListener('click', function (ev) {
        var t = ev.target;
        while (t && t !== methods && !(t.getAttribute && t.getAttribute('data-policy'))) { t = t.parentNode; }
        if (t && t !== methods && t.getAttribute && !t.disabled) { choosePolicy(t.getAttribute('data-policy')); }
      });
      /* A radio group: arrow keys move the choice, like native radio buttons. */
      methods.addEventListener('keydown', function (ev) {
        var dir = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
        if (!dir) { return; }
        ev.preventDefault();
        var cur = POLICY_NAMES.indexOf(chosenPolicy());
        for (var step = 1; step <= POLICY_NAMES.length; step++) {
          var next = POLICY_NAMES[(cur + dir * step + POLICY_NAMES.length * 2) % POLICY_NAMES.length];
          if (policyAvailable(next)) {
            choosePolicy(next);
            var card = methods.querySelector ? methods.querySelector('[data-policy="' + next + '"]') : null;
            if (card && card.focus) { card.focus(); }
            return;
          }
        }
      });
    }
    var sel = byId('run-policy');
    if (sel) { sel.addEventListener('change', function () { choosePolicy(sel.value); }); }
    ['run-alpha', 'run-threshold', 'run-eps'].forEach(function (id) {
      var el = byId(id);
      if (el) {
        el.addEventListener('change', function () {
          var bad = readSettings();
          showMessage('run-settings-error', bad);   /* the design shows the rule right under the inputs */
          if (!bad) { if (run) { stale = true; } render('settings'); }
        });
      }
    });
    APRM.store.subscribe(function (s, changed) {
      var panel = byId('run-panel');
      if (panel) { panel.hidden = s.mode !== 'run'; }
      if (changed === 'mode' && s.mode !== 'run') { pause(); }
      if ((changed === 'settings' || changed === 'policies' || changed === 'mode') && !selfChange) { syncInputs(s); }
      /* The run belongs to the jobs and machine it started with; a new case ends it. */
      if ((changed === 'jobs' || changed === 'machine') && run !== null && !ownChange && source === 'yours') { reset(); }
      if (changed === 'jobs' && run === null) { enterRun(s); render('reset'); }
      if (changed === 'details' || changed === 'theme') { render('details'); }
      if (changed === 'mode' && s.mode === 'run') { enterRun(s); render('mode'); }
    });
    syncInputs(APRM.store.get());
    if (APRM.store.get().jobs.length > 0) { source = 'yours'; } else { useSampleSettings(); }
    var sp = Number(APRM.store.get().settings.speed);
    speed = SPEEDS.indexOf(sp) >= 0 ? sp : 1;
    prepareAddForm();
    render('reset');
  }

  /* Show the store's settings in the Run panel's inputs. */
  function syncInputs(s) {
    var set = function (id, v) { var el = byId(id); if (el && el.value !== String(v)) { el.value = String(v); } };
    set('run-alpha', alphaWords(s.settings.alphaMilli));
    set('run-threshold', s.settings.threshold);
    set('run-eps', s.settings.eps);
    set('run-policy', s.policies[0] || 'fcfs');
  }

  APRM.player = {
    SPEEDS: SPEEDS,
    LARGE: LARGE,
    BEAT_MS: BEAT_MS,
    LARGE_BEAT_MS: LARGE_BEAT_MS,
    SLICE_STEPS: SLICE_STEPS,
    MAX_STEPS_PER_FRAME: MAX_STEPS_PER_FRAME,
    POLICY_NAMES: POLICY_NAMES,
    setScheduler: setScheduler,
    plan: planOf,
    addView: addView,
    frame: frame,
    start: start,
    reset: reset,
    play: play,
    ensureRun: ensureRun,
    pause: pause,
    stepOnce: stepOnce,
    setSpeed: setSpeed,
    jumpToEnd: jumpToEnd,
    addJobMidRun: addJobMidRun,
    choosePolicy: choosePolicy,
    setSource: setSource,
    openAdd: openAdd,
    select: select,
    alphaWords: alphaWords,
    epsFromText: epsFromText,
    mount: mount,
    handle: function () { return run ? run.handle : null; },
    snapshot: function () {
      return {
        status: status, speed: speed, selected: selected, error: errorText, source: source, stale: stale,
        events: run ? run.entries.length : 0, state: run ? run.view : null, engineState: run ? run.state : null,
        metrics: run ? run.metrics : null, entries: run ? run.entries : [],
        bars: run ? APRM.runmodel.bars(run.hist) : {}, jobs: run ? run.jobs : [], pending: run ? run.queue.length : 0
      };
    }
  };
})();
