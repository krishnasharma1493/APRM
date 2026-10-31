# APRM: Backlog

The master list of issues, in build order, grouped by the five gates in BLUEPRINT §4. GitHub issues are copies; if they disagree, this file wins. Nobody starts a gate until the previous gate check passes. Inside Gate 4, every Must-have issue is done, and the full demo path has run once end to end, before any Nice-to-have issue starts (PRD §1A rule).

**Ids:** `K-xx` Krishna, `A-xx` Ahaana. **(plan first)**: write a plan (files, functions, data structures, tests, complexity) and get approval before coding. **GitHub #:** the issue number on github.com/krishnasharma1493/APRM. Each gate also has a tracker issue (#49–#53).

Every issue's definition of done also includes the CLAUDE.md checklist: tests green, `make sanitize` for C, PR template filled in, `docs/AI_USE.md` updated, human review.

---

## Gate 1: Foundations

### K-01 Toolchain setup (plan first) · GitHub #1 ([link](https://github.com/krishnasharma1493/APRM/issues/1))
- **Refs:** PRD "Version safety rule", §1, §3 (Build options), §9; `docs/TOOLCHAIN.md`
- **Files:** `docs/TOOLCHAIN.md`, `requirements.txt`, `README.md` (setup section)
- **Do:** Verify the latest stable GCC/Clang, Make, Emscripten (emsdk), Node.js LTS, Python and the PyPI packages from their official sources (web search + registry). Install them on both laptops (Windows through WSL2 Ubuntu, Mac). Fill in TOOLCHAIN.md with what each laptop actually has. Write `requirements.txt` with names only (`numpy`, `pandas`, `matplotlib`, `pytest`). Report what was verified, and where.
- **Done when:**
  - [ ] Every TOOLCHAIN.md row filled for both laptops, with its source and the date checked
  - [ ] `requirements.txt` lists names only, no versions
  - [ ] `emcc`, `gcc`/`clang`, `make`, `node`, `python3` run on both laptops (or the CI fallback for Emscripten from PRD §10B is written down)
  - [ ] No version number typed from memory anywhere

### K-02 Makefile, config.h, job.h · GitHub #2 ([link](https://github.com/krishnasharma1493/APRM/issues/2))
- **Refs:** PRD §2, §3 (Defaults and limits, Build options), §5 (Job, error codes, `SimConfig` with `alpha_milli` and `max_jobs`), §6; DECISIONS D13, D27, D51
- **Files:** `Makefile`, `core/config.h`, `core/job.h`, `tests/c/test_main.h` (tiny assert helpers)
- **Do:** Targets `make`, `make debug`, `make sanitize`, `make test`, `make wasm` (calls `wasm/build.sh` once it exists), `make clean`. Flags `-std=c11 -Wall -Wextra -Werror`. Output in `build/`, CLI at `build/aprm`. `config.h`: every default and limit from PRD §3 as named constants (`APRM_EXACT_MAX_JOBS 9`, `APRM_MAX_JOBS_CLI 1000000`, `APRM_MAX_JOBS_WEB 5000`, `alpha_milli` range 0–10000 …). `job.h`: the `Job` struct, `PolicyKind`, error codes −1 to −9 from §5.
- **Done when:**
  - [ ] `make`, `make debug`, `make sanitize`, `make test`, `make clean` all work on an empty test suite
  - [ ] Every PRD §3 limit appears once in `config.h`; every PRD §5 error code once in `job.h`
  - [ ] Builds with zero warnings on GCC and Clang

### K-03 Generic binary heap (M1) · GitHub #3 ([link](https://github.com/krishnasharma1493/APRM/issues/3))
- **Refs:** BLUEPRINT §3.1, §3.8; PRD §1A M1, §4 (Modules), §6, §10 (`test_heap.c`)
- **Files:** `core/heap.h`, `core/heap.c`, `tests/c/test_heap.c`
- **Do:** An array-based binary heap over a caller-supplied compare function: create, destroy, push, pop, peek, build (O(n) heapify), size. Grows with a checked `realloc`; no globals. A comment on each function: what it does, its complexity, who owns returned memory.
- **Done when:**
  - [ ] push and pop O(log n), peek O(1), build O(n), as stated in comments and BP §3.1
  - [ ] 10,000 random pushes pop in order, for both a min compare and a max compare (M1)
  - [ ] Empty-heap pop and peek return an error, not a crash
  - [ ] Allocation failure returns `OUT_OF_MEMORY` and leaves the heap valid
  - [ ] `make sanitize` clean

### K-04 JSON writer · GitHub #4 ([link](https://github.com/krishnasharma1493/APRM/issues/4))
- **Refs:** PRD §5 (Conventions, JSON shapes), §6 (Memory safety); DECISIONS O-11, D14
- **Files:** `core/json.h`, `core/json.c`, `tests/c/test_json.c`
- **Do:** Define `JsonBuf` (decide O-11: fields, growth, ownership) and a writer for objects, arrays, strings (escaped), int64, booleans, null, and fixed three-decimal numbers made from integers (for the live score). `snprintf` only.
- **Done when:**
  - [ ] Every string escaped (quotes, backslash, control characters), checked by tests
  - [ ] The buffer grows safely; allocation failure is reported and leaves the buffer valid
  - [ ] Three-decimal output made from integers (e.g. 6200 milli → `6.200`), no floating point
  - [ ] O-11 recorded in DECISIONS.md; `make sanitize` clean

