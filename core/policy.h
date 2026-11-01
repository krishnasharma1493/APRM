/*
 * policy.h: how a policy orders waiting jobs (BLUEPRINT 3.2, issue K-09).
 *
 * A policy is a compare function: it says which of two waiting jobs is
 * served first. FCFS (K-09), static priority, SJF, adaptive aging (K-19) and
 * aging with a reservation (K-26, the same order as aging) are built; knapsack
 * comes later. Pure functions: no state,
 * no I/O, integers only (no floating point in any decision, D13).
 *
 * Aging (BLUEPRINT 3.3) keeps a fixed integer key per job, computed once at
 * arrival: K = 1000 * priority - alpha_milli * arrival (larger = better). The
 * engine stores -K in the waiting entry (smaller = served first), so the heap
 * is never re-sorted as time passes; the compare for aging is only the final
 * arrival-then-id tie-break.
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

/* Static priority: larger priority first, then earlier arrival, then lower id.
 * O(1) time and space; integers only. */
int policy_priority_compare(const Job *a, const Job *b);

/* SJF: smaller duration first, then earlier arrival, then lower id. Priority
 * is ignored. O(1) time and space; integers only. */
int policy_sjf_compare(const Job *a, const Job *b);

/* Aging order among jobs with equal key: earlier arrival, then lower id. The
 * key itself is policy_wait_key. O(1). */
int policy_aging_compare(const Job *a, const Job *b);

/* The aging key K = 1000 * priority - alpha_milli * arrival, larger = better,
 * written to *key. Returns APRM_OK, APRM_INVALID_ARGUMENT (NULL pointer) or
 * APRM_INVALID_FIELD (priority, arrival or alpha_milli outside PRD section 3,
 * so the arithmetic is checked rather than assumed). Inside the limits
 * |K| <= 9000 + 10^4 * 10^9 ~ 10^13, far inside int64. O(1); nothing is
 * allocated. */
int policy_aging_key(const Job *j, int64_t alpha_milli, int64_t *key);

/* The key the engine stores in a waiting entry (smaller = served first):
 * -K for POL_AGING, 0 for every other policy (their order is the compare
 * function alone). Returns what policy_aging_key returns. O(1). */
int policy_wait_key(PolicyKind kind, int64_t alpha_milli, const Job *j, int64_t *key);

/* The compare for a policy, or NULL if that policy is not implemented yet
 * (or kind is unknown). O(1). The returned pointer is a function, not owned
 * memory. */
PolicyCompare policy_compare_for(PolicyKind kind);

#endif /* APRM_POLICY_H */
