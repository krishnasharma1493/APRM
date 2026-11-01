# APRM — Adaptive Priority Resource Manager: Project PRD

Owner and scope keeper: Krishna Sharma. Companion documents: `BLUEPRINT.md` (algorithm specifications), `BACKLOG.md` (issues), `DECISIONS.md`, `RESEARCH_NOTES.md`.

## Change log

This PRD follows the structure of the Hackathon Project Blueprint & PRD v3.0 template, adapted to a C algorithms project with no server, database or login.

1. **Backend replaced by a C core.** The template's FastAPI backend becomes a C scheduling engine. "All business logic in the backend" becomes "all scheduling logic in the C core". The website and Python never decide which job runs.
2. **API contract kept, transport changed.** The template's REST endpoints become C functions (the step API) that return JSON strings. The same contract serves the browser (through WebAssembly) and the console program. §5 is the contract.
3. **Auth, database and server removed.** There are no accounts, no stored user data and no network calls, so the template's auth, database, CORS, JWT, sockets and email sections are dropped. Each is listed in §12A with a reason.
4. **Security checklists rewritten.** Backend security becomes C robustness (memory safety, input validation, overflow checks). Frontend security becomes safe handling of user-built cases, CSV uploads and shared links.
5. **Hackathon framing changed to course framing.** The 5-minute stage demo becomes a 12-minute viva. Judges become examiners. Success metrics are about correctness, proofs and a reliable demo.
6. **Ownership fixed (revised 2026-10-31).** Krishna Sharma owns everything except the report graphs: the C core and every algorithm, the WebAssembly build, the website, CI, golden test cases, preset CSVs, and all non-graph Python (workload generator, experiment runner, metrics and statistics, summary CSVs, property checks, conformance checks, timing benchmarks). Ahaana Arya owns the Python plotting script that turns summary CSV files into the report figures for E1–E6, plus figure styling and captions. She also hand-checks every golden case and reviews changes to CSV formats, summary formats and figures.
7. **Kept from the template:** the version safety rule, MVP scope tiers, repository rules, one standard error shape, the testing-first attitude, the demo script with fallbacks, risks with early warnings, master prompts for AI assistants, future scope and document maintenance rules.
8. **Step 1 review (2026-10-31).** Decisions taken after reading the papers and the Consensus report are recorded in `DECISIONS.md` and reflected here: integer aging rate (`alpha_milli`), `max_jobs` in `SimConfig`, classic scripts instead of ES modules, a fixed exact-solver limit of 9, the summary CSV contract (§5), and E6 measured on total turnaround.

## Version safety rule (read first)

Never copy version numbers from this document or from memory into `requirements.txt`, the Makefile, CI files or a `<script>` tag. This file contains no version numbers on purpose.

**For humans.**

1. At project start, check the official source for each tool below and take the latest stable release. Avoid alpha, beta and release-candidate versions.
2. Once the walking skeleton works (Gate 2), freeze: write the exact versions into `docs/TOOLCHAIN.md`, `requirements.lock.txt` (`pip freeze`) and the CI workflow. Both laptops install from those.
3. Upgrade after the freeze only when a bug forces it, and then both members upgrade together.
4. Before the final submission, run `pip-audit` on the Python environment and check Chart.js for security advisories.

**For AI assistants (mandatory).** Before writing or editing `requirements.txt`, `requirements.lock.txt`, `TOOLCHAIN.md`, the CI workflow, or any CDN `<script>` URL, or recommending install commands:

1. Web search each tool for its latest stable release and any security advisory.
2. Cross-check with the registry or official page when a shell is available (`pip index versions <pkg>`, `emsdk list`, the npm or jsDelivr page for Chart.js).
3. Pin CDN scripts to an exact version that has been published for at least two weeks, with a Subresource Integrity hash.
4. State briefly what you verified. Never invent versions.
5. In `requirements.txt`, list names only until the freeze; the lock file holds exact versions.

| Tool (verify each) | Where to check |
| --- | --- |
| GCC or Clang | Distribution package manager (WSL Ubuntu, Linux) or Xcode command line tools (Mac) |
| GNU Make | Same as above |
| Emscripten (emsdk) | emscripten.org and `emsdk list`; both laptops and CI use the same version |
| Node.js (only to run WebAssembly tests in CI) | Current Active LTS from nodejs.org |
| Python | python.org, a release still in bugfix or security support |
| `numpy`, `pandas`, `matplotlib`, `pytest` | PyPI latest stable + advisories |
| Chart.js (website CDN) | npm or jsDelivr page; exact pinned version + SRI hash |

## 0. Project brief and assumptions

| Field | Value |
| --- | --- |
| Project name | APRM (Adaptive Priority Resource Manager), as in the submitted synopsis |
| Course | Analysis and Design of Algorithms, B.Tech CSE, 3rd semester, Section B1, Faculty of Technology, University of Delhi |
| One-line pitch | Anyone can build a stream of jobs for a shared machine and watch our C scheduler decide, live and explained, which job runs next, so that priority, fairness and utilization trade-offs become visible and provable |
| Domain | Online, non-preemptive scheduling of jobs with two resource demands (CPU and memory) |
| Primary entities | Machine (capacities), Job (arrival, duration, cpu, mem, priority), Policy (key + selection rule), Simulation (state over time) |
| Signature feature | The interactive playground: any case, run step by step on the real C engine in the browser, with a plain-English reason for every decision and a side-by-side comparison against other schedulers and the true optimum |
| Users | The two team members, the professor and examiners. No public users, no accounts |
| Evaluation criteria | Paste the official rubric here when available |

### Team and ownership

| Member | Roll no. | Owns |
| --- | --- | --- |
| Krishna Sharma | 25293916052 | C core and every algorithm (heap, policies, aging, greedy fill, reservation, knapsack batch, exact solver), engine API, console program, WebAssembly build, website, CI, golden test cases, preset CSVs, all non-graph Python (workload generator, experiment runner, metrics and statistics, summary CSVs, property checks, conformance checks, timing benchmarks), scope keeping |
| Ahaana Arya | 25293916008 | Report figures for E1–E6 (`tools/plot_figures.py`), figure styling and captions, the "what this graph shows" text in the results chapter; hand-checks every golden case; reviews changes to CSV formats, summary formats and figures |

The step API and the CSV formats (§5) are the contract between the C core, the website and Krishna's Python. The summary CSV formats (§5) are the contract between Krishna's Python and Ahaana's plotting script. No Python re-implements a scheduler: Krishna's Python only generates inputs, calls the console program and summarises outputs; Ahaana's plotting script only reads summary CSV files and never runs experiments, calls the C program or computes statistics.

### Goal

A correct, provable scheduler with a working interactive demo that runs reliably in a 12-minute viva, offline, on either team laptop.

### Non-goals

User accounts, servers, databases, cloud deployment beyond a static page, real operating-system process control, multiple machines, preemption, estimated (uncertain) durations, more than two resource types. Each deferred item appears in §12A.

### Assumptions

| # | Assumption | Why |
| --- | --- | --- |
| A1 | All scheduling logic lives in the C core. The website and Python only build inputs and display or analyse outputs | One source of truth; results can never disagree |
| A2 | The website runs the C core compiled to WebAssembly, packed into a single JavaScript file | Works offline, no server, same algorithm as the report |
| A3 | No backend server and no database. Cases live in memory, CSV files and shareable URLs | Nothing to deploy or break during the viva |
| A4 | One machine with integer CPU and memory capacities; integer time ticks | Clean model, simple proofs, no floating-point surprises |
| A5 | Job durations are known exactly when the job arrives | Needed by SJF, reservation and the exact solver; matches Fan & Liang |
| A6 | Jobs cannot be paused or moved once started | Matches the synopsis and the research model |
| A7 | Every simulation is deterministic: same input and settings, same result, on every machine | Makes testing, conformance and demos repeatable |
| A8 | All workloads are synthetic, generated with recorded seeds | Any graph can be regenerated exactly |
| A9 | The primary demo runs from the laptop: `web/index.html` opens with a double-click (`file://`), using classic scripts and a bundled presets data file, so no local server is needed. The GitHub Pages link is a bonus copy | Venue networks fail; a local file does not. Browsers block ES modules and `fetch` from `file://`, so neither is used |