### K-05 CSV reader and writer · GitHub #5 ([link](https://github.com/krishnasharma1493/APRM/issues/5))
- **Refs:** PRD §5 (CSV formats, error `PARSE_ERROR`), §6 (Input validation), §3 (ranges)
- **Files:** `core/csv.h`, `core/csv.c`, `tests/c/test_csv.c`
- **Do:** Parse `jobs.csv` text from memory (the core does no file I/O; the CLI reads the file). Header required, exactly 6 columns, integers only, range checks per §3, a fixed maximum line length. Errors give line and column. A writer for `results.csv`.
- **Done when:**
  - [ ] Rejects missing header, extra or missing columns, non-numbers, overflow, over-long lines, with "Line N, column X: …"
  - [ ] Every field range-checked against PRD §3
  - [ ] Round trip: write then read gives the same jobs
  - [ ] `make sanitize` clean

### K-06 CI baseline · GitHub #6 ([link](https://github.com/krishnasharma1493/APRM/issues/6))
- **Refs:** PRD §9 (CI baseline), version safety rule
- **Files:** `.github/workflows/ci.yml`
- **Do:** Jobs build-c, test-c, sanitize on Linux, plus a python job that runs `pytest tests/py` (only the figure smoke test exists at first). Leave placeholders for build-wasm and deploy, filled in by K-13 and K-37. Verify every action and runner version per the version safety rule.
- **Done when:**
  - [ ] CI runs on every push and pull request; green on `main`
  - [ ] A deliberate warning makes the build fail (warnings are errors)
  - [ ] Every version in the workflow verified and noted in the PR

### K-07 First golden cases: FCFS (paper) · GitHub #7 ([link](https://github.com/krishnasharma1493/APRM/issues/7))
- **Refs:** PRD §10 (Golden cases), BLUEPRINT §2 (rules), §3.4 (greedy fill); DECISIONS D44
- **Files:** `tests/cases/<case>.csv`, `tests/cases/<case>.fcfs.expected.csv`, `tests/cases/README.md` (worked schedule per case)
- **Do:** At least 3 small FCFS cases (3–6 jobs), including a simultaneous finish-and-arrival case, each schedule worked out by hand. Ahaana redoes each one on paper without seeing the program's output.
- **Done when:**
  - [ ] Files named `<case>.<policy>.expected.csv` with the `results.csv` columns
  - [ ] Each case has its hand-worked timeline in `tests/cases/README.md`
  - [ ] Ahaana's paper check recorded in the PR ("checked by hand: yes")

### A-01 Python environment and a "hello figure" · GitHub #8 ([link](https://github.com/krishnasharma1493/APRM/issues/8))
- **Refs:** PRD §5 "Summary CSV formats"; `data/sample_summaries/README.md`; CLAUDE.md "Working with Ahaana"
- **Files:** `tools/plot_figures.py` (first version), `.venv/` (not committed)
- **Do:** Create the virtual environment from `requirements.txt` on Ahaana's laptop. Write one short function that reads `data/sample_summaries/e1_summary.csv` with pandas and draws average wait vs load (one line per policy) with matplotlib, saving a PNG. Needs only the sample files, not the C program.
- **Done when:**
  - [ ] `python tools/plot_figures.py` runs on Ahaana's laptop and writes one PNG
  - [ ] Every block has a comment; Ahaana can explain each line
  - [ ] Uses only pandas and matplotlib; reads only the sample summary file

### Gate 1 check · tracker #49 ([link](https://github.com/krishnasharma1493/APRM/issues/49))
Heap tests pass, both laptops build, CI green.

---

## Gate 2: Engine

### K-08 Engine lifecycle (plan first) · GitHub #9 ([link](https://github.com/krishnasharma1493/APRM/issues/9))
- **Refs:** PRD §4 (Sim struct, three collections), §5 (core C functions, error codes, conventions), §6; DECISIONS D27, D29, O-8
- **Files:** `core/engine.h`, `core/engine.c`, `tests/c/test_engine.c`
- **Do:** The opaque `Sim` struct; `sim_create`, `sim_add_job` (any time, arrival ≥ now), `sim_reset` (keeps config), `sim_destroy`. Validate every pointer and every field before touching state. Enforce `max_jobs`, duplicate ids, capacity. Decide O-8 (rejected-job semantics).
- **Done when:**
  - [ ] Each error code returned for its trigger (`INVALID_ARGUMENT`, `INVALID_FIELD` with `field`, `CAPACITY_EXCEEDED`, `ARRIVAL_IN_PAST`, `DUPLICATE_ID`, `LIMIT_REACHED`, `OUT_OF_MEMORY`)
  - [ ] A rejected job leaves the simulation unchanged (test compares state before and after)
  - [ ] Reset and destroy are clean under `make sanitize` (no leaks)
  - [ ] O-8 decided and recorded; PRD §5 updated first if the contract changes

