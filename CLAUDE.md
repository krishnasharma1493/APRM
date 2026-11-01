# CLAUDE.md: APRM rules for every session

## Project
APRM (Adaptive Priority Resource Manager) is an ADA course project (B.Tech CSE, 3rd semester, University of Delhi). It is an online, non-preemptive job scheduler in C for one machine with two resources (CPU, memory). There is a console program, a website that runs the same C code compiled to WebAssembly, and Python tooling for workloads, experiments, checks and graphs. It is graded in a viva: each owner must explain every line of their part.

## Ownership
- **Krishna Sharma:** everything except the graphs. C core and every algorithm, WebAssembly build, website, CI, golden test cases, preset CSVs, and all non-graph Python (workload generator, experiment runner, metrics and statistics, summary CSVs, property checks, conformance checks, timing benchmarks).
- **Ahaana Arya:** `tools/plot_figures.py` only: report figures for E1–E6 from summary CSVs, figure styling and captions. She also hand-checks golden cases on paper and reviews PRs that change CSV formats, summary formats or figures (not C internals). Krishna reviews her plotting PRs.
- **Boundary:** Krishna's Python writes `results/summaries/*.csv` (formats in PRD §5 "Summary CSV formats"). Ahaana's script reads only those files (or `data/sample_summaries/`). It never runs experiments, calls the C program or computes statistics.

## Document map (read before working on an issue)
| Document | Holds |
| --- | --- |
| `docs/PRD.md` | Scope (§1A), repo layout (§2), config and limits (§3), architecture and invariants (§4), **API, CSV and summary contracts (§5)**, C and web checklists (§6, §8), CI (§9), testing (§10), demo (§10A) |
| `docs/BLUEPRINT.md` | **Algorithm specifications (§3)**, gates (§4), website spec (§5), experiments E1–E6 (§6), report outline (§7) |
| `docs/BACKLOG.md` | Ordered issues K-xx / A-xx with "Done when" boxes (master copy; GitHub issues are copies) |
| `docs/DECISIONS.md` | Every decision (D-numbers) and every open question (O-numbers) |
| `docs/RESEARCH_NOTES.md` | What each paper says and where we use it; glossary |
| `docs/TOOLCHAIN.md`, `docs/AI_USE.md` | Frozen versions; AI-use log |

**Which wins:** PRD.md over BLUEPRINT.md. BLUEPRINT §3 is the algorithm specification. DECISIONS.md records how conflicts were settled. Report any new conflict instead of choosing silently.

## Hard rules (always)
1. All scheduling logic lives in `core/`. JavaScript and Python never decide which job runs.
2. `core/` is pure C11 with the standard library only: no file I/O, no printing, no global or static mutable state. All state lives in the `Sim` struct.
3. Follow the API, CSV and summary contracts in PRD §5 exactly. They are frozen after Gate 2; to change them, ask first, update PRD §5 first, then code.
4. Only build what the current issue asks. No Nice-to-have work before all Must-haves are done.
5. Deterministic output: ties broken by earlier arrival, then lower id; identical results on GCC, Clang and WebAssembly. No floating point in scheduling decisions (aging key = `1000·b − alpha_milli·r`, int64).
6. C: compile cleanly with `-std=c11 -Wall -Wextra -Werror`; `snprintf` only; check every allocation; 64-bit time with overflow checks. Each function has a comment stating what it does, its complexity, and who owns any returned memory.
7. Website: plain HTML, CSS and classic `<script>` files on `window.APRM` (no ES modules, no `fetch`, no framework); works from `file://`; `textContent` never `innerHTML` for user, file, URL or engine text; loading, empty and error states everywhere.
8. Version safety: never write version numbers from memory into requirements files, CI, TOOLCHAIN.md or `<script>` tags. Web search and check the official registry first, pin CDN scripts with an SRI hash, and tell Krishna what you verified.
9. Never commit build output (`build/`, `*.o`, `web/vendor/aprm.js` except on the `demo-ready` tag), `results/`, `.venv/`, `__pycache__/` or editor caches.
10. If anything is unclear or seems wrong, ask instead of guessing, especially about algorithms. Open questions are listed in DECISIONS.md (O-numbers); never settle one silently.

