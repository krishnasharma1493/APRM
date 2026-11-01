/*
 * policy.c: policy compare functions (see policy.h).
 * No globals, no static mutable state, no I/O.
 */
#include <stddef.h>
#include "config.h"
#include "policy.h"

/* See policy.h. Earlier arrival, then lower id. O(1). */
int policy_fcfs_compare(const Job *a, const Job *b)
{
    if (a->arrival != b->arrival) return a->arrival < b->arrival ? -1 : 1;
    return (a->id > b->id) - (a->id < b->id);
}

/* See policy.h. Larger priority first, then arrival, then id. O(1). */
int policy_priority_compare(const Job *a, const Job *b)
{
    if (a->priority != b->priority) return a->priority > b->priority ? -1 : 1;
    return policy_fcfs_compare(a, b);
}

/* See policy.h. Smaller duration first, then arrival, then id. O(1). */
int policy_sjf_compare(const Job *a, const Job *b)
{
    if (a->duration != b->duration) return a->duration < b->duration ? -1 : 1;
    return policy_fcfs_compare(a, b);
}

/* See policy.h. Arrival, then id. O(1). */
int policy_aging_compare(const Job *a, const Job *b)
{
    return policy_fcfs_compare(a, b);
}

/* See policy.h. O(1). */
int policy_aging_key(const Job *j, int64_t alpha_milli, int64_t *key)
{
    if (!j || !key) return APRM_INVALID_ARGUMENT;
    if (j->priority < APRM_PRIORITY_MIN || j->priority > APRM_PRIORITY_MAX ||
        j->arrival < APRM_ARRIVAL_MIN || j->arrival > APRM_ARRIVAL_MAX ||
        alpha_milli < APRM_ALPHA_MILLI_MIN || alpha_milli > APRM_ALPHA_MILLI_MAX)
        return APRM_INVALID_FIELD;
    /* Within the limits above: alpha_milli * arrival <= 10^4 * 10^9 = 10^13. */
    *key = 1000 * (int64_t)j->priority - alpha_milli * j->arrival;
    return APRM_OK;
}

/* See policy.h. O(1). */
int policy_wait_key(PolicyKind kind, int64_t alpha_milli, const Job *j, int64_t *key)
{
    int64_t k;
    int rc;
    if (!j || !key) return APRM_INVALID_ARGUMENT;
    if (kind == POL_KNAPSACK) { *key = POLICY_KEY_UNCHOSEN; return APRM_OK; }  /* not yet in a batch */
    if (kind != POL_AGING && kind != POL_AGING_RESERVE) { *key = 0; return APRM_OK; }
    rc = policy_aging_key(j, alpha_milli, &k);
    if (rc != APRM_OK) return rc;
    *key = -k;  /* the heap serves the smaller key first; |k| <= ~10^13, so -k is safe */
    return APRM_OK;
}

/* See policy.h. O(1). */
PolicyCompare policy_compare_for(PolicyKind kind)
{
    switch (kind) {
    case POL_FCFS:
    case POL_KNAPSACK: return policy_fcfs_compare;  /* pool order; the batch order is the key (K-34) */
    case POL_PRIORITY: return policy_priority_compare;
    case POL_SJF:      return policy_sjf_compare;
    case POL_AGING:
    case POL_AGING_RESERVE: return policy_aging_compare;  /* reserve = aging order + reservation (K-26) */
    default:           return NULL;  /* unknown kind */
    }
}