### Success metrics

| Metric | Target |
| --- | --- |
| Engine correctness | All golden cases pass; zero invariant violations over 10,000 random runs |
| Conformance | Console and WebAssembly outputs identical on 1,000 random cases |
| Proofs | Heap ordering, aging-without-re-sorting, priority starvation bound and reservation bounded wait written out in the report |
| Evidence | Experiments E1 to E6 run on 30 seeds each, with graphs and confidence intervals |
| Demo reliability | 3 consecutive clean rehearsals, no restart, inside 12 minutes |
| Responsiveness | Website steps a 500-job case with no visible lag; exact solver answers a 9-job case in under 2 seconds |
| Fresh-clone setup | The other member gets the project running from the README in 15 minutes or less |
| Explainability | Each member can explain any algorithm in the project without notes |

## 1. Tech stack

C for every algorithm, compiled twice; plain HTML, CSS and JavaScript for the website; Python for experiments. Versions are verified per the rule above, never copied from here.

| Layer | Choice | Owner | Notes |
| --- | --- | --- | --- |
| Scheduler core | C11, standard library only | Krishna | No third-party C libraries; the heap, knapsack and solver are hand-written |
| Laptop build | GCC (Clang on Mac) + GNU Make | Krishna | `-std=c11 -Wall -Wextra -Werror`; debug and sanitizer targets |
| Browser build | Emscripten → WebAssembly, single-file output | Krishna | Same `core/` sources; exported step API only |
| Console program | C, `cli/main.c` | Krishna | The synopsis deliverable; reads and writes CSV |
| Website | HTML + CSS + plain JavaScript (classic `<script>` files loaded in order, each attaching to one global namespace `window.APRM`) | Krishna | No framework, no ES modules, no build step for the page itself; works from `file://` |
| Live visuals | HTML Canvas 2D | Krishna | Resource bars, waiting line, running jobs, Gantt timeline |
| Comparison charts | Chart.js from a CDN, pinned with SRI | Krishna | Compare mode only; the page still works if it fails to load (table fallback) |
| Workload generation | Python 3 + `numpy` | Krishna | Seeded random workloads and presets written as CSV |
| Experiment runner | Python 3 `subprocess` | Krishna | Calls the console program; never schedules in Python |
| Metrics, statistics and summaries | `pandas` + `numpy` | Krishna | Means, 95% confidence intervals, summary CSVs in the §5 formats (`tools/summarize.py`) |
| Report figures | `pandas` + `matplotlib` only | Ahaana | Reads summary CSVs only (`tools/plot_figures.py`); no statistics, no experiments |
| Python tests | `pytest` | Krishna (Ahaana: figure smoke test) | Property checks, conformance, golden-case checks, summary-format checks |
| C tests | Plain C test files with `assert` | Krishna | Heap, engine, policies, reservation, knapsack, exact solver |
| WebAssembly test runner | Node.js (CI only) | Krishna | Runs the WebAssembly build headless so Python can compare it with the console program |
| Version control | Git + GitHub | Both | Pull requests, branch protection on `main` |
| CI and hosting | GitHub Actions + GitHub Pages | Krishna | Build, test, conformance, then publish the website |
| Editor | VS Code (WSL extension on Windows) | Both | Shared settings in `.vscode/` |

**Ports and servers.** None. The website opens as a local file: double-click `web/index.html`. A local server (`python -m http.server` from `web/`) is optional and never required.

## 1A. MVP scope

**Rule:** nothing from "Nice to have" starts until every "Must have" row is done and the full demo path has run once end to end.

### Must have

| # | Feature | Owner | Done when |
| --- | --- | --- | --- |
| M1 | Generic binary heap | Krishna | Push, pop, peek, build; 10,000-push random test passes for both compare functions |
| M2 | Event-driven engine + step API | Krishna | `sim_create`, `sim_add_job`, `sim_step`, `sim_state_json`, `sim_results_json` work; invariants hold after every step |
| M3 | Four policies: FCFS, static priority, SJF, adaptive aging | Krishna | Each passes its golden cases; aging uses the fixed integer key 1000·b − alpha_milli·r |
| M4 | Reservation (EASY-style) | Krishna | Memory-hog golden case: the reserved job starts by its shadow time |
| M5 | Event log with plain-English reasons | Krishna | Every start, skip, reserve, backfill and finish has one log sentence; every reject has one error sentence (the API error message, D54) |
| M6 | Console program | Krishna | `aprm --policy aging --in jobs.csv --out results.csv` works on all golden cases |
| M7 | Website: Build and Run modes on WebAssembly | Krishna | Any case can be built, edited, played, stepped and extended mid-run; every preset loads |
| M8 | Website: Compare mode | Krishna | Two or more policies on the same jobs, side-by-side timelines and metrics table |
| M9 | Workload generator | Krishna | `gen_workload.py` writes seeded CSVs for every experiment and preset |
| M10 | Experiment runner + summaries (Krishna) and graphs (Ahaana) for E1, E2, E3, E5 | Krishna, Ahaana | Summary CSVs match the §5 formats; graphs regenerate from one command |
| M11 | Property checks and conformance | Krishna | Invariants hold on 10,000 random runs; console and WebAssembly outputs match on 1,000 cases |
| M12 | Runs from a clean clone | Both | Other member follows the README on their own laptop in 15 minutes or less |
| M13 | Backup demo video | Both | 3-minute recording of the website demo, saved locally and in the cloud |

### Nice to have (in priority order)

| # | Feature | Owner | Why it is worth it |
| --- | --- | --- | --- |
| N1 | Exact solver for up to 9 jobs | Krishna | Shows how far each scheduler is from optimal; strong ADA content |
| N2 | Knapsack batch selection (simplified MRIS) | Krishna | Brings dynamic programming into the project; links directly to Fan & Liang |
| N3 | Experiments E4 (α sweep) and E6 (gap to optimum) | Krishna (runs, summaries), Ahaana (figures) | Needs N1 for E6 |
| N4 | Shareable case links (job list in the URL) | Krishna | Examiner can open the exact case later |
| N5 | GitHub Pages deployment | Krishna | A link for the professor to try afterwards |
| N6 | Timing benchmarks backing the complexity claims | Krishna | Measured evidence for the complexity table |
| N7 | Dark mode, keyboard shortcuts, mobile layout polish | Krishna | Polish |

### Explicitly out

Multiple machines, preemption, estimated durations, more than two resources, user accounts, servers, databases. Each has a one-line reason in §12A.

## 2. Repository structure

One repository; `core/` is the only place scheduling logic exists. Owner initials: K = Krishna, A = Ahaana.

