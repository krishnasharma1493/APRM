/* comparemodel.js: the numbers behind the Compare page (K-57), as pure functions.
 *
 * Idea: the C engine runs every scheduler on the same jobs and machine and returns, per scheduler,
 * its metrics JSON and its results JSON (one row per job: arrival, start, finish, wait, ...). The
 * exact solver returns the best schedule for total wait. This file only rearranges those answers
 * for drawing: which scheduler wins the verdict (by the engine's own numbers), how waits spread,
 * how busy the machine was at each tick, and where each job's ribbon lies in "Who ran when".
 * Nothing here decides which job runs.
 *
 * Classic script: attaches APRM.comparemodel only. No DOM access, so Node tests load it directly.
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});

  /* The schedulers in the design's order. name = the engine's policy name; key = the design's id
   * (also the CSS colour token --sch-<key>); bench marks the exact best (a benchmark, never ranked). */
  var SCHED = [
    { name: 'fcfs', key: 'fcfs' },
    { name: 'priority', key: 'priority' },
    { name: 'sjf', key: 'sjf' },
    { name: 'aging', key: 'aging' },
    { name: 'aging_reserve', key: 'easy' },
    { name: 'knapsack', key: 'knap' },
    { name: 'exact', key: 'opt', bench: true }
  ];
  var EXACT_MAX = 9;

  /* The measures, in the design's order. dir -1: lower is better; +1: higher is better. */
  var MET = [
    { id: 'maxw', unit: 'ticks', dir: -1 },
    { id: 'avgw', unit: 'ticks', dir: -1 },
    { id: 'avgt', unit: 'ticks', dir: -1 },
    { id: 'wc', unit: '', dir: -1 },
    { id: 'mk', unit: 'ticks', dir: -1 },
    { id: 'cpu', unit: '%', dir: 1 },
    { id: 'mem', unit: '%', dir: 1 }
  ];

  function schedOf(name) {
    for (var i = 0; i < SCHED.length; i++) { if (SCHED[i].name === name || SCHED[i].key === name) { return SCHED[i]; } }
    return null;
  }

  var EPS = 1e-9;
  function eq(a, b) { return Math.abs(a - b) < EPS; }
  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) { s += a[i]; } return s; }

  /* A number the design's way: integers as they are, others with three decimals, null as a dash. O(1). */
  function fmt(v) {
    if (v === null || v === undefined || !isFinite(v)) { return '—'; }
    return Math.floor(v) === v ? String(v) : v.toFixed(3);
  }

  /* Percentile p (0..1) of a list, nearest rank. null for an empty list. O(n log n). */
  function pct(a, p) {
    if (!a.length) { return null; }
    var s = a.slice().sort(function (x, y) { return x - y; });
    return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
  }

  /* One column's measures. From the engine: its metrics JSON and result rows (waits read from
   * the rows' "wait" field). util_* (shares 0..1) become percents. O(rows). */
  function fromEngine(metrics, rows) {
    var waits = rows.map(function (r) { return r.wait; });
    var turns = rows.map(function (r) { return r.turnaround; });
    var m = metrics || {};
    return {
      maxw: m.max_wait === undefined ? null : m.max_wait,
      avgw: m.avg_wait === undefined ? null : m.avg_wait,
      avgt: m.avg_turnaround === undefined ? null : m.avg_turnaround,
      wc: m.weighted_completion === undefined ? null : m.weighted_completion,
      mk: m.makespan === undefined ? null : m.makespan,
      cpu: m.util_cpu === null || m.util_cpu === undefined ? null : m.util_cpu * 100,
      mem: m.util_mem === null || m.util_mem === undefined ? null : m.util_mem * 100,
      per: Array.isArray(m.avg_wait_by_priority) ? m.avg_wait_by_priority.slice() : [null, null, null, null, null, null, null, null, null, null],
      waits: waits, n: rows.length, totW: rows.length ? sum(waits) : null, totT: rows.length ? sum(turns) : null
    };
  }

  /* The exact best's measures, from its schedule (the engine has no metrics call for it; these are
   * the same formulas as PRD section 5, applied to the engine's start ticks). O(rows). */
  function fromSchedule(rows, cap) {
    if (!rows.length) { return fromEngine({}, []); }
    var waits = rows.map(function (r) { return r.wait; });
    var mk = 0, busyC = 0, busyM = 0, wc = 0;
    var per = [], cnt = [];
    for (var p = 0; p < 10; p++) { per.push(0); cnt.push(0); }
    rows.forEach(function (r) {
      if (r.finish > mk) { mk = r.finish; }
      var d = r.finish - r.start;
      busyC += r.cpu * d; busyM += r.mem * d; wc += (r.priority + 1) * r.finish;
      per[r.priority] += r.wait; cnt[r.priority]++;
    });
    return {
      maxw: Math.max.apply(null, waits), avgw: sum(waits) / rows.length,
      avgt: sum(rows.map(function (r) { return r.turnaround; })) / rows.length, wc: wc, mk: mk,
      cpu: mk ? 100 * busyC / (cap.cpu * mk) : null, mem: mk ? 100 * busyM / (cap.mem * mk) : null,
      per: per.map(function (s, i) { return cnt[i] ? s / cnt[i] : null; }),
      waits: waits, n: rows.length, totW: sum(waits), totT: sum(rows.map(function (r) { return r.turnaround; }))
    };
  }

  /* The best value of each measure among the competing (not benchmark) columns: { id: {key: true} }. */
  function bests(cols) {
    var out = {};
    MET.forEach(function (mt) {
      var comp = cols.filter(function (c) { return !c.bench && c.m[mt.id] !== null; });
      out[mt.id] = {};
      if (!comp.length) { return; }
      var vals = comp.map(function (c) { return c.m[mt.id]; });
      var b = mt.dir < 0 ? Math.min.apply(null, vals) : Math.max.apply(null, vals);
      comp.forEach(function (c) { if (eq(c.m[mt.id], b)) { out[mt.id][c.key] = true; } });
    });
    return out;
  }

  /* The verdict order: shortest longest wait, then lowest average wait, then busiest CPU; ties keep
   * the design's scheduler order. Returns the competing columns sorted. O(k log k). */
  function rank(cols) {
    var big = 1e18;
    return cols.filter(function (c) { return !c.bench; }).slice().sort(function (a, b) {
      var x = (a.m.maxw === null ? big : a.m.maxw) - (b.m.maxw === null ? big : b.m.maxw);
      if (!eq(x, 0)) { return x; }
      var y = (a.m.avgw === null ? big : a.m.avgw) - (b.m.avgw === null ? big : b.m.avgw);
      if (!eq(y, 0)) { return y; }
      var z = (b.m.cpu === null ? -1 : b.m.cpu) - (a.m.cpu === null ? -1 : a.m.cpu);
      if (!eq(z, 0)) { return z; }
      return a.order - b.order;
    });
  }

  /* Wait-time spread: bands of equal width over 0..longest wait (at most 24), and each column's
   * share of jobs per band. O(columns x jobs). */
  function spread(cols) {
    var maxAll = 0;
    cols.forEach(function (c) { c.m.waits.forEach(function (w) { if (w > maxAll) { maxAll = w; } }); });
    var nb = Math.max(1, Math.min(24, maxAll + 1));
    var bw = Math.ceil((maxAll + 1) / nb);
    var maxShare = 0;
    var shares = {};
    cols.forEach(function (c) {
      var counts = [];
      for (var b = 0; b < nb; b++) { counts.push(0); }
      c.m.waits.forEach(function (w) { counts[Math.min(nb - 1, Math.floor(w / bw))]++; });
      shares[c.key] = counts.map(function (v) { return c.m.n ? v / c.m.n : 0; });
      shares[c.key].forEach(function (v) { if (v > maxShare) { maxShare = v; } });
    });
    return { nb: nb, bw: bw, maxAll: maxAll, edge: nb * bw, maxShare: maxShare || 1, shares: shares };
  }

  /* Per tick 0..T: percent of cores and of memory in use, and jobs waiting (arrived, not started).
   * From the result rows by difference arrays. O(rows + T). */
  function series(rows, T, cap) {
    var c = new Array(T + 2).fill(0), m = new Array(T + 2).fill(0), q = new Array(T + 2).fill(0);
    rows.forEach(function (r) {
      var s = Math.min(r.start, T + 1), f = Math.min(r.finish, T + 1);
      c[s] += r.cpu; c[f] -= r.cpu; m[s] += r.mem; m[f] -= r.mem;
      if (r.start > r.arrival) { q[Math.min(r.arrival, T + 1)] += 1; q[s] -= 1; }
    });
    var cpu = [], mem = [], qq = [];
    for (var t = 0; t <= T; t++) {
      if (t > 0) { c[t] += c[t - 1]; m[t] += m[t - 1]; q[t] += q[t - 1]; }
      cpu.push(100 * c[t] / cap.cpu); mem.push(100 * m[t] / cap.mem); qq.push(q[t]);
    }
    return { cpu: cpu, mem: mem, q: qq };
  }

  /* The job whose wait differs most between the columns (the design's default for "Per job"). */
  function defaultJob(cols, jobs) {
    var best = null, spreadMax = -1;
    jobs.forEach(function (j) {
      var ws = [];
      cols.forEach(function (c) { var r = c.byId[j.id]; if (r) { ws.push(r.wait); } });
      if (ws.length) { var s = Math.max.apply(null, ws) - Math.min.apply(null, ws); if (s > spreadMax) { spreadMax = s; best = j.id; } }
    });
    return best;
  }

  /* ---------- "Who ran when" helpers ---------- */

  /* How much of job r's resource is drawn at time t (ticks, continuous). Inside [start, finish) the
   * job rises and falls with a smoothstep over e = min(0.45, 0.45 x duration) ticks, so at every
   * tick centre the height is exact (the engine's value) and only jobs the engine ran at t are
   * stacked: the stack never passes the capacity. O(1). */
  function ramp(r, t) {
    var s = r.start, f = r.finish;
    if (t <= s || t >= f) { return 0; }
    var e = Math.min(0.45, 0.45 * (f - s));
    var up = Math.min(1, (t - s) / e), dn = Math.min(1, (f - t) / e);
    var a = up * up * (3 - 2 * up), b = dn * dn * (3 - 2 * dn);
    return a * b;
  }

  /* Stack the jobs as smooth streams. Jobs are layered by start, then id (a fixed order, so a
   * ribbon only moves when a job below it ends). Returns for n samples across [0, T]: per job the
   * bottom and top as shares of capacity, and the total. O(samples x jobs). */
  function streams(rows, T, cap, key, n) {
    var order = rows.slice().sort(function (a, b) { return a.start - b.start || a.id - b.id; });
    var capv = key === 'cpu' ? cap.cpu : cap.mem;
    var xs = [], total = [], bands = order.map(function (r) { return { r: r, lo: [], hi: [] }; });
    for (var i = 0; i < n; i++) {
      var t = T * i / (n - 1);
      xs.push(t);
      var y = 0;
      for (var k = 0; k < bands.length; k++) {
        var r = bands[k].r;
        var v = r.start < t + 1 && r.finish > t - 1 ? ramp(r, t) * r[key] / capv : 0;
        bands[k].lo.push(y);
        y += v;
        bands[k].hi.push(y);
      }
      total.push(y);
    }
    return { xs: xs, bands: bands, total: total };
  }

  /* "Who ran when" as a mountain range: job r drawn as a smooth peak over the ticks it ran, as
   * tall as its share of the machine (1 at its middle), falling to 0 just outside [start, finish].
   * A generalised bell (power 2.6) keeps the shoulders full, so a long job reads as a long ridge.
   * Returns 0..1. O(1). */
  function hill(r, t) {
    var d = Math.max(1, r.finish - r.start), c = (r.start + r.finish) / 2, sg = d / 2.2 + 0.35;
    var u = Math.abs(t - c) / sg;
    if (u > 2.2) { return 0; }
    return Math.exp(-Math.pow(u, 2.6));
  }
  /* Where a job's peak lies on the time axis: [from, to] in ticks (the part drawn). */
  function hillSpan(r) {
    var d = Math.max(1, r.finish - r.start), c = (r.start + r.finish) / 2, sg = d / 2.2 + 0.35;
    return [c - 2.2 * sg, c + 2.2 * sg];
  }

  /* Monotone cubic path through points (no overshoot), as SVG path data; numbers with one decimal. */
  function f1(x) { return (+x).toFixed(1); }
  function mono(pts) {
    var n = pts.length;
    if (!n) { return ''; }
    if (n === 1) { return 'M' + f1(pts[0][0]) + ',' + f1(pts[0][1]); }
    var x = pts.map(function (p) { return p[0]; }), y = pts.map(function (p) { return p[1]; });
    var m = [], tg = [], i;
    for (i = 0; i < n - 1; i++) { m[i] = (y[i + 1] - y[i]) / ((x[i + 1] - x[i]) || 1e-9); }
    tg[0] = m[0];
    for (i = 1; i < n - 1; i++) { tg[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2; }
    tg[n - 1] = m[n - 2];
    for (i = 0; i < n - 1; i++) {
      if (m[i] === 0) { tg[i] = 0; tg[i + 1] = 0; continue; }
      var a = tg[i] / m[i], b = tg[i + 1] / m[i], s = a * a + b * b;
      if (s > 9) { var k = 3 / Math.sqrt(s); tg[i] = k * a * m[i]; tg[i + 1] = k * b * m[i]; }
    }
    var d = 'M' + f1(x[0]) + ',' + f1(y[0]);
    for (i = 0; i < n - 1; i++) {
      var h = (x[i + 1] - x[i]) / 3;
      d += ' C' + f1(x[i] + h) + ',' + f1(y[i] + tg[i] * h) + ' ' + f1(x[i + 1] - h) + ',' + f1(y[i + 1] - tg[i + 1] * h) + ' ' + f1(x[i + 1]) + ',' + f1(y[i + 1]);
    }
    return d;
  }

  /* Round axis ticks: a top at or above max and about n steps. */
  function niceStep(x) {
    var p = Math.pow(10, Math.floor(Math.log(x) / Math.LN10)), q = x / p;
    return (q <= 1 ? 1 : q <= 2 ? 2 : q <= 2.5 ? 2.5 : q <= 5 ? 5 : 10) * p;
  }
  function nice(max, n) {
    n = n || 4;
    if (!(max > 0)) { return { max: 1, ticks: [0, 1] }; }
    var st = niceStep(max / n), top = Math.ceil(max / st - 1e-9) * st, ticks = [];
    for (var v = 0; v <= top + 1e-9; v += st) { ticks.push(+v.toFixed(6)); }
    return { max: top, ticks: ticks };
  }

  /* One column from the runner's answer: { key, name, bench, order, rows, m, byId, res, bf }. */
  function column(policy, metrics, rows, cap, events) {
    var s = schedOf(policy);
    var byId = {};
    rows.forEach(function (r) { byId[r.id] = r; });
    return {
      name: policy, key: s ? s.key : policy, bench: !!(s && s.bench), order: SCHED.indexOf(s),
      rows: rows, byId: byId, raw: metrics, m: s && s.bench ? fromSchedule(rows, cap) : fromEngine(metrics, rows),
      res: events ? events.reserve : 0, bf: events ? events.backfill : 0
    };
  }

  /* Everything the page draws, from the runner's columns. O(columns x (jobs + T)). */
  function build(columnsIn, jobs, cap) {
    var cols = columnsIn.slice().sort(function (a, b) { return a.order - b.order; });
    var T = 1;
    cols.forEach(function (c) { if (c.m.mk !== null && c.m.mk > T) { T = c.m.mk; } });
    cols.forEach(function (c) { c.ser = series(c.rows, T, cap); });
    var ranked = rank(cols);
    return { cols: cols, T: T, n: jobs.length, cap: cap, jobs: jobs, best: bests(cols), ranked: ranked,
      winner: ranked.length ? ranked[0].key : null, dist: spread(cols), defJob: defaultJob(cols, jobs) };
  }

  APRM.comparemodel = {
    SCHED: SCHED, MET: MET, EXACT_MAX: EXACT_MAX, schedOf: schedOf, eq: eq, fmt: fmt, pct: pct,
    fromEngine: fromEngine, fromSchedule: fromSchedule, bests: bests, rank: rank, spread: spread,
    series: series, defaultJob: defaultJob, ramp: ramp, streams: streams, hill: hill, hillSpan: hillSpan, mono: mono, nice: nice,
    column: column, build: build
  };
})();
