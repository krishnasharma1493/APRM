# APRM: Toolchain

Tool versions for each laptop and for CI. Krishna's column was filled in K-01 from the machine itself and checked against the official sources named below. The CI column was filled in K-18 from the logs of CI run 41308803440 on 2026-11-01 (only values the run printed). Ahaana's column cannot be known from this machine: it says "not yet recorded (A-01)" until she records her real versions. After the freeze, upgrade only when a bug forces it, both members together, and update the CI workflow in the same PR.

Never write a version here from memory. For each row, record where it was checked and when.

| Tool | Krishna's laptop | Ahaana's laptop | CI (GitHub Actions) | Verified from | Date checked |
| --- | --- | --- | --- | --- | --- |
| Operating system / WSL2 Ubuntu | macOS 27.0 (build 26A428) | not yet recorded (A-01) | Ubuntu 24.04.5 LTS (image ubuntu-24.04, version 20261025.353.1) | `sw_vers` on the machine | 2026-11-01 |
| GCC | not installed; `gcc` is an alias for Apple clang (below) | not yet recorded (A-01) | gcc 13.3.0 (Ubuntu 13.3.0-6ubuntu2~24.04.1); `cc` is the same | `gcc --version` on the machine | 2026-11-01 |
| Clang (Mac: Xcode command line tools) | Apple clang 21.0.0 (clang-2100.1.1.101); command line tools package 26.6.0.0.1781586589 | not yet recorded (A-01) | not used in CI (CI builds with gcc) | `clang --version`, `pkgutil --pkg-info com.apple.pkg.CLTools_Executables`. Apple ships its own build; there is no separate upstream release to compare with | 2026-11-01 |
| GNU Make | 3.81 (Apple's build, `/usr/bin/make`) | not yet recorded (A-01) | GNU Make 4.3 | `make --version` on the machine. See note 1 | 2026-11-01 |
| Emscripten (emsdk) | 6.0.13 (`emcc` commit e13ee988ce3d), installed in `~/emsdk` | not yet recorded (A-01) | 6.0.13 (`emcc` e13ee988ce3d), pinned in the CI job as `EMSDK_VERSION` | [Emscripten releases on GitHub](https://github.com/emscripten-core/emscripten/releases/tag/6.0.13): 6.0.13 is tagged "Latest", published 19 Oct 2026; `emsdk list` shows 6.0.13 as the newest installable. A test program compiled with `emcc` and ran under Node | 2026-11-01 |
| Node.js (CI only, runs WebAssembly tests) | 24.19.0 (the copy bundled with emsdk) | not yet recorded (A-01) | 24.19.0 (installed by emsdk 6.0.13; see note 2) | [nodejs.org releases](https://nodejs.org/en/about/releases/) lists 26.13.0 as the latest LTS line. See note 2 | 2026-11-01 |
| Python | 3.13.7 (system `python3`, used by `.venv`) | not yet recorded (A-01) | 3.13.17 (`setup-python` with `3.13`), pip 26.2.2 | [Python devguide, status of versions](https://devguide.python.org/versions/): 3.13 is security-only, 3.14 and 3.15 are in bugfix. See note 3 | 2026-11-01 |
| numpy | 2.5.4 | not yet recorded (A-01); install from `requirements.lock.txt` | 2.5.4 (from the lock file) | `pip index versions numpy` (PyPI): latest stable; `pip install -r requirements.txt` installed this version | 2026-11-01 |
| pandas | 3.1.0 | not yet recorded (A-01); install from `requirements.lock.txt` | 3.1.0 (from the lock file) | `pip index versions pandas` (PyPI), same check | 2026-11-01 |
| matplotlib | 3.11.2 | not yet recorded (A-01); install from `requirements.lock.txt` | 3.11.2 (from the lock file) | `pip index versions matplotlib` (PyPI), same check | 2026-11-01 |
| pytest | 9.2.0 | not yet recorded (A-01); install from `requirements.lock.txt` | 9.2.0 (from the lock file) | `pip index versions pytest` (PyPI), same check | 2026-11-01 |
| Chart.js (CDN, with SRI hash) |  | to be filled in K-27 | to be filled in K-27 | Checked in K-27 |  |

**Notes (decisions made at the K-18 freeze, 2026-11-01).**

1. **Make.** CI uses GNU Make 4.3, the laptop has 3.81. The Makefile uses no feature newer than 3.81 and CI passes on 4.3, so both work. Decision: keep Apple's 3.81 on the Mac; no Homebrew Make.
2. **Node.** [nodejs.org/en/about/releases](https://nodejs.org/en/about/releases/) (read 2026-11-01) lists v26 (26.13.0), v24 (24.22.2) and v22 as LTS lines. The Node that emsdk 6.0.13 installs (24.19.0, an older patch of the v24 LTS line) runs the WebAssembly tests in CI and on the laptop, so both use the same Node. Decision (DECISIONS D65): keep the emsdk-bundled Node; do not move to 26 (it would differ from the laptop, and the bundled one is what emsdk tests against). Revisit only if a bug forces it.
3. **Python.** [devguide.python.org/versions](https://devguide.python.org/versions/) (read 2026-11-01) shows 3.13 as security support until 2029-10, 3.14 and 3.15 in bugfix. The PRD allows bugfix or security. Decision: stay on 3.13 (the line on the laptop and in CI). The patch differs (laptop 3.13.7, CI 3.13.17, the newest in the runner cache); the minor line is the same. Pin of exact patches is not forced by the lock file, which fixes every package. pip: the laptop venv has 25.2, CI has 26.2.2; neither affects the resolved packages.
4. **Advisories.** `pip-audit` 2.10.1 (installed in a throwaway venv) run on 2026-11-01 as `pip-audit -r requirements.lock.txt --no-deps --disable-pip`: "No known vulnerabilities found" (it warned that hashes are not pinned). Chart.js is not used yet (K-27). Run it again before submission.
5. **Lock file.** `requirements.lock.txt` is `pip freeze` of a clean venv created only from `requirements.txt` (Python 3.13.7, macOS), 2026-11-01. CI installs from it; the same packages resolved in CI (it printed numpy 2.5.4, pandas 3.1.0, matplotlib 3.11.2, pytest 9.2.0).

**Identical-versions criterion (issue #19): UNMET.** Python patch 3.13.7 vs 3.13.17, Make 3.81 vs 4.3, pip 25.2 vs 26.2.2, Ahaana's column unrecorded.

**CI log evidence** (run 41308803440, job logs): `Image: ubuntu-24.04`, `Version: 20261025.353.1`; `cc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0`; `GNU Make 4.3`; `Python 3.13.17`; `pip 26.2.2`; `emcc ... 6.0.13 (e13ee988ce3d...)`; `Installing tool 'node-24.19.0-64bit'`.

**Freeze record.** Gate 2 freeze date: 2026-11-01 (on Krishna's authorisation) · Lock file: `requirements.lock.txt` · Last `pip-audit` run: 2026-11-01, no known vulnerabilities · Awaiting Ahaana: her laptop versions (A-01).