```
aprm/
├── CLAUDE.md                    Instructions for Claude Code
├── core/                        K  C scheduler, single source of truth
│   ├── config.h                 K  Defaults and limits (§3)
│   ├── job.h                    K  Job struct, enums, error codes
│   ├── heap.c / heap.h          K  Generic binary heap
│   ├── engine.c / engine.h      K  Event loop, state, invariants
│   ├── policy.c / policy.h      K  Keys: FCFS, static, SJF, aging
│   ├── reserve.c / reserve.h    K  Reservation and backfill rule
│   ├── knapsack.c / knapsack.h  K  CADP knapsack + batch selector (N2)
│   ├── exact.c / exact.h        K  Exact solver, n ≤ 9 (N1)
│   ├── metrics.c / metrics.h    K  Wait, turnaround, utilization, makespan
│   ├── eventlog.c / eventlog.h  K  Typed entries + sentence formatter
│   ├── json.c / json.h          K  Safe JSON writer (escaping, bounds)
│   └── csv.c / csv.h            K  CSV reader and writer with validation
├── cli/main.c                   K  Console program
├── wasm/
│   ├── api.c                    K  Exported step API (thin wrapper)
│   ├── build.sh                 K  Emscripten command (flags in §3)
│   └── run_wasm.mjs             K  Headless runner for CI conformance
├── web/                         K
│   ├── index.html                  Loads the classic scripts below in order
│   ├── css/style.css
│   ├── vendor/aprm.js           K  Generated WebAssembly bundle (CI builds it)
│   └── js/  wasm.js store.js editor.js presets_data.js presets.js
│            generator.js player.js canvas.js whylog.js compare.js
│            share.js app.js     K  Classic scripts on window.APRM
├── tools/                       K  Python (except plot_figures.py)
│   ├── config.py                K  Paths, default seeds, experiment grid
│   ├── gen_workload.py          K  Seeded workloads and preset CSVs
│   ├── run_experiments.py       K  Runs the console program over a grid
│   ├── summarize.py             K  Metrics, confidence intervals → results/summaries/*.csv
│   ├── check_properties.py      K  Invariant checks over random runs
│   ├── conformance.py           K  Console vs WebAssembly comparison
│   ├── bench_timing.py          K  Timing benchmarks (N6)
│   └── plot_figures.py          A  Summary CSVs → docs/report/figures/
├── tests/
│   ├── c/  test_heap.c test_engine.c test_policy.c ...    K
│   ├── cases/<case>.csv + <case>.<policy>.expected.csv    K writes, A checks by hand
│   └── py/ test_properties.py test_conformance.py
│           test_summaries.py                              K
│           test_plot_figures.py                           A  Smoke test on sample summaries
├── data/
│   ├── presets/                 K  Preset CSVs (master copy of web/js/presets_data.js)
│   └── sample_summaries/        K  Small, clearly fake summary CSVs in the §5 formats
├── results/                        Generated; not committed (summaries in results/summaries/)
├── docs/  PRD.md BLUEPRINT.md BACKLOG.md DECISIONS.md RESEARCH_NOTES.md
│          TOOLCHAIN.md AI_USE.md research/ slides/
│   └── report/figures/          A  Generated figures (PNG + PDF)
├── .github/workflows/ci.yml     K
├── .github/ISSUE_TEMPLATE/task.md, pull_request_template.md, issues/   K
├── Makefile                     K
├── requirements.txt             K  Names only until the freeze
├── requirements.lock.txt        K  After the freeze
└── README.md                    Both
```

**Rules that are never broken.**

- No scheduling decision is made outside `core/`. JavaScript and Python never choose which job runs.
- `core/` has no platform code: no file I/O, no printing, no globals. All state lives inside one `Sim` struct, so the website can run several simulations at once in Compare mode.
- Never commit build output (`build/`, `*.o`, the CLI binary), `results/`, `.venv/`, `__pycache__/`, or editor caches. `web/vendor/aprm.js` is built by CI; commit it only on the `demo-ready` tag so the offline copy works.
- Always commit `requirements.txt`, the lock file after the freeze, `TOOLCHAIN.md`, preset and golden-case CSVs, and the README.
- `main` always builds and passes tests. If it breaks, fixing it comes first.
- Every C function has a comment stating what it does, its complexity, and who owns any memory it returns.

## 3. Configuration

There are no secrets and no environment variables to protect. Configuration lives in three places: `core/config.h` for defaults and limits, the Makefile for build options, and `tools/config.py` for experiments.

### Defaults and limits (`core/config.h`)

| Setting | Default | Allowed range | Notes |
| --- | --- | --- | --- |
| CPU capacity | 16 cores | 1 to 1,000,000 | User-editable |
| Memory capacity | 32,768 MB | 1 to 1,000,000,000 | User-editable |
| Priority | — | 0 to 9 | Higher = more important |
| Duration | — | 1 to 1,000,000 ticks | |
| Arrival | — | 0 to 1,000,000,000 ticks | Time stored as 64-bit integers |
| Job id | — | 0 to 2,147,483,647 | Unique within a simulation |
| α (aging rate), stored as `alpha_milli` | 100 (α = 0.1) | 0 to 10,000 (α = 0 to 10) | Integer thousandths of a priority level per tick. 0 turns aging into static priority |
| Reservation threshold T | 50 ticks | 0 to 1,000,000 | 0 reserves immediately |
| Knapsack ε | 0.1 | 0.01 to 1 | Smaller = more accurate, slower |
| Exact solver job limit | 9 | Fixed constant, not configurable | Above this the solver returns `TOO_LARGE` |
| Max jobs, console program | 1,000,000 | | `SimConfig.max_jobs`, set by `cli/main.c` |
| Max jobs, website | 5,000 | | `SimConfig.max_jobs`, set by `wasm/api.c`; keeps the canvas responsive |

### Build options (Makefile)

| Command | What it does |
| --- | --- |
| `make` | Release build of the console program |
| `make debug` | Adds `-g` and turns on invariant checks after every engine step |
| `make sanitize` | Debug build with AddressSanitizer and UndefinedBehaviorSanitizer |
| `make test` | Builds and runs all C tests and golden cases |
| `make wasm` | Runs `wasm/build.sh` to produce `web/vendor/aprm.js` |
| `make clean` | Removes build output |

**Emscripten flags (in `wasm/build.sh`).** Modular output with a named factory, single-file output (WebAssembly embedded in the JavaScript), memory growth allowed, and only the step API functions exported. Exact flag spellings are checked against the current Emscripten documentation when the script is written.

### Experiment settings (`tools/config.py`, owned by Krishna)

Path to the console program, output folder, the list of seeds (30 per setting), and the experiment grid for E1 to E6. Every run writes its seed and settings next to its results.

### Website settings

All user-facing settings (capacities, policy, α, T, ε, speed) live in the page and can be stored in the URL hash for sharing (N4). Nothing is stored on a server.

## 4. Core architecture

The core is an event-driven simulator: each call to `sim_step` handles one moment in time, and only the selection step depends on the chosen policy. Owner: Krishna.

```
 ┌────────────────────┐    ┌─────────────────────┐    ┌──────────────────────┐
 │ Jump to next event │ →  │ Finish jobs         │ →  │ Add arrivals         │
 │ earliest arrival   │    │ free their CPU and  │    │ push into the        │
 │ or finish          │    │ memory              │    │ waiting heap         │
 └────────────────────┘    └─────────────────────┘    └──────────────────────┘
           ↑ yes                                                  ↓
     ┌───────────┐         ┌─────────────────────┐    ┌──────────────────────┐
     │Jobs left? │    ←    │ Log and publish     │ ←  │ SELECTION STEP       │
     └───────────┘         │ reasons, state JSON │    │ policy key, greedy   │
           ↓ no            └─────────────────────┘    │ fill, reservation    │
 ┌────────────────────┐                               └──────────────────────┘
 │ Simulation finished│
 │ sim_step returns 0 │
 └────────────────────┘
```

Finishes are processed before arrivals at the same time, so a job arriving exactly when another finishes can use the freed resources.

### Modules

| Module | Holds | Key operations and cost |
| --- | --- | --- |
| `heap` | Array-based binary heap with a compare function | push, pop O(log n); peek O(1); build O(n) |
| `engine` | The `Sim` struct: clock, capacities, free resources, waiting heap, running heap, pending arrivals, finished list | `sim_step`: O((s + k) log n) per event, s started and k skipped |
| `policy` | Key and compare function per policy | O(1) per comparison |
| `reserve` | Current reservation (job id, shadow time, spare room at shadow time) | Shadow time O(r log r) for r running jobs |
| `knapsack` | Scaled DP table, chosen batch | O(n² / ε) per window |
| `exact` | Permutation search with pruning | O(n! · n²), n ≤ 9 |
| `metrics` | Running totals for wait, turnaround, busy time | O(1) per event, O(n) to report |
| `eventlog` | Growing array of typed entries | O(1) amortised append |
| `json`, `csv` | Safe writers and validating reader | Linear in output or input size |

### The `Sim` struct holds three collections

1. **Pending arrivals:** jobs added but not yet arrived, sorted by arrival time. A job added mid-run is inserted here.
2. **Waiting heap:** arrived jobs, ordered by the policy key. For aging, the stored key is the 64-bit integer 1000·b − alpha_milli·r, so it never changes while the job waits.
3. **Running heap:** started jobs, ordered by finish time, so the next finish is always at the top.

