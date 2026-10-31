## Issue

Closes #<number> (<ID>: <title>)

## What changed

-

## How it works (plain English, for the viva)

The idea in a few sentences, the main steps, the invariants it keeps, time and space complexity, and the edge cases it handles. Write it so the owner can say it aloud without notes.

## Tests

- [ ] Tests written with or before the code (list the new tests below)
- [ ] `make test` passes
- [ ] `make sanitize` passes with zero reports (C changes)
- [ ] `pytest tests/py` passes (Python changes)
- [ ] No new compiler warnings
- [ ] Website checked by hand in loading, empty and error states, from `file://` (web changes)

New or changed tests:

-

## Contracts

- [ ] API or CSV contract changed (PRD §5). If ticked: PRD §5 was updated first, the change was approved, and Ahaana has reviewed it
- [ ] Summary CSV format changed (PRD §5 "Summary CSV formats"). If ticked: `data/sample_summaries/` updated and Ahaana has reviewed it
- [ ] Golden case added or changed. If ticked: Ahaana checked it by hand on paper
- [ ] New decision or answered open question recorded in `docs/DECISIONS.md`
- [ ] Any version number added was verified from its official source (say where)

## Checklist

- [ ] The issue's "Done when" boxes are all ticked
- [ ] Only what the issue asks for; no Nice-to-have work before Must-haves are done
- [ ] `docs/AI_USE.md` updated
- [ ] Author can explain every line of this change
- [ ] Reviewer can explain this change
