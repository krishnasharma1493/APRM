/*
 * knapsack.c: CADP knapsack batch selector (see knapsack.h, D72).
 * No globals, no static mutable state, no I/O.
 */
#include "knapsack.h"

#include <stdlib.h>
#include <string.h>
#include "config.h"

/* Largest zeta accepted: 2^61, so every divisor stays below 2^63. */
#define ZETA_MAX ((int64_t)1 << 61)

/* dp cells ever needed: C + 1 <= min(100 n + 1, MAX / n), whose maximum over
 * n is about 81,935 (at n = 819). One bound for every n lets the engine
 * reserve before it knows the exact candidate count. Checked by the tests. */
#define DP_BOUND 131072

/* ---- 128-bit unsigned arithmetic from two uint64 words (portable C11) ---- */

typedef struct { uint64_t hi, lo; } U128;

/* a * b as a 128-bit value (schoolbook on 32-bit halves). O(1). */
static U128 mul_64_64(uint64_t a, uint64_t b)
{
    uint64_t a0 = a & 0xffffffffu, a1 = a >> 32, b0 = b & 0xffffffffu, b1 = b >> 32;
    uint64_t p00 = a0 * b0, p01 = a0 * b1, p10 = a1 * b0, p11 = a1 * b1;
    uint64_t mid = (p00 >> 32) + (p01 & 0xffffffffu) + (p10 & 0xffffffffu);
    U128 r;
    r.lo = (mid << 32) | (p00 & 0xffffffffu);
    r.hi = p11 + (p01 >> 32) + (p10 >> 32) + (mid >> 32);
    return r;
}

/* x * m into *out. Returns 0, or 1 if the product does not fit in 128 bits
 * (then *out is untouched). O(1). */
static int mul_128_64(U128 x, uint64_t m, U128 *out)
{
    U128 lo = mul_64_64(x.lo, m), hi = mul_64_64(x.hi, m);
    uint64_t h;
    if (hi.hi != 0) return 1;
    h = hi.lo + lo.hi;
    if (h < hi.lo) return 1;
    out->lo = lo.lo;
    out->hi = h;
    return 0;
}

/* *x = floor(*x / d) by binary long division. d must be 1 .. 2^63 - 1 (so the
 * running remainder, always below d, can be shifted left without overflow).
 * 128 iterations: O(1). */
static void div_128_64(U128 *x, uint64_t d)
{
    U128 q = { 0, 0 };
    uint64_t rem = 0;
    int i;
    if (x->hi == 0) { x->lo /= d; return; }  /* fast path: d is nonzero by the caller's contract */
    for (i = 127; i >= 0; i--) {
        uint64_t bit = i >= 64 ? (x->hi >> (i - 64)) & 1u : (x->lo >> i) & 1u;
        rem = (rem << 1) | bit;
        if (rem >= d) {
            rem -= d;
            if (i >= 64) q.hi |= (uint64_t)1 << (i - 64);
            else q.lo |= (uint64_t)1 << i;
        }
    }
    *x = q;
}

/* ---- workspace ---- */

void knapsack_work_init(KnapWork *w)
{
    memset(w, 0, sizeof *w);
}

void knapsack_work_free(KnapWork *w)
{
    free(w->items);
    free(w->dp);
    free(w->bits);
    memset(w, 0, sizeof *w);
}

/* New capacity for an array that must hold at least need items of elem
 * bytes: at least double. Returns 0 if the byte size would overflow. O(1). */
static size_t grown(size_t cap, size_t need, size_t elem)
{
    size_t ncap = (cap <= SIZE_MAX / 2 && cap * 2 > need) ? cap * 2 : need;
    if (ncap > SIZE_MAX / elem) return 0;
    return ncap;
}

/* Words needed for the take table of the plan, or the whole cap when the plan
 * is capped (a smaller batch can then need more bits than this plan). O(1). */
static size_t words_for(const KnapPlan *p)
{
    int64_t bits = p->capped ? (int64_t)APRM_KNAPSACK_TABLE_MAX : p->table;
    return (size_t)((bits + 63) / 64);
}