### Selection step per policy

| Policy | Selection rule |
| --- | --- |
| FCFS, static priority, SJF, aging | Greedy fill: pop best; start if it fits, else set aside; stop when empty or CPU or memory is full; push set-aside jobs back |
| Aging + reservation | Greedy fill, but if the best job does not fit and has waited at least T ticks, reserve it at its shadow time and only backfill jobs that cannot delay it |
| Knapsack batch | At each window boundary, choose the highest-value set by knapsack DP; greedy fill starts only jobs from the chosen set |

Full algorithm specifications, proofs and complexity: `BLUEPRINT.md` §3.

### Invariants (checked after every step in debug builds)

This list is the reference for every invariant check in the project (C debug checks, §6, and the Python property checks in §10).

- Used CPU ≤ CPU capacity and used memory ≤ memory capacity.
- Every running job started at or after its arrival.
- Every finished job has finish − start = duration.
- Pending + waiting + running + finished = total jobs added.
- At most one reservation exists, and the reserved job is in the waiting heap.

## 5. Engine API contract

**Frozen at Gate 2 (2026-11-01).** The step API, the CSV formats and the summary CSV formats in this section no longer move. To change anything here: ask first, update this section first, then the code, then tell Ahaana (§13). **One exception, open on purpose:** the representation of `knapsack_eps` (DECISIONS O-2) is the only open item; K-34 may change it through the same process (PRD first, code, tell Ahaana). The freeze was done on Krishna's authorisation; Ahaana's review of the CSV and summary formats is still awaited.

This section is the contract between the C core, the website and Python. Agree on it before Gate 2, change it here first, then in code, then tell the other member.

### Conventions

- All times, capacities and demands are integers. Inside C they are 64-bit; across the WebAssembly boundary they travel as JavaScript numbers and are range-checked (safe up to 2^53).
- Every function returns an integer status: 0 or positive means success, negative means an error code from the table below.
- Every JSON output uses one envelope: success is `{"ok": true, "data": …}`, failure is `{"ok": false, "error": {"code", "message", "field"?}}`.
- JSON keys are `snake_case`. Ties are broken by earlier arrival, then lower id.
- **No floating point in scheduling decisions.** The aging rate is the integer `alpha_milli` (α × 1000). The aging key is the `int64_t` value `1000·priority − alpha_milli·arrival`, overflow-checked. The live score shown to users, S = priority + alpha_milli·(now − arrival)/1000, is computed only when JSON is written, from integers, and printed with exactly three decimals (for example `6.200`).

### Core C functions (`core/engine.h`)

```c
typedef enum { POL_FCFS, POL_PRIORITY, POL_SJF, POL_AGING,
               POL_AGING_RESERVE, POL_KNAPSACK } PolicyKind;

typedef struct {
    int64_t cpu_cap, mem_cap;
    PolicyKind policy;
    int64_t alpha_milli;        /* aging rate α × 1000, 0..10000 */
    int64_t reserve_threshold;  /* T, ticks */
    double  knapsack_eps;       /* representation open: DECISIONS O-2 */
    int64_t max_jobs;           /* CLI 1,000,000; website 5,000 */
} SimConfig;

typedef struct {
    int32_t id;
    int64_t arrival, duration, cpu, mem;
    int32_t priority;           /* 0..9 */
} Job;

typedef struct Sim Sim;         /* opaque */

int  sim_create(const SimConfig *cfg, Sim **out);
int  sim_add_job(Sim *s, const Job *job);      /* any time, arrival >= now */
int  sim_step(Sim *s);                          /* 1 = event done, 0 = finished */
int  sim_run_until(Sim *s, int64_t t);
int  sim_state_json(const Sim *s, JsonBuf *out);
int  sim_log_json(const Sim *s, int64_t since_seq, JsonBuf *out);
int  sim_results_json(const Sim *s, JsonBuf *out);
int  sim_metrics_json(const Sim *s, JsonBuf *out);
int  sim_reset(Sim *s);                          /* keeps config, clears jobs */
void sim_destroy(Sim *s);

/* Additions (D55) */
typedef struct { int code; char field[24]; char message[160]; } SimError;   /* last failed call */
const SimError *sim_last_error(const Sim *s);   /* Sim-owned; code 0 = none; behind aprm_last_error */
int  sim_validate_config(const SimConfig *cfg, SimError *err);   /* sim_create's checks, with the message */

int  exact_solve(const SimConfig *cfg, const Job *jobs, int n, JsonBuf *out);
```

### WebAssembly exports (`wasm/api.c`)

Flat functions, so JavaScript never builds C structs. Each returns a status, or a pointer to a JSON string owned by the simulation and valid until the next call on the same handle.

| Export | Purpose |
| --- | --- |
| `aprm_create(cpu, mem, policy, alpha_milli, T, eps)` | Returns a handle (≥ 1) or a negative error. `api.c` sets `max_jobs` to the website limit (5,000) |
| `aprm_add_job(h, id, arrival, duration, cpu, mem, priority)` | Adds one job; returns a status |
| `aprm_step(h)` / `aprm_run_until(h, t)` | Advance the simulation |
| `aprm_state(h)` / `aprm_log(h, since)` / `aprm_results(h)` / `aprm_metrics(h)` | JSON strings |
| `aprm_last_error(h)` | JSON error envelope for the last failed call on `h`. `h` = 0, or any handle that is not live, means "no handle": the last failed `aprm_create` or call with an unknown handle (D64) |
| `aprm_exact(h)` | Runs the exact solver on the handle's jobs (n ≤ 9) |
| `aprm_reset(h)` / `aprm_destroy(h)` | Clear or free |

### JSON shapes

State, returned after every step:

```json
{ "ok": true, "data": {
  "now": 42, "done": 5, "total": 12,
  "cap":  { "cpu": 16, "mem": 32768 },
  "free": { "cpu": 4,  "mem": 8192 },
  "waiting": [ { "id": 7, "score": 6.200, "priority": 2, "arrival": 0,
                  "duration": 30, "cpu": 8, "mem": 20480 } ],
  "running": [ { "id": 3, "start": 30, "finish": 55, "cpu": 8, "mem": 4096 } ],
  "reservation": { "id": 7, "shadow_time": 55 }
} }
```

In the state, `reservation` is `null` when none is active. `score` is the live aging score for the `aging` and `aging_reserve` policies (three decimals, from integers, D14) and `null` for every other policy (D63). `waiting` is in service order (best first) and `running` is ordered by finish time, then arrival, then id. Event log entry:

```json
{ "seq": 17, "t": 42, "kind": "SKIP", "job": 7,
  "msg": "Job 7 skipped: needs 20480 MB, only 8192 MB free." }
```

Log kinds: `ARRIVE`, `START`, `SKIP`, `RESERVE`, `BACKFILL`, `FINISH`, `REJECT`, `BATCH_SELECT`, `PROMOTE_INFO`. `REJECT` is reserved and never emitted: a rejected job leaves no log entry, its reason is the error message (D54).

Metrics:

```json
{ "ok": true, "data": {
  "avg_wait": 12.4, "max_wait": 88, "avg_turnaround": 40.1,
  "weighted_completion": 5320, "makespan": 310,
  "util_cpu": 0.83, "util_mem": 0.71,
  "avg_wait_by_priority": [30.2, 28.0, 21.5, 18.0, 14.1, 11.0, 9.2, 6.3, 4.0, 2.1]
} }
```

Metrics are computed over the finished jobs. Averages and utilisations are printed with exactly nine decimals, rounded half up from exact integer arithmetic (no floating point; so `12.4` appears as `12.400000000`, which is within 1e-9 of any correct value). `max_wait`, `weighted_completion` and `makespan` are integers. A value whose denominator is zero is `null`: `avg_wait`, `avg_turnaround` with no finished job, `util_cpu` and `util_mem` when the makespan is 0, and an entry of `avg_wait_by_priority` whose priority level has no finished job (D61, D62). Utilisation is the busy resource-time of the finished jobs divided by capacity × makespan over the interval [0, makespan].

