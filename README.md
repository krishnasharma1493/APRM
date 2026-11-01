# APRM: Adaptive Priority Resource Manager

An online, non-preemptive job scheduler for one machine with two resources (CPU cores and memory), written in C. The same C code runs as a console program and, compiled to WebAssembly, inside an interactive website where you can build any case, watch the scheduler decide step by step with a plain-English reason for each decision, and compare schedulers side by side. Python tooling generates workloads, runs experiments, checks correctness and draws the report graphs.

Course project for Analysis and Design of Algorithms, B.Tech CSE (3rd semester), Faculty of Technology, University of Delhi. Team: Krishna Sharma and Ahaana Arya.

> **Status:** setup stage. Most commands below work once their backlog issue is done (see `docs/BACKLOG.md`).

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
| `docs/research/` | The papers |
| `data/sample_summaries/README.md` | Fake summary files for building figures early |

## Setup

Install the exact versions listed in `docs/TOOLCHAIN.md`. Until that table is filled in (issue K-01), use the latest stable release from each official source. Do not copy version numbers from anywhere else.

You need: a C compiler (GCC or Clang), GNU Make, Git, Python 3 with `venv`, and Emscripten (emsdk) for the WebAssembly build. Node.js is needed only for the WebAssembly tests.

### Windows (WSL2 Ubuntu)

1. Install WSL2 with Ubuntu (`wsl --install` in an administrator PowerShell, then restart).
2. In the Ubuntu terminal: `sudo apt update && sudo apt install build-essential git python3 python3-venv`.
3. Install Emscripten with emsdk, following emscripten.org: clone `emsdk`, then `./emsdk install <version from TOOLCHAIN.md>`, `./emsdk activate <same version>`, `source ./emsdk_env.sh`.
4. Keep the repository inside the Linux file system (for example `~/aprm`), not under `/mnt/c`, and open it with the VS Code WSL extension.

### Mac

1. `xcode-select --install` (Clang and Make).
2. Python 3 from python.org (or Homebrew), and Git.
3. Emscripten through emsdk as above.

### Linux

1. Install `build-essential` (or your distribution's GCC + Make), `git`, `python3`, `python3-venv`.
2. Emscripten through emsdk as above.

### Python environment (all systems)

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt        # names only, until the Gate 2 freeze
pip install -r requirements.lock.txt   # after the freeze: exact versions
```

## Build and test

```sh
make              # console program → build/aprm
make debug        # with invariant checks after every step
make sanitize     # AddressSanitizer + UndefinedBehaviorSanitizer
make test         # C unit tests and golden cases
make wasm         # WebAssembly bundle → web/vendor/aprm.js
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

Run `make wasm` (or download `aprm.js` from the CI run), then double-click `web/index.html`. It works offline from the folder; no server is needed.

**Python**

```sh
python tools/gen_workload.py      # seeded workloads and preset CSVs
python tools/run_experiments.py   # run the console program over the experiment grid
python tools/summarize.py         # means and 95% intervals → results/summaries/
python tools/plot_figures.py      # figures → docs/report/figures/ (reads summaries only)
```

## Contributing

Work one issue at a time on a branch `k/<id>-<topic>` or `a/<id>-<topic>`, open a pull request using the template, the reviewer subagent checks it, and it is squash-merged when CI is green. `main` must always build and pass its tests.
