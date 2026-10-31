/*
 * policy.c: policy compare functions (see policy.h).
 * No globals, no static mutable state, no I/O.
 */
#include <stddef.h>
#include "policy.h"

/* See policy.h. Earlier arrival, then lower id. O(1). */
int policy_fcfs_compare(const Job *a, const Job *b)
{
    if (a->arrival != b->arrival) return a->arrival < b->arrival ? -1 : 1;
    return (a->id > b->id) - (a->id < b->id);
}

/* See policy.h. O(1). */
PolicyCompare policy_compare_for(PolicyKind kind)
{
    switch (kind) {
    case POL_FCFS: return policy_fcfs_compare;
    default:       return NULL;  /* priority, sjf, aging, reserve, knapsack: later issues */
    }
}
