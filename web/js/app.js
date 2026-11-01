/* app.js: loaded last (PRD section 7). Wires the page to the store, shows the
 * loading, empty and error states, and starts the engine.
 *
 * Idea: the page is a thin view. State lives in APRM.store; the engine is
 * reached only through APRM.wasm. This file draws text with textContent and
 * createElement (D34), and attaches events with
 * addEventListener, never inline handlers.
 *
 * Classic script: attaches APRM.app only.
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});

  var TEXT_LOADING = APRM.copy ? APRM.copy.get('engine.loading') : 'Starting the engine…';
  var TEXT_EMPTY = APRM.copy ? APRM.copy.get('build.empty') : 'No jobs yet. Add one, or start with an example.';

  /* Where the backup demo video lives (M13). Not recorded yet, so empty: the
   * error state then says the link is still to be added. Set when the video exists. */
  var BACKUP_VIDEO_URL = '';

  function byId(id) { return document.getElementById(id); }

  /* Remove all children of el. */
  function clear(el) {
    while (el.firstChild) { el.removeChild(el.firstChild); }
  }

  /* Show an engine error next to the thing that caused it: target is the
   * element that holds the message. err is an EngineError or any Error.
   * The engine's own message is used as is; "field: " names the field. O(1). */
  function showError(target, err) {
    clear(target);
    var text = err && err.message ? err.message : String(err);
    if (err && err.field) { text = err.field + ': ' + text; }
    target.textContent = text;
    target.hidden = false;
    target.setAttribute('role', 'alert');
  }

  function clearError(target) {
    clear(target);
    target.hidden = true;
  }

  /* One job as a line of text. Plain list until the editor (K-24) replaces it. */
  function jobLine(job) {
    return 'Job ' + job.id + ': arrives ' + job.arrival + ', runs ' + job.duration +
      ', CPU ' + job.cpu + ', memory ' + job.mem + ' MB, priority ' + job.priority;
  }

  /* Draw everything from the state. Cheap enough to call on every change. */
  function render(st) {
    var status = byId('engine-status');
    var errBox = byId('engine-error');
    var main = byId('app-main');

    main.setAttribute('data-engine', st.engine.status);
    main.setAttribute('data-mode', st.mode);

    if (st.engine.status === 'loading') {
      status.textContent = TEXT_LOADING;
    } else if (st.engine.status === 'ready') {
      status.textContent = APRM.copy.get('engine.ready');
    } else {
      status.textContent = APRM.copy.get('engine.error');
    }

    if (st.engine.status === 'error') {
      renderEngineError(errBox, st.engine.error);
    } else {
      clearError(errBox);
    }

    /* One step at a time: the run dashboard (machine, timeline, why, metrics) belongs to the Run step. */
    var dash = [main, byId('app-footer')];
    for (var d = 0; d < dash.length; d++) { if (dash[d]) { dash[d].hidden = st.mode !== 'run'; } }
    var sw = byId('details-switch');
    if (sw && sw.checked !== st.details) { sw.checked = st.details; }
    var root = document.documentElement;
    if (root && typeof root.setAttribute === 'function') { root.setAttribute('data-details', st.details ? 'on' : 'off'); }

    var modeButtons = document.querySelectorAll('[data-mode-button]');
    for (var i = 0; i < modeButtons.length; i++) {
      var on = modeButtons[i].getAttribute('data-mode-button') === st.mode;
      modeButtons[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      modeButtons[i].setAttribute('aria-current', on ? 'step' : 'false');
    }

    byId('machine-text').textContent = 'CPU ' + st.machine.cpu + ' cores, memory ' + st.machine.mem + ' MB';

    var list = byId('job-list');
    var empty = byId('jobs-empty');
    clear(list);
    if (st.jobs.length === 0) {
      empty.textContent = TEXT_EMPTY;
      empty.hidden = false;
    } else {
      empty.hidden = true;
      for (var j = 0; j < st.jobs.length; j++) {
        var li = document.createElement('li');
        li.textContent = jobLine(st.jobs[j]);
        list.appendChild(li);
      }
    }

    /* canvas-empty, whylog-empty and metrics-empty are owned by player.js once mounted. */
  }

  /* The big error state for a failed engine: a clear message plus the backup video link. */
  function renderEngineError(box, detail) {
    clear(box);
    box.hidden = false;
    box.setAttribute('role', 'alert');

    var title = document.createElement('strong');
    title.textContent = 'The scheduling engine could not be loaded.';
    box.appendChild(title);

    var why = document.createElement('p');
    why.textContent = detail || 'Unknown problem.';
    box.appendChild(why);

    var video = document.createElement('p');
    if (BACKUP_VIDEO_URL) {
      video.appendChild(document.createTextNode('You can still watch the recorded demo: '));
      var a = document.createElement('a');
      a.setAttribute('href', BACKUP_VIDEO_URL);
      a.textContent = 'backup video';
      video.appendChild(a);
    } else {
      video.textContent = 'The link to the backup video will be added here once it is recorded.';
    }
    box.appendChild(video);
  }

  /* Switch-mode buttons. */
  function wireModeButtons() {
    var buttons = document.querySelectorAll('[data-mode-button]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function (ev) {
        var to = ev.currentTarget.getAttribute('data-mode-button');
        APRM.store.setMode(to);
        focusStep(to);
      });
    }
  }

  var toastTimer = null;

  /* A short message at the bottom of the page (aria-live). Hides itself after a few seconds. */
  function toast(text) {
    var el = byId('toast');
    if (!el) { return; }
    el.textContent = text;
    if (toastTimer !== null && typeof clearTimeout === 'function') { clearTimeout(toastTimer); }
    if (typeof setTimeout === 'function') { toastTimer = setTimeout(function () { el.textContent = ''; toastTimer = null; }, 4000); }
  }

  /* After a step change, move focus to that step's heading so Space and the arrow keys
   * work at once (they are ignored while a button has focus). Skipped when focus() is missing. */
  function focusStep(mode) {
    var panel = byId(mode + '-panel');
    var h = panel && panel.querySelector ? panel.querySelector('h2') : (mode === 'run' ? byId('run-panel') : null);
    if (!h || typeof h.focus !== 'function') { return; }
    h.setAttribute('tabindex', '-1');
    h.focus();
  }

  /* Next and Back buttons move to another step. */
  function wireNextButtons() {
    var buttons = document.querySelectorAll('[data-next]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function (ev) {
        var to = ev.currentTarget.getAttribute('data-next');
        APRM.store.setMode(to);
        if (typeof window.scrollTo === 'function') { window.scrollTo(0, 0); }
        focusStep(to);
      });
    }
  }

  /* Day and night button. The first look follows the system; a saved choice wins. The page theme is
   * the data-theme attribute on the root element (tokens.css holds both colour sets). */
  function applyTheme(theme) {
    var root = document.documentElement;
    if (root && typeof root.setAttribute === 'function') { root.setAttribute('data-theme', theme); }
    var btn = byId('theme-toggle');
    if (btn) { btn.textContent = APRM.copy.get(theme === 'dark' ? 'theme.day' : 'theme.night'); }
  }

  function wireThemeButton() {
    var btn = byId('theme-toggle');
    var theme = 'light';
    try {
      var saved = window.localStorage ? window.localStorage.getItem('aprm.theme') : null;
      if (saved === 'light' || saved === 'dark') { theme = saved; }
      else if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches) { theme = 'dark'; }
    } catch (e) { /* storage or matchMedia blocked: stay light */ }
    APRM.store.setTheme(theme);
    applyTheme(theme);
    if (!btn) { return; }
    btn.addEventListener('click', function () {
      var next = APRM.store.get().theme === 'dark' ? 'light' : 'dark';
      APRM.store.setTheme(next);
      applyTheme(next);
      try { if (window.localStorage) { window.localStorage.setItem('aprm.theme', next); } } catch (e) { /* storage blocked: fine */ }
    });
  }

  /* Show details switch. The choice is remembered when the browser allows it. */
  function wireDetailsSwitch() {
    var sw = byId('details-switch');
    if (!sw) { return; }
    try { if (window.localStorage && window.localStorage.getItem('aprm.details') === '1') { APRM.store.setDetails(true); } } catch (e) { /* storage blocked: fine */ }
    sw.addEventListener('change', function () {
      APRM.store.setDetails(sw.checked);
      try { if (window.localStorage) { window.localStorage.setItem('aprm.details', sw.checked ? '1' : '0'); } } catch (e) { /* storage blocked: fine */ }
    });
  }

  /* Connect the Build mode scripts (K-24) and the Run mode scripts (K-25) that are present on the page. */
  function mountBuildMode() {
    ['presets', 'editor', 'generator', 'whylog', 'player', 'compare'].forEach(function (name) {
      if (APRM[name] && typeof APRM[name].mount === 'function') { APRM[name].mount(); }
    });
  }

  /* Start: show loading, load the engine, then ready or error. Returns a
   * Promise that always resolves (an engine failure is a state, not a crash). */
  function start() {
    APRM.copy.apply(document);
    wireModeButtons();
    wireNextButtons();
    wireDetailsSwitch();
    wireThemeButton();
    if (APRM.keys && typeof APRM.keys.mount === 'function') { APRM.keys.mount(); }
    APRM.store.subscribe(render);
    mountBuildMode();
    APRM.store.setEngine('loading', '');
    return APRM.wasm.init().then(function () {
      APRM.store.setEngine('ready', '');
    }, function (err) {
      APRM.store.setEngine('error', err && err.message ? err.message : String(err));
    });
  }

  APRM.app = {
    TEXT_LOADING: TEXT_LOADING,
    TEXT_EMPTY: TEXT_EMPTY,
    showError: showError,
    toast: toast,
    clearError: clearError,
    start: start
  };

  /* Last script on the page: the DOM above it exists already. A failure here
   * must still leave a visible message, never a blank page. */
  try {
    start();
  } catch (e) {
    var box = document.getElementById('engine-error');
    if (box) { showError(box, e); }
  }
})();
