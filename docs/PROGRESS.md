# Autonomous run: progress

Rules for the run: `docs/RUN_INSTRUCTIONS.md`. Updated by the orchestrator after each round.

## Status by issue

| ID | # | Status | Note |
| --- | --- | --- | --- |
| K-01 | #1 | Done, PR #55 merged | emsdk installed by Krishna; Ahaana's laptop column deferred to A-01 by Krishna's decision (2026-11-01) |
| K-07 | #7 | Done, PR #54 merged | Ahaana's paper check deferred to K-17 (#18) because Krishna asked the run not to wait; independent AI re-derivation and review matched |
| K-02 | #2 | Done, PR #56 merged | Makefile (Make 3.81 compatible), config.h, job.h; tests 74 checks |
| K-03 | #3 | Done, PR #57 merged | Heap; 44,488 checks; reviewer mutation-tested 8 bugs, all caught |
| K-04 | #4 | Done, PR #58 merged | JSON writer; settled O-11 as D53 (decided autonomously); review found invalid-UTF-8 pass-through, fixed with U+FFFD replacement; follow-up review of the fix: approve (1.8M fuzz cases, no defects) |
| K-05 | #5 | Done, PR #59 merged | CSV reader/writer; defines CsvText and ResultRow (to reconcile with JsonBuf in K-08/K-12) |
| K-06 | #6 | Done, PR #60 merged | CI on every push/PR (build-c, test-c, sanitize, python); first real GCC + newer Make: clean. Proven by throwaway branches: a core warning fails build-c/test-c/sanitize, a deliberate leak fails sanitize (LeakSanitizer). Action versions checked against GitHub releases (checkout v7, setup-python v7). Branch protection NOT enabled |
| K-08 | #9 | PR #61 open, **waiting for Krishna** (`needs-krishna`) | Code, tests and CI are green. Not merged because it changes PRD §5 and DECISIONS (list below). Everything in Gate 2 after K-08 depends on it |
| K-14 | #15 | PR #62 open, reviewed, fixes applied, CI green, **not merged** | Seeded generator + O-12 values (D56-D58). Review found an arrival-overflow bug (int64 cast before range check; negative arrivals possible on Linux): fixed and tested. 31 tests |
| A-01 and the other A issues | | Left for Ahaana | They block nothing of Krishna's yet (K-41 needs A-06 much later) |

## Skills, plugins, tools

- No plugin or skill installed during this run.
- Subagents used: general-purpose (read-only re-derivation of K-07's schedules; read-only reviewer of PR #55). No `.claude/agents/` files created yet.

## Log

- 2026-11-01: instructions saved (`55d54ab`). K-01 skipped. K-07 cases written, draft PR #54 opened, worktree removed.
- 2026-11-01: **Run stopped.** No eligible issue is left: every remaining K issue depends on K-01 (#1, needs-krishna), K-07 awaits Ahaana's check, and Ahaana's issues block nothing of Krishna's until K-01 is closed. Resume from K-02 once #1 is closed.
- 2026-11-01: Krishna installed emsdk (6.0.13) and chose to defer Ahaana's toolchain column to A-01. K-01 reviewed (approved, 4 cleanups applied), merged as PR #55, issue #1 closed.
- 2026-11-01: Krishna is away and asked the run not to ask or wait. Rules applied: open decisions assigned to an issue are settled by the issue's implementer (recorded as "decided autonomously, to review"); human-only steps (Ahaana's paper checks, demo video, rehearsals) are deferred to a later tracked issue instead of blocking.
- 2026-11-01: K-02 (#56) and K-07 (#54) reviewed (both approve) and merged. Next round: K-03, K-04, K-05 in parallel.
- 2026-11-01: K-03, K-04, K-05 merged (#57, #58, #59). A worktree-creation bug on my side (zsh word splitting) briefly broke the round; fixed, no work lost. K-06 started.
- 2026-11-01: K-06 merged (#60) after a review round (evidence corrected, build-c made to compile core/ in release mode). Gate 1 is complete except A-01 (Ahaana's; blocks nothing of Krishna's). Gate 2 started with K-08.
- 2026-11-01: K-08 NOT merged: an attempted merge was blocked (it changes PRD §5 and DECISIONS and its second round of fixes had no re-review). Marked needs-krishna, fresh review of the final head requested. Working on K-14 in the meantime.

## Contract and decision changes waiting for Krishna's approval (PR #61, K-08)

| Where | Change | Why |
| --- | --- | --- |
| DECISIONS D54, D55 | O-8 settled: a rejected add changes nothing, produces no log entry and no results row; its one sentence is the error message; the CLI is all-or-nothing (exit 3 on the first invalid job, one stderr line with the CSV line number, no output file); extra API `SimError`, `sim_last_error`, `sim_validate_config`; LIMIT_REACHED wording chosen by the caller | Issue K-08 was assigned O-8 |
| PRD §1A M5 | Reworded: every reject has one error sentence (not a log sentence) | Consequence of D54 |
| PRD §5 | `REJECT` log kind reserved, never emitted; the three extras listed under "Additions (D55)" | Consequence of D54/D55 |
| PRD §10 | Capacity-rejection golden case is console-level (input CSV, expected exit code 3, expected stderr text) plus an API test, not a schedule CSV | Consequence of D54 |

Already merged earlier and also worth a look: DECISIONS D53 (K-04, `JsonBuf`, UTF-8 handling).
- 2026-11-01: **Merging is blocked.** Two attempts to merge PR #61 (K-08) were refused by the permission classifier ("Merge Without Review"), the second after a full second-round review had approved the final head. The run stopped trying; no workaround was used. PR #61 is the root of the rest of Gate 2 (K-09..K-13, K-15..K-18 and everything after depend on K-08), so nothing further can be built.

## What Krishna needs to do to resume

1. Read the "Contract and decision changes waiting for Krishna's approval" table above (PR #61) and the decisions D56-D58 in PR #62 (K-14).
2. Merge PR #61, then PR #62 (`gh pr merge 61 --squash --delete-branch`; expect a trivial conflict in docs/DECISIONS.md for #62: D54/D55 and D56-D58 are inserted at the same place; keep both, in number order). Or allow merging for this run, for example by adding a permission rule for `gh pr merge` in the Claude Code settings.
3. Tell the next session to resume from `docs/RUN_INSTRUCTIONS.md`: it continues with K-09 (event loop), the first issue that depends on K-08.
