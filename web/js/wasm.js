/* wasm.js: the only file that talks to the WebAssembly engine (PRD section 7).
 *
 * Idea: the engine in core/ decides everything. This file only (1) starts the
 * module, (2) turns each aprm_* export into a function that returns plain
 * JavaScript data, and (3) turns every engine failure into one thrown
 * APRM.wasm.EngineError. It never decides which job runs.
 *
 * Classic script: defines nothing global except properties of window.APRM.
 * It reads one vendor global, createAprm (made by vendor/aprm.js; D64 (c)).
 *
 * Three traps this file handles:
 *  - JSON strings returned by C live in memory that the next call on the same
 *    handle overwrites, so every string is copied out and parsed at once.
 *  - JavaScript converts a handle argument with ToInt32 before C sees it
 *    (2^32 + 1 and 1.5 both arrive as 1), so handles are checked here: a
 *    whole number from 1 to 4096.
 *  - aprm_create returns a negative code with no handle; its message is read
 *    with aprm_last_error(0) (D64).
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});

  var START_TIMEOUT_MS = 30000; /* give up waiting for the engine after 30 s */
  var MAX_HANDLE = 4096; /* at most 4,096 simulations at once (D64) */

  /* Policy names to the numbers in PRD section 5 (PolicyKind order). */
  var POLICIES = { fcfs: 0, priority: 1, sjf: 2, aging: 3, aging_reserve: 4, knapsack: 5 };

  /* Error code names, PRD section 5 "Error codes". */
  var CODE_NAMES = {
    '-1': 'INVALID_ARGUMENT', '-2': 'INVALID_FIELD', '-3': 'CAPACITY_EXCEEDED',
    '-4': 'ARRIVAL_IN_PAST', '-5': 'DUPLICATE_ID', '-6': 'LIMIT_REACHED',
    '-7': 'OUT_OF_MEMORY', '-8': 'PARSE_ERROR', '-9': 'TOO_LARGE'
  };

  /* Typed error. code: the negative engine code (0 for a load failure or a
   * wrapper-side problem); codeName: e.g. "INVALID_FIELD"; field: the name of
   * the offending field or "" when none; message: the engine's own words. */
  function EngineError(code, message, field) {
    this.name = 'EngineError';
    this.code = code;
    this.codeName = CODE_NAMES[String(code)] || (code === 0 ? 'ENGINE_UNAVAILABLE' : 'UNKNOWN');
    this.field = field || '';
    this.message = message;
    if (Error.captureStackTrace) { Error.captureStackTrace(this, EngineError); }
  }
  EngineError.prototype = Object.create(Error.prototype);
  EngineError.prototype.constructor = EngineError;

  var M = null; /* the emscripten module, set by init() */

  /* Throws unless the engine is ready. */
  function need() {
    if (M === null) { throw new EngineError(0, 'The engine is not loaded yet.', ''); }
    return M;
  }

  /* Handle check (see the ToInt32 trap above). O(1). */
  function checkHandle(h) {
    if (typeof h !== 'number' || !isFinite(h) || Math.floor(h) !== h || h < 1 || h > MAX_HANDLE) {
      throw new EngineError(-1, 'Not a valid simulation handle.', 'handle');
    }
  }

  /* Numeric arguments must be real numbers; the engine range-checks them. */
  function checkNumbers(list) {
    for (var i = 0; i < list.length; i++) {
      if (typeof list[i] !== 'number' || isNaN(list[i])) {
        throw new EngineError(-1, 'Expected a number for argument ' + (i + 1) + '.', '');
      }
    }
  }

  /* Copy a C string out and parse it. Throws EngineError if the JSON itself
   * is an error envelope, or if it is not valid JSON (internal problem). */
  function readEnvelope(ptr) {
    var text = need().UTF8ToString(ptr);
    return parseEnvelope(text);
  }

  /* Parse one envelope text: {"ok":true,"data":...} or {"ok":false,"error":{...}}.
   * Returns data, or throws EngineError. Exposed for tests. */
  function parseEnvelope(text) {
    var env;
    try { env = JSON.parse(text); } catch (e) {
      throw new EngineError(0, 'The engine returned text that is not valid JSON.', '');
    }
    if (env === null || typeof env !== 'object' || typeof env.ok !== 'boolean') {
      throw new EngineError(0, 'The engine returned an unexpected reply.', '');
    }
    if (env.ok) { return env.data; }
    var err = env.error || {};
    throw new EngineError(typeof err.code === 'number' ? err.code : 0,
      typeof err.message === 'string' ? err.message : 'Unknown engine error.',
      typeof err.field === 'string' ? err.field : '');
  }

  /* After a negative status on handle h, build the error from the engine's
   * own message (aprm_last_error). Falls back to a generic one. */
  function failFromStatus(h, rc) {
    try {
      parseEnvelope(need().UTF8ToString(need()._aprm_last_error(h)));
    } catch (e) {
      if (e instanceof EngineError && e.code !== 0) { return e; }
    }
    return new EngineError(rc, 'The engine reported error ' + rc + '.', '');
  }

  /* Status-returning calls: returns the status (>= 0) or throws. */
  function status(h, rc) {
    if (rc < 0) { throw failFromStatus(h, rc); }
    return rc;
  }

  /* Start the engine. Returns a Promise of APRM.wasm. Rejects with an
   * EngineError (code 0) if vendor/aprm.js is missing or fails to start. */
  function init() {
    if (typeof window.createAprm !== 'function') {
      return Promise.reject(new EngineError(0,
        'The engine file (web/vendor/aprm.js) did not load. Run "make wasm" or use the demo-ready build.', ''));
    }
    var p;
    try { p = Promise.resolve(window.createAprm()); } catch (e) { p = Promise.reject(e); }
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = null;
      if (typeof window.setTimeout === 'function') {
        timer = window.setTimeout(function () {
          if (settled) { return; }
          settled = true;
          reject(new EngineError(0, 'The engine took too long to start. Reload the page or use the backup video.', ''));
        }, START_TIMEOUT_MS);
      }
      p.then(function (mod) {
        if (settled) { return; }  /* a late answer after the timeout is ignored */
        settled = true;
        if (timer !== null && typeof window.clearTimeout === 'function') { window.clearTimeout(timer); }
        M = mod;
        resolve(APRM.wasm);
      }, function (e) {
        if (settled) { return; }
        settled = true;
        if (timer !== null && typeof window.clearTimeout === 'function') { window.clearTimeout(timer); }
        reject(new EngineError(0, 'The engine failed to start: ' + (e && e.message ? e.message : String(e)), ''));
      });
    });
  }

  /* Epsilon as typed (0.1) to integer thousandths (100) for aprm_create (D72).
   * A value with more than 3 decimals is passed on unrounded, so the engine
   * refuses it with its own message instead of silently changing it. */
  function epsToMilli(eps) {
    var scaled = eps * 1000;
    var rounded = Math.round(scaled);
    return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled;
  }

  /* Create a simulation: returns a handle (1..4096). eps is the knapsack
   * epsilon as a decimal (0.1). Throws EngineError with the message from
   * aprm_last_error(0) on failure. */
  function create(cpu, mem, policy, alphaMilli, threshold, eps) {
    var m = need();
    var p = (typeof policy === 'string') ? POLICIES[policy] : policy;
    checkNumbers([cpu, mem, p, alphaMilli, threshold, eps]);
    var h = m._aprm_create(cpu, mem, p, alphaMilli, threshold, epsToMilli(eps));
    if (h < 0) {
      try { parseEnvelope(m.UTF8ToString(m._aprm_last_error(0))); } catch (e) {
        if (e instanceof EngineError && e.code !== 0) { throw e; }
      }
      throw new EngineError(h, 'The engine could not create a simulation.', '');
    }
    return h;
  }

  function addJob(h, id, arrival, duration, cpu, mem, priority) {
    checkHandle(h);
    checkNumbers([id, arrival, duration, cpu, mem, priority]);
    return status(h, need()._aprm_add_job(h, id, arrival, duration, cpu, mem, priority));
  }

  /* 1 = one event done, 0 = finished. */
  function step(h) { checkHandle(h); return status(h, need()._aprm_step(h)); }

  function runUntil(h, t) {
    checkHandle(h); checkNumbers([t]);
    return status(h, need()._aprm_run_until(h, t));
  }

  function reset(h) { checkHandle(h); return status(h, need()._aprm_reset(h)); }
  function destroy(h) { checkHandle(h); return status(h, need()._aprm_destroy(h)); }

  function state(h) { checkHandle(h); return readEnvelope(need()._aprm_state(h)); }
  function results(h) { checkHandle(h); return readEnvelope(need()._aprm_results(h)); }
  function metrics(h) { checkHandle(h); return readEnvelope(need()._aprm_metrics(h)); }
  function exact(h) { checkHandle(h); return readEnvelope(need()._aprm_exact(h)); }

  /* Log entries with seq greater than since (0 = all). */
  function log(h, since) {
    checkHandle(h); checkNumbers([since]);
    return readEnvelope(need()._aprm_log(h, since));
  }

  /* The last failure on h as an EngineError, or null if there is none. h may
   * be 0 for the failure that had no handle. */
  function lastError(h) {
    if (h !== 0) { checkHandle(h); }
    try { readEnvelope(need()._aprm_last_error(h)); } catch (e) {
      if (e instanceof EngineError) { return e; }
      throw e;
    }
    return null;
  }

  APRM.wasm = {
    EngineError: EngineError,
    POLICIES: POLICIES,
    MAX_HANDLE: MAX_HANDLE,
    parseEnvelope: parseEnvelope,
    init: init,
    create: create,
    addJob: addJob,
    step: step,
    runUntil: runUntil,
    state: state,
    log: log,
    results: results,
    metrics: metrics,
    exact: exact,
    lastError: lastError,
    reset: reset,
    destroy: destroy
  };
})();
