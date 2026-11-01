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
    'theme.night': 'Night mode',
    'theme.day': 'Day mode',
    'theme.hint': 'Switch between a light and a dark page.',
    'keys.hint': 'Space plays or pauses. Right arrow steps. Enter on a job shows only its decisions; Esc shows all.',
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
    'short.col.id': 'Job',
    'short.col.arrival': 'Arrives',
    'short.col.duration': 'Runs for',
    'short.col.cpu': 'Cores',
    'short.col.mem': 'Memory (MB)',
    'short.col.priority': 'Priority',
    'job.add': 'Add job',
    'job.new': 'New job',
    'build.count.limit': ' (limit {n})',
    'job.add.lead': 'Can’t add this job.',
    'toast.loaded': 'Loaded “{name}”.',
    'toast.generated': 'Replaced your jobs with {n} random ones.',
    'toast.exported': 'Exported jobs.csv.',

    'run.heading': 'Run your jobs',
    'run.policy': 'How to choose the next job',
    'run.more': 'More settings',
    'run.alpha': 'Aging rate \u03b1 (alpha_milli)',
    'run.alpha.hint': 'How fast a waiting job gains priority. 0 to 10000; higher means faster.',
    'run.threshold': 'Reservation threshold T (ticks)',
    'run.threshold.hint': 'How long a job waits before the scheduler saves it a spot.',
    'run.eps': 'Knapsack \u03b5 (epsilon)',
    'run.eps.hint': 'How close to the best mix the search must get. Smaller is slower.',
    'run.settings': 'Settings: \u03b1 = {alpha}, T = {t}, \u03b5 = {eps}',
    'run.start': 'Run',
    'run.restart': 'Start over',
    'run.play': 'Play',
    'run.pause': 'Pause',
    'run.step': 'Step',
    'run.jump': 'Jump to end',
    'run.reset': 'Reset',
    'run.speed': 'Speed',
    'run.res.cpu': 'CPU',
    'run.res.mem': 'Memory',
    'run.res.cpu.text': '{used} of {cap} cores busy, {free} free',
    'run.res.mem.text': '{used} of {cap} MB in use, {free} MB free',
    'run.res.none': 'Not running yet',
    'run.timeline': 'The board',
    'run.tray': 'Waiting',
    'run.tray.empty': 'Nobody is waiting.',
    'run.tray.more': 'and {n} more',
    'run.tray.next': 'Next',
    'run.tray.saved': 'Spot saved',
    'run.tray.needs': 'priority {p}, needs {c} {cores} and {m} MB',
    'run.tray.score': 'score {s}',
    'run.alljobs': 'All jobs',
    'run.canvas.empty': 'Nothing to show yet. Add jobs, then press Run.',
    'run.why': 'Why',
    'run.why.empty': 'Each decision is explained here once the run starts.',
    'run.why.only': 'Showing only job {id}.',
    'run.why.none': 'No log lines for job {id} yet.',
    'run.why.all': 'Show all jobs',
    'run.reserve': 'Saved spot: job {id} will start by tick {t}.',
    'run.metrics': 'How it went',
    'run.metrics.empty': 'Numbers appear once some jobs have finished.',
    'run.add': 'Add a job right now',
    'run.add.submit': 'Add job (pauses the run first)',
    'run.add.note': 'Arrival defaults to the next tick. An arrival equal to the current time is allowed, but the job is then considered after jobs that already started at this time.',
    'run.clock.none': 'No run yet. Press Run.',
    'run.clock': 'Time: tick {now}. {done} of {total} jobs finished.',
    'run.clock.details': 'Time: tick {now}, event {events}. {done} of {total} jobs finished.',
    'status.idle': 'Not started',
    'status.playing': 'Playing',
    'status.paused': 'Paused',
    'status.jumping': 'Jumping to the end\u2026',
    'status.finished': 'Finished',
    'status.error': 'Stopped by an error',
    'policy.fcfs': 'First come, first served (FCFS)',
    'policy.priority': 'Highest priority first (priority)',
    'policy.sjf': 'Shortest job first (SJF)',
    'policy.aging': 'Waiting jobs gain priority over time (aging)',
    'policy.aging_reserve': 'Saves a spot for a long wait (EASY reservation)',
    'policy.knapsack': 'Best mix of waiting jobs (knapsack)',
    'metric.avg_wait': 'Average wait',
    'metric.max_wait': 'Longest wait',
    'metric.avg_turnaround': 'Average turnaround (arrival to finish)',
    'metric.weighted_completion': 'Weighted completion',
    'metric.makespan': 'Time until everything finished (makespan)',
    'metric.util_cpu': 'CPU busy (utilization)',
    'metric.util_mem': 'Memory busy (utilization)',
    'metric.by_priority': 'Average wait by priority',
    'metric.none': 'no value yet (no job has finished)',
    'kind.ARRIVE': 'Arrived',
    'kind.START': 'Started',
    'kind.SKIP': 'Skipped',
    'kind.RESERVE': 'Spot saved',
    'kind.BACKFILL': 'Squeezed in',
    'kind.FINISH': 'Finished',
    'kind.REJECT': 'Rejected',
    'kind.BATCH_SELECT': 'Batch chosen',
    'kind.PROMOTE_INFO': 'Moved up',

    'compare.heading': 'Compare schedulers',
    'compare.pick': 'Pick two or more. They all run on the same jobs and machine.',
    'compare.settings.note': 'The aging rate and reservation threshold come from the Run settings.',
    'compare.start': 'Compare',
    'compare.status.idle': 'Ready. Pick two or more.',
    'compare.status.running': 'Comparing {n} schedulers\u2026 {events} events so far.',
    'compare.status.done': 'Done: {n} schedulers on {jobs} jobs.',
    'compare.status.stale': ' The jobs or settings changed since; press Compare again.',
    'compare.status.error': 'The comparison stopped.',
    'compare.error.nojobs': 'There are no jobs. Add some in step 1 first.',
    'compare.error.pick': 'Pick at least two schedulers to compare.',
    'compare.empty': 'Nothing to compare yet. Add jobs in step 1, pick two or more schedulers, then press Compare.',
    'compare.table': 'Same jobs, different schedulers',
    'compare.col.scheduler': 'Scheduler',
    'compare.dash': 'A dash means no value exists, for example when no job finished.',
    'compare.best': 'Best',
    'compare.verdict.best': '{name} finished everything first, at tick {t}.',
    'compare.verdict.tie': '{names} tied for first, finishing at tick {t}.',
    'compare.verdict.later': '{name} took {d} {ticks} longer.',
    'compare.exact.partial': '{name} did not finish every job, so its gap is not shown.',
    'compare.exact.line': 'Exact best order (up to 9 jobs): total wait {t}.',
    'compare.exact.gap': '{name} is {d} above it.',
    'compare.exact.same': '{name} matches it.',
    'compare.exact.big': 'The exact best order is only worked out for 9 jobs or fewer.',
    'compare.exact.failed': 'The exact best order could not be worked out: {why}',
    'compare.timelines': 'Who ran when',
    'compare.timeline.cap': '{name} (everything finished at tick {t})',
    'compare.timeline.aria': 'Timeline of every job under {name}',
    'compare.charts': 'Charts',
    'compare.chart.loading': 'Charts are still loading. The table above has the numbers; the charts appear when they arrive.',
    'compare.chart.failed': 'Charts could not load, so here are the numbers instead.',
    'compare.chart.error': 'Charts could not be drawn ({why}). The table above has the same numbers.',
    'compare.chart.aria': 'Bar chart of {title} per scheduler',
    'short.fcfs': 'First come, first served (FCFS)',
    'short.priority': 'Highest priority first',
    'short.sjf': 'Shortest job first (SJF)',
    'short.aging': 'Aging',
    'short.aging_reserve': 'Aging with reservation (EASY)',
    'short.knapsack': 'Knapsack',
    'policy.knapsack.soon': ' (not implemented yet)',
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
    var cells = scope.querySelectorAll('[data-copy-attr]');
    for (var c = 0; c < cells.length; c++) { cells[c].setAttribute('data-label', get(cells[c].getAttribute('data-copy-attr'))); }
    var labelled = scope.querySelectorAll('[data-copy-label]');
    for (var j = 0; j < labelled.length; j++) { labelled[j].setAttribute('aria-label', get(labelled[j].getAttribute('data-copy-label'))); }
  }

  APRM.copy = { get: get, fill: fill, has: has, keys: keys, apply: apply };
})();
