# APRM: Adaptive Priority Resource Manager

An online, non-preemptive job scheduler for one machine with two resources (CPU cores and memory), written in C. The same C code runs as a console program and, compiled to WebAssembly, inside an interactive website where you can build any case, watch the scheduler decide step by step with a plain-English reason for each decision, and compare schedulers side by side. Python tooling generates workloads, runs experiments, checks correctness and draws the report graphs.

Course project for Analysis and Design of Algorithms, B.Tech CSE (3rd semester), Faculty of Technology, University of Delhi. Team: Krishna Sharma and Ahaana Arya.


## Documentation map

| File | Read it for |
| --- | --- |
| `CLAUDE.md` | Rules every coding session follows (people and AI assistants) |
| `docs/PRD.md` | Scope, repository layout, limits, API and CSV contracts, testing, demo script |
| `docs/BLUEPRINT.md` | Algorithm specifications, phase plan, website spec, experiments, report outline |
| `docs/BACKLOG.md` | The ordered list of issues |
| `docs/DECISIONS.md` | Every design decision and every open question |
| `docs/RESEARCH_NOTES.md` | What each paper says, where we use it, glossary |
| `docs/TOOLCHAIN.md` | Frozen tool versions (the only place versions are written) |
| `docs/AI_USE.md` | Log of AI-assistant use |
| `docs/FRESH_CLONE_TEST.md` | Timed fresh-clone setup test (steps, times, problems found) |
| `docs/research/` | The papers |
| `data/sample_summaries/README.md` | Fake summary files for building figures early |

## Setup

Versions are written in one place only: `docs/TOOLCHAIN.md`. Do not copy version numbers from anywhere else. Where a version matters (Emscripten), install the one that file lists.

### Prerequisites (check each with the command shown)