### Error codes

| Code | Name | When | Example message |
| --- | --- | --- | --- |
| -1 | `INVALID_ARGUMENT` | Null pointer, bad handle, bad policy | "Unknown policy 9." |
| -2 | `INVALID_FIELD` | A field outside its range (§3); `field` names it | "priority must be 0 to 9." |
| -3 | `CAPACITY_EXCEEDED` | Job needs more CPU or memory than the machine has | "Job 4 needs 40960 MB; machine has 32768 MB." |
| -4 | `ARRIVAL_IN_PAST` | Mid-run job with arrival before now | "Arrival 10 is before current time 42." |
| -5 | `DUPLICATE_ID` | Same id added twice | "Job id 3 already exists." |
| -6 | `LIMIT_REACHED` | Too many jobs (§3) | "Website limit is 5000 jobs." |
| -7 | `OUT_OF_MEMORY` | Allocation failed | "Out of memory." |
| -8 | `PARSE_ERROR` | Bad CSV; message gives line and column | "Line 12, column cpu: not a number." |
| -9 | `TOO_LARGE` | Exact solver asked for more than 9 jobs | "Exact solver supports up to 9 jobs." |

### CSV formats (shared with Python)

Input, `jobs.csv`, header required:

```csv
id,arrival,duration,cpu,mem,priority
1,0,30,8,20480,2
2,1,5,2,1024,7
```

Output, `results.csv`:

```csv
id,arrival,start,finish,wait,turnaround,priority,cpu,mem
1,0,0,30,0,30,2,8,20480
2,1,1,6,0,5,7,2,1024
```

### Console program

```
aprm --in jobs.csv --out results.csv [--policy fcfs|priority|sjf|aging|reserve|knapsack]
     [--cpu 16] [--mem 32768] [--alpha-milli 100] [--threshold 50] [--eps 0.1]
     [--log log.txt] [--metrics metrics.json] [--exact]
```

Exit codes: 0 success, 1 bad arguments, 2 input file error, 3 invalid job, 4 internal error. Errors go to stderr in one line, using the same names as the table above.

### Summary CSV formats (Krishna's Python → Ahaana's plotting script)

`tools/summarize.py` (Krishna) writes these files into `results/summaries/`. `tools/plot_figures.py` (Ahaana) reads only these files. `data/sample_summaries/` holds small, clearly fake files with exactly the same names and columns, so plotting can be built before any experiment exists. Changing any file name or column follows the §13 rule: update this section first, then code, then tell Ahaana.

**Rules for every summary file.**

- UTF-8, comma-separated, one header row, no index column, `.` as the decimal point, no thousands separators. A missing value is an empty field.
- Long format: one row per (experiment, setting, policy), plus one extra key where stated (E3 adds the priority level through `x_value`).
- Key columns, always first and in this order: `experiment` (`E1` … `E6`), `setting` (text label of the varied parameter), `x_value` (the number to put on the x-axis), `policy` (`fcfs`, `priority`, `sjf`, `aging`, `reserve`, `knapsack`), `n_seeds` (number of seeds or instances averaged; the same for every metric in the row).
- For every metric `<m>` three columns follow: `<m>_mean`, `<m>_ci_low`, `<m>_ci_high`.
- **Confidence interval.** Two-sided 95% Student-t interval of the mean across seeds: mean ± t · s / √n, with s the sample standard deviation (n − 1 in the denominator). The t value is a hard-coded constant: t(0.975, df = 29) = 2.045 for n = 30 seeds; t(0.975, df = 49) = 2.010 for the E6 groups of 50 instances. Source and rounding are recorded in `DECISIONS.md`. Any other n is an error in `summarize.py`.
- Time metrics are in ticks; utilisations are fractions from 0 to 1; ratios have no unit.

| File | Rows (key) | `setting` / `x_value` | `policy` values | Metric columns (each with `_mean`, `_ci_low`, `_ci_high`) |
| --- | --- | --- | --- | --- |
| `e1_summary.csv` | (E1, load, policy) | `light` / `medium` / `heavy`; `x_value` = mean arrival rate, jobs per tick | all implemented policies | `avg_wait`, `avg_turnaround`, `util_cpu`, `util_mem` |
| `e2_summary.csv` | (E2, load, policy) | as E1 (same runs) | as E1 | `max_wait` |
| `e3_summary.csv` | (E3, priority mix, policy, priority level) | `setting` = priority mix (`uniform`, `low_heavy`, `high_heavy`); `x_value` = priority level 0–9; `n_seeds` = seeds in which that level had at least one job | `priority`, `aging` | `avg_wait` |
| `e4_summary.csv` | (E4, α, policy) | `setting` = `alpha_milli=<v>`; `x_value` = α (alpha_milli / 1000) | `aging` | `high_prio_avg_wait`, `low_prio_max_wait` (groups defined in `DECISIONS.md`) |
| `e5_summary.csv` | (E5, big-memory share, policy) | `setting` = `big_mem_pct=<v>`; `x_value` = share of big-memory jobs in percent, 0–40 | `aging`, `reserve` | `max_wait`, `avg_wait` |
| `e6_summary.csv` | (E6, job count, policy) | `setting` = `n_jobs=<v>`; `x_value` = jobs per instance, 6–9; `n_seeds` = instances (50 per job count) | all implemented policies | `turnaround_ratio`, `wait_gap` |

Two raw files feed figures that need individual values instead of means:

```csv
# e2_wait_cdf.csv: one row per job per run, for the E2 wait CDF
experiment,setting,x_value,policy,seed,job_id,wait
E2,heavy,0.9,aging,1,17,42
```

```csv
# e6_ratios.csv: one row per (instance, policy), for the E6 box plot
experiment,n_jobs,instance_seed,policy,total_turnaround,opt_total_turnaround,turnaround_ratio,total_wait,opt_total_wait,wait_gap
E6,7,1004,fcfs,212,190,1.115789,58,36,22
```

(The `#` lines above label the examples; real files have no comment lines.)

**E6 definitions.** `turnaround_ratio` = (scheduler's total turnaround) / (exact optimum's total turnaround). Total turnaround = total wait + sum of durations, so the optimal schedule is the same as for total wait, and the ratio is always defined (durations are at least 1). `wait_gap` = scheduler's total wait − optimum's total wait, in ticks (never negative). No instance is skipped. Ratios are written with six decimals.

## 6. Core robustness and safety checklist

The C core takes input from anyone using the website, so it is treated as untrusted-input code. Krishna owns this list; the Python property checks (§10) verify it from outside.

### Input validation

- [ ] Every API entry point checks pointers, handles and every field against the ranges in §3 before touching state.
- [ ] A rejected job leaves the simulation unchanged (validate first, then modify).
- [ ] The CSV reader rejects missing headers, extra columns, non-numbers, overflow and lines longer than a fixed limit, reporting line and column.

### Memory safety

- [ ] Every `malloc`/`realloc` result is checked; failure returns `OUT_OF_MEMORY` and leaves state valid.
- [ ] No unbounded string functions: `snprintf` only, never `sprintf`, `strcpy` or `strcat`.
- [ ] The JSON writer escapes every string and grows its buffer safely.
- [ ] `sim_destroy` frees everything; `make sanitize` runs all tests with zero AddressSanitizer reports and zero leaks.
- [ ] Ownership of every returned pointer is documented in the header.

### Arithmetic safety

- [ ] Times are 64-bit; `start + duration` and resource sums are checked for overflow before use.
- [ ] The aging key is the integer 1000·priority − alpha_milli·arrival (int64, overflow-checked), compared with a tie-break on arrival and id. No floating point is used in any scheduling decision.
- [ ] Knapsack scaling guards against division by zero, against integer overflow in volumes, and against a table larger than a fixed limit (values: `DECISIONS.md` O-2).

### Correctness guards

