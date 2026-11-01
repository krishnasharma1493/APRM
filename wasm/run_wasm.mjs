// run_wasm.mjs: headless runner for CI (K-13). Loads web/vendor/aprm.js (the
// WebAssembly build of core/), reads a jobs CSV, adds the jobs, steps to the
// end and prints results.csv on stdout in exactly the console program's format.
//
// JavaScript never schedules. The only logic here is reading the CSV, turning
// the C results JSON into CSV text, and mapping errors to exit codes.
//
// Usage: node wasm/run_wasm.mjs --policy fcfs --in jobs.csv
//          [--cpu N] [--mem N] [--alpha-milli N] [--threshold N] [--eps X]
// Exit codes (as the console program, PRD section 5): 0 success, 1 bad
// arguments, 2 input file or CSV error, 3 invalid job, 4 internal error.
// Difference from the CLI: the website build allows at most 5,000 jobs
// (APRM_MAX_JOBS_WEB), so a larger CSV is exit 3 (LIMIT_REACHED).
// CSV reading is in csv_parse.mjs (same rules and first error as core/csv.c).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseJobs, CsvFail } from './csv_parse.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const POLICIES = { fcfs: 0, priority: 1, sjf: 2, aging: 3, reserve: 4, knapsack: 5 };
const CODE_NAMES = {
  '-1': 'INVALID_ARGUMENT', '-2': 'INVALID_FIELD', '-3': 'CAPACITY_EXCEEDED',
  '-4': 'ARRIVAL_IN_PAST', '-5': 'DUPLICATE_ID', '-6': 'LIMIT_REACHED',
  '-7': 'OUT_OF_MEMORY', '-8': 'PARSE_ERROR', '-9': 'TOO_LARGE',
};
const RESULTS_HEADER = 'id,arrival,start,finish,wait,turnaround,priority,cpu,mem';
const MAX_JOBS_WEB = 5000;               // APRM_MAX_JOBS_WEB, as set in wasm/api.c

class Fail extends Error {
  constructor(exit, text) { super(text); this.exit = exit; }
}

// Parse the command line. Throws Fail(1, ...) on anything unknown or malformed.
function parseArgs(argv) {
  const opt = { policy: 'fcfs', in: null, cpu: 16, mem: 32768, alphaMilli: 100, threshold: 50, eps: 0.1 };
  const flags = { '--policy': 'policy', '--in': 'in', '--cpu': 'cpu', '--mem': 'mem',
                  '--alpha-milli': 'alphaMilli', '--threshold': 'threshold', '--eps': 'eps' };
  for (let i = 0; i < argv.length; i += 2) {
    const key = flags[argv[i]];
    if (!key) throw new Fail(1, `INVALID_ARGUMENT: unknown option ${argv[i]}.`);
    if (i + 1 >= argv.length) throw new Fail(1, `INVALID_ARGUMENT: ${argv[i]} needs a value.`);
    const v = argv[i + 1];
    if (key === 'policy' || key === 'in') opt[key] = v;
    else {
      if (!/^-?\d+(\.\d+)?$/.test(v)) throw new Fail(1, `INVALID_ARGUMENT: ${argv[i]} needs a number, got "${v}".`);
      opt[key] = Number(v);
    }
  }
  if (opt.in === null) throw new Fail(1, 'INVALID_ARGUMENT: --in jobs.csv is required.');
  if (!(opt.policy in POLICIES)) throw new Fail(1, `INVALID_ARGUMENT: unknown policy "${opt.policy}".`);
  return opt;
}

// Exit code for an engine status, as the console program uses them (D54).
function exitFor(code) {
  return code === -7 ? 4 : 3;
}

// Turn the C results envelope into results.csv text. Formatting only.
function resultsCsv(json) {
  const env = JSON.parse(json);
  if (!env.ok) throw new Fail(4, `${CODE_NAMES[env.error.code]}: ${env.error.message}`);
  let out = RESULTS_HEADER + '\n';
  for (const r of env.data) {
    out += [r.id, r.arrival, r.start, r.finish, r.wait, r.turnaround, r.priority, r.cpu, r.mem].join(',') + '\n';
  }
  return out;
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  let text;
  try { text = readFileSync(opt.in, 'latin1'); }   // one char per byte, like the C reader
  catch (e) { throw new Fail(2, `PARSE_ERROR: cannot read ${opt.in}: ${e.code || e.message}`); }
  let jobs;
  try { jobs = parseJobs(text, MAX_JOBS_WEB); }
  catch (e) {
    // PARSE_ERROR is exit 2; a range or limit error is exit 3 (D54), first error in file order wins
    if (e instanceof CsvFail) throw new Fail(e.code === 'PARSE_ERROR' ? 2 : 3, e.message);
    throw e;
  }

  const createAprm = require(resolve(here, '..', 'web', 'vendor', 'aprm.js'));
  const M = await createAprm();
  const str = (p) => M.UTF8ToString(p);
  const errText = (h) => {
    const e = JSON.parse(str(M._aprm_last_error(h))).error;
    return `${CODE_NAMES[e.code]}: ${e.message}`;
  };

  const h = M._aprm_create(opt.cpu, opt.mem, POLICIES[opt.policy], opt.alphaMilli, opt.threshold, opt.eps);
  if (h < 0) throw new Fail(h === -7 ? 4 : 1, errText(0));
  try {
    for (const j of jobs) {
      const rc = M._aprm_add_job(h, j.id, j.arrival, j.duration, j.cpu, j.mem, j.priority);
      if (rc < 0) throw new Fail(exitFor(rc), `${errText(h)} (line ${j.line})`);
    }
    for (;;) {
      const rc = M._aprm_step(h);
      if (rc < 0) throw new Fail(4, errText(h));   // includes "policy not implemented yet"
      if (rc === 0) break;
    }
    process.stdout.write(resultsCsv(str(M._aprm_results(h))));
  } finally {
    M._aprm_destroy(h);
  }
}

main().catch((e) => {
  if (e instanceof Fail) {
    process.stderr.write(e.message + '\n');
    process.exitCode = e.exit;
  } else {
    process.stderr.write(`INTERNAL: ${e && e.stack ? e.stack : e}\n`);
    process.exitCode = 4;
  }
});
