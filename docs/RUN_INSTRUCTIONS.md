# Autonomous run instructions

Saved verbatim from Krishna's message of 2026-11-01 so that a later session can resume the run. **The original message was cut off mid-sentence at the end** (see "Golden cases" below). The section "Orchestrator notes" at the bottom is not part of the original text.

---

# Autonomous run: build the APRM backlog with parallel subagents

You are the ORCHESTRATOR. Work through the GitHub issues in backlog order, starting from K-01. For each issue: implement it, open a pull request, merge it when every check passes, and confirm the issue is closed. Use subagents to work on several independent issues at the same time. Keep going until usage runs out or nothing is left that you are allowed to do. Do not ask me for approval between issues.

First, save this entire prompt to docs/RUN_INSTRUCTIONS.md and commit it to main ("Add autonomous run instructions"), so a later session can resume from it.

## Overrides for this run (they take precedence over CLAUDE.md)

- You MAY merge pull requests yourself, but only when every merge condition below is met and the reviewer subagent has approved.
- Plan-first issues: do not wait for my approval. Post the plan as a comment on the issue, then implement it.
- Do not edit CLAUDE.md to reflect these overrides; they apply only to autonomous runs.

Everything else in CLAUDE.md still applies: hard rules, coding standards, the version safety rule, tests with every change, and no scheduling logic outside core/.

## Skills, plugins and tools

