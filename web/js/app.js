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

  var TEXT_LOADING = 'Loading engine…';
  var TEXT_EMPTY = 'No jobs yet. Add one, load a preset, or generate a random set.';
  var TEXT_NO_RUN = 'Nothing to show yet. Add jobs, then press Run.';

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
      status.textContent = 'Engine ready';
    } else {
      status.textContent = 'Engine not available';
    }

    if (st.engine.status === 'error') {
      renderEngineError(errBox, st.engine.error);
    } else {
      clearError(errBox);
    }

    var modeButtons = document.querySelectorAll('[data-mode-button]');
    for (var i = 0; i < modeButtons.length; i++) {
      var on = modeButtons[i].getAttribute('data-mode-button') === st.mode;
      modeButtons[i].setAttribute('aria-pressed', on ? 'true' : 'false');
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

    byId('canvas-empty').textContent = TEXT_NO_RUN;
    byId('whylog-empty').textContent = 'The reasons for each decision appear here once a run starts.';
    byId('metrics-empty').textContent = 'Metrics appear when jobs have finished.';
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
        APRM.store.setMode(ev.currentTarget.getAttribute('data-mode-button'));
      });
    }
  }

  /* Connect the Build mode scripts (K-24) that are present on the page. */
  function mountBuildMode() {
    ['presets', 'editor', 'generator'].forEach(function (name) {
      if (APRM[name] && typeof APRM[name].mount === 'function') { APRM[name].mount(); }
    });
  }

  /* Start: show loading, load the engine, then ready or error. Returns a
   * Promise that always resolves (an engine failure is a state, not a crash). */
  function start() {
    wireModeButtons();
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
