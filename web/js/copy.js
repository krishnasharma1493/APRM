/* copy.js: every word the user reads (K-43).
 *
 * Idea: all labels, hints, empty states and error lead-ins live here, so the tone
 * is consistent and one file can be reviewed. Plain words come first with the
 * technical term next to them. Engine sentences are never reworded here: the
 * pages show them verbatim after a lead-in.
 *
 * Classic script: attaches APRM.copy only. get(key) throws on an unknown key, so a
 * typo is found by the tests, not by a user.
 */
(function () {
  'use strict';

  var APRM = (window.APRM = window.APRM || {});

  var TEXT = {
    'app.title': 'APRM scheduler',
    'step.build': '1 Build',
    'step.run': '2 Run',
    'step.compare': '3 Compare',
    'steps.label': 'Steps',
    'details.label': 'Show details',
    'details.hint': 'Shows exact numbers, scores and log kinds.',
    'engine.loading': 'Starting the engine…',
    'engine.ready': 'Engine ready',
    'engine.error': 'The engine could not start',
    'next.build': 'Next: run your jobs',
    'next.run': 'Next: compare schedulers',
    'next.compare': 'Back to your jobs',
    'keys.hint': 'Space plays or pauses. Right arrow steps.',
    'noscript': 'This page needs JavaScript. The recorded demo video is the fallback.',

    'build.heading': 'Let’s schedule some jobs',
    'build.intro': 'A scheduler decides which waiting job runs next on a machine with limited cores (CPU) and memory. Pick an example and watch it happen.',
    'build.examples': 'Try an example',
    'build.jobs': 'Your jobs',
    'build.empty': 'No jobs yet. Add one, or start with an example.',
    'build.machine.summary': 'Machine: {cpu} cores and {mem} MB of memory.',
    'build.more': 'More ways to add jobs',
    'machine.title': 'Your machine',
    'machine.cpu': 'Processor cores (CPU)',
    'machine.mem': 'Memory (MB)',
    'machine.mem.hint': '32768 MB is 32 GB.',
    'random.title': 'Make random jobs',
    'random.seed': 'Random seed (same seed, same jobs)',
    'random.newseed': 'New seed',
    'random.count': 'How many jobs',
    'random.arrival': 'Latest arrival (ticks)',
    'random.tick.hint': 'A tick is one step of the scheduler’s clock.',
    'random.duration': 'Longest job (ticks)',
    'random.cpu': 'Biggest CPU use (% of machine)',
    'random.mem': 'Biggest memory use (% of machine)',
    'random.make': 'Make jobs (replaces your list)',
    'csv.title': 'Import or export jobs',
    'csv.import': 'Import a jobs file (CSV, up to 1 MB and 5,000 jobs)',
    'csv.export': 'Export jobs.csv',
    'col.id': 'Job number (id)',
    'col.arrival': 'Arrives at (arrival)',
    'col.duration': 'Runs for (duration)',
    'col.cpu': 'Cores (CPU)',
    'col.mem': 'Memory (MB)',
    'col.priority': 'Priority (higher runs first)',
    'col.problem': 'Problem',
    'job.add': 'Add job',
    'job.add.lead': 'Can’t add this job.',
    'toast.loaded': 'Loaded “{name}”.',
    'toast.generated': 'Replaced your jobs with {n} random ones.',
    'toast.exported': 'Exported jobs.csv.',
    'preset.big_job_trap.title': 'The big job trap',
    'preset.big_job_trap.hint': 'One huge job arrives first and blocks nine tiny jobs that would all fit together (Fan and Liang, Lemma 4.1).',
    'preset.priority_starvation.title': 'A low-priority job gets stuck',
    'preset.priority_starvation.hint': 'Urgent jobs keep arriving, so job 2 may never run. Letting waiting jobs gain priority (aging) fixes it.',
    'preset.memory_hog.title': 'The memory hog',
    'preset.memory_hog.hint': 'A job that needs most of the memory keeps being passed over. Saving it a spot (EASY reservation) helps.',
    'preset.sjf_starvation.title': 'Short jobs keep cutting in line',
    'preset.sjf_starvation.hint': 'Shortest job first (SJF) leaves one long job waiting; aging lets it through.',
    'preset.heavy_load.title': 'A busy day',
    'preset.heavy_load.hint': 'Twelve mixed jobs on 8 cores: more work than fits at once, so a queue forms.',
    'preset.tiny_case.title': 'A small case you can check by hand',
    'preset.tiny_case.hint': 'Eight jobs on 4 cores, small enough for the exact solver.'
  };

  /* The text for `key`. Throws on an unknown key. O(1). */
  function get(key) {
    if (!Object.prototype.hasOwnProperty.call(TEXT, key)) { throw new Error('Unknown copy key: ' + key); }
    return TEXT[key];
  }

  /* The text for `key` with {name} placeholders replaced from vars. O(length). */
  function fill(key, vars) {
    var t = get(key);
    var v = vars || {};
    return t.replace(/\{([a-z]+)\}/g, function (m, name) { return Object.prototype.hasOwnProperty.call(v, name) ? String(v[name]) : m; });
  }

  /* True when `key` exists (for optional text such as a preset added later). */
  function has(key) { return Object.prototype.hasOwnProperty.call(TEXT, key); }

  /* All keys, for the tests. */
  function keys() { return Object.keys(TEXT); }

  /* Fill every element that has data-copy="key" using textContent only,
   * and set aria-label from data-copy-label="key". */
  function apply(root) {
    var scope = root || document;
    var els = scope.querySelectorAll('[data-copy]');
    for (var i = 0; i < els.length; i++) { els[i].textContent = get(els[i].getAttribute('data-copy')); }
    var labelled = scope.querySelectorAll('[data-copy-label]');
    for (var j = 0; j < labelled.length; j++) { labelled[j].setAttribute('aria-label', get(labelled[j].getAttribute('data-copy-label'))); }
  }

  APRM.copy = { get: get, fill: fill, has: has, keys: keys, apply: apply };
})();
