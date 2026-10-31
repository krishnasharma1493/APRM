/*
 * policy.h: how a policy orders waiting jobs (BLUEPRINT 3.2, issue K-09).
 *
 * A policy is a compare function: it says which of two waiting jobs is
 * served first. K-09 provides FCFS only; the other policies add their own
 * compare in K-19 and later. Pure functions: no state, no I/O.
 */
#ifndef APRM_POLICY_H
#define APRM_POLICY_H

#include "job.h"

/* Returns <0 if a is served before b, >0 if after, 0 only when a and b are
 * the same job. Every policy compare must end with the arrival-then-id
 * tie-break (D8) so the order is total and deterministic. */
typedef int (*PolicyCompare)(const Job *a, const Job *b);

/* FCFS: earlier arrival first, then lower id. Priority is ignored.
 * O(1) time and space. */
int policy_fcfs_compare(const Job *a, const Job *b);

/* The compare for a policy, or NULL if that policy is not implemented yet
 * (or kind is unknown). O(1). The returned pointer is a function, not owned
 * memory. */
PolicyCompare policy_compare_for(PolicyKind kind);

#endif /* APRM_POLICY_H */