### K-09 Event loop with FCFS greedy fill (plan first) · GitHub #10 ([link](https://github.com/krishnasharma1493/APRM/issues/10))
- **Refs:** PRD §4 (diagram, invariants, selection step), §1A M2; BLUEPRINT §2 rules 1–6, §3.4; DECISIONS D9, D15, O-13
- **Files:** `core/engine.c`, `core/policy.h`, `core/policy.c` (FCFS key only), `tests/c/test_engine.c`
- **Do:** `sim_step` (1 = event done, 0 = finished) and `sim_run_until`: jump to the next event; finishes before arrivals; then greedy fill; running heap ordered by finish time. Debug builds check every PRD §4 invariant after every step. Decide O-13.
- **Done when:**
  - [ ] Every FCFS golden case from K-07 passes
  - [ ] All PRD §4 invariants checked after every step in `make debug`
  - [ ] `start + duration` overflow-checked
  - [ ] Cost per event O((s + k) log n), stated in comments
  - [ ] `make sanitize` clean

### K-10 Event log with plain-English reasons (M5) · GitHub #11 ([link](https://github.com/krishnasharma1493/APRM/issues/11))
- **Refs:** PRD §1A M5, §5 (event log entry, log kinds), BLUEPRINT §5 ("why" panel); DECISIONS O-7
- **Files:** `core/eventlog.h`, `core/eventlog.c`, `core/engine.c`, `tests/c/test_eventlog.c`
- **Do:** A growing array of typed entries (O(1) amortised append) and a sentence formatter; `sim_log_json(s, since_seq, out)`. Decide what `PROMOTE_INFO` means (O-7).
- **Done when:**
  - [ ] Every start, skip, reserve, backfill, finish and reject produces exactly one sentence (M5)
  - [ ] Sentences match the PRD §5 example style ("Job 7 skipped: needs 20480 MB, only 8192 MB free.")
  - [ ] `since_seq` returns only newer entries; `make sanitize` clean

### K-11 Metrics and JSON outputs · GitHub #12 ([link](https://github.com/krishnasharma1493/APRM/issues/12))
- **Refs:** PRD §5 (JSON shapes: state, metrics), §1A M2; BLUEPRINT §2 (What we measure); DECISIONS D14, D17, O-4, O-5, O-6
- **Files:** `core/metrics.h`, `core/metrics.c`, `core/engine.c`, `tests/c/test_metrics.c`
- **Do:** Running totals; `sim_state_json`, `sim_results_json`, `sim_metrics_json` with exactly the PRD §5 shapes. Weighted completion = Σ (priority + 1) × finish. Decide O-4 (utilisation), O-5 (empty priority level), O-6 (score for non-aging policies).
- **Done when:**
  - [ ] Shapes match PRD §5 key for key (test compares against literal JSON)
  - [ ] `reservation` is `null` when none is active
  - [ ] Live score printed with three decimals from integers
  - [ ] O-4, O-5, O-6 recorded; PRD §5 updated first if needed

### K-12 Console program (M6) · GitHub #13 ([link](https://github.com/krishnasharma1493/APRM/issues/13))
- **Refs:** PRD §5 (Console program, exit codes), §1A M6; DECISIONS D51, O-8
- **Files:** `cli/main.c`, `tests/cases/run_golden.sh` (or a C runner), Makefile `test` target
- **Do:** `aprm --in jobs.csv --out results.csv [--policy …] [--cpu] [--mem] [--alpha-milli] [--threshold] [--eps] [--log] [--metrics] [--exact]`. Reads files, sets `max_jobs` = 1,000,000, writes outputs. Errors go to stderr as one line. `make test` runs every golden case through the CLI.
- **Done when:**
  - [ ] `build/aprm --policy fcfs --in … --out …` matches every FCFS golden case (M6; the other policies follow in K-19, K-26)
  - [ ] Exit codes 0–4 exactly as in PRD §5, each tested
  - [ ] `make sanitize` clean

### K-13 WebAssembly exports and build · GitHub #14 ([link](https://github.com/krishnasharma1493/APRM/issues/14))
- **Refs:** PRD §5 (WebAssembly exports), §3 (Emscripten flags), §9 (build-wasm); DECISIONS D26, D27, O-10
- **Files:** `wasm/api.c`, `wasm/build.sh`, `wasm/run_wasm.mjs`, `.github/workflows/ci.yml`
- **Do:** Flat exports `aprm_create(cpu, mem, policy, alpha_milli, T, eps)` … `aprm_destroy`, a handle table in `api.c`, `max_jobs` = 5,000. Modular, single-file output, only the step API exported; check the flag spellings in the current Emscripten documentation. A headless Node runner for conformance. CI job build-wasm with the frozen emsdk. Decide O-10.
- **Done when:**
  - [ ] `make wasm` produces `web/vendor/aprm.js` (git-ignored)
  - [ ] `node wasm/run_wasm.mjs` on a golden case prints the same `results.csv` as the CLI
  - [ ] CI build-wasm green; O-10 recorded

### K-14 Workload generator (M9) · GitHub #15 ([link](https://github.com/krishnasharma1493/APRM/issues/15))
- **Refs:** PRD §1A M9, §5 (jobs.csv); BLUEPRINT §6 (Workload generator settings); DECISIONS D43, D50, O-12
- **Files:** `tools/gen_workload.py`, `tools/config.py`, `tests/py/test_gen_workload.py`
- **Do:** Seeded workloads: Poisson arrivals, size mix, priority distribution; writes `jobs.csv` plus a sidecar with the seed and settings. Decide O-12 values with Krishna's approval and record them.
- **Done when:**
  - [ ] Same seed → byte-identical CSV; different seeds differ
  - [ ] Every row passes PRD §3 ranges
  - [ ] Seed and settings written next to each workload
  - [ ] O-12 values recorded in DECISIONS.md and `tools/config.py`