| You need | Check with | Needed for |
| --- | --- | --- |
| A C compiler (GCC or Clang) | `cc --version` | `make`, `make test` |
| GNU Make | `make --version` | every build command |
| Git | `git --version` | cloning |
| Python 3 with `venv` | `python3 --version` and `python3 -m venv --help` | tools, `pytest`, figures |
| A web browser (Chrome, Edge, Firefox) | open it | the website |
| Emscripten (emsdk), optional | `emcc --version`; "command not found" is fine if `~/emsdk` exists, because `make wasm` sources it itself | `make wasm` only (the website's engine file) |
| Node.js, optional | `node --version` | some WebAssembly tests; emsdk bundles one |

If a command prints "command not found", install that tool using the system section below, then run the check again. Everything except the website's engine file builds without Emscripten.

### Windows (WSL2 Ubuntu)

1. Install WSL2 with Ubuntu (`wsl --install` in an administrator PowerShell, then restart).
2. In the Ubuntu terminal: `sudo apt update && sudo apt install build-essential git python3 python3-venv`.
3. Keep the repository inside the Linux file system (for example `~/aprm`), not under `/mnt/c`, and open it with the VS Code WSL extension.
4. Emscripten: see "Installing Emscripten" below.

### Mac

1. `xcode-select --install` (Clang and Make; `cc` and `make` then exist).
2. Python 3 from python.org (or Homebrew), and Git.
3. Emscripten: see "Installing Emscripten" below.

### Linux

1. Install `build-essential` (or your distribution's GCC + Make), `git`, `python3`, `python3-venv`.
2. Emscripten: see "Installing Emscripten" below.

### Installing Emscripten (only for `make wasm`)

Follow emscripten.org: clone `emsdk` into `~/emsdk`, then `./emsdk install <version from docs/TOOLCHAIN.md>`, `./emsdk activate <same version>`. `make wasm` finds `~/emsdk` on its own (it sources `emsdk_env.sh` for you). If emsdk is somewhere else, run `source <your emsdk folder>/emsdk_env.sh` in the same terminal first, then check `emcc --version`.

There is no prebuilt engine file to download: CI does not publish one and the `demo-ready` build does not exist yet. So the website needs `make wasm`, and therefore emsdk. Without it, everything else (console program, tests, figures) still works.

### Python environment (all systems)

From the repository folder:

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.lock.txt   # exact versions; use this one
```

(`requirements.txt` lists the package names only; install it instead only if the lock file fails on your Python.) On Windows WSL and Mac/Linux the prompt shows `(.venv)` while it is active. Open a new terminal later? Run `source .venv/bin/activate` again before `pytest` or `python tools/...`.

## First run: from a fresh clone to everything working

Run these in order, from the repository folder, with the virtual environment active. Each step says what success looks like.

| Step | Command | Success looks like |
| --- | --- | --- |
| 1. Build | `make` | Last line links `build/aprm`, no errors |
| 2. C tests | `make test` | Ends with "passed" lines, exit code 0 |
| 3. Python tests | `pytest tests/py -q` | `passed`, no failures (about a minute) |
| 4. Engine for the website | `make wasm` | `built web/vendor/aprm.js (... bytes)` |
| 5. Website | double-click `web/index.html` | The page says "Engine ready" |
| 6. Figures | `python tools/plot_figures.py` | Prints the paths of `.png` and `.pdf` files in `docs/report/figures/` |

Run step 1 before step 3: some Python tests call `build/aprm`. Step 6 reads `data/sample_summaries/` until real summaries exist in `results/summaries/`. A timed record of this procedure on a fresh clone is in `docs/FRESH_CLONE_TEST.md`.

### Troubleshooting

| You see | Cause and fix |
| --- | --- |
| `make: cc: command not found` or similar | No C compiler. Mac: `xcode-select --install`. Ubuntu/WSL: `sudo apt install build-essential`. |
| `wasm/build.sh: emcc not found` | Emscripten is not installed or not active. See "Installing Emscripten"; check with `emcc --version`. All other steps still work. |
| Website shows "The engine file (web/vendor/aprm.js) did not load. Run "make wasm"..." | `web/vendor/aprm.js` is not built (it is never committed). Run `make wasm`, then reload the page. |
| `ModuleNotFoundError` (numpy, pandas, matplotlib, pytest) or `pytest: command not found` | The virtual environment is not active in this terminal. Run `source .venv/bin/activate`. |
| `python3 -m venv` fails on Ubuntu/WSL | `sudo apt install python3-venv`. |
| `pip` prints "A new release of pip is available" | A notice, not an error. Ignore it; do not upgrade pip for this project. |
| `pytest` prints a warning "no runs under raw/E2" | Expected: E2 is summarised from the E1 runs. Not a failure. |

## Build and test

```sh
make              # console program → build/aprm
make debug        # with invariant checks after every step
make sanitize     # AddressSanitizer + UndefinedBehaviorSanitizer
make test         # C unit tests and golden cases
make wasm         # WebAssembly bundle → web/vendor/aprm.js (needs emsdk)
make clean
pytest tests/py   # property checks, conformance, summary and figure checks
```

## Run

**Console program**

```sh
build/aprm --in jobs.csv --out results.csv --policy aging \
           [--cpu 16] [--mem 32768] [--alpha-milli 100] [--threshold 50] [--eps 0.1] \
           [--log log.txt] [--metrics metrics.json] [--exact]
```

Policies: `fcfs`, `priority`, `sjf`, `aging`, `reserve`, `knapsack`. Input and output formats: PRD §5.

**Website**

Run `make wasm`, then double-click `web/index.html` (or open it from your browser with File > Open). It works offline from the folder; no server is needed. The page shows "Engine ready" when the engine loaded.

**Optional: GitHub Pages copy**

The laptop is the primary demo. A bonus copy can be published from `main` by the `deploy` job in `.github/workflows/ci.yml`. It stays skipped until two human steps are done, in this order (step 1 before step 2):

1. In the repository, Settings > Pages > Source: GitHub Actions.
2. Set the repository variable: Settings > Secrets and variables > Actions > Variables > `PAGES_ENABLED` = `true`, or `gh variable set PAGES_ENABLED --body true`.

The next push to `main` (after all five checks pass) publishes only `web/`, with the CI-built `web/vendor/aprm.js`. To stop publishing, delete the variable.

**Python**

```sh
python tools/gen_workload.py      # seeded workloads and preset CSVs
python tools/run_experiments.py   # run the console program over the experiment grid
python tools/summarize.py         # means and 95% intervals → results/summaries/
python tools/plot_figures.py      # figures → docs/report/figures/ (reads summaries only)
```

## Contributing

Work one issue at a time on a branch `k/<id>-<topic>` or `a/<id>-<topic>`, open a pull request using the template, the reviewer subagent checks it, and it is squash-merged when CI is green. `main` must always build and pass its tests.
