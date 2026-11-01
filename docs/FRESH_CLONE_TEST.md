# APRM: Fresh-clone setup test (K-31, issue #34)

**Status: simulated by the assistant on the maintainer's laptop (macOS); the real test on Ahaana's laptop is still to be done.**

Date of the simulation: 2026-11-01. Target (PRD M12): everything running from the README in 15 minutes or less, excluding downloads.

## Method

The assistant cloned the repository into a new empty folder outside any existing checkout and followed only what `README.md` said, running each command and timing it with the wall clock. Pass 1 used the README as it was on `main`. The README was then fixed and pass 2 repeated everything in a second fresh clone of the fixed branch. Because it is the maintainer's laptop, the compiler, make, Python, Node, Chrome and `~/emsdk` were already installed, and pip's download cache was warm. So this shows the README steps are correct and complete; it does not show that a clean laptop can install the prerequisites. That is what Ahaana's run must check.

## Timings (wall clock, seconds)

| Step | Command | Pass 1 (old README) | Pass 2 (fixed README) |
| --- | --- | --- | --- |
| Clone (download) | `git clone` | 1 | 2 |
| Python venv | `python3 -m venv .venv` | 1 | 1 |
| Install packages (download) | `pip install -r requirements.lock.txt` | 9 (also ran `requirements.txt`, redundant) | 9 |
| Build | `make` | under 1 | under 1 |
| C tests | `make test` | 8 | 8 |
| Python tests | `pytest tests/py -q` | 55 | 52 |
| WebAssembly | `make wasm` | 2 | 2 |
| Website | headless Chrome on `web/index.html` over `file://` | under 1; page said "Engine ready" | under 1; "Engine ready" |
| Figures | `python tools/plot_figures.py` | 2 | 2 |
| **Total** | | about 80 | 76 (measured end to end) |

Both passes are far under 15 minutes. Expected extra time on a real laptop: installing the compiler and emsdk (downloads, not counted).

## Problems found in pass 1 and what changed

| # | Problem in the old README | Fix |
| --- | --- | --- |
| 1 | No way to check which tools are installed | Prerequisites table with a check command for each tool; no version numbers, only a pointer to `docs/TOOLCHAIN.md` |
| 2 | It told the reader to run both `pip install -r requirements.txt` and `requirements.lock.txt` (the second repeats the first) | Install from the lock file; the names-only file is described as a fallback |
| 3 | Said "download `aprm.js` from the CI run", which is false: CI uploads no artifact and the `demo-ready` build does not exist | Removed; README says the website needs `make wasm`, and what is still possible without emsdk |
| 4 | Silent about what to do without emsdk | New "Installing Emscripten" section; notes that `make wasm` finds `~/emsdk` itself, and that everything but the website works without it |
| 5 | No order or success criteria; `pytest` needs `build/aprm` first | "First run" table with the order, each command and what success looks like |
| 6 | Did not say the virtual environment must be activated in every new terminal | Stated in the Python section and in troubleshooting |
| 7 | No mention of what the website shows when the engine file is missing, or the "Engine ready" message | Added to the table and troubleshooting |
| 8 | Outdated "setup stage" status note | Removed |
| 9 | Harmless messages (pip upgrade notice, the E2 warning in pytest) could look like failures | Listed in troubleshooting as expected |

No stall happened in either pass; the problems were wrong or missing wording, not failing commands. One masked risk: `wasm/build.sh` quietly sources `~/emsdk/emsdk_env.sh`, so the pass worked only because emsdk sits in the home folder; with it absent the script prints "emcc not found" (checked), which the README now explains.

## Still to do (acceptance criteria of #34)

- Ahaana runs the README on her own laptop from a fresh clone, with Krishna only noting stalls, and records start and end times here.
- Fix any stall she finds in the README, and repeat until 15 minutes or less.
- Fill in her column of `docs/TOOLCHAIN.md` (A-01) at the same time.