- Before starting, list the skills, plugins, MCP servers and subagent types available to you, and use any that fit a task (for example a GitHub integration, a C or testing skill, a frontend design skill).
- If a task would clearly benefit from a skill or plugin that is not installed, you may install it only from the tool vendor's official sources or a well-known official marketplace. Never install unverified third-party plugins or anything that asks for credentials. Log every installation in docs/PROGRESS.md.
- You may create project subagents in the assistant's project agents folder (commit them), for example:
  - c-implementer: C11 core work following PRD §5, §6 and BLUEPRINT §3;
  - web-implementer: the website per PRD §7–§8 and DESIGN.md (D76: bundled build, offline from file://);
  - python-implementer: tools/ and tests/py/;
  - reviewer: an independent, read-only review of a PR against its issue, CLAUDE.md, PRD §5 contracts and DECISIONS.md;
  - test-writer: tests and golden cases.

## Choosing issues

Before each round, run `gh issue list --state open` and read docs/PROGRESS.md (create it if missing).

Eligible issues:
1. Krishna's issues (K-xx) whose dependencies are all closed, in backlog order.
2. An Ahaana issue (A-xx) is eligible ONLY if an eligible or upcoming K-xx issue depends on it. Note in its PR: "Done by the assistant because it blocked K-xx."
3. Never take an Ahaana issue that blocks nothing of Krishna's. Leave it open for her.
4. Skip the Gate tracker issues. When all issues in a gate are closed, tick the tracker's boxes, run the gate check from the milestone description, close the tracker and push the tag gate-N.
5. Stay in the earliest gate that still has eligible work. Move to a later gate only when everything left in the earlier gate is blocked or skipped.

## Running issues in parallel

- Each round, pick up to 3 eligible issues that can safely run together:
  - none depends on another;
  - their "Files" sections (section 4) do not overlap;
  - none changes shared files: Makefile, .github/workflows/, core/job.h, core/config.h, PRD.md, BLUEPRINT.md, DECISIONS.md.
  Issues touching shared files run alone. If fewer issues are safe, run fewer; one at a time is fine.
- Give each issue to its own subagent in its own Git worktree: `git worktree add ../aprm-<ID> -b <branch> origin/main`.
- Hand the subagent: the full issue text, CLAUDE.md, the relevant PRD and BLUEPRINT sections, these run rules, and the per-issue steps below. Subagents must NOT merge, must NOT edit docs/PROGRESS.md, docs/REVIEW_NOTES.md or docs/AI_USE.md, and must NOT touch other worktrees.
- Only you, the orchestrator, merge, and only one PR at a time. Before merging each PR, update its branch on the latest main (rebase or merge main into it), re-run its checks, and resolve simple conflicts. If a conflict is not simple, send the issue back to a subagent to redo on the new main.
- After a round, remove finished worktrees (`git worktree remove`) and start the next round.

## Per-issue steps (done by the subagent)

1. Read the issue in full: all 13 sections. Follow section 12's instructions, except where the overrides above change them.
2. Plan-first issues: post the plan as an issue comment (files, functions, data structures, tests, complexity), then continue.
3. Write tests first, then implement in small commits with clear messages.
4. Run every verification command from section 9, plus `make test`, `make sanitize` for C changes, and `pytest tests/py` for Python changes. Fix until everything passes.
5. Push the branch and open a PR with `gh pr create`:
   - title "<ID>: <title>";
   - body filled in from .github/pull_request_template.md, containing "Closes #<issue number>";
   - every section 8 box ticked with evidence;
   - a plain-English "How it works" section.
6. Report back to the orchestrator: PR number, check results, anything uncertain.

## Review and merge (done by the orchestrator)

1. Run the reviewer subagent on the PR. It checks:
   - the code against the issue's acceptance criteria, CLAUDE.md hard rules, PRD §5 contracts, DECISIONS.md and the version safety rule;
   - tests were added and none was weakened or removed;
   - no scheduling logic outside core/.
   It posts its findings as a PR comment. If it requests changes, send them back to an implementer subagent, then review again.
2. Wait for CI with `gh pr checks <PR> --watch` (if no CI workflow exists yet, local checks are enough).
3. Merge with `gh pr merge <PR> --squash --delete-branch`.
4. Confirm the issue is closed (`gh issue view <N>`). If it is still open, close it with a comment linking the PR.
5. `git checkout main && git pull`, then update docs/PROGRESS.md, docs/REVIEW_NOTES.md and docs/AI_USE.md, and commit on main ("Update progress after <IDs>"). Push.

## Merge conditions (all must be true)

- Every section 8 acceptance box is genuinely met; none is ticked without verification.
- The reviewer subagent approved.
- All local checks pass and CI is green (or there is no CI yet).
- No change to the PRD §5 API or CSV contracts, or to anything in DECISIONS.md.
- No version numbers written from memory; any version added was verified as the version safety rule requires.
- No test was weakened, skipped or deleted to make things pass.

If a condition cannot be met, do NOT merge:
- leave the PR open as a draft;
- comment exactly what is blocking it;
- add the label needs-krishna;
- continue with other issues that do not depend on it.

## When to skip an issue

Skip it (comment on the issue, add the label needs-krishna, log it in docs/PROGRESS.md, continue) if it needs any of these:
- a password, sudo, or installing system software you cannot install yourself (for example emsdk or WSL setup);
- a decision listed as open in DECISIONS.md (O-1, O-2, …) that the issue does not settle itself;
- a change to the frozen contract;
- a human action (for example Ahaana checking golden cases on paper, or recording the demo video).

Golden cases: write them as the issue says, mark

[message ends here: truncated when pasted]

---

## Orchestrator notes (not part of the original text)

- Commit messages and PR bodies carry no AI tool name, co-author trailer or "Generated with" line. Krishna's standing rule: no AI name anywhere in the repo.
- The cut-off sentence is not guessed. Until Krishna supplies the rest, a golden case is written as its issue says but is never merged without Ahaana's recorded paper check; its PR stays a draft labelled `needs-krishna`.

---

## Continuous mode (added 2026-11-01; overrides the sections above where they differ)

Scope: do EVERY open issue in backlog and gate order, including Ahaana's (A-xx) issues. Use parallel subagents in worktrees as described above.

**Ahaana's issues (A-xx):** write the code as the issue's section 12 says (simple Python, pandas and matplotlib only, short functions, a comment on every block, reading only summary CSVs). Add the label `done-by-assistant`. For each, add a section to `docs/AHAANA_GUIDE.md` that teaches the code: what each function does, how to run it, how to read each figure, and 3 small exercises. Leave her as owner.

**Special issues:** K-18: try to resolve it (emsdk installs without sudo; verify versions from official sources); if something truly needs a human, do every other part and list the exact commands under "Needs Krishna" in docs/PROGRESS.md. K-31: simulate a fresh clone in a temp folder following only the README; record steps, time and problems; fix the README. K-32: do everything except recording (checklist, `docs/DEMO_SCRIPT.md`, offline check), leave the recording under "Needs Krishna" and keep the issue open with a comment. Golden cases stay marked "awaiting Ahaana's paper check"; that does not block merging.

**Rules**
- A turn ends ONLY when a stop condition is true. Finishing an issue, merging, closing a gate or writing a summary is not one.
- After every merge, pick the next issue in the same turn.
- Do not ask questions. Choose the safest option the docs allow, record it under "Decisions made during autonomous run" in `docs/PROGRESS.md`, continue.
- A blocked issue never stops the run: label it `needs-krishna`, log it, continue.
- No long summaries between issues: one line in `docs/PROGRESS.md`.
- If CI takes more than 10 minutes, work on another issue and return.
- Keep context small; rely on `docs/PROGRESS.md` and `docs/REVIEW_NOTES.md`. Update "Currently working on" in `docs/PROGRESS.md` at each important step.

**Stop conditions**
1. Every open issue is done, or blocked only by something that needs Krishna.
2. main is broken and cannot be fixed safely.
3. `gh` is no longer authenticated.

On stopping: write the reason on the first line of `docs/PROGRESS.md`; for condition 1 create `.autorun/DONE`; commit and push; give one short report (issues merged, what needs Krishna with exact steps, a reminder that Ahaana should read `docs/AHAANA_GUIDE.md`).

`autorun.sh` restarts the session every 15 minutes until `.autorun/DONE` or `.autorun/STOP` exists.

### Merge conditions (clarified by Krishna, 2026-11-01)

- The only issue allowed to change PRD §5 is K-18 (contract freeze). Any later change needs Krishna.
- `a/*` PRs auto-merge under the same conditions as `k/*` PRs: reviewer subagent approval plus green checks. Keep the `done-by-assistant` label and the `docs/AHAANA_GUIDE.md` section.
- Avoid stacking on unmerged PRs. Merge first, then branch from the updated main, unless waiting would leave every subagent idle. When a stacked branch's base merges, merge main into the branch (or rebase), re-run its checks, then continue.
- Do not delete a base branch while another PR is stacked on it; retarget the dependent PR to main first (GitHub closes PRs whose base branch is deleted).
