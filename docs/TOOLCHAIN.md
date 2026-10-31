# APRM: Toolchain

Tool versions for each laptop and for CI. Krishna's column was filled in K-01 from the machine itself and checked against the official sources named below. **Ahaana's laptop and CI stay empty** until her laptop is set up (A-01) and the Gate 2 freeze (K-18). After the freeze, upgrade only when a bug forces it, both members together, and update the CI workflow in the same PR.

Never write a version here from memory. For each row, record where it was checked and when.

| Tool | Krishna's laptop | Ahaana's laptop | CI (GitHub Actions) | Verified from | Date checked |
| --- | --- | --- | --- | --- | --- |
| Operating system / WSL2 Ubuntu | macOS 27.0 (build 26A428) | | | `sw_vers` on the machine | 2026-11-01 |
| GCC | not installed; `gcc` is an alias for Apple clang (below) | | | `gcc --version` on the machine | 2026-11-01 |
| Clang (Mac: Xcode command line tools) | Apple clang 21.0.0 (clang-2100.1.1.101); command line tools package 26.6.0.0.1781586589 | | | `clang --version`, `pkgutil --pkg-info com.apple.pkg.CLTools_Executables`. Apple ships its own build; there is no separate upstream release to compare with | 2026-11-01 |
| GNU Make | 3.81 (Apple's build, `/usr/bin/make`) | | | `make --version` on the machine. See note 1 | 2026-11-01 |
| Emscripten (emsdk) | 6.0.13 (`emcc` commit e13ee988ce3d), installed in `~/emsdk` | | | [Emscripten releases on GitHub](https://github.com/emscripten-core/emscripten/releases/tag/6.0.13): 6.0.13 is tagged "Latest", published 19 Oct 2026; `emsdk list` shows 6.0.13 as the newest installable. A test program compiled with `emcc` and ran under Node | 2026-11-01 |
| Node.js (CI only, runs WebAssembly tests) | 24.19.0 (the copy bundled with emsdk) | | | [nodejs.org releases](https://nodejs.org/en/about/releases/) lists 26.13.0 as the latest LTS line. See note 2 | 2026-11-01 |
| Python | 3.13.7 (system `python3`, used by `.venv`) | | | [Python devguide, status of versions](https://devguide.python.org/versions/): 3.13 is security-only, 3.14 and 3.15 are in bugfix. See note 3 | 2026-11-01 |
| numpy | 2.5.4 | | | `pip index versions numpy` (PyPI): latest stable; `pip install -r requirements.txt` installed this version | 2026-11-01 |
| pandas | 3.1.0 | | | `pip index versions pandas` (PyPI), same check | 2026-11-01 |
| matplotlib | 3.11.2 | | | `pip index versions matplotlib` (PyPI), same check | 2026-11-01 |
| pytest | 9.2.0 | | | `pip index versions pytest` (PyPI), same check | 2026-11-01 |
| Chart.js (CDN, with SRI hash) | | | | Checked in K-27 | |

**Notes (decisions for the freeze in K-18; nothing here is changed yet).**

1. **Make 3.81 is old.** CI on Linux will probably have a newer GNU Make (not yet checked). Until K-18, write the Makefile so it also works with 3.81 (no features added after it) and let CI catch differences. Whether to use Homebrew's newer GNU Make instead is to be decided at K-18.
2. **Node differs from the current LTS.** The latest LTS on nodejs.org is 26.x, while emsdk bundles 24.19.0. The PRD asks for the current Active LTS for CI. Decide at K-18 whether CI uses the latest LTS and whether the laptop's `run_wasm.mjs` runs need the same one; the check in K-21 compares outputs, so a difference would show up.
3. **Python 3.13 is security-only.** The PRD allows "bugfix or security support", so 3.13.7 is acceptable. The [python.org release announcement of 21 Oct 2026](https://blog.python.org/2026/10/python-3151-3149-31317/) reports newer patch releases (3.13.17, 3.14.9, 3.15.1) that bundle pip 26.2.2 because of a certificate security incident; this laptop's `.venv` has pip 25.2 (pip itself reported 26.2.2 as available). Decide at K-18 whether to move to a bugfix line (3.14) and upgrade pip, then freeze the same version on both laptops and in CI.
4. **Advisories.** No security advisory lookup was done for numpy, pandas, matplotlib or pytest in this issue. The PRD schedules `pip-audit` before the final submission; K-18 should run it once at the freeze.

**Freeze record.** Gate 2 freeze date: ____ · Lock file: `requirements.lock.txt` · Last `pip-audit` run: ____