### K-15 Experiment runner skeleton · GitHub #16 ([link](https://github.com/krishnasharma1493/APRM/issues/16))
- **Refs:** PRD §3 (Experiment settings), §5 (Console program); BLUEPRINT §6
- **Files:** `tools/run_experiments.py`, `tools/config.py`, `tests/py/test_run_experiments.py`
- **Do:** Runs `build/aprm` over a grid with `subprocess`, writes raw results under `results/raw/<experiment>/<setting>/<policy>/<seed>/`. Never schedules in Python.
- **Done when:**
  - [ ] A small grid (2 seeds × 1 setting × FCFS) runs end to end
  - [ ] Python reads the console output (Gate 2 check)
  - [ ] A non-zero exit code from the CLI is reported with its stderr line

### K-16 Invariant property checker · GitHub #17 ([link](https://github.com/krishnasharma1493/APRM/issues/17))
- **Refs:** PRD §10 (Python checks: Invariants), §4 (Invariants list), §1A M11
- **Files:** `tools/check_properties.py`, `tests/py/test_properties.py`
- **Do:** Random workloads through the CLI; check every result row against the PRD §4 invariants that are visible in `results.csv` (no resource overuse at any time, no early start, correct duration, no lost jobs).
- **Done when:**
  - [ ] 10,000 random runs with zero violations (M11; the CI run may use fewer, the full count runs before Gate 4)
  - [ ] A deliberately broken results file is caught by each check

### K-17 Golden cases for every policy · GitHub #18 ([link](https://github.com/krishnasharma1493/APRM/issues/18))
- **Refs:** PRD §10 (Golden cases); BLUEPRINT §3.2–§3.5, §5 (Presets); DECISIONS D44
- **Files:** `tests/cases/*.csv`, `tests/cases/*.<policy>.expected.csv`, `tests/cases/README.md`
- **Do:** At least 10 cases (3–6 jobs): one per policy plus big-job trap, priority starvation, memory hog, simultaneous finish and arrival, capacity rejection, each worked by hand. Ahaana redoes each one on paper.
- **Done when:**
  - [ ] ≥ 10 cases, named `<case>.<policy>.expected.csv`
  - [ ] Each has its worked timeline in the README
  - [ ] Ahaana's paper check recorded for every case

### K-18 Freeze the step API and the toolchain · GitHub #19 ([link](https://github.com/krishnasharma1493/APRM/issues/19))
- **Refs:** BLUEPRINT §4 ("One fixed agreement"); PRD version safety rule (steps 2–3), §5, §9
- **Files:** `docs/PRD.md` §5, `docs/TOOLCHAIN.md`, `requirements.lock.txt`, `.github/workflows/ci.yml`
- **Do:** Settle every §5 open item touched so far; mark PRD §5 "Frozen at Gate 2"; record exact versions in TOOLCHAIN.md and `pip freeze` into the lock file; CI installs from the lock file. Ahaana reviews the CSV and summary formats.
- **Done when:**
  - [ ] PRD §5 marked frozen; Ahaana approved the CSV and summary formats in the PR
  - [ ] TOOLCHAIN.md filled for both laptops and CI with identical versions
  - [ ] CI python job installs from `requirements.lock.txt`

### A-02 Shared figure style · GitHub #20 ([link](https://github.com/krishnasharma1493/APRM/issues/20))
- **Refs:** CLAUDE.md "Working with Ahaana"; PRD §5 "Summary CSV formats"
- **Files:** `tools/plot_figures.py`
- **Do:** One small function that sets the shared style: readable fonts; colours that work in print and in greyscale (each policy also gets its own line style and marker); axis labels with units; a helper that saves each figure as PNG and PDF into `docs/report/figures/`. Re-draw the A-01 figure with it.
- **Done when:**
  - [ ] Every policy has a fixed colour + line style + marker, readable when printed in greyscale
  - [ ] PNG and PDF written for the E1 sample figure
  - [ ] Ahaana can explain why each style choice helps the reader

### Gate 2 check · tracker #50 ([link](https://github.com/krishnasharma1493/APRM/issues/50))
FCFS cases pass, **step API frozen**, Python reads console output.

---

## Gate 3: Policies and website

### K-19 Static priority, SJF and aging policies (M3) · GitHub #21 ([link](https://github.com/krishnasharma1493/APRM/issues/21))
- **Refs:** BLUEPRINT §3.2, §3.3 (integer key, starvation bound); PRD §1A M3, §10 (`test_policy.c`); DECISIONS D11–D13
- **Files:** `core/policy.c`, `core/policy.h`, `tests/c/test_policy.c`, `cli/main.c` (policy flags)
- **Do:** Keys: static = largest priority; SJF = smallest duration; aging = largest `1000·b − alpha_milli·r` (int64). Every compare ends with earlier arrival, then lower id.
- **Done when:**
  - [ ] Each policy passes its golden cases (M3)
  - [ ] Test: aging order unchanged as time passes (no re-sorting)
  - [ ] Test: alpha_milli = 0 orders exactly like static priority
  - [ ] Key overflow impossible within PRD §3 ranges (shown in a comment and a boundary test)

