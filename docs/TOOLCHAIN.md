# APRM: Toolchain

Frozen tool versions for each laptop and for CI. **This table stays empty until each version has been verified from its official source** (PRD "Version safety rule"). Fill it in K-01 and freeze it at Gate 2 (K-18). After the freeze, upgrade only when a bug forces it, both members together, and update the CI workflow in the same PR.

Never write a version here from memory. For each row, record where it was checked and when.

| Tool | Krishna's laptop | Ahaana's laptop | CI (GitHub Actions) | Verified from | Date checked |
| --- | --- | --- | --- | --- | --- |
| Operating system / WSL2 Ubuntu | | | | | |
| GCC | | | | | |
| Clang (Mac: Xcode command line tools) | | | | | |
| GNU Make | | | | | |
| Emscripten (emsdk) | | | | | |
| Node.js (CI only, runs WebAssembly tests) | | | | | |
| Python | | | | | |
| numpy | | | | | |
| pandas | | | | | |
| matplotlib | | | | | |
| pytest | | | | | |
| Chart.js (CDN, with SRI hash) | | | | | |

**Freeze record.** Gate 2 freeze date: ____ · Lock file: `requirements.lock.txt` · Last `pip-audit` run: ____
