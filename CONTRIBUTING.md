# Contributing

APRM is a two-person course project. The rules below keep `main` green and every line explainable in the viva.

## Workflow

1. Pick one issue from [`docs/BACKLOG.md`](docs/BACKLOG.md) (the master list; GitHub issues are copies). Do Must-have issues before Nice-to-have ones.
2. Branch from the latest `main`: `k/<id>-<topic>` for Krishna's issues, `a/<id>-<topic>` for Ahaana's. Never commit on `main`.
3. Write the tests with or before the code. Commit in small steps, present tense, one idea each.
4. Run the checks for what you changed:
   - C: `make test` and `make sanitize`; `make hardening` for input handling
   - Website: `make wasm && make web && make web-test`
   - Python: `pytest tests/py`
5. Open a pull request from [`.github/pull_request_template.md`](.github/pull_request_template.md): "Closes #<issue>", every "Done when" box ticked with evidence, and a plain-English "How it works". Add a line to [`docs/AI_USE.md`](docs/AI_USE.md) if an AI assistant helped.
6. A reviewer checks the PR against the issue, the rules below and the contracts in `docs/PRD.md` §5. It is squash-merged once the review approves and CI is green. Never merge red, never force-push to `main`.

## Rules that are never broken

- Every scheduling decision is made in `core/`. JavaScript and Python never choose which job runs.
- `core/` is C11 with the standard library only: no file I/O, no printing, no global or static mutable state.
- Output is deterministic: ties go to the earlier arrival, then the lower id. No floating point in decisions.
- C compiles with `-std=c11 -Wall -Wextra -Werror`. Use `snprintf` only. Check every allocation and overflow-check time arithmetic.
- The API, CSV and summary formats in `docs/PRD.md` §5 are frozen. A change needs Krishna's explicit approval.
- Never write a tool version from memory: check the official source and record it in `docs/TOOLCHAIN.md`.
- Never commit build output, `results/`, virtual environments or tool folders (see `.gitignore`).

Decisions and open questions go in [`docs/DECISIONS.md`](docs/DECISIONS.md).