### K-20 Summaries for E1–E3 (`summarize.py`) · GitHub #22 ([link](https://github.com/krishnasharma1493/APRM/issues/22))
- **Refs:** PRD §5 "Summary CSV formats", §10 (Metrics, Summary format checks), §1A M10; BLUEPRINT §6; DECISIONS D36–D39
- **Files:** `tools/summarize.py`, `tests/py/test_summaries.py`, `tools/config.py`
- **Do:** Run E1–E3 (30 seeds per setting) through the runner; compute means and Student-t 95% intervals with the hard-coded t values; write `e1_summary.csv`, `e2_summary.csv`, `e2_wait_cdf.csv`, `e3_summary.csv` into `results/summaries/`. Verify the t constants against the cited table first (D38).
- **Done when:**
  - [ ] Columns and order exactly as PRD §5 (test also runs on `data/sample_summaries/`)
  - [ ] `ci_low ≤ mean ≤ ci_high` on every row
  - [ ] Metrics recomputed in pandas match the C metrics JSON within 1e-9 (PRD §10)
  - [ ] n other than 30 or 50 raises an error

### K-21 Conformance script (M11) · GitHub #23 ([link](https://github.com/krishnasharma1493/APRM/issues/23))
- **Refs:** PRD §10 (Conformance), §1A M11, §9 (CI python job)
- **Files:** `tools/conformance.py`, `tests/py/test_conformance.py`
- **Do:** Random workloads through `build/aprm` and `node wasm/run_wasm.mjs`; compare outputs byte for byte, for every policy implemented so far.
- **Done when:**
  - [ ] 1,000 random cases identical, byte for byte (M11)
  - [ ] Runs in CI against the fresh WebAssembly build
  - [ ] A first difference is reported with the case seed and the first differing line

### K-22 Six presets · GitHub #24 ([link](https://github.com/krishnasharma1493/APRM/issues/24))
- **Refs:** BLUEPRINT §5 (Presets), §3.4 (Lemma 4.1 trap); PRD §7 (`presets_data.js`); DECISIONS D32, O-9
- **Files:** `data/presets/*.csv`, `web/js/presets_data.js`, generator in `tools/gen_workload.py`
- **Do:** Big-job trap (own capacities so all small jobs fit together), priority starvation, memory hog, SJF starvation, heavy load, tiny case (6–9 jobs). Generate `presets_data.js` from the CSVs. Decide O-9.
- **Done when:**
  - [ ] Six presets, each demonstrating what BLUEPRINT §5 says (checked by running the CLI)
  - [ ] `presets_data.js` regenerates from the CSVs with one command, identically
  - [ ] Every preset passes PRD §3 validation

### K-23 Website shell and states · GitHub #25 ([link](https://github.com/krishnasharma1493/APRM/issues/25))
- **Refs:** PRD §7 (Loading model, Scripts, UI states, Layout), §8; BLUEPRINT §5; DECISIONS D31, D34
- **Files:** `web/index.html`, `web/css/style.css`, `web/js/wasm.js`, `web/js/store.js`, `web/js/app.js`
- **Do:** Classic scripts in the PRD §7 order on `window.APRM`; the layout (left panel, centre canvas, right "why" log, bottom metrics, mode switch); light and dark colours as CSS variables; loading, empty and error states; a clear message when WebAssembly fails to load.
- **Done when:**
  - [ ] Opens from `file://` with a double-click and the network off
  - [ ] Loading, empty and error states each visible and tested by hand
  - [ ] No `innerHTML`, `eval` or inline handlers (grep check)

### K-24 Website Build mode (M7) · GitHub #26 ([link](https://github.com/krishnasharma1493/APRM/issues/26))
- **Refs:** BLUEPRINT §5 (Build mode); PRD §7 (`editor.js`, `generator.js`, `presets.js`), §8 (CSV upload rules), §1A M7
- **Files:** `web/js/editor.js`, `web/js/generator.js`, `web/js/presets.js`
- **Do:** Capacities; job table add/edit/delete with PRD §3 validation (red cell when over capacity); random jobs from sliders with a visible seed; load presets; CSV import (1 MB limit, bad rows listed) and export.
- **Done when:**
  - [ ] Every preset loads (M7)
  - [ ] CSV export then import gives the same case
  - [ ] Invalid input shows the message next to the right field

### K-25 Website Run mode (plan first) (M7) · GitHub #27 ([link](https://github.com/krishnasharma1493/APRM/issues/27))
- **Refs:** BLUEPRINT §5 (Run mode, live canvas, "why" panel); PRD §7 (run loop), §8 (long runs), §10 (website checklist), §1A M7
- **Files:** `web/js/player.js`, `web/js/canvas.js`, `web/js/whylog.js`
- **Do:** Play, pause, step, speed, jump to end (in slices); resource bars, waiting line with live scores and the reservation lock, Gantt timeline with a "now" marker; "why" log filtered by clicked job; pause and add a job mid-run.
- **Done when:**
  - [ ] Any case can be built, edited, played, stepped and extended mid-run (M7)
  - [ ] A job added mid-run appears and is scheduled
  - [ ] A 500-job case steps with no visible lag; steps per frame capped
  - [ ] All six presets play, step and finish

