/* store.js: the one app-state object (PRD section 7) and change notification.
 *
 * Idea: views never keep their own copy of the truth. They read APRM.store.get(),
 * change it only through the functions here, and subscribe to be told when it
 * changed. No scheduling logic lives here: it holds inputs the user chose.
 *
 * Classic script: attaches APRM.store only.
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});

  var MODES = ['build', 'run', 'compare'];

  /* The state. jobs: array of {id, arrival, duration, cpu, mem, priority}.
   * engine.status: 'loading' | 'ready' | 'error'; engine.error: text or ''. */
  var state = {
    machine: { cpu: 16, mem: 32768 },
    jobs: [],
    policies: ['fcfs'],
    settings: { alphaMilli: 100, threshold: 50, eps: 0.1, speed: 1 },
    mode: 'build',
    engine: { status: 'loading', error: '' }
  };

  var listeners = [];

  /* Tell every listener, in subscription order. A listener that throws is
   * skipped (reported on the console) so one broken view cannot freeze the rest. */
  function notify(changed) {
    var snapshot = listeners.slice();
    for (var i = 0; i < snapshot.length; i++) {
      try { snapshot[i](get(), changed); } catch (e) {
        if (typeof console !== 'undefined') { console.error('store listener failed:', e); }
      }
    }
  }

  /* A copy of the state, so callers cannot change it behind the store's back.
   * O(jobs). */
  function get() {
    return {
      machine: { cpu: state.machine.cpu, mem: state.machine.mem },
      jobs: state.jobs.slice(),
      policies: state.policies.slice(),
      settings: {
        alphaMilli: state.settings.alphaMilli, threshold: state.settings.threshold,
        eps: state.settings.eps, speed: state.settings.speed
      },
      mode: state.mode,
      engine: { status: state.engine.status, error: state.engine.error }
    };
  }

  /* Call fn(state, changedKey) after every change. Returns an unsubscribe function. */
  function subscribe(fn) {
    if (typeof fn !== 'function') { throw new TypeError('subscribe needs a function'); }
    listeners.push(fn);
    return function () {
      var i = listeners.indexOf(fn);
      if (i >= 0) { listeners.splice(i, 1); }
    };
  }

  /* Replace the job list (the editor validates the jobs; the engine checks them again). */
  function setJobs(jobs) {
    if (!Array.isArray(jobs)) { throw new TypeError('jobs must be an array'); }
    state.jobs = jobs.slice();
    notify('jobs');
  }

  function setMachine(cpu, mem) {
    state.machine = { cpu: cpu, mem: mem };
    notify('machine');
  }

  function setPolicies(list) {
    if (!Array.isArray(list)) { throw new TypeError('policies must be an array'); }
    state.policies = list.slice();
    notify('policies');
  }

  /* Merge known setting keys only: alphaMilli, threshold, eps, speed. */
  function setSettings(patch) {
    var keys = ['alphaMilli', 'threshold', 'eps', 'speed'];
    for (var i = 0; i < keys.length; i++) {
      if (Object.prototype.hasOwnProperty.call(patch, keys[i])) { state.settings[keys[i]] = patch[keys[i]]; }
    }
    notify('settings');
  }

  /* Mode is one of build, run, compare. Returns false (no change) for anything else. */
  function setMode(mode) {
    if (MODES.indexOf(mode) < 0) { return false; }
    if (state.mode !== mode) { state.mode = mode; notify('mode'); }
    return true;
  }

  /* status: 'loading', 'ready' or 'error'; error: text shown in the error state. */
  function setEngine(status, error) {
    if (['loading', 'ready', 'error'].indexOf(status) < 0) { return false; }
    state.engine = { status: status, error: error ? String(error) : '' };
    notify('engine');
    return true;
  }

  APRM.store = {
    MODES: MODES,
    get: get,
    subscribe: subscribe,
    setJobs: setJobs,
    setMachine: setMachine,
    setPolicies: setPolicies,
    setSettings: setSettings,
    setMode: setMode,
    setEngine: setEngine
  };
})();