int knapsack_work_reserve(KnapWork *w, size_t n, int64_t eps_milli)
{
    KnapPlan plan;
    size_t need_dp, need_bits, ncap;
    void *p;
    int rc;
    if (!w) return APRM_INVALID_ARGUMENT;
    if (n == 0) {
        if (eps_milli < APRM_KNAPSACK_EPS_MILLI_MIN || eps_milli > APRM_KNAPSACK_EPS_MILLI_MAX)
            return APRM_INVALID_ARGUMENT;
        return APRM_OK;
    }
    rc = knapsack_plan(n, eps_milli, &plan);
    if (rc != APRM_OK) return rc;
    /* A capped plan leaves a smaller batch free to be uncapped with a larger
     * C, so reserve the proven bound for dp in that case. */
    need_dp = plan.capped ? (size_t)DP_BOUND : (size_t)plan.cells + 1;
    need_bits = words_for(&plan);
    if (n > w->cap_items) {
        ncap = grown(w->cap_items, n, sizeof *w->items);
        if (ncap == 0) return APRM_OUT_OF_MEMORY;
        p = realloc(w->items, ncap * sizeof *w->items);
        if (!p) return APRM_OUT_OF_MEMORY;
        w->items = p;
        w->cap_items = ncap;
    }
    if (need_dp > w->cap_dp) {
        ncap = grown(w->cap_dp, need_dp, sizeof *w->dp);
        if (ncap == 0) return APRM_OUT_OF_MEMORY;
        p = realloc(w->dp, ncap * sizeof *w->dp);
        if (!p) return APRM_OUT_OF_MEMORY;
        w->dp = p;
        w->cap_dp = ncap;
    }
    if (need_bits > w->cap_bits) {
        ncap = grown(w->cap_bits, need_bits, sizeof *w->bits);
        if (ncap == 0) return APRM_OUT_OF_MEMORY;
        p = realloc(w->bits, ncap * sizeof *w->bits);
        if (!p) return APRM_OUT_OF_MEMORY;
        w->bits = p;
        w->cap_bits = ncap;
    }
    return APRM_OK;
}

/* ---- scale and sizes ---- */

int knapsack_plan(size_t n, int64_t eps_milli, KnapPlan *out)
{
    int64_t nn, c;
    if (!out || eps_milli < APRM_KNAPSACK_EPS_MILLI_MIN || eps_milli > APRM_KNAPSACK_EPS_MILLI_MAX ||
        n == 0)
        return APRM_INVALID_ARGUMENT;
    if (n > (size_t)APRM_KNAPSACK_N_MAX) return APRM_TOO_LARGE;
    nn = (int64_t)n;  /* <= 65536 */
    out->qnum = 1000 * nn;  /* K = eps * zeta / n, so zeta / K = n / eps = 1000 n / eps_milli */
    out->qden = eps_milli;  /* nonzero: checked above */
    out->cells = out->qnum / out->qden;
    out->capped = 0;
    out->eff_eps_milli = eps_milli;
    if (nn * (out->cells + 1) > (int64_t)APRM_KNAPSACK_TABLE_MAX) {
        /* Table too big: coarsen to C cells with K = zeta / C. n <= 65536 gives C >= 1023. */
        c = (int64_t)APRM_KNAPSACK_TABLE_MAX / nn - 1;
        out->qnum = c;
        out->qden = 1;
        out->cells = c;
        out->capped = 1;
        out->eff_eps_milli = (1000 * nn + c - 1) / c;  /* ceil(1000 n / C) */
    }
    out->table = nn * (out->cells + 1);
    return APRM_OK;
}

int knapsack_scaled_size(const Job *j, int64_t cpu_cap, int64_t mem_cap, int64_t zeta,
                         const KnapPlan *plan, int64_t *out)
{
    U128 x;
    int64_t numer;
    if (!j || !plan || !out) return APRM_INVALID_ARGUMENT;
    if (cpu_cap < APRM_CPU_CAP_MIN || cpu_cap > APRM_CPU_CAP_MAX ||
        mem_cap < APRM_MEM_CAP_MIN || mem_cap > APRM_MEM_CAP_MAX ||
        zeta < 1 || zeta > ZETA_MAX || plan->qnum < 1 || plan->qden < 1 || plan->cells < 0)
        return APRM_INVALID_FIELD;
    if (j->duration < APRM_DURATION_MIN || j->duration > APRM_DURATION_MAX ||
        j->cpu < 1 || j->cpu > cpu_cap || j->mem < 1 || j->mem > mem_cap ||
        j->priority < APRM_PRIORITY_MIN || j->priority > APRM_PRIORITY_MAX)
        return APRM_INVALID_FIELD;
    /* N = c * MEM_CAP + m * CPU_CAP <= 2 * 10^15; each product is <= 10^15. */
    numer = j->cpu * mem_cap + j->mem * cpu_cap;
    x = mul_64_64((uint64_t)j->duration, (uint64_t)numer);       /* p * N <= 2 * 10^21 */
    if (mul_128_64(x, (uint64_t)plan->qnum, &x) != 0)           /* * qnum: cannot overflow, but checked */
        return APRM_INVALID_FIELD;
    /* Divide by qden, zeta and D = CPU_CAP * MEM_CAP one after the other:
     * floor(floor(x / a) / b) = floor(x / (a * b)). Each divisor is in 1 .. 2^61. */
    div_128_64(&x, (uint64_t)plan->qden);
    div_128_64(&x, (uint64_t)zeta);
    div_128_64(&x, (uint64_t)cpu_cap * (uint64_t)mem_cap);       /* <= 10^15 */
    if (x.hi != 0 || x.lo > (uint64_t)plan->cells)
        *out = plan->cells + 1;  /* does not fit even an empty knapsack */
    else
        *out = (int64_t)x.lo;
    return APRM_OK;
}