### A-03 Figures for E1, E2 (with CDF) and E3 · GitHub #28 ([link](https://github.com/krishnasharma1493/APRM/issues/28))
- **Refs:** BLUEPRINT §6 (E1–E3); PRD §5 "Summary CSV formats"; CLAUDE.md "Working with Ahaana"
- **Files:** `tools/plot_figures.py`
- **Do:** One function per figure, built on the sample summaries first: E1 average wait vs load (error bars); E2 maximum wait vs load (error bars) and the wait CDF from `e2_wait_cdf.csv`; E3 average wait per priority level, priority vs aging. Switch the input folder to `results/summaries/` once K-20 has merged.
- **Done when:**
  - [ ] Four figures, each with title, axis labels with units, legend, and error bars or 95% bands
  - [ ] Each saved as PNG and PDF in `docs/report/figures/`
  - [ ] Works on the sample summaries and on the real ones
  - [ ] Ahaana can explain how to read each figure

### Gate 3 check · tracker #51 ([link](https://github.com/krishnasharma1493/APRM/issues/51))
All policy cases pass, website runs every preset.

---

## Gate 4: Advanced

**Must-have issues first (K-26 to K-32, A-04, A-05). Nice-to-have issues (K-33 to K-38, A-04b) start only after all of them are done and the full demo path has run once.**

### K-26 Reservation (plan first) (M4) · GitHub #29 ([link](https://github.com/krishnasharma1493/APRM/issues/29))
- **Refs:** BLUEPRINT §3.5 (trigger, shadow time, extra room, backfill rule, guarantee), §3.8; PRD §1A M4, §4 (invariants), §10 (`test_reserve.c`); DECISIONS D18, O-14
- **Files:** `core/reserve.h`, `core/reserve.c`, `core/engine.c`, `tests/c/test_reserve.c`, golden cases
- **Do:** Policy `reserve` = aging + reservation, implemented exactly as BLUEPRINT §3.5 describes. Log `RESERVE` and `BACKFILL` entries. Decide O-14 (is a reservation ever cancelled?).
- **Done when:**
  - [ ] Memory-hog golden case: the reserved job starts by its shadow time (M4)
  - [ ] Shadow time correct; backfilled jobs never delay the reserved job (PRD §10)
  - [ ] Invariant "at most one reservation, the reserved job is in the waiting heap" checked
  - [ ] Shadow-time cost O(r log r) stated; O-14 recorded

### K-27 Website Compare mode (M8) · GitHub #30 ([link](https://github.com/krishnasharma1493/APRM/issues/30))
- **Refs:** BLUEPRINT §5 (Compare); PRD §7 (`compare.js`), §8 (Chart.js rules), §1A M8, version safety rule
- **Files:** `web/js/compare.js`, `web/index.html` (Chart.js `<script>` with SRI)
- **Do:** One simulation per selected policy on the same jobs; side-by-side timelines and a metrics table; Chart.js pinned to an exact version at least two weeks old with an SRI hash (verified, reported); table fallback when it fails to load.
- **Done when:**
  - [ ] Two or more policies side by side (M8)
  - [ ] Metrics equal the console program's for the same case
  - [ ] With the network off, the table fallback appears

### K-28 E5 runs and summary (M10) · GitHub #31 ([link](https://github.com/krishnasharma1493/APRM/issues/31))
- **Refs:** BLUEPRINT §6 (E5); PRD §5 "Summary CSV formats" (`e5_summary.csv`), §1A M10
- **Files:** `tools/config.py`, `tools/summarize.py`, `tests/py/test_summaries.py`
- **Do:** Big-memory share 0–40%, aging vs reserve, 30 seeds; write `e5_summary.csv`.
- **Done when:**
  - [ ] `e5_summary.csv` exactly in the PRD §5 format; summary tests pass

