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