## Working loop (every issue, one at a time)
1. Krishna names the issue (e.g. "K-03"). Read it in `docs/BACKLOG.md` (or its GitHub issue) and every PRD/BLUEPRINT section it references.
2. "(plan first)" issues (toolchain setup, engine lifecycle, event loop, reservation, knapsack, website run mode): write a short plan (files, functions, data structures, tests, complexity) and wait for approval.
3. Branch: `k/<id>-<topic>` for Krishna, `a/<id>-<topic>` for Ahaana. Never work on `main`.
4. Write tests with or before the code.
5. Implement in small commits (present tense, one idea each).
6. Run `make test` (plus `make sanitize` for C changes) and `pytest tests/py` for Python changes. Fix until green.
7. Explain the work in plain English for the viva: idea, steps, invariants, time and space complexity, edge cases.
8. Fill in the PR from `.github/pull_request_template.md`, tick the issue's "Done when" boxes, add a line to `docs/AI_USE.md`.
9. Merge automatically once CI is green (Krishna has authorised this; no need to ask):
   - Wait for the PR's checks: `gh pr checks <n> --watch`.
   - All required checks green: `gh pr merge <n> --squash --delete-branch --subject "<issue id>: <topic> (#<n>)" --body "<plain summary>"`. Always pass `--subject` and `--body` explicitly so GitHub does not pre-fill them from the commits.
   - The squash message must contain no `Co-Authored-By`, "Generated with" or other AI attribution lines.
   - A check fails: fix on the same branch and push again. Never merge red; never bypass checks (`--admin`, force-push to `main`).
   - Exception: do not merge `a/*` PRs or PRs that change PRD §5 contracts. Those wait for the named human reviewer (see Ownership).
   - After merging: `git checkout main && git pull`.

## Commands
| Command | What it does (PRD §3, §10) |
| --- | --- |
| `make` | Release build of the console program (`build/aprm`) |
| `make debug` | `-g` plus invariant checks after every engine step |
| `make sanitize` | Debug build with AddressSanitizer and UndefinedBehaviorSanitizer |
| `make test` | All C tests and golden cases |
| `make wasm` | `wasm/build.sh` → `web/vendor/aprm.js` |
| `make clean` | Remove build output |
| `pytest tests/py` | Property checks, conformance, summary-format checks, figure smoke test |
| `python tools/plot_figures.py` | Regenerate every figure into `docs/report/figures/` |
| `build/aprm --policy aging --in jobs.csv --out results.csv` | Run the console program |

## Coding standards
- **C (PRD §6, §11.1):** validate every input against PRD §3 before touching state; validate first, then modify; return PRD §5 error codes; `snprintf` only, never `sprintf`/`strcpy`/`strcat`; check every `malloc`/`realloc`; overflow-check `start + duration` and resource sums; JSON writer escapes every string; every compare ends with the arrival-then-id tie-break; `assert`-based tests in `tests/c/test_<module>.c`.
- **Invariants:** the PRD §4 list is the reference; debug builds check all of it after every step.
- **Website (PRD §7, §8):** colours as CSS variables with light and dark values; CSV upload ≤ 1 MB with every field validated and bad rows listed; URL hash size-limited and parsed in `try/catch`; no `eval`, `new Function` or inline handlers; steps per frame capped; Chart.js only in Compare mode, pinned with SRI, with a table fallback.
- **Python (PRD §11.3):** never schedules; every workload has an explicit, recorded seed; numpy, pandas, pytest; type hints and a docstring on every function; summaries exactly as PRD §5.
- **Golden cases:** `tests/cases/<case>.csv` + `<case>.<policy>.expected.csv`, worked by hand, re-checked on paper by Ahaana.

## Definition of done
- [ ] Every "Done when" box in the issue ticked, with evidence
- [ ] Tests written with or before the code; edge cases covered (empty, boundary, ties, overflow, invalid input)
- [ ] `make test` green; `make sanitize` clean for C changes; `pytest tests/py` green for Python changes
- [ ] No new compiler warnings; no `innerHTML`; no version numbers from memory
- [ ] PRD §5 contracts unchanged, or updated first with approval
- [ ] Any decision made is added to DECISIONS.md; any open question answered there
- [ ] PR filled in from the template, including the plain-English explanation
- [ ] `docs/AI_USE.md` updated
- [ ] Owner can explain every line; CI green; squash-merged by the assistant (except `a/*` and PRD §5 PRs, which wait for human review)

## Working with Ahaana (A-xx issues)
- Teach while building: explain each step before writing it, in simple language.
- Use only pandas and matplotlib, with short functions, clear names and a comment on every block. No clever one-liners, no classes unless needed, no extra libraries.
- One figure per function. Every figure has a title, labelled axes with units, a legend, and error bars or shaded 95% bands from the `ci_low` / `ci_high` columns.
- After each figure, explain how to read it and what it shows, so she can present it in the viva.
- Her code only reads summary CSVs (`data/sample_summaries/` until real ones exist in `results/summaries/`). It never computes statistics or runs experiments.
