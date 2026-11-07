/* runmodel.js: what the Run page shows after each engine log entry (K-51).
 *
 * Idea: the C engine is stepped one moment at a time (aprm_step). A moment can write several log
 * entries (finishes, arrivals, starts, skips, a saved spot). The page shows those entries one per
 * Step. After each entry the view is the engine's previous state with the entries so far applied;
 * after the moment's last entry the view is replaced by the engine's own state JSON, so every number
 * on screen at a moment end is exactly the engine's. JavaScript never chooses a job here: an entry
 * only says what the engine already did.
 *
 * The view has the PRD section 5 state shape (now, done, total, cap, free, waiting, running,
 * reservation) plus marks the state JSON does not carry: skipped[id] = tick of the job's last SKIP,
 * squeezed[id] = true while a backfilled job runs, chosen[id] = tick of a knapsack BATCH_SELECT.
 *
 * The history keeps, per job, what the strip timeline needs: arrival, start, finish, skip ticks,
 * the saved spot. It grows by one record per job and one number per SKIP.
 *
 * Pure functions and plain objects only: no DOM, no engine calls. Classic script: attaches
 * APRM.runmodel only.
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});

  var AGING = { aging: true, aging_reserve: true };

  /* The live aging score the engine prints, S = priority + alpha_milli * (now - arrival) / 1000,
   * from integers (PRD section 5, D14). Returns a number equal to JSON.parse of the engine's
   * three-decimal text, or null for a policy without a score. O(1). */
  function score(policy, alphaMilli, priority, arrival, now) {
    if (!AGING[policy]) { return null; }
    var milli = 1000 * priority + alphaMilli * (now - arrival);
    return milli / 1000;
  }

  /* The score as the engine writes it: exactly three decimals ("6.200"). O(1). */
  function scoreText(s) {
    if (s === null || s === undefined) { return ''; }
    var neg = s < 0;
    var milli = Math.round(Math.abs(s) * 1000);
    var whole = Math.floor(milli / 1000), frac = String(milli % 1000);
    while (frac.length < 3) { frac = '0' + frac; }
    return (neg ? '-' : '') + whole + '.' + frac;
  }

  /* A view before the first step, from the first engine state (taken right after the jobs were
   * added). Owner: the caller. O(waiting + running). */
  function fromState(state) {
    var v = { now: 0, done: 0, total: 0, cap: { cpu: 0, mem: 0 }, free: { cpu: 0, mem: 0 },
      waiting: [], running: [], reservation: null, skipped: {}, squeezed: {}, chosen: {} };
    return snap(v, state);
  }

  /* Replace every engine field of view v with the engine's state; the marks stay. Returns v. O(n). */
  function snap(v, state) {
    v.now = state.now; v.done = state.done; v.total = state.total;
    v.cap = { cpu: state.cap.cpu, mem: state.cap.mem };
    v.free = { cpu: state.free.cpu, mem: state.free.mem };
    v.waiting = state.waiting.map(function (w) {
      return { id: w.id, score: w.score === undefined ? null : w.score, priority: w.priority, arrival: w.arrival,
        duration: w.duration, cpu: w.cpu, mem: w.mem };
    });
    v.running = state.running.map(function (r) { return { id: r.id, start: r.start, finish: r.finish, cpu: r.cpu, mem: r.mem }; });
    v.reservation = state.reservation ? { id: state.reservation.id, shadow_time: state.reservation.shadow_time } : null;
    return v;
  }

  function indexOfId(list, id) {
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { return i; } }
    return -1;
  }

  /* The engine's running order: finish time, then arrival, then id (PRD section 5). */
  function sortRunning(v, jobs) {
    v.running.sort(function (a, b) {
      if (a.finish !== b.finish) { return a.finish - b.finish; }
      var ja = jobs[a.id], jb = jobs[b.id];
      var aa = ja ? ja.arrival : 0, ab = jb ? jb.arrival : 0;
      return aa !== ab ? aa - ab : a.id - b.id;
    });
  }

  /* Waiting order between the entries of a moment: the order the engine reports at the end of this
   * moment; jobs that are not in it (they start later in this moment) go first, as they were chosen
   * first. Never a decision: only the engine's own order, read ahead. O(n log n). */
  function orderLike(v, end) {
    if (!end) { return; }
    var rank = {};
    for (var i = 0; i < end.waiting.length; i++) { rank[end.waiting[i].id] = i; }
    var at = {};
    for (var k = 0; k < v.waiting.length; k++) { at[v.waiting[k].id] = k; }
    v.waiting.sort(function (a, b) {
      var ra = a.id in rank ? rank[a.id] : -1, rb = b.id in rank ? rank[b.id] : -1;
      if (ra === -1 && rb === -1) { return at[a.id] - at[b.id]; }
      return ra - rb;
    });
  }

  /* Apply one log entry to view v (changed in place). ctx = { jobs: id -> job, policy, alphaMilli,
   * end: the engine state at the end of this entry's moment, or null }. Returns v. O(waiting) for
   * a START or a new tick (scores), O(1) otherwise. */
  function apply(v, e, ctx) {
    var jobs = ctx.jobs, j = jobs[e.job];
    if (e.t !== v.now) {
      v.now = e.t;
      for (var s = 0; s < v.waiting.length; s++) {
        var w = v.waiting[s];
        w.score = score(ctx.policy, ctx.alphaMilli, w.priority, w.arrival, v.now);
      }
    }
    var i;
    switch (e.kind) {
      case 'ARRIVE':
        if (j && indexOfId(v.waiting, e.job) < 0) {
          v.waiting.push({ id: j.id, score: score(ctx.policy, ctx.alphaMilli, j.priority, j.arrival, v.now), priority: j.priority,
            arrival: j.arrival, duration: j.duration, cpu: j.cpu, mem: j.mem });
        }
        break;
      case 'START':
        i = indexOfId(v.waiting, e.job);
        if (i >= 0) { v.waiting.splice(i, 1); }
        if (j) {
          v.running.push({ id: j.id, start: e.t, finish: e.t + j.duration, cpu: j.cpu, mem: j.mem });
          v.free.cpu -= j.cpu; v.free.mem -= j.mem;
          sortRunning(v, jobs);
        }
        if (v.reservation && v.reservation.id === e.job) { v.reservation = null; }
        delete v.skipped[e.job];
        break;
      case 'BACKFILL':
        v.squeezed[e.job] = true;
        break;
      case 'SKIP':
        v.skipped[e.job] = e.t;
        break;
      case 'RESERVE':
        var r = ctx.end && ctx.end.reservation && ctx.end.reservation.id === e.job ? ctx.end.reservation.shadow_time : null;
        v.reservation = { id: e.job, shadow_time: r };
        break;
      case 'BATCH_SELECT':
        v.chosen[e.job] = e.t;
        break;
      case 'FINISH':
        i = indexOfId(v.running, e.job);
        if (i >= 0) {
          var rr = v.running[i];
          v.running.splice(i, 1);
          v.free.cpu += rr.cpu; v.free.mem += rr.mem;
        }
        v.done += 1;
        delete v.squeezed[e.job];
        break;
      default:
        break;
    }
    orderLike(v, ctx.end);
    return v;
  }

  /* Differences between a view and an engine state, as plain sentences (empty = the same).
   * Used by the tests and by debug checks. O(n). */
  function diff(v, state) {
    var out = [];
    var same = function (name, a, b) { if (a !== b) { out.push(name + ': page ' + a + ', engine ' + b); } };
    same('now', v.now, state.now); same('done', v.done, state.done);
    same('free cpu', v.free.cpu, state.free.cpu); same('free mem', v.free.mem, state.free.mem);
    var ids = function (l) { return l.map(function (x) { return x.id; }).join(','); };
    same('waiting', ids(v.waiting), ids(state.waiting));
    same('running', ids(v.running), ids(state.running));
    for (var i = 0; i < Math.min(v.waiting.length, state.waiting.length); i++) {
      var a = v.waiting[i].score, b = state.waiting[i].score;
      same('score of job ' + state.waiting[i].id, a === undefined ? null : a, b === undefined ? null : b);
    }
    for (var k = 0; k < Math.min(v.running.length, state.running.length); k++) {
      same('start of job ' + state.running[k].id, v.running[k].start, state.running[k].start);
      same('finish of job ' + state.running[k].id, v.running[k].finish, state.running[k].finish);
    }
    same('reservation', v.reservation ? v.reservation.id + '@' + v.reservation.shadow_time : 'none',
      state.reservation ? state.reservation.id + '@' + state.reservation.shadow_time : 'none');
    return out;
  }

  /* ---------- history for the timeline ---------- */

  function history() { return { jobs: {}, order: [] }; }

  function recOf(h, job) {
    var r = h.jobs[job.id];
    if (!r) {
      r = { id: job.id, arrival: job.arrival, duration: job.duration, cpu: job.cpu, mem: job.mem, priority: job.priority,
        arrived: null, start: null, finish: null, skips: [], resAt: null, resBy: null, squeezed: false, chosen: null };
      h.jobs[job.id] = r;
      h.order.push(job.id);
    }
    return r;
  }

  /* Add one entry to history h. The shadow time of a saved spot comes from view v (already applied).
   * O(1). */
  function record(h, e, jobs, v) {
    var j = jobs[e.job];
    if (!j) { return; }
    var r = recOf(h, j);
    if (e.kind === 'ARRIVE') { r.arrived = e.t; }
    else if (e.kind === 'START') { r.start = e.t; }
    else if (e.kind === 'FINISH') { r.finish = e.t; }
    else if (e.kind === 'SKIP') { if (r.skips[r.skips.length - 1] !== e.t) { r.skips.push(e.t); } }
    else if (e.kind === 'RESERVE') { r.resAt = e.t; r.resBy = v && v.reservation && v.reservation.id === e.job ? v.reservation.shadow_time : null; }
    else if (e.kind === 'BACKFILL') { r.squeezed = true; }
    else if (e.kind === 'BATCH_SELECT') { r.chosen = e.t; }
  }

  /* Planned or actual start and finish per job, the shape the board and the tests use. O(jobs). */
  function bars(h) {
    var out = {};
    for (var i = 0; i < h.order.length; i++) {
      var r = h.jobs[h.order[i]];
      if (r.start !== null) { out[r.id] = { start: r.start, finish: r.finish !== null ? r.finish : r.start + r.duration }; }
    }
    return out;
  }

  APRM.runmodel = {
    score: score,
    scoreText: scoreText,
    fromState: fromState,
    snap: snap,
    apply: apply,
    orderLike: orderLike,
    diff: diff,
    history: history,
    record: record,
    bars: bars
  };
})();