/* ---- the DP ---- */

int knapsack_select(KnapWork *w, size_t n, int64_t cpu_cap, int64_t mem_cap, int64_t zeta,
                    int64_t eps_milli, KnapResult *res)
{
    KnapPlan plan;
    size_t i, words, row;
    int64_t c, cap;
    int rc;
    if (!w || !res) return APRM_INVALID_ARGUMENT;
    memset(res, 0, sizeof *res);
    if (n == 0) {
        if (eps_milli < APRM_KNAPSACK_EPS_MILLI_MIN || eps_milli > APRM_KNAPSACK_EPS_MILLI_MAX)
            return APRM_INVALID_ARGUMENT;
        return APRM_OK;
    }
    rc = knapsack_plan(n, eps_milli, &plan);
    if (rc != APRM_OK) return rc;
    if (!w->items || !w->dp || !w->bits || n > w->cap_items ||
        (size_t)plan.cells + 1 > w->cap_dp || (size_t)((plan.table + 63) / 64) > w->cap_bits)
        return APRM_INVALID_ARGUMENT;  /* knapsack_work_reserve was not called for this batch */

    /* Validate and scale every item first; nothing is written to the DP before that. */
    for (i = 0; i < n; i++) {
        rc = knapsack_scaled_size(&w->items[i].job, cpu_cap, mem_cap, zeta, &plan, &w->items[i].size);
        if (rc != APRM_OK) return rc;
    }
    for (i = 0; i < n; i++) w->items[i].take = 0;

    cap = plan.cells;
    row = (size_t)cap + 1;
    words = (size_t)((plan.table + 63) / 64);
    memset(w->bits, 0, words * sizeof *w->bits);
    memset(w->dp, 0, row * sizeof *w->dp);
    for (i = 0; i < n; i++) {
        int64_t s = w->items[i].size, val = (int64_t)w->items[i].job.priority + 1;
        if (s > cap) continue;  /* can never fit */
        for (c = cap; c >= s; c--) {
            int64_t cand = w->dp[c - s] + val;  /* <= 10 * 65536: no overflow */
            if (cand > w->dp[c]) {
                size_t bit = i * row + (size_t)c;
                w->dp[c] = cand;
                w->bits[bit >> 6] |= (uint64_t)1 << (bit & 63);
            }
        }
    }
    /* Walk back from the last item at full capacity. */
    c = cap;
    for (i = n; i-- > 0;) {
        size_t bit = i * row + (size_t)c;
        if ((w->bits[bit >> 6] >> (bit & 63)) & 1u) {
            w->items[i].take = 1;
            c -= w->items[i].size;
            res->count++;
            res->value += (int64_t)w->items[i].job.priority + 1;
        }
    }
    res->plan = plan;
    return APRM_OK;
}

/* ---- batch order ---- */

int knapsack_wsjf_compare(const Job *a, const Job *b)
{
    /* duration_a / (pa + 1) < duration_b / (pb + 1)  <=>  da * (pb + 1) < db * (pa + 1);
     * both sides are at most 10^6 * 10. */
    int64_t l = a->duration * ((int64_t)b->priority + 1), r = b->duration * ((int64_t)a->priority + 1);
    if (l != r) return l < r ? -1 : 1;
    if (a->arrival != b->arrival) return a->arrival < b->arrival ? -1 : 1;
    return (a->id > b->id) - (a->id < b->id);
}

int knapsack_item_wsjf_cmp(const void *a, const void *b)
{
    return knapsack_wsjf_compare(&((const KnapItem *)a)->job, &((const KnapItem *)b)->job);
}