- [ ] Every invariant in the §4 list ("Invariants") is checked after every step in debug builds. That list is the reference; do not maintain a second copy here.
- [ ] No global or static mutable state, so several simulations can run side by side.
- [ ] Same input and settings give the same output on GCC, Clang and WebAssembly (checked by §10 conformance).

### Deliberately skipped

Threads, signal handling, file locking and fuzzing infrastructure. The core is single-threaded and does no I/O, so these add nothing for this project.

## 7. Frontend architecture

The website is plain JavaScript around the WebAssembly engine. It builds inputs and draws outputs; it never decides which job runs. Owner: Krishna. Feature spec: `BLUEPRINT.md` §5.

**Loading model.** `index.html` loads classic `<script>` files (no `type="module"`) in a fixed order: `vendor/aprm.js`, then `js/wasm.js`, `store.js`, `presets_data.js`, `presets.js`, `editor.js`, `generator.js`, `canvas.js`, `whylog.js`, `player.js`, `compare.js`, `share.js`, and last `app.js`. Each file attaches its functions to one global namespace, `window.APRM` (for example `APRM.store`, `APRM.player`), and defines nothing else globally. No file uses `fetch`, so the page works from `file://` with a double-click.

### Scripts (`web/js/`)

| Script | Responsibility |
| --- | --- |
| `wasm.js` | Initialises `aprm.js`, wraps every export in a function that parses the JSON envelope and throws a typed error on `ok: false` |
| `store.js` | One app-state object: machine, job list, selected policies and settings, current mode; notifies views on change |
| `editor.js` | Job table: add, edit, delete, CSV import and export; shows the same range errors as §3 before calling C |
| `presets_data.js` | The six presets as a JavaScript data object (capacities + jobs), generated from `data/presets/` by Krishna's tooling and committed |
| `presets.js` | Reads presets from `presets_data.js` (no `fetch`) and loads one into the store |
| `generator.js` | Random job sets from slider settings with a visible seed; produces input only |
| `player.js` | Play, pause, step, speed, jump to end; calls `aprm_step` and pulls state and new log entries after each step |
| `canvas.js` | Draws resource bars, waiting line with live scores, running jobs, Gantt timeline, "now" marker |
| `whylog.js` | Shows event-log sentences; filters to a clicked job |
| `compare.js` | Creates one simulation per selected policy on the same jobs; side-by-side timelines, metrics table, Chart.js charts, exact optimum for 9 jobs or fewer |
| `share.js` | Encodes and decodes a case in the URL hash (N4) |
| `app.js` | Loaded last: wires the scripts together, shows the loading state, starts the page |

### The run loop

1. On **Run**, `player.js` destroys any old simulation, creates a new one, and adds every job from the store.
2. Each tick of `requestAnimationFrame`, it calls `aprm_step` a number of times set by the speed slider.
3. After stepping, it reads state and new log entries, then asks `canvas.js` and `whylog.js` to redraw.
4. **Add job mid-run** pauses, validates the job, calls `aprm_add_job` with arrival set to the current time or later, then resumes.

### UI states (every view has all three)

| State | What the user sees |
| --- | --- |
| Loading | "Loading engine…" until the WebAssembly module is ready |
| Empty | "No jobs yet. Add one, load a preset, or generate a random set." |
| Error | The engine's own message in plain words, next to the field or job that caused it. If WebAssembly fails to load: a clear message and a link to the backup video |

### Layout

Left panel: machine settings and job editor. Centre: canvas. Right panel: "why" log. Bottom: metrics. A mode switch at the top chooses Build, Run or Compare. Light and dark themes follow the system setting.

## 8. Frontend safety checklist

The website has no accounts or stored data, so the risks are bad input from files and links, and the page breaking during the demo.

- [ ] All text from users, files, URLs or the engine is shown with `textContent`, never `innerHTML`.
- [ ] CSV upload: size limit (1 MB), row limit (§3), every field validated before calling C; bad rows listed, not silently dropped.
- [ ] Shared-case links: the URL hash is size-limited, decoded inside `try/catch`, and every field validated exactly like a CSV row.
- [ ] The only external request is Chart.js from a CDN, pinned to an exact version with an integrity hash. If it fails, Compare mode falls back to a table.
- [ ] No `eval`, no `new Function`, no inline event-handler attributes.
- [ ] Classic scripts only; each defines nothing globally except properties of `window.APRM`. No `fetch`, so the page works from `file://`.
- [ ] A failed WebAssembly load shows a clear error state, never a blank page.
- [ ] Long runs cannot freeze the tab: steps per frame are capped, and "jump to end" runs in slices.
- [ ] Nothing is stored in the browser beyond optional user preferences (theme, speed), wrapped in `try/catch`.

## 9. AI workflow, CI and Git hygiene

### Using AI assistants

- Give the assistant this PRD and the blueprint as context, plus the one file being worked on. Claude Code reads `CLAUDE.md` automatically.
- **Never merge code you cannot explain line by line.** This is a viva project: if the assistant writes it, the owner rewrites or annotates it until they can defend it.
- Ask for complexity and invariants with every algorithm, not just code.
- Keep `docs/AI_USE.md` (date, what was asked, what was kept) in case the course requires an AI-use acknowledgment.
- Follow the version safety rule for anything that touches dependencies.

### Git workflow

| Rule | Detail |
| --- | --- |
| Branches | `main` is protected. Work on `k/<issue-id>-<topic>` (Krishna) or `a/<issue-id>-<topic>` (Ahaana) |
| Commits | Small, one idea each, message in the present tense: "Add reservation shadow-time calculation" |
| Pull requests | Every merge goes through a PR. Krishna reviews Ahaana's plotting PRs. Ahaana reviews every PR that changes a CSV format, a summary format or a figure, and must be able to explain what changed; she does not review C internals. Ahaana hand-checks every golden case on paper before it is merged |
| CI must be green | No merge with a failing check |
| Tags | `gate-1` … `gate-5` at each gate; `demo-ready` on the viva build |

### CI baseline (`.github/workflows/ci.yml`)

On every push and pull request:

1. **build-c:** `make` with warnings as errors on Linux.
2. **test-c:** `make test` (unit tests + golden cases).
3. **sanitize:** `make sanitize` and the full test suite under sanitizers.
4. **build-wasm:** install the frozen emsdk version, `make wasm`.
5. **python:** install from the lock file (from `requirements.txt` names before the Gate 2 freeze), run `pytest tests/py` (property checks, summary-format checks, the figure smoke test on `data/sample_summaries/`, and conformance against the fresh WebAssembly build through `wasm/run_wasm.mjs`).
6. **deploy (main only):** publish `web/` to GitHub Pages.

## 10. Testing guide

Krishna proves the core from inside with C tests and from outside with Python over thousands of random runs. Ahaana is the independent second pair of eyes: she hand-checks every golden case on paper, and her figure smoke test checks the summary contract from the reader's side.

### C tests (Krishna, `tests/c/`)

| File | Checks |
| --- | --- |
| `test_heap.c` | 10,000 random pushes pop in order; both compare functions; empty-heap behaviour |
| `test_engine.c` | Each error code is returned for its trigger; rejected jobs leave state unchanged; reset and destroy are clean |
| `test_policy.c` | Each policy's key order; aging order unchanged as time passes |
| `test_reserve.c` | Shadow time is correct; backfilled jobs never delay the reserved job |
| `test_knapsack.c` | DP matches brute force on small item sets; uses at most (1 + ε) of the capacity |
| `test_exact.c` | Matches full brute force on 5-job cases; returns `TOO_LARGE` above the limit |

### Golden cases (`tests/cases/`, Krishna writes, Ahaana checks by hand)

At least 10 small cases (3 to 6 jobs), each with the correct schedule worked out on paper and saved as `<case>.<policy>.expected.csv` next to its input `<case>.csv`: one per policy, plus big-job trap, priority starvation, memory hog, simultaneous finish and arrival, and a capacity-rejection case. The capacity-rejection case is not a schedule (D54): it is a console-level case with the input `tests/cases/<case>.csv`, the expected exit code 3 in `tests/cases/<case>.expected.exit` and the expected one-line stderr text in `tests/cases/<case>.expected.stderr` (no output file is written), plus an API test that the other jobs still schedule when the caller skips the bad one; so the 10 cases with `<case>.<policy>.expected.csv` are 10 schedule cases, plus this one. Ahaana redoes each schedule on paper, without looking at the program's output, and signs off in the PR before it merges.

