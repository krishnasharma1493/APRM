/* generator.js: random job sets from slider settings with a visible seed (K-24).
 *
 * Idea: the generator makes INPUT only. It never schedules and never decides
 * which job runs (hard rule 1). It uses its own tiny seeded integer generator
 * (mulberry32) so the same seed and the same sliders always give the same jobs,
 * and the seed is shown on screen. It need not match tools/gen_workload.py.
 * The browser's unseeded random call is never used.
 *
 * Classic script: attaches APRM.generator only.
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});

  var DEFAULTS = { seed: 42, count: 12, maxArrival: 30, maxDuration: 10, cpuPct: 50, memPct: 50 };
  var SEED_MAX = 4294967295;
  var COUNT_MAX = 200;

  /* mulberry32: returns a function giving the next number in [0, 1) from a
   * 32-bit seed. Integer maths only (Math.imul, shifts), so it is the same
   * on every browser. O(1) per call, state in the closure. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Whole number from lo to hi inclusive. */
  function randInt(rand, lo, hi) {
    return lo + Math.floor(rand() * (hi - lo + 1));
  }

  /* The next seed to offer: a fixed scramble of the old one (no unseeded random call). */
  function nextSeed(seed) {
    return (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0;
  }

  /* Clamp a setting to [lo, hi]; non-numbers become the fallback. */
  function clampInt(v, lo, hi, fallback) {
    if (typeof v !== 'number' || !isFinite(v)) { return fallback; }
    return Math.min(hi, Math.max(lo, Math.floor(v)));
  }

  /* Make jobs 1..count. s: {seed, count, maxArrival, maxDuration, cpuPct, memPct}
   * (percentages are of the machine, so every job fits). machine: {cpu, mem}.
   * Same seed + same settings + same machine = same jobs. Returns a new array
   * the caller owns. O(count). */
  function generate(s, machine) {
    var seed = clampInt(s.seed, 0, SEED_MAX, DEFAULTS.seed);
    var count = clampInt(s.count, 1, COUNT_MAX, DEFAULTS.count);
    var maxArrival = clampInt(s.maxArrival, 0, 1000000000, DEFAULTS.maxArrival);
    var maxDuration = clampInt(s.maxDuration, 1, 1000000, DEFAULTS.maxDuration);
    var cpuPct = clampInt(s.cpuPct, 1, 100, DEFAULTS.cpuPct);
    var memPct = clampInt(s.memPct, 1, 100, DEFAULTS.memPct);
    var cpuMax = Math.max(1, Math.floor(machine.cpu * cpuPct / 100));
    var memMax = Math.max(1, Math.floor(machine.mem * memPct / 100));
    var rand = mulberry32(seed);
    var jobs = [];
    for (var i = 1; i <= count; i++) {
      jobs.push({
        id: i,
        arrival: randInt(rand, 0, maxArrival),
        duration: randInt(rand, 1, maxDuration),
        cpu: randInt(rand, 1, cpuMax),
        mem: randInt(rand, 1, memMax),
        priority: randInt(rand, 0, 9)
      });
    }
    return jobs;
  }

  var mounted = false;

  /* Slider ids and the setting each one controls. */
  var CONTROLS = [
    ['gen-count', 'count'], ['gen-arrival', 'maxArrival'], ['gen-duration', 'maxDuration'],
    ['gen-cpu', 'cpuPct'], ['gen-mem', 'memPct']
  ];

  /* Wire the generator controls. Missing elements are skipped. */
  function mount() {
    if (mounted) { return; }
    mounted = true;
    var seedEl = document.getElementById('gen-seed');
    var run = document.getElementById('gen-run');
    var fresh = document.getElementById('gen-newseed');
    var err = document.getElementById('gen-error');
    if (seedEl && seedEl.value === '') { seedEl.value = String(DEFAULTS.seed); }
    CONTROLS.forEach(function (c) {
      var el = document.getElementById(c[0]);
      var out = document.getElementById(c[0] + '-out');
      if (!el) { return; }
      if (el.value === '' || el.value === undefined) { el.value = String(DEFAULTS[c[1]]); }
      if (out) {
        out.textContent = el.value;
        el.addEventListener('input', function () { out.textContent = el.value; });
      }
    });
    function readSettings() {
      var s = {};
      CONTROLS.forEach(function (c) {
        var el = document.getElementById(c[0]);
        s[c[1]] = el ? Number(el.value) : DEFAULTS[c[1]];
      });
      s.seed = seedEl ? Number(seedEl.value) : DEFAULTS.seed;
      return s;
    }
    if (fresh && seedEl) {
      fresh.addEventListener('click', function () {
        var cur = Number(seedEl.value);
        seedEl.value = String(nextSeed(isFinite(cur) ? cur : DEFAULTS.seed));
      });
    }
    if (run) {
      run.addEventListener('click', function () {
        var s = readSettings();
        if (!/^[0-9]+$/.test(String(seedEl ? seedEl.value : DEFAULTS.seed).trim()) || s.seed > SEED_MAX) {
          if (err) { err.textContent = 'seed must be a whole number from 0 to ' + SEED_MAX + '.'; err.hidden = false; }
          return;
        }
        if (err) { err.textContent = ''; err.hidden = true; }
        APRM.store.setJobs(generate(s, APRM.store.get().machine));
      });
    }
  }

  APRM.generator = {
    DEFAULTS: DEFAULTS,
    SEED_MAX: SEED_MAX,
    COUNT_MAX: COUNT_MAX,
    mulberry32: mulberry32,
    nextSeed: nextSeed,
    generate: generate,
    mount: mount
  };
})();
