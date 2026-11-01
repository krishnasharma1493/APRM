---
name: Task
about: One backlog issue (K-xx or A-xx). Copy its text from docs/BACKLOG.md and fill every section.
title: "<ID>: <Short title>"
labels: []
assignees: []
---

# <ID>: <Short title>

| Field | Value |
| --- | --- |
| Owner | Krishna / Ahaana |
| Gate | 1–5 |
| Type | C / Web / Python / CI / Docs |
| Priority | Must-have (M-number) / Nice-to-have (N-number) |
| Plan first | Yes / No |
| Depends on | Issue IDs that must be merged first (or None) |
| Blocks | Issue IDs waiting on this one |
| Estimated size | S (under 2 h) / M (half a day) / L (1–2 days) |

## 1. Goal
Two or three sentences in plain English: what this builds and why the project needs it.

## 2. Background
The specification text this issue needs, copied from PRD.md / BLUEPRINT.md with the section named ("From BLUEPRINT §3.5: …"). Formulas, rules and definitions in full.

## 3. Scope
**In scope:**
-

**Out of scope:** (tempting things not to do here, and the issue that does them)
-

## 4. Files
| Path | Create / modify | Purpose |
| --- | --- | --- |

## 5. Specification
Exact interfaces: signatures, structs, enums, or Python/JS functions; JSON shapes and CSV columns from PRD §5; limits and defaults from PRD §3; error codes this issue can return, and when.

## 6. Step-by-step tasks
1.

## 7. Tests to write
| Test name | What it checks | Expected result |
| --- | --- | --- |

## 8. Acceptance criteria (Done when)
- [ ]

## 9. How to verify
Exact commands and what a pass looks like.

## 10. Viva notes
The idea, invariants, time and space complexity, why this design over alternatives, and one likely examiner question with a one-sentence answer.

## 11. Pitfalls
-

## 12. Assistant prompt
```
Read CLAUDE.md, then this issue (#<number>) in full.
```

## 13. Definition of done
- [ ] All section 8 boxes ticked
- [ ] make test passes (C: also make sanitize)
- [ ] pytest tests/py passes (Python changes)
- [ ] No new compiler warnings
- [ ] PR filled in from the template, with the plain-English explanation
- [ ] docs/AI_USE.md updated
- [ ] CI green, PR squash-merged and issue closed
