/*
 * knapsack.h: the knapsack batch selector of the `knapsack` policy
 * (BLUEPRINT 3.6, DECISIONS D19 to D23 and D72, issue K-34).
 *
 * At a window boundary the engine hands over the waiting jobs that may be
 * chosen (arrival <= gamma, duration <= gamma, in (arrival, id) order). Each
 * job has a volume v = p * (c / CPU_CAP + m / MEM_CAP) and a value
 * priority + 1. The selector solves the 0/1 knapsack "largest total value
 * whose volume is at most zeta = 2 * gamma" with the scaled DP of Ibarra and
 * Kim (CADP): with K = eps * zeta / n every size becomes floor(v / K), the
 * capacity floor(zeta / K) = floor(n / eps), and the DP is exact on those
 * integers. The value found is at least the true optimum, and the chosen set
 * has real volume at most (1 + eps) * zeta (Fan & Liang, Lemma 6.1:
 * each size loses less than K, n sizes lose less than n * K = eps * zeta).
 *
 * Integers only. The exact volume has a numerator near 2e21 (over int64), so
 * the scaled size is computed in a 128-bit value built from two uint64 words
 * and divided step by step (D72). The DP table is capped (APRM_KNAPSACK_TABLE_MAX
 * cells); above the cap the scale is coarsened, never refused (D72).
 *
 * Memory: the caller owns a KnapWork, reserves it with knapsack_work_reserve
 * BEFORE it changes anything, and knapsack_select never allocates (so the
 * engine step stays all-or-nothing). Pure functions apart from that scratch:
 * no globals, no I/O, no static mutable state.
 */
#ifndef APRM_KNAPSACK_H
#define APRM_KNAPSACK_H

#include <stddef.h>
#include <stdint.h>
#include "job.h"

/* One candidate. The caller fills job and src (any index it wants back);
 * knapsack_select fills size and take. */
typedef struct {
    Job job;
    size_t src;
    int64_t size;         /* scaled size floor(v / K); output */
    unsigned char take;   /* 1 = in the chosen set; output */
} KnapItem;

/* Scratch memory owned by the caller (the Sim). Zero-filled = empty. */
typedef struct {
    KnapItem *items;      /* cap_items entries */
    int64_t *dp;          /* cap_dp values */
    uint64_t *bits;       /* cap_bits words: the take table, n * (C + 1) bits */
    size_t cap_items, cap_dp, cap_bits;
} KnapWork;

/* How n items are scaled (see knapsack_plan). */
typedef struct {
    int64_t qnum, qden;   /* K = zeta / (qnum / qden): scaled size = floor(v * qnum / (qden * zeta)) */
    int64_t cells;        /* C = floor(qnum / qden): the scaled capacity */
    int64_t table;        /* n * (C + 1): bits in the take table, <= APRM_KNAPSACK_TABLE_MAX */
    int64_t eff_eps_milli; /* epsilon actually achieved, in thousandths, rounded up */
    int capped;           /* 1 if the table cap forced a coarser scale than eps asked for */
} KnapPlan;

/* What knapsack_select found. */
typedef struct {
    int64_t value;        /* total value of the chosen set */
    int64_t count;        /* how many items are chosen */
    KnapPlan plan;        /* the scale that was used */
} KnapResult;

/* Empty workspace, no allocation. O(1). */
void knapsack_work_init(KnapWork *w);

/* Free the workspace; it can be reused after knapsack_work_init. Safe on a
 * zeroed workspace. O(1). */
void knapsack_work_free(KnapWork *w);

/* Make the workspace large enough to solve any batch of at most n items with
 * epsilon eps_milli (n up to APRM_KNAPSACK_N_MAX). Returns APRM_OK,
 * APRM_INVALID_ARGUMENT (NULL w, bad eps_milli), APRM_TOO_LARGE (n above
 * APRM_KNAPSACK_N_MAX) or APRM_OUT_OF_MEMORY (every array keeps a valid
 * pointer and capacity). Sizes at least double, so repeated calls are
 * amortised O(1); the call that grows costs O(size). w owns the memory. */
int knapsack_work_reserve(KnapWork *w, size_t n, int64_t eps_milli);

/* The scale for n items (1 <= n <= APRM_KNAPSACK_N_MAX) and epsilon eps_milli
 * (10..1000): normally qnum / qden = n / eps = 1000 n / eps_milli and capacity
 * C = floor(1000 n / eps_milli); if the table n * (C + 1) would exceed
 * APRM_KNAPSACK_TABLE_MAX the scale is coarsened to C = floor(MAX / n) - 1
 * with qnum = C, qden = 1 (effective epsilon n / C). Returns APRM_OK,
 * APRM_INVALID_ARGUMENT (NULL out, eps_milli out of range, n == 0) or
 * APRM_TOO_LARGE (n above the limit). O(1). */
int knapsack_plan(size_t n, int64_t eps_milli, KnapPlan *out);

/* The scaled size floor(p * (c * MEM_CAP + m * CPU_CAP) * qnum /
 * (qden * zeta * CPU_CAP * MEM_CAP)) of job j, saturated at plan->cells + 1
 * ("cannot fit"). Validates the job and the capacities against PRD section 3
 * (APRM_INVALID_FIELD), zeta in 1..2^61, and guards every division and
 * multiplication (128-bit arithmetic, no overflow possible). O(1) (about 400
 * word operations). */
int knapsack_scaled_size(const Job *j, int64_t cpu_cap, int64_t mem_cap, int64_t zeta,
                         const KnapPlan *plan, int64_t *out);

/* Solve the batch in w->items[0..n-1] (given in (arrival, id) order) for the
 * capacity zeta, writing item.size and item.take and filling *res. Ties are
 * deterministic: an item is taken only if it strictly raises the value, so
 * equal-value optima prefer earlier items. Validation happens first and
 * changes nothing: NULL pointers or a workspace smaller than
 * knapsack_work_reserve(n) gives APRM_INVALID_ARGUMENT; n above
 * APRM_KNAPSACK_N_MAX gives APRM_TOO_LARGE; a bad job or capacity gives
 * APRM_INVALID_FIELD. n == 0 succeeds with value 0. Never allocates.
 * Time O(n * C) = O(n^2 / eps) (at most about 2^26 steps by the table cap),
 * space O(n * C) bits plus O(C) integers, all inside w. */
int knapsack_select(KnapWork *w, size_t n, int64_t cpu_cap, int64_t mem_cap, int64_t zeta,
                    int64_t eps_milli, KnapResult *res);

/* WSJF order inside a batch: smaller duration / (priority + 1) first (compared
 * by cross-multiplication, no division), then earlier arrival, then lower id.
 * Total order on distinct ids. O(1). */
int knapsack_wsjf_compare(const Job *a, const Job *b);

/* qsort-style wrapper over KnapItem for sorting the chosen set. O(1). */
int knapsack_item_wsjf_cmp(const void *a, const void *b);

#endif /* APRM_KNAPSACK_H */
