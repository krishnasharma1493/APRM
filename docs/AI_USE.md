# APRM: AI use log

Every use of an AI assistant that produced something we kept. One row per piece of work (usually one issue or PR). The last column is the owner's honest answer: if it is "no", the work is not ready to merge (PRD §9: never merge code you cannot explain line by line).

| Date | Member | Issue | What was asked | What was kept | Owner can explain it (yes/no) |
| --- | --- | --- | --- | --- | --- |
| 2026-10-31 | Krishna | Setup (Steps 0–2) | Claude Code: organise the repo, read PRD/BLUEPRINT and the papers, report conflicts, then write the project docs and scaffolding | Folder layout; ownership and decision updates in PRD.md and BLUEPRINT.md; summary CSV contract and sample files; CLAUDE.md, BACKLOG.md, DECISIONS.md, RESEARCH_NOTES.md, TOOLCHAIN.md, AI_USE.md, README.md, .gitignore, GitHub templates | to confirm |
| 2026-11-01 | Krishna | K-07 | Autonomous run: write the four FCFS golden cases and worked timelines; a second AI session independently re-derived the schedules | Four cases, expected files, README timelines (draft PR #54) | to confirm; Ahaana's paper check pending |
| 2026-11-01 | Krishna | K-01 | Autonomous run: verify tool versions against official sources, record them in TOOLCHAIN.md, write requirements.txt; independent AI review of the PR | requirements.txt, Krishna's TOOLCHAIN.md column and notes (PR #55) | to confirm |
| 2026-11-01 | Krishna | K-02 | Autonomous run: Makefile, config.h, job.h, test helpers; independent AI review | PR #56 as merged (plus literal MIN checks from the review) | to confirm |
| 2026-11-01 | Krishna | K-03 | Autonomous run: generic binary heap and tests; independent AI review with mutation testing | PR #57 as merged | to confirm |
| 2026-11-01 | Krishna | K-04 | Autonomous run: JSON writer, JsonBuf design (D53), UTF-8 handling after review; independent AI review | PR #58 as merged | to confirm |
| 2026-11-01 | Krishna | K-05 | Autonomous run: CSV reader and writer; independent AI review | PR #59 as merged | to confirm |
| 2026-11-01 | Krishna | K-06 | Autonomous run: GitHub Actions workflow with versions verified against official releases; independent AI review | PR #60 as merged | to confirm |
| 2026-11-01 | Krishna | K-08 | Autonomous run: engine lifecycle (PR #61, not merged); two independent AI reviews | Branch k/K-08-engine-lifecycle, decisions D54/D55 | to confirm |
| 2026-11-01 | Krishna | K-14 | Autonomous run: seeded workload generator and experiment parameters (PR #62, not merged); independent AI review | Branch k/K-14-gen-workload, decisions D56-D58 | to confirm |
| 2026-11-01 | Krishna | K-17 | Autonomous run: hand-worked golden cases for every policy; independent AI re-derivation | PR #63 (not yet merged) | to confirm; Ahaana's paper check pending |
| 2026-11-01 | Krishna | K-09 | Autonomous run: event loop, invariant checker, decision D59; independent AI review with differential and mutation testing | PR #64 (not yet merged) | to confirm |
| 2026-11-01 | Krishna | K-10 | Autonomous run: event log, decision D60, skip-log bound after review; independent AI review (fuzz, fault injection, mutation) | PR #65 as merged | to confirm |
| 2026-11-01 | Krishna | K-11 | Autonomous run: metrics and JSON outputs, decisions D61-D63; independent AI review (reference arithmetic, mutation) | PR #66 (not yet merged) | to confirm |
| 2026-11-01 | Krishna | K-12 | Autonomous run: console program, atomic outputs, golden and CLI test runners; independent AI review | PR #68 (stacked; not yet merged) | to confirm |
| 2026-11-01 | Krishna | K-13 | Autonomous run: WebAssembly exports, build, Node tests, CI job, decision D64; independent AI review incl. real-browser check | PR #67 (stacked; not yet merged) | to confirm |
| 2026-11-01 | Krishna | K-15 | Autonomous run: experiment runner; independent AI review | PR #70 (stacked; not yet merged) | to confirm |
| 2026-11-01 | Krishna | K-16 | Autonomous run: invariant property checker; independent AI review with differential and mutation testing | PR #71 (stacked; not yet merged) | to confirm |
| 2026-11-01 | Krishna | K-23 | Autonomous run: website shell (index.html, wasm.js, store.js, app.js), Node tests with fake DOM; independent AI review with mutation testing; file:// checked in headless Chrome | PR #72 | to confirm |
| 2026-11-01 | Ahaana (owner) | A-01 | Written by Claude Code at Krishna's request: tools/plot_figures.py hello figure, tests, docs/AHAANA_GUIDE.md; independent AI review found a crashing exercise answer and a wrong confidence-interval explanation, both fixed | PR #74 | awaiting Ahaana's reading |
| 2026-11-01 | Krishna | K-18 | Run-owner-authorised freeze: PRD §5 marker, TOOLCHAIN CI column from real CI logs, lock file, pinned emsdk; D65; independent AI review found wording and unmet-box issues, fixed | PR #75 (not yet merged) | to confirm |
| 2026-11-01 | Ahaana (owner) | A-02 | Written by the assistant at Krishna's request: shared figure style; independent AI review found tests that did not pin colours, fixed | PR #76 | awaiting Ahaana's reading |
| 2026-11-01 | Krishna | K-19 | Priority, SJF and aging policies; independent AI review with a reference simulator (3000 workloads) and mutation testing; CI wasm tests fixed | PR #77 | to confirm |
| 2026-11-01 | Krishna | K-20 | Summaries for E1 to E3 (summarize.py); independent AI review recomputed intervals against scipy, found a missing decision entry (D67) and unpinned t constants, fixed | PR #80 | to confirm |
| 2026-11-01 | Krishna | K-22 | Six presets; settles O-9 as D66; independent AI review ran every preset under all policies | PR #79 | to confirm |
| 2026-11-01 | Krishna | K-24 | Website Build mode; independent AI review fuzzed the JS CSV validator against the C reader (3000 files) | PR #81 | to confirm |
| 2026-11-01 | Krishna | K-25 | Website Run mode (player, canvas, why log); D69; review found a stale add-job form, fixed | PR #84 | to confirm |
| 2026-11-01 | Krishna | K-26 | Reservation (EASY backfilling), D68; independent reference simulator matched on 6000 workloads | PR #82 | to confirm |
| 2026-11-01 | Krishna | K-28 | E5 summary writer and full E5 run; review recomputed all 10 rows | PR #85 | to confirm |
| 2026-11-01 | Krishna | K-21 | Conformance script console vs WebAssembly; mutation-tested, CI step added | PR #86 | to confirm |
| 2026-11-01 | Krishna | K-29 | Aging-order and starvation-bound checks, D70; brute-force checker agreed on 1500 runs and 2239 perturbations | PR #87 | to confirm |
| 2026-11-01 | Ahaana (owner) | A-03 | Written by the assistant at Krishna's request: E1 to E3 figures and guide section | PR #78 | to confirm |
| 2026-11-01 | Ahaana (owner) | A-04 | Written by the assistant at Krishna's request: E5 figure and guide section | PR #83 | to confirm |
| 2026-11-01 | Krishna | K-27 | Compare mode with lazily loaded Chart.js (version and hash re-verified independently by the reviewer); review forced lazy loading | PR #88 | to confirm |
| 2026-11-01 | Ahaana (owner) | A-05 | Written by the assistant at Krishna's request: one command for every figure; tests tightened after review | PR #89 | to confirm |
| 2026-11-01 | Krishna | K-30 | Hardening review: docs/HARDENING.md, make hardening (fuzz, allocation-failure injection, stress); independent AI review found the harness could not fail, fixed, plus website error cap, engine start timeout, exclusive temp file | PR #90 | to confirm |
| 2026-11-02 | Krishna | K-38 | Timing benchmark tools/bench_timing.py writing timing.csv; log-log slope note | K-38 PR | to confirm |
| 2026-11-02 | Krishna | K-43 | Website redesign 1: design tokens and components, copy.js, motion.js, keys.js, step shell with Show details switch; contrast, copy and keyboard tests; PRODUCT.md and the design doc | K-43 PR (#100) | to confirm |
| 2026-11-02 | Krishna | K-44 | Website redesign 2: Build page (example tiles, plain labels, disclosure, toasts); tests updated for tiles | K-44 PR (#101) | to confirm |
| 2026-11-02 | Krishna | K-45 | Website redesign 3: Run page (resource strip, plain policy names and labels, reservation card, 10 job colours with labels and hatch, dock, Why kind labels); tests extended incl. real-engine number checks | K-45 PR (#102) | to confirm |
| 2026-11-02 | Krishna | K-46 | Website redesign 4: Compare page (verdict sentence, best marks, exact best order and gaps from the exact solver, plain names, copy); tests extended incl. real-engine check | K-46 PR (#103) | to confirm |
| 2026-11-02 | Krishna | K-47 | Website redesign 5: layout, keyboard and media-preference checks (tests/demo/check_layout_cdp.mjs), file-input overflow fix, meter animated with transform, DESIGN.md, final screenshots; PRD §10 checklist rehearsal re-run | K-47 PR (#104) | to confirm |
| 2026-11-02 | Krishna | K-48 | Website: day and night button (store theme, top-bar button, saved choice, redraw of canvas and charts); tests and browser check extended | K-48 PR (#110) | to confirm |
| 2026-11-02 | Krishna | K-49 | PR 1: website rule change (D76) in CLAUDE.md, PRD, BLUEPRINT, DESIGN.md, PRODUCT.md; K-49 issue and backlog entry | K-49 PR 1 (#113), issue #112 | to confirm |
| 2026-11-02 | Krishna | K-49 | PR 2: planning-board direction contract (Impeccable seed f916d9cf, chosen by Krishna), PRODUCT.md jobs and viva questions, ranked findings | K-49 PR 2, issue #112 | to confirm |
| 2026-11-02 | Krishna | K-49 | PR 3: `make web` single-file offline build (web/build.mjs), Chart.js 4.5.1 bundled from npm with lockfile, CI build and offline rehearsal, docs (D77, D78) | K-49 PR 3, issue #112 | to confirm |
| 2026-11-02 | Krishna | K-49 | PR 4: Build page and top bar in the planning-board world (no nested cards, tile racks from real job data, phone job cards, compact top bar, one page CSS layer) | K-49 PR 4, issue #112 | to confirm |
| 2026-11-02 | Krishna | K-49 | PR 5: Run page as the planning board (lanes, cards, now rail, waiting tray, card flight, why-log labels); tests rewritten for the board | K-49 PR 5, issue #112 | to confirm |