### Python checks (Krishna, `tests/py/`)

| Check | Method | Pass condition |
| --- | --- | --- |
| Invariants | 10,000 random workloads through the console program; check every result row | No resource overuse at any time, no early starts, correct durations, no lost jobs |
| Aging order | Random workloads with aging | No job is started ahead of a waiting job with a higher score unless the higher one did not fit |
| Starvation bound | Random workloads with reservation | Measured maximum wait never exceeds the bound proven in the report (formula still open: `DECISIONS.md` O-1) |
| Exact never beaten | 200 tiny workloads | Exact total wait ≤ every policy's total wait |
| Conformance | 1,000 random workloads through the console program and the WebAssembly build (`run_wasm.mjs`) | Outputs identical, byte for byte |
| Metrics | Recompute metrics in pandas from `results.csv` | Match the C metrics JSON within 1e-9 |
| Summary format | Every file `summarize.py` writes, and every file in `data/sample_summaries/` | Exactly the §5 summary columns, in order; `ci_low ≤ mean ≤ ci_high` |
| Figures (Ahaana, `test_plot_figures.py`) | Run `plot_figures.py` on `data/sample_summaries/` into a temporary folder | Every expected PNG and PDF file is created |

### Website checklist (Krishna, before each tag)

- [ ] All six presets load, play, step and finish.
- [ ] A job added mid-run appears and is scheduled.
- [ ] CSV export then import gives the same case.
- [ ] Compare mode shows the same metrics as the console program for the same case.
- [ ] Invalid input shows the engine's message next to the right field.
- [ ] Works opened directly from a folder (double-click `index.html`, `file://`) with the network off.

## 10A. Demo script

Twelve minutes, two presenters: each speaks about what they built. Ahaana presents the problem story and the experiment graphs; Krishna presents the algorithms, the website and the testing. Every row is rehearsed.

| # | Time | Who | On screen | Says | If it breaks |
| --- | --- | --- | --- | --- | --- |
| 1 | 0:00–1:00 | Ahaana | Problem slide | The lab-computer story: 16 cores, 32 GB, jobs keep arriving, someone must choose | — |
| 2 | 1:00–4:00 | Krishna | Algorithm slides | Heap with the fixed aging key; the starvation bound; why aging alone fails for big-memory jobs; reservation; complexity table | Slides are local PDF too |
| 3 | 4:00–5:00 | Krishna | Console program on a golden case | "This is the synopsis deliverable: C, structs, heap, greedy, aging, resource check." | Show saved terminal screenshot |
| 4 | 5:00–6:30 | Krishna | Website: big-job trap, FCFS vs ours in Compare | "The Fan & Liang worst case, and what our scheduler does about it." | Backup video at 0:00 |
| 5 | 6:30–7:30 | Krishna | Memory-hog preset, aging vs aging + reservation, "why" log open | "Aging puts the job first in line; reservation actually gets it on the machine." | Backup video at 1:00 |
| 6 | 7:30–8:30 | Krishna | Hand laptop to examiner | "Build any case you like, or add a job mid-run." | Load the heavy-load preset |
| 7 | 8:30–10:30 | Ahaana | Graphs E1, E2, E5, E6 | What each graph shows and how to read it; each point is a mean over 30 seeds with a 95% confidence interval; the E6 box plot compares each scheduler with the exact optimum | Graphs are also in the report PDF |
| 8 | 10:30–11:30 | Krishna | Testing slide | Golden cases checked by hand by both members; 10,000 random runs, zero invariant violations; console and WebAssembly identical on 1,000 cases; exact solver never beaten | — |
| 9 | 11:30–12:00 | Krishna | Limits slide | Greedy's known worst case, known durations assumed, one machine; what comes next (§12A) | — |

### Pre-demo checklist

- [ ] Laptop on the `demo-ready` tag; website opens from the folder with Wi-Fi off.
- [ ] Presets load; a dry run of rows 4 and 5 done that morning.
- [ ] Graphs and slides open as local files.
- [ ] Backup video open and paused; a copy on a USB stick and in the cloud.
- [ ] Browser zoom 125%, notifications off, charger in, projector adapter tested.
- [ ] Second laptop has the same tag and runs the demo too.

### If something breaks

The speaker keeps talking ("let me show you the recorded run") while the other switches to the backup video at the matching point within 10 seconds. Never debug in front of the examiners.

### Likely examiner questions (one-sentence answers to rehearse)

| Question | Answer owner |
| --- | --- |
| Why a heap and not a sorted array? | Krishna: O(log n) insert and remove versus O(n) insert |
| Doesn't aging change every priority each tick? | Krishna: the time term is the same for all waiting jobs, so the heap stores a fixed key and never re-sorts |
| Can a job starve? | Krishna: not with reservation; after (b_max − b) / α ticks no newcomer can overtake it, and once reserved it starts within p_max |
| Is your scheduler optimal? | Krishna: no; greedy has a known bad case (Fan & Liang), and our exact solver measures the gap |
| Is the website really running your C code? | Krishna: yes, compiled to WebAssembly, and the conformance test checks identical output on 1,000 cases |
| How do you know results are correct? | Krishna: golden cases worked by hand by both of us, invariants over 10,000 runs, and cross-checks against the exact solver |
| Why Python at all? | Krishna: for generating workloads and summarising thousands of runs; it never schedules |
| What do the error bars mean? | Ahaana: each point is the mean over 30 seeds; the bar is the 95% confidence interval of that mean, from the Student-t distribution |
| Why a box plot for E6, and why turnaround? | Ahaana: it shows the spread over all instances, not just the average; turnaround keeps the ratio defined when the optimum has zero wait |
| What would you add next? | Either: multiple machines and estimated durations (§12A) |

## 10B. Risks and fallbacks

| Risk | Likelihood | Early warning | Fallback |
| --- | --- | --- | --- |
| Emscripten will not install on a laptop | Medium | `emcc` not found or fails in WSL | CI builds `aprm.js`; download it from the CI run; the laptop only needs GCC |
| Console and WebAssembly results differ | Medium | Conformance check fails | Usually uninitialised memory or float ties: run `make sanitize`, check tie-breaks; never ship until it passes |
| Memory bug in C | Medium | Random crashes, odd results | `make sanitize` on every change; CI blocks the merge |
| Python and C disagree on CSV format | Medium | Parse errors in experiment runs | §5 is the contract; golden CSVs are the shared reference; change §5 first |
| Website lags on large cases | Medium | Visible stutter above a few hundred jobs | Cap steps per frame; draw only the visible part of the timeline; 5,000-job limit |
| Reservation proof harder than expected | Medium | Proof stalls in Stage 4 | Present E5 as measured evidence plus a clearly labelled proof sketch |
| Knapsack batch underperforms greedy | Medium | E1 shows it worse at light load | Report it honestly; Fan & Liang saw the same at light load (their Fig. 3) |
| Exact solver too slow | Low | 9-job cases take over 2 seconds | Add pruning; lower the limit to 8 |
| Ahaana blocked waiting for real summaries | Medium | No `results/summaries/` by Stage 3 | Build every figure on `data/sample_summaries/`, which use the §5 summary formats; switching to real data changes only the input folder |
| Results differ between compilers through floating point | Low | Conformance fails on aging or knapsack cases | Scheduling decisions use integers only (`alpha_milli`); knapsack representation fixed in `DECISIONS.md` O-2 |
| One member cannot explain the other's part | Medium | Stumbles in rehearsal | PR reviews, the questions table in §10A, and one solo rehearsal each |
| Projector or laptop fails | Low | — | Second laptop on the same tag; backup video on USB and cloud |
| Running out of time | Medium | Must-haves open near the end | Cut from the bottom of the Nice-to-have list; never cut M4 (reservation), M7 (website) or M13 (backup video) |