### K-29 Starvation-bound check · GitHub #32 ([link](https://github.com/krishnasharma1493/APRM/issues/32))
- **Refs:** BLUEPRINT §3.3, §3.5 (guarantee); PRD §10 (Starvation bound, Aging order); DECISIONS O-1
- **Files:** `tools/check_properties.py`, `tests/py/test_properties.py`
- **Do:** Settle O-1: state the explicit bound (with Krishna's proof sketch) and test that the measured maximum wait under `reserve` never exceeds it. Add the aging-order check: no job starts ahead of a waiting job with a higher score unless the higher one did not fit.
- **Done when:**
  - [ ] O-1 recorded with the formula; the report proof (K-40) uses the same formula
  - [ ] Zero violations on random workloads with reservation
  - [ ] Aging-order check passes

### K-30 Hardening review · GitHub #33 ([link](https://github.com/krishnasharma1493/APRM/issues/33))
- **Refs:** PRD §6, §8, §11.4 (hardening prompt)
- **Files:** any file in `core/`, `cli/`, `wasm/`, `web/` (smallest fixes only)
- **Do:** Go through each PRD §6 and §8 item: pass or fail, quoting the line, with the smallest fix. No refactors of passing code, no new features.
- **Done when:**
  - [ ] Every §6 and §8 checkbox ticked with evidence in the PR
  - [ ] `make sanitize` and the full test suite clean

### K-31 Fresh-clone setup test (M12) · GitHub #34 ([link](https://github.com/krishnasharma1493/APRM/issues/34))
- **Refs:** PRD §1A M12, success metrics (fresh-clone setup)
- **Files:** `README.md`
- **Do:** Ahaana follows the README alone on her laptop from a fresh clone; fix every step that stalls.
- **Done when:**
  - [ ] Ahaana builds, runs `make test`, opens the website and regenerates figures in ≤ 15 minutes (M12)

### K-32 Backup demo video and first end-to-end run (M13) · GitHub #35 ([link](https://github.com/krishnasharma1493/APRM/issues/35))
- **Refs:** PRD §1A M13, §10A (demo script, pre-demo checklist)
- **Files:** `docs/slides/` (notes only; the video is not committed)
- **Do:** Run the full demo path once end to end; record a 3-minute website demo.
- **Done when:**
  - [ ] The full demo path has run once end to end (unlocks Nice-to-have work)
  - [ ] Video saved locally and in the cloud (M13)

### A-04 Figure for E5 (Must-have) · GitHub #36 ([link](https://github.com/krishnasharma1493/APRM/issues/36))
- **Refs:** BLUEPRINT §6 (E5); PRD §5 (`e5_summary.csv`)
- **Files:** `tools/plot_figures.py`
- **Do:** Maximum wait vs share of big-memory jobs, aging vs reserve, error bars; sample data first, then real.
- **Done when:**
  - [ ] Title, axis labels with units, legend, 95% error bars; PNG and PDF saved
  - [ ] Works on sample and real summaries; Ahaana can explain it

### A-05 One command regenerates every figure · GitHub #37 ([link](https://github.com/krishnasharma1493/APRM/issues/37))
- **Refs:** PRD §1A M10 ("Graphs regenerate from one command"), §10 (figure smoke test)
- **Files:** `tools/plot_figures.py`, `tests/py/test_plot_figures.py`
- **Do:** `python tools/plot_figures.py` (option: input folder) rebuilds every figure into `docs/report/figures/`, skipping figures whose summary file does not exist yet, with a message. A small pytest smoke test runs it on `data/sample_summaries/` into a temporary folder.
- **Done when:**
  - [ ] One command regenerates every available figure (M10)
  - [ ] The smoke test passes in CI

### K-33 Exact solver (N1, Nice-to-have) · GitHub #38 ([link](https://github.com/krishnasharma1493/APRM/issues/38))
- **Refs:** BLUEPRINT §3.7, §3.8; PRD §5 (`exact_solve`, `TOO_LARGE`), §10 (`test_exact.c`), success metrics (< 2 s at 9 jobs); DECISIONS D24, O-3
- **Files:** `core/exact.h`, `core/exact.c`, `tests/c/test_exact.c`, `cli/main.c` (`--exact`), `wasm/api.c` (`aprm_exact`)
- **Do:** Permutations + serial schedule generation + branch and bound, minimising total wait; limit fixed at 9. Decide O-3 (true complexity, tie-break between equally good schedules). Verify the Kolisch 1996 citation.
- **Done when:**
  - [ ] Matches full brute force on 5-job cases; `TOO_LARGE` above 9 jobs
  - [ ] A 9-job case solves in under 2 seconds (CLI and website)
  - [ ] O-3 recorded

### K-34 Knapsack batch selection (plan first) (N2, Nice-to-have) · GitHub #39 ([link](https://github.com/krishnasharma1493/APRM/issues/39))
- **Refs:** BLUEPRINT §3.6 (windows, volume, CADP with K = εζ/n, batch order, starting rule, consequences); PRD §6 (knapsack guards), §10 (`test_knapsack.c`); DECISIONS D19–D23, O-2
- **Files:** `core/knapsack.h`, `core/knapsack.c`, `core/engine.c`, `tests/c/test_knapsack.c`
- **Do:** Exactly BLUEPRINT §3.6. Decide O-2 (integer volumes, ε representation, table limit) in the plan. Log `BATCH_SELECT`.
- **Done when:**
  - [ ] DP matches brute force on small item sets; uses at most (1 + ε) of the capacity
  - [ ] Guards against division by zero, overflow and an oversized table
  - [ ] Conformance still identical with `knapsack` included

### K-35 E4 and E6 runs, summaries and exact-never-beaten check (N3, Nice-to-have) · GitHub #40 ([link](https://github.com/krishnasharma1493/APRM/issues/40))
- **Refs:** BLUEPRINT §6 (E4, E6); PRD §5 (`e4_summary.csv`, `e6_summary.csv`, `e6_ratios.csv`, E6 definitions), §10 (Exact never beaten); DECISIONS D40, D41, O-15, O-16
- **Files:** `tools/config.py`, `tools/summarize.py`, `tools/check_properties.py`, tests
- **Do:** E4 α sweep (alpha_milli 0–1,000); E6 200 tiny instances (50 per job count) with turnaround ratio and wait gap; check that exact total wait ≤ every policy's total wait on 200 tiny workloads. Decide O-15, O-16.
- **Done when:**
  - [ ] Files exactly in the PRD §5 formats; no E6 instance skipped
  - [ ] Exact never beaten on 200 workloads (Gate 4 check)

### K-36 Shareable case links (N4, Nice-to-have) · GitHub #41 ([link](https://github.com/krishnasharma1493/APRM/issues/41))
- **Refs:** PRD §7 (`share.js`), §8 (shared-link rules)
- **Files:** `web/js/share.js`
- **Done when:**
  - [ ] A case round-trips through the URL hash; hash size-limited, decoded in `try/catch`, every field validated like a CSV row

### K-37 GitHub Pages deploy (N5, Nice-to-have) · GitHub #42 ([link](https://github.com/krishnasharma1493/APRM/issues/42))
- **Refs:** PRD §9 (deploy step), A9
- **Files:** `.github/workflows/ci.yml`
- **Done when:**
  - [ ] `main` publishes `web/` (with the built `aprm.js`) to Pages; the page works there and from `file://`

### K-38 Timing benchmarks (N6, Nice-to-have) · GitHub #43 ([link](https://github.com/krishnasharma1493/APRM/issues/43))
- **Refs:** BLUEPRINT §3.8, §6 ("Also recorded"); PRD §1A N6
- **Files:** `tools/bench_timing.py`, a CLI timing option if needed
- **Done when:**
  - [ ] Measured time per decision against n for each policy, written as a CSV supporting the complexity table

### A-04b Figures for E4 and E6 (Nice-to-have) · GitHub #44 ([link](https://github.com/krishnasharma1493/APRM/issues/44))
- **Refs:** BLUEPRINT §6 (E4, E6); PRD §5 (`e4_summary.csv`, `e6_summary.csv`, `e6_ratios.csv`); DECISIONS D42
- **Files:** `tools/plot_figures.py`
- **Do:** E4: high-priority average wait vs low-priority maximum wait across α, with bands. E6: box plot of `turnaround_ratio` per policy from `e6_ratios.csv` (whiskers at 1.5 × IQR, the matplotlib default), plus the wait gap.
- **Done when:**
  - [ ] Both figures follow the shared style; PNG and PDF saved
  - [ ] The E6 caption notes we divide by the exact optimum, not a lower bound as in Beaumont

### Gate 4 check · tracker #52 ([link](https://github.com/krishnasharma1493/APRM/issues/52))
C and WebAssembly outputs match, exact solver never beaten.

---

## Gate 5: Evidence and viva

### K-39 Polish (N7, Nice-to-have) · GitHub #45 ([link](https://github.com/krishnasharma1493/APRM/issues/45))
- **Refs:** PRD §1A N7; BLUEPRINT §5 (Quality details)
- **Files:** `web/css/style.css`, `web/js/app.js`
- **Done when:**
  - [ ] Dark mode follows the system; Space plays/pauses, right arrow steps; no sideways scroll on a laptop screen

### K-40 Report chapters (Krishna) · GitHub #46 ([link](https://github.com/krishnasharma1493/APRM/issues/46))
- **Refs:** BLUEPRINT §7 (chapters 3–11, 12 method and statistics, 13–17), §3 (proofs); RESEARCH_NOTES.md
- **Files:** `docs/report/`
- **Do:** Model, heap, policies with the priority starvation proof, greedy fill (Lemma 6.3 scope, Lemma 4.1 example), reservation with the bounded-wait proof (same formula as O-1), knapsack, exact solver, implementation, testing (chapter 11), method and statistics (chapter 12). Every citation verified.
- **Done when:**
  - [ ] Each chapter in BLUEPRINT §7 owned by Krishna is written
  - [ ] Every reference marked "to verify" in RESEARCH_NOTES.md is verified or removed

### A-06 Captions and "what this graph shows" · GitHub #47 ([link](https://github.com/krishnasharma1493/APRM/issues/47))
- **Refs:** BLUEPRINT §6, §7 (chapter 12); PRD §10A row 7 and likely questions
- **Files:** `docs/report/` (results chapter, figure captions)
- **Do:** For each figure: a caption, plus one paragraph on what the graph shows and how to read it, in Ahaana's words.
- **Done when:**
  - [ ] Every figure has a caption and a paragraph
  - [ ] Ahaana presents demo row 7 from memory in rehearsal

### K-41 Slides, rehearsals and the demo-ready tag · GitHub #48 ([link](https://github.com/krishnasharma1493/APRM/issues/48))
- **Refs:** PRD §10A (demo script, pre-demo checklist, likely questions), success metrics (demo reliability)
- **Files:** `docs/slides/`
- **Done when:**
  - [ ] 3 consecutive clean rehearsals inside 12 minutes, no restart
  - [ ] `demo-ready` tag on both laptops; pre-demo checklist done

### Gate 5 check · tracker #53 ([link](https://github.com/krishnasharma1493/APRM/issues/53))
Viva ready: each member can demo and explain everything alone.

---

## Coverage check

| PRD §1A row | Issues |
| --- | --- |
| M1 | K-03 |
| M2 | K-08, K-09, K-11 |
| M3 | K-09 (FCFS), K-19 |
| M4 | K-26 |
| M5 | K-10 |
| M6 | K-12 |
| M7 | K-23, K-24, K-25 |
| M8 | K-27 |
| M9 | K-14 |
| M10 | K-15, K-20, K-28, A-03, A-04, A-05 |
| M11 | K-16, K-21 |
| M12 | K-01, K-31 |
| M13 | K-32 |
| N1 | K-33 |
| N2 | K-34 |
| N3 | K-35, A-04b |
| N4 | K-36 |
| N5 | K-37 |
| N6 | K-38 |
| N7 | K-39 |
