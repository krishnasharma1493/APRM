# Review notes (autonomous run)

One entry per reviewed pull request: what the reviewer checked, what it found, and what changed as a result.

| PR | Issue | Reviewer verdict | Findings and fixes |
| --- | --- | --- | --- |
| #54 | K-07 | Approve | Reviewer derived all 4 schedules by hand before reading expected files: identical. Paper check by Ahaana deferred to K-17 (stated openly in PR, issue files and README). |
| #55 | K-01 | Approve | Read-only reviewer. Cleanups applied: soften the Make note (decision left to K-18), source the pip/certificate claim, tick verified boxes, refresh the PR body. Open item (Ahaana's laptop) openly deferred to A-01. |
| #56 | K-02 | Approve | Reviewer re-ran all targets under Make 3.81 and Apple clang. Optional suggestion applied: literal checks for the *_MIN constants. Not covered locally: real GCC (gcc is Apple clang here). |
| #57 | K-03 | Approve | Reviewer mutated heap.c 8 ways (sift directions, build, pop, peek, tie-break): all caught. Gap closed before merge: >64-byte element test, multiset checks. Not covered: a real malloc/realloc returning NULL (tested via size-overflow cases only). |
| #58 | K-04 | Approve after fix | Must-fix: invalid UTF-8 passed through, producing invalid JSON. Fixed (per-byte U+FFFD, RFC 3629 validation, tests, strict-parse check). Also added: second top-level value rejected, balance checker in tests. Follow-up review of the fix after merge: pending. |
| #59 | K-05 | Approve | Reviewer fuzzed ~28 adversarial inputs under ASan/UBSan; mutations in overflow check and column count caught. Notes: whole-line errors read "Line N: ..." (no column); -9223372036854775808 reported as too large (PARSE_ERROR). |