## 11. Master prompts

Claude Code reads `CLAUDE.md` automatically, so most sessions only need: "Work on issue K-07 from docs/BACKLOG.md." Use these prompts with other assistants, or to steer a session.

### 11.1 C core prompt (Krishna)

```
You are helping build the C core of the Adaptive Priority Resource Manager, an ADA course project.
Context: docs/PRD.md (sections 3, 5, 6) and docs/BLUEPRINT.md (section 3, algorithms) are the source of truth.

Task: implement <MODULE> (e.g. core/heap.c + heap.h).

Rules:
- C11, standard library only, compiles with -std=c11 -Wall -Wextra -Werror on GCC, Clang and Emscripten.
- No globals, no I/O, no printing inside core/. All state in the Sim struct.
- Validate every input against PRD section 3 ranges; return the PRD section 5 error codes.
- Check every allocation; snprintf only; 64-bit time; check overflow on start + duration.
- Ties broken by earlier arrival, then lower id. Deterministic output.
- Above each function: what it does, time and space complexity, who owns returned memory.
- Also write tests/c/test_<module>.c with assert-based tests, including edge cases.
- After the code, explain the algorithm and its invariants in plain words so I can defend it in a viva.
- Do not add features outside PRD section 1A.
```

### 11.2 WebAssembly and website prompt (Krishna)

```
You are helping build the website for the Adaptive Priority Resource Manager.
Context: docs/PRD.md sections 5 (API contract), 7 (frontend architecture), 8 (safety checklist); docs/BLUEPRINT.md section 5 (website spec).

Task: implement <MODULE> (e.g. web/js/player.js, or wasm/api.c + wasm/build.sh).

Rules:
- Plain HTML, CSS and classic JavaScript files attached to window.APRM. No ES modules, no fetch, no framework, no bundler. Must work from file://.
- JavaScript never makes scheduling decisions; it only calls the aprm_* exports and draws results.
- Parse every engine response as the PRD section 5 JSON envelope; show error.message next to the right field.
- textContent only, never innerHTML for any user, file, URL or engine text.
- Every view has loading, empty and error states.
- Colours as CSS variables with light and dark values.
- Emscripten: single-file, modular output, export only the step API; check current flag names in the Emscripten docs.
- Any CDN script: follow the PRD version safety rule (exact version, at least two weeks old, SRI hash) and tell me what you verified.
- Explain how the module works when you finish.
```

### 11.3 Python experiments prompt (Krishna)

```
You are helping build the Python tooling for the Adaptive Priority Resource Manager.
Context: docs/PRD.md sections 5 (CSV formats, summary CSV formats, console program) and 10 (testing guide); docs/BLUEPRINT.md section 6 (experiments E1-E6).

Task: implement <SCRIPT> (e.g. tools/gen_workload.py).

Rules:
- Python never schedules jobs. It only generates input CSVs, runs the console program with subprocess, and summarises output CSVs.
- Every random workload takes an explicit seed and writes it next to the output.
- Use numpy for generation, pandas for analysis, pytest for checks. No plotting here: figures belong to tools/plot_figures.py.
- Summary files follow PRD section 5 "Summary CSV formats" exactly: columns, order, Student-t 95% intervals with the hard-coded t values.
- Follow the PRD version safety rule before touching requirements.txt; list names only; tell me what you verified.
- Type hints and a docstring on every function.
- Explain what the script does and how to run it in two commands.
```

### 11.3b Figures prompt (Ahaana)

```
You are helping Ahaana build tools/plot_figures.py for the Adaptive Priority Resource Manager. Ahaana is learning.
Context: docs/PRD.md section 5 "Summary CSV formats"; docs/BLUEPRINT.md section 6 (experiments E1-E6).

Task: <FIGURE> (e.g. the E1 figure: average wait vs load).

Rules:
- Read only the summary CSV files (data/sample_summaries/ or results/summaries/). Never run experiments, call the C program, or compute statistics.
- Use only pandas and matplotlib. Short functions, clear names, a comment on every block. No clever one-liners, no classes.
- One figure per function. Title, labelled axes with units, legend, and error bars or shaded 95% bands from the ci_low / ci_high columns.
- Save PNG and PDF into docs/report/figures/ using the shared style.
- Explain each step before writing it, in simple language. After the figure, explain how to read it and what it shows.
```

### 11.4 Hardening prompt (Krishna, before Gate 4)

```
Review <FILES> in the Adaptive Priority Resource Manager against docs/PRD.md section 6 (C) or section 8 (website).
For each checklist item: say pass or fail, quote the line, and propose the smallest fix.
Also look for: unchecked allocations, possible overflow, missing validation, nondeterministic ordering, innerHTML use.
Do not refactor anything that passes. Do not add features.
```

## 12. Extension add-ons

Each add-on is started only after every Must-have and Nice-to-have item is done. Paste the block into 11.1 as extra rules.

**Multiple machines.**

```
Add M identical machines. Each machine has its own CPU and memory capacity.
The selection step chooses a job AND a machine: try best fit (machine left with least spare capacity after placement).
Keep the step API; add machine_id to state and results. Revisit Fan & Liang Lemma 6.3 for the M-machine bound.
```

**Estimated durations.**

```
Each job carries an estimated duration and a true duration revealed only at finish.
SJF and reservation use the estimate; the engine uses the true value.
Measure how estimate error hurts reservation (Mu'alem & Feitelson 2001 is the reference).
```

**More resource types.**

```
Generalise CPU and memory to R resources (GPU, disk). Volume becomes p_j times the sum of normalised demands.
Knapsack capacity becomes R times the window length, matching Fan & Liang.
```

## 12A. Future scope

Nothing from the template or the blueprint was dropped silently.

| Feature | Status | Why not now |
| --- | --- | --- |
| Backend server (FastAPI) | Removed | Scheduling runs in the browser through WebAssembly; a server adds a failure point with no benefit |
| Database | Removed | Cases live in CSV files and URLs; nothing needs to persist |
| Login and accounts | Removed | No personal data and no multi-user features |
| Real-time sync between windows | Removed | Each viewer runs their own simulation |
| Multiple machines | Deferred (add-on) | Adds bin packing on top of scheduling; keeps the core proofs simpler without it |
| Estimated durations | Deferred (add-on) | Breaks the exactness that reservation and the exact solver rely on |
| More than two resources | Deferred (add-on) | Two resources already show every idea; the model generalises directly |
| Preemption | Deferred | Changes the problem class; the synopsis and research model are non-preemptive |
| Faithful MRIS with its 16(1 + ε) guarantee | Deferred | Our engine-integrated version is evaluated by experiment instead |
| Dominant Resource Fairness (per-user fairness) | Deferred | Needs a notion of users owning jobs |
| Learning-based scheduler | Deferred | Not an algorithms-course topic; hard to prove anything about |

**Template sections not used and why:** environment-variable secrets (we have no secrets), auth and ownership helpers (no users), Postman collections (no HTTP endpoints), and the domain add-ons for e-commerce, CRM, social and analytics (different domain).

## 13. Document maintenance

This PRD is the single source of truth for scope and the engine contract. **Scope keeper: Krishna.** Either member may edit; Krishna keeps it consistent.

**When to update.**

- Changed C function, JSON shape, error code, or CSV column → update §5 first, then code, then tell Ahaana.
- New default or limit → update §3 and `core/config.h` together.
- Scope change → move the row within §1A; anything cut goes to §12A with a one-line reason.
- New risk → add it to §10B with its fallback before going back to coding.
- Demo change → update §10A and re-time a full rehearsal.
- Toolchain change → update `TOOLCHAIN.md` and the CI workflow together, following the version safety rule.
- New decision → add it to `DECISIONS.md`.

**After the feature freeze** (Gate 4), only §10A and §10B may change.

**AI assistant instruction.** When using this document as context, follow the version safety rule, keep all scheduling logic in `core/`, keep scope to §1A unless the team says otherwise, and explain every piece of code well enough for a viva.
