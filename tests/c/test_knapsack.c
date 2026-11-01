/* test_knapsack.c: the knapsack batch selector (core/knapsack.c) and the
 * knapsack policy in the engine, issue K-34, DECISIONS D19 to D23 and D72.
 *
 * Part 1: the DP against brute force over subsets, the (1 + eps) capacity
 *   bound, the 128-bit size arithmetic against __int128 (where the compiler has
 *   it), the guards (division by zero, overflow, table cap, n limit) and ties.
 * Part 2: whole schedules through the engine: windows at 1, 2, 4, 8 ..., WSJF
 *   order, chosen before unchosen, unchosen wait for the next window, reset,
 *   determinism, invariants. Every expected schedule below was worked out by
 *   hand (see the comment above each test). */
#define APRM_ENGINE_INTERNAL  /* read the Sim: finished list, log, window state */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "../../core/config.h"
#include "../../core/engine_internal.h"
#include "../../core/knapsack.h"
#include "test_main.h"

/* ================= part 1: the selector ================= */

/* xorshift64: a fixed-seed generator so every run sees the same cases. */
static uint64_t rng_state = 88172645463325252ULL;
static uint64_t rnd(void)
{
    rng_state ^= rng_state << 13;
    rng_state ^= rng_state >> 7;
    rng_state ^= rng_state << 17;
    return rng_state;
}
static int64_t rnd_in(int64_t lo, int64_t hi) { return lo + (int64_t)(rnd() % (uint64_t)(hi - lo + 1)); }

static Job mkjob(int32_t id, int64_t arrival, int64_t dur, int64_t cpu, int64_t mem, int32_t prio)
{
    Job j;
    j.id = id; j.arrival = arrival; j.duration = dur; j.cpu = cpu; j.mem = mem; j.priority = prio;
    return j;
}

/* Fill w->items[0..n-1] and reserve; asserts success. */
static void load(KnapWork *w, const Job *jobs, size_t n, int64_t eps_milli)
{
    size_t i;
    CHECK(knapsack_work_reserve(w, n, eps_milli) == APRM_OK);
    for (i = 0; i < n; i++) { w->items[i].job = jobs[i]; w->items[i].src = i; }
}

/* ---- the plan ---- */

/* n = 10, eps = 0.1: K = eps * zeta / n, so zeta / K = n / eps = 100 cells;
 * table = 10 * 101 = 1010 bits, nowhere near the cap. n = 1, eps = 1: 1 cell
 * of capacity... 1000 * 1 / 1000 = 1. */
static void test_plan(void)
{
    KnapPlan p;
    CHECK(knapsack_plan(10, 100, &p) == APRM_OK);
    CHECK(p.qnum == 10000 && p.qden == 100 && p.cells == 100 && p.table == 1010);
    CHECK(p.capped == 0 && p.eff_eps_milli == 100);
    CHECK(knapsack_plan(1, 1000, &p) == APRM_OK && p.cells == 1 && p.table == 2 && !p.capped);
    CHECK(knapsack_plan(3, 300, &p) == APRM_OK && p.cells == 10 && p.qnum == 3000);  /* 3 / 0.3 = 10 */
    CHECK(knapsack_plan(7, 30, &p) == APRM_OK && p.cells == 233);                    /* floor(7000 / 30) */
}

/* n = 2000, eps = 0.01: C would be 200,000 and the table 4 * 10^8 > 2^26, so
 * the scale is coarsened to C = floor(2^26 / 2000) - 1 = 33553 cells
 * (effective eps = ceil(1000 * 2000 / 33553) = 60 thousandths). */
static void test_plan_capped(void)
{
    KnapPlan p;
    CHECK(knapsack_plan(2000, 10, &p) == APRM_OK);
    CHECK(p.capped == 1 && p.cells == 33553 && p.qnum == 33553 && p.qden == 1);
    CHECK(p.table == 2000 * 33554 && p.table <= APRM_KNAPSACK_TABLE_MAX);
    CHECK(p.eff_eps_milli == 60 && p.eff_eps_milli >= 10);
    /* the largest allowed n at the smallest eps still has a sensible scale */
    CHECK(knapsack_plan(APRM_KNAPSACK_N_MAX, 10, &p) == APRM_OK);
    CHECK(p.capped == 1 && p.cells == 1023 && p.table <= APRM_KNAPSACK_TABLE_MAX);
}

/* For every n and three eps values: the table never exceeds the cap and the
 * dp row (C + 1) stays below the 131072 reserved by knapsack.c (DP_BOUND). */
static void test_plan_sweep(void)
{
    static const int64_t eps[3] = { 10, 100, 1000 };
    size_t n;
    int k, ok = 1;
    for (n = 1; n <= (size_t)APRM_KNAPSACK_N_MAX; n++) {
        for (k = 0; k < 3; k++) {
            KnapPlan p;
            if (knapsack_plan(n, eps[k], &p) != APRM_OK || p.table > APRM_KNAPSACK_TABLE_MAX ||
                p.cells < 1 || p.cells + 1 > 131072 || p.table != (int64_t)n * (p.cells + 1) ||
                p.eff_eps_milli < eps[k])
                ok = 0;
        }
    }
    CHECK(ok);
}

static void test_plan_guards(void)
{
    KnapPlan p;
    CHECK(knapsack_plan(0, 100, &p) == APRM_INVALID_ARGUMENT);
    CHECK(knapsack_plan(5, 100, NULL) == APRM_INVALID_ARGUMENT);
    CHECK(knapsack_plan(5, 9, &p) == APRM_INVALID_ARGUMENT);
    CHECK(knapsack_plan(5, 1001, &p) == APRM_INVALID_ARGUMENT);
    CHECK(knapsack_plan(5, 0, &p) == APRM_INVALID_ARGUMENT);   /* division by zero is never reached */
    CHECK(knapsack_plan(5, -100, &p) == APRM_INVALID_ARGUMENT);
    CHECK(knapsack_plan((size_t)APRM_KNAPSACK_N_MAX + 1, 100, &p) == APRM_TOO_LARGE);
    CHECK(knapsack_plan(SIZE_MAX, 100, &p) == APRM_TOO_LARGE);
}

/* ---- scaled sizes ---- */

/* Hand-computed. Machine 1 core / 1 MB, one job using all of it: N = 2,
 * D = 1, volume = p * 2. n = 1, eps = 0.1: C = 10, qnum / qden = 1000 / 100.
 *  zeta 2, p 1: size = floor(1 * 2 * 1000 / (100 * 2 * 1)) = 10 = C (fits exactly).
 *  zeta 1, p 1: size = 20 > C, saturated to C + 1 = 11.
 *  zeta 4, p 1: size = 5.
 * Machine 4 cores / 1000 MB, job 2 cores / 1 MB, p = 4: N = 2 * 1000 + 1 * 4 = 2004,
 * D = 4000, volume = 4 * 2004 / 4000 = 2.004. zeta 8, n = 5, eps 0.1: qnum 5000,
 * qden 100, C = 50: size = floor(4 * 2004 * 5000 / (100 * 8 * 4000)) = floor(12.525) = 12. */
static void test_scaled_size_values(void)
{
    KnapPlan p;
    int64_t sz = -1;
    Job j = mkjob(1, 0, 1, 1, 1, 0);
    CHECK(knapsack_plan(1, 100, &p) == APRM_OK);
    CHECK(knapsack_scaled_size(&j, 1, 1, 2, &p, &sz) == APRM_OK && sz == 10);
    CHECK(knapsack_scaled_size(&j, 1, 1, 1, &p, &sz) == APRM_OK && sz == 11);
    CHECK(knapsack_scaled_size(&j, 1, 1, 4, &p, &sz) == APRM_OK && sz == 5);
    j = mkjob(2, 0, 4, 2, 1, 3);
    CHECK(knapsack_plan(5, 100, &p) == APRM_OK && p.cells == 50);
    CHECK(knapsack_scaled_size(&j, 4, 1000, 8, &p, &sz) == APRM_OK && sz == 12);
}

#ifdef __SIZEOF_INT128__
/* The same size with the compiler's 128-bit type, for comparison. */
static int64_t oracle_size(const Job *j, int64_t cpu_cap, int64_t mem_cap, int64_t zeta, const KnapPlan *p)
{
    __int128 num = (__int128)j->duration * ((__int128)j->cpu * mem_cap + (__int128)j->mem * cpu_cap) * p->qnum;
    __int128 den = (__int128)p->qden * zeta * ((__int128)cpu_cap * mem_cap);
    __int128 q = num / den;
    return q > p->cells ? p->cells + 1 : (int64_t)q;
}

/* Random machines, jobs, zetas (up to 2^61), n and eps, including the
 * extremes (10^6 cores, 10^9 MB, 10^6 ticks) where the exact numerator is
 * about 10^30: the portable 128-bit code must agree with __int128 everywhere. */
static void test_scaled_size_vs_int128(void)
{
    int it, bad = 0;
    for (it = 0; it < 200000; it++) {
        int64_t cpu_cap = it % 7 == 0 ? APRM_CPU_CAP_MAX : rnd_in(1, it % 3 ? 64 : APRM_CPU_CAP_MAX);
        int64_t mem_cap = it % 11 == 0 ? APRM_MEM_CAP_MAX : rnd_in(1, it % 5 ? 65536 : APRM_MEM_CAP_MAX);
        Job j = mkjob(1, 0, it % 13 == 0 ? APRM_DURATION_MAX : rnd_in(1, APRM_DURATION_MAX),
                      it % 17 == 0 ? cpu_cap : rnd_in(1, cpu_cap), it % 19 == 0 ? mem_cap : rnd_in(1, mem_cap),
                      (int32_t)rnd_in(0, 9));
        int64_t zeta = it % 23 == 0 ? ((int64_t)1 << 61) : (int64_t)1 << rnd_in(0, 61);
        int64_t eps = it % 29 == 0 ? 10 : rnd_in(10, 1000);
        size_t n = it % 31 == 0 ? (size_t)APRM_KNAPSACK_N_MAX : (size_t)rnd_in(1, 3000);
        KnapPlan p;
        int64_t got = -1;
        if (zeta > 1 && it % 2) zeta += rnd_in(0, zeta > 1000 ? 1000 : zeta - 1);
        if (zeta > ((int64_t)1 << 61)) zeta = (int64_t)1 << 61;
        if (knapsack_plan(n, eps, &p) != APRM_OK) { bad++; continue; }
        if (knapsack_scaled_size(&j, cpu_cap, mem_cap, zeta, &p, &got) != APRM_OK ||
            got != oracle_size(&j, cpu_cap, mem_cap, zeta, &p))
            bad++;
    }
    CHECK(bad == 0);
}
#endif

/* Extreme corner without an oracle: the biggest job on the biggest machine with
 * the biggest n and the smallest zeta must saturate, not overflow or divide by zero. */
static void test_scaled_size_extremes(void)
{
    KnapPlan p;
    int64_t sz = -1;
    Job j = mkjob(1, 0, APRM_DURATION_MAX, APRM_CPU_CAP_MAX, APRM_MEM_CAP_MAX, 9);
    CHECK(knapsack_plan(APRM_KNAPSACK_N_MAX, 10, &p) == APRM_OK);
    CHECK(knapsack_scaled_size(&j, APRM_CPU_CAP_MAX, APRM_MEM_CAP_MAX, 2, &p, &sz) == APRM_OK);
    CHECK(sz == p.cells + 1);  /* volume 2 * 10^6 against capacity 2: cannot fit */
    /* zeta = 2^61, the largest accepted: the same job is tiny */
    CHECK(knapsack_scaled_size(&j, APRM_CPU_CAP_MAX, APRM_MEM_CAP_MAX, (int64_t)1 << 61, &p, &sz) == APRM_OK);
    CHECK(sz == 0);  /* 2 * 10^6 * 1023 / 2^61 < 1 */
}

static void test_scaled_size_guards(void)
{
    KnapPlan p;
    int64_t sz = 7;
    Job j = mkjob(1, 0, 5, 2, 2, 1);
    Job bad;
    CHECK(knapsack_plan(4, 100, &p) == APRM_OK);
    CHECK(knapsack_scaled_size(NULL, 4, 4, 8, &p, &sz) == APRM_INVALID_ARGUMENT);
    CHECK(knapsack_scaled_size(&j, 4, 4, 8, NULL, &sz) == APRM_INVALID_ARGUMENT);
    CHECK(knapsack_scaled_size(&j, 4, 4, 8, &p, NULL) == APRM_INVALID_ARGUMENT);
    CHECK(knapsack_scaled_size(&j, 4, 4, 0, &p, &sz) == APRM_INVALID_FIELD);                  /* zeta 0: no division */
    CHECK(knapsack_scaled_size(&j, 4, 4, -5, &p, &sz) == APRM_INVALID_FIELD);
    CHECK(knapsack_scaled_size(&j, 4, 4, ((int64_t)1 << 61) + 1, &p, &sz) == APRM_INVALID_FIELD);
    CHECK(knapsack_scaled_size(&j, 0, 4, 8, &p, &sz) == APRM_INVALID_FIELD);                  /* cpu_cap 0 */
    CHECK(knapsack_scaled_size(&j, 4, 0, 8, &p, &sz) == APRM_INVALID_FIELD);                  /* mem_cap 0 */
    CHECK(knapsack_scaled_size(&j, APRM_CPU_CAP_MAX + 1, 4, 8, &p, &sz) == APRM_INVALID_FIELD);
    CHECK(knapsack_scaled_size(&j, 4, (int64_t)APRM_MEM_CAP_MAX + 1, 8, &p, &sz) == APRM_INVALID_FIELD);
    bad = j; bad.cpu = 0;  CHECK(knapsack_scaled_size(&bad, 4, 4, 8, &p, &sz) == APRM_INVALID_FIELD);
    bad = j; bad.cpu = 5;  CHECK(knapsack_scaled_size(&bad, 4, 4, 8, &p, &sz) == APRM_INVALID_FIELD);
    bad = j; bad.mem = 0;  CHECK(knapsack_scaled_size(&bad, 4, 4, 8, &p, &sz) == APRM_INVALID_FIELD);
    bad = j; bad.mem = 5;  CHECK(knapsack_scaled_size(&bad, 4, 4, 8, &p, &sz) == APRM_INVALID_FIELD);
    bad = j; bad.duration = 0; CHECK(knapsack_scaled_size(&bad, 4, 4, 8, &p, &sz) == APRM_INVALID_FIELD);
    bad = j; bad.duration = APRM_DURATION_MAX + 1; CHECK(knapsack_scaled_size(&bad, 4, 4, 8, &p, &sz) == APRM_INVALID_FIELD);
    bad = j; bad.priority = 10; CHECK(knapsack_scaled_size(&bad, 4, 4, 8, &p, &sz) == APRM_INVALID_FIELD);
    bad = j; bad.priority = -1; CHECK(knapsack_scaled_size(&bad, 4, 4, 8, &p, &sz) == APRM_INVALID_FIELD);
    p.qden = 0;
    CHECK(knapsack_scaled_size(&j, 4, 4, 8, &p, &sz) == APRM_INVALID_FIELD);                  /* corrupt plan: no division */
    CHECK(sz == 7);  /* never written on failure */
}

/* ---- the DP against brute force ---- */

/* A random batch of n jobs on a small machine (so exact volumes fit int64):
 * every job has duration <= gamma, so its volume is at most 2 * gamma = zeta
 * and it fits an empty knapsack, as the engine guarantees. */
static size_t random_batch(Job *jobs, size_t max_n, int64_t *cpu_cap, int64_t *mem_cap, int64_t *gamma)
{
    size_t n = (size_t)rnd_in(1, (int64_t)max_n), i;
    *cpu_cap = rnd_in(1, 64);
    *mem_cap = rnd_in(1, 4096);
    *gamma = (int64_t)1 << rnd_in(0, 10);
    for (i = 0; i < n; i++)
        jobs[i] = mkjob((int32_t)i, (int64_t)i, rnd_in(1, *gamma), rnd_in(1, *cpu_cap), rnd_in(1, *mem_cap),
                        (int32_t)rnd_in(0, 9));
    return n;
}

/* 6000 random batches of up to 12 jobs. For each:
 *  (a) the DP value equals the brute-force optimum of the SCALED problem
 *      (maximum value with total scaled size <= C), over all 2^n subsets;
 *  (b) the chosen set is feasible for that scaled problem and its value adds up;
 *  (c) the value is at least the optimum of the EXACT problem (total exact
 *      volume <= zeta), because rounding sizes down only enlarges the feasible
 *      sets (Lemma 6.1, first half);
 *  (d) the chosen set uses at most (1 + eps) * zeta of real volume (second half):
 *      1000 * sum(p*N) <= zeta * D * (1000 + effective eps in thousandths). */
static void test_dp_vs_brute_force(void)
{
    static const int64_t eps_list[5] = { 10, 50, 100, 250, 1000 };
    KnapWork w;
    Job jobs[12];
    int it, bad_a = 0, bad_b = 0, bad_c = 0, bad_d = 0, nonempty = 0;
    knapsack_work_init(&w);
    for (it = 0; it < 6000; it++) {
        int64_t cpu_cap, mem_cap, gamma, zeta, eps = eps_list[it % 5];
        size_t n = random_batch(jobs, 12, &cpu_cap, &mem_cap, &gamma), i;
        unsigned mask;
        int64_t best_scaled = 0, best_exact = 0, D, sum_sz = 0, sum_val = 0, sum_vol = 0;
        KnapResult res;
        zeta = 2 * gamma;
        D = cpu_cap * mem_cap;
        load(&w, jobs, n, eps);
        if (knapsack_select(&w, n, cpu_cap, mem_cap, zeta, eps, &res) != APRM_OK) { bad_a++; continue; }
        for (mask = 0; mask < (1u << n); mask++) {
            int64_t sz = 0, val = 0, vol = 0;
            for (i = 0; i < n; i++) {
                if (!(mask >> i & 1u)) continue;
                sz += w.items[i].size;
                val += jobs[i].priority + 1;
                vol += jobs[i].duration * (jobs[i].cpu * mem_cap + jobs[i].mem * cpu_cap);
            }
            if (sz <= res.plan.cells && val > best_scaled) best_scaled = val;
            if (vol <= zeta * D && val > best_exact) best_exact = val;
        }
        for (i = 0; i < n; i++) {
            if (!w.items[i].take) continue;
            sum_sz += w.items[i].size;
            sum_val += jobs[i].priority + 1;
            sum_vol += jobs[i].duration * (jobs[i].cpu * mem_cap + jobs[i].mem * cpu_cap);
        }
        if (res.value != best_scaled) bad_a++;
        if (sum_sz > res.plan.cells || sum_val != res.value) bad_b++;
        if (res.value < best_exact) bad_c++;
        if (1000 * sum_vol > zeta * D * (1000 + res.plan.eff_eps_milli)) bad_d++;
        if (res.value > 0) nonempty++;
    }
    CHECK(bad_a == 0);
    CHECK(bad_b == 0);
    CHECK(bad_c == 0);
    CHECK(bad_d == 0);
    CHECK(nonempty == 6000);  /* every batch has a job that fits, so something is always chosen */
    knapsack_work_free(&w);
}

/* A simple, separate 2-D DP (values only) written for the test, to check the
 * 1-D DP with its bit table on bigger batches and on a capped scale. */
static int64_t reference_value(const KnapWork *w, size_t n, int64_t cells)
{
    int64_t *tab = calloc((n + 1) * (size_t)(cells + 1), sizeof *tab);
    int64_t best;
    size_t i;
    int64_t c;
    if (!tab) return -1;
    for (i = 1; i <= n; i++) {
        int64_t s = w->items[i - 1].size, v = (int64_t)w->items[i - 1].job.priority + 1;
        for (c = 0; c <= cells; c++) {
            int64_t keep = tab[(i - 1) * (size_t)(cells + 1) + (size_t)c], take = -1;
            if (s <= c) take = tab[(i - 1) * (size_t)(cells + 1) + (size_t)(c - s)] + v;
            tab[i * (size_t)(cells + 1) + (size_t)c] = take > keep ? take : keep;
        }
    }
    best = tab[n * (size_t)(cells + 1) + (size_t)cells];
    free(tab);
    return best;
}

static void test_dp_vs_reference_medium(void)
{
    KnapWork w;
    Job *jobs = malloc(300 * sizeof *jobs);
    int it, bad = 0;
    CHECK(jobs != NULL);
    knapsack_work_init(&w);
    for (it = 0; it < 40 && jobs; it++) {
        int64_t cpu_cap = rnd_in(2, 32), mem_cap = rnd_in(2, 2048), gamma = (int64_t)1 << rnd_in(3, 12);
        size_t n = (size_t)rnd_in(20, 300), i;
        int64_t eps = it % 2 ? 100 : 400;
        KnapResult res;
        for (i = 0; i < n; i++)
            jobs[i] = mkjob((int32_t)i, (int64_t)i, rnd_in(1, gamma), rnd_in(1, cpu_cap), rnd_in(1, mem_cap),
                            (int32_t)rnd_in(0, 9));
        load(&w, jobs, n, eps);
        if (knapsack_select(&w, n, cpu_cap, mem_cap, 2 * gamma, eps, &res) != APRM_OK) { bad++; continue; }
        if (res.value != reference_value(&w, n, res.plan.cells)) bad++;
    }
    CHECK(bad == 0);
    knapsack_work_free(&w);
    free(jobs);
}

/* The table cap in action: 2000 candidates at eps = 0.01 would need a
 * 4 * 10^8-bit table; the plan is coarsened, the table stays within the cap,
 * the result still matches an independent DP on the coarsened sizes, and the
 * capacity bound holds with the (larger) effective epsilon. */
static void test_table_cap_hit(void)
{
    KnapWork w;
    Job *jobs = malloc(2000 * sizeof *jobs);
    size_t i, n = 2000;
    int64_t cpu_cap = 16, mem_cap = 1024, gamma = 64, zeta = 128, sum_vol = 0, D = cpu_cap * mem_cap;
    KnapResult res;
    CHECK(jobs != NULL);
    if (!jobs) return;
    knapsack_work_init(&w);
    for (i = 0; i < n; i++)
        jobs[i] = mkjob((int32_t)i, (int64_t)i, rnd_in(1, gamma), rnd_in(1, cpu_cap), rnd_in(1, mem_cap),
                        (int32_t)rnd_in(0, 9));
    load(&w, jobs, n, 10);
    CHECK(knapsack_select(&w, n, cpu_cap, mem_cap, zeta, 10, &res) == APRM_OK);
    CHECK(res.plan.capped == 1 && res.plan.table <= APRM_KNAPSACK_TABLE_MAX);
    CHECK(res.plan.eff_eps_milli == 60);
    CHECK(res.value == reference_value(&w, n, res.plan.cells));
    for (i = 0; i < n; i++)
        if (w.items[i].take)
            sum_vol += jobs[i].duration * (jobs[i].cpu * mem_cap + jobs[i].mem * cpu_cap);
    CHECK(res.value > 0 && 1000 * sum_vol <= zeta * D * (1000 + res.plan.eff_eps_milli));
    /* the workspace never grew past the cap: 2^26 bits = 2^20 words (plus doubling slack) */
    CHECK(w.cap_bits <= (size_t)(2 * (APRM_KNAPSACK_TABLE_MAX / 64)));
    knapsack_work_free(&w);
    free(jobs);
}

/* ---- guards on the select and reserve calls ---- */

static void test_select_guards(void)
{
    KnapWork w, z;
    KnapResult res;
    Job jobs[3];
    Job big;
    memset(&z, 0, sizeof z);
    knapsack_work_init(&w);
    jobs[0] = mkjob(1, 0, 2, 1, 1, 0); jobs[1] = mkjob(2, 0, 2, 1, 1, 0); jobs[2] = mkjob(3, 0, 2, 1, 1, 0);
    CHECK(knapsack_select(NULL, 1, 4, 4, 8, 100, &res) == APRM_INVALID_ARGUMENT);
    CHECK(knapsack_select(&w, 1, 4, 4, 8, 100, NULL) == APRM_INVALID_ARGUMENT);
    /* n == 0: success, nothing chosen, and a bad eps is still refused */
    CHECK(knapsack_select(&w, 0, 4, 4, 8, 100, &res) == APRM_OK && res.value == 0 && res.count == 0);
    CHECK(knapsack_select(&w, 0, 4, 4, 8, 5, &res) == APRM_INVALID_ARGUMENT);
    /* too many */
    CHECK(knapsack_select(&w, (size_t)APRM_KNAPSACK_N_MAX + 1, 4, 4, 8, 100, &res) == APRM_TOO_LARGE);
    CHECK(knapsack_work_reserve(&w, (size_t)APRM_KNAPSACK_N_MAX + 1, 100) == APRM_TOO_LARGE);
    CHECK(knapsack_work_reserve(NULL, 3, 100) == APRM_INVALID_ARGUMENT);
    CHECK(knapsack_work_reserve(&w, 3, 9) == APRM_INVALID_ARGUMENT);
    CHECK(knapsack_work_reserve(&w, 0, 5000) == APRM_INVALID_ARGUMENT);
    CHECK(knapsack_work_reserve(&w, 0, 100) == APRM_OK && w.items == NULL);
    /* not reserved yet */
    CHECK(knapsack_select(&w, 3, 4, 4, 8, 100, &res) == APRM_INVALID_ARGUMENT);
    load(&w, jobs, 3, 100);
    /* bad eps, zeta, caps */
    CHECK(knapsack_select(&w, 3, 4, 4, 8, 9, &res) == APRM_INVALID_ARGUMENT);
    CHECK(knapsack_select(&w, 3, 4, 4, 8, 1001, &res) == APRM_INVALID_ARGUMENT);
    CHECK(knapsack_select(&w, 3, 4, 4, 0, 100, &res) == APRM_INVALID_FIELD);
    CHECK(knapsack_select(&w, 3, 0, 4, 8, 100, &res) == APRM_INVALID_FIELD);
    /* an invalid job changes nothing: take flags keep their old values */
    big = jobs[2]; big.cpu = 99;
    w.items[2].job = big;
    w.items[0].take = 1; w.items[1].take = 1;
    CHECK(knapsack_select(&w, 3, 4, 4, 8, 100, &res) == APRM_INVALID_FIELD);
    CHECK(w.items[0].take == 1 && w.items[1].take == 1);
    /* a workspace reserved for fewer items than asked */
    knapsack_work_free(&w);
    CHECK(knapsack_work_reserve(&w, 2, 100) == APRM_OK);
    memcpy(&w.items[0].job, &jobs[0], sizeof jobs[0]);
    CHECK(knapsack_select(&w, 3, 4, 4, 8, 100, &res) == APRM_INVALID_ARGUMENT || w.cap_items >= 3);
    knapsack_work_free(&w);
    knapsack_work_free(&z);  /* freeing a zeroed workspace is safe */
}

/* A workspace reserved for a large batch serves smaller batches too (the
 * engine reserves for an upper bound), including across the cap boundary, and
 * gives the same answer as a workspace reserved for exactly that batch. */
static void test_reserve_for_upper_bound(void)
{
    KnapWork big, exact;
    Job jobs[400];
    size_t ns[5] = { 1, 7, 300, 400, 150 };
    int k, same = 1, it;
    knapsack_work_init(&big);
    knapsack_work_init(&exact);
    CHECK(knapsack_work_reserve(&big, 3000, 10) == APRM_OK);   /* capped plan: the proven bound */
    for (it = 0; it < 30; it++) {
        for (k = 0; k < 5; k++) {
            size_t n = ns[k], i;
            int64_t cpu_cap = rnd_in(1, 32), mem_cap = rnd_in(1, 2048), gamma = (int64_t)1 << rnd_in(2, 9);
            int64_t eps = 10;
            KnapResult r1, r2;
            for (i = 0; i < n; i++)
                jobs[i] = mkjob((int32_t)i, (int64_t)i, rnd_in(1, gamma), rnd_in(1, cpu_cap), rnd_in(1, mem_cap),
                                (int32_t)rnd_in(0, 9));
            for (i = 0; i < n; i++) { big.items[i].job = jobs[i]; big.items[i].src = i; }
            load(&exact, jobs, n, eps);
            if (knapsack_select(&big, n, cpu_cap, mem_cap, 2 * gamma, eps, &r1) != APRM_OK ||
                knapsack_select(&exact, n, cpu_cap, mem_cap, 2 * gamma, eps, &r2) != APRM_OK || r1.value != r2.value)
                same = 0;
            for (i = 0; i < n && same; i++)
                if (big.items[i].take != exact.items[i].take) same = 0;
        }
    }
    CHECK(same);
    knapsack_work_free(&big);
    knapsack_work_free(&exact);
}

/* ---- ties and determinism ---- */

/* Machine 1 / 1. Three jobs, each p = 2, so volume 4 each; zeta = 4 so exactly
 * one fits (eps = 0.01: C = 3 * 100 = 300, each size floor(2*2*3000/(10*4*1)) =
 * 300 = C). Values: job 0 -> 1, job 1 -> 1, job 2 -> 1 (priority 0). Equal
 * value, so the earliest item (index 0) is kept: later items replace only on a
 * strict improvement. With priority 5 on job 2 it wins instead (value 6). */
static void test_ties_prefer_earlier(void)
{
    KnapWork w;
    KnapResult res;
    Job jobs[3];
    knapsack_work_init(&w);
    jobs[0] = mkjob(10, 0, 2, 1, 1, 0); jobs[1] = mkjob(11, 0, 2, 1, 1, 0); jobs[2] = mkjob(12, 0, 2, 1, 1, 0);
    load(&w, jobs, 3, 10);
    CHECK(knapsack_select(&w, 3, 1, 1, 4, 10, &res) == APRM_OK);
    CHECK(w.items[0].size == 300 && res.plan.cells == 300);
    CHECK(res.count == 1 && res.value == 1 && w.items[0].take == 1 && w.items[1].take == 0 && w.items[2].take == 0);
    jobs[2].priority = 5;
    load(&w, jobs, 3, 10);
    CHECK(knapsack_select(&w, 3, 1, 1, 4, 10, &res) == APRM_OK);
    CHECK(res.count == 1 && res.value == 6 && w.items[2].take == 1 && w.items[0].take == 0);
    knapsack_work_free(&w);
}

static void test_determinism_select(void)
{
    KnapWork a, b;
    Job jobs[12];
    int it, same = 1;
    knapsack_work_init(&a);
    knapsack_work_init(&b);
    for (it = 0; it < 500; it++) {
        int64_t cpu_cap, mem_cap, gamma;
        size_t n = random_batch(jobs, 12, &cpu_cap, &mem_cap, &gamma), i;
        KnapResult r1, r2;
        load(&a, jobs, n, 100);
        load(&b, jobs, n, 100);
        /* b's table is left dirty from an earlier, different batch */
        memset(b.bits, 0xA5, b.cap_bits * sizeof *b.bits);
        for (i = 0; i < b.cap_dp; i++) b.dp[i] = 12345;
        if (knapsack_select(&a, n, cpu_cap, mem_cap, 2 * gamma, 100, &r1) != APRM_OK ||
            knapsack_select(&b, n, cpu_cap, mem_cap, 2 * gamma, 100, &r2) != APRM_OK || r1.value != r2.value)
            same = 0;
        for (i = 0; i < n; i++) if (a.items[i].take != b.items[i].take || a.items[i].size != b.items[i].size) same = 0;
    }
    CHECK(same);
    knapsack_work_free(&a);
    knapsack_work_free(&b);
}

/* ---- WSJF order ---- */

/* duration / (priority + 1): A 6/3 = 2, B 4/1 = 4, C 5/5 = 1, D 10/5 = 2
 * (ties A: the earlier arrival wins), E 10/5 = 2 arriving with D (lower id). */
static void test_wsjf_order(void)
{
    Job a = mkjob(1, 0, 6, 1, 1, 2), b = mkjob(2, 0, 4, 1, 1, 0), c = mkjob(3, 0, 5, 1, 1, 4);
    Job d = mkjob(4, 3, 10, 1, 1, 4), e = mkjob(5, 3, 10, 1, 1, 4);
    KnapItem v[5];
    int i;
    CHECK(knapsack_wsjf_compare(&c, &a) < 0);   /* 1 < 2 */
    CHECK(knapsack_wsjf_compare(&a, &b) < 0);   /* 2 < 4 */
    CHECK(knapsack_wsjf_compare(&a, &d) < 0);   /* equal ratio, earlier arrival */
    CHECK(knapsack_wsjf_compare(&d, &e) < 0);   /* equal ratio and arrival, lower id */
    CHECK(knapsack_wsjf_compare(&e, &d) > 0);
    CHECK(knapsack_wsjf_compare(&a, &a) == 0);
    memset(v, 0, sizeof v);
    v[0].job = e; v[1].job = b; v[2].job = d; v[3].job = a; v[4].job = c;
    qsort(v, 5, sizeof v[0], knapsack_item_wsjf_cmp);
    {
        static const int32_t want[5] = { 3, 1, 4, 5, 2 };
        for (i = 0; i < 5; i++) CHECK(v[i].job.id == want[i]);
    }
}

/* ================= part 2: the engine ================= */

static Sim *mk(int64_t cpu, int64_t mem, int64_t eps_milli)
{
    SimConfig c;
    Sim *s = NULL;
    memset(&c, 0, sizeof c);
    c.cpu_cap = cpu; c.mem_cap = mem; c.policy = POL_KNAPSACK;
    c.alpha_milli = 100; c.reserve_threshold = 50; c.knapsack_eps_milli = eps_milli;
    c.max_jobs = 5000;
    CHECK(sim_create(&c, &s) == APRM_OK);
    return s;
}

static void addj(Sim *s, int32_t id, int64_t arr, int64_t dur, int64_t cpu, int64_t mem, int32_t prio)
{
    Job j = mkjob(id, arr, dur, cpu, mem, prio);
    CHECK(sim_add_job(s, &j) == APRM_OK);
}

static void run_all(Sim *s)
{
    int rc;
    while ((rc = sim_step(s)) == 1) { }
    CHECK(rc == 0);
}

static int64_t start_of(const Sim *s, int32_t id)
{
    size_t i;
    for (i = 0; i < s->fin_len; i++) if (s->fin[i].job.id == id) return s->fin[i].start;
    return -1;
}

static int log_count(const Sim *s, LogKind k)
{
    size_t i;
    int n = 0;
    for (i = 0; i < s->log.len; i++) if (s->log.e[i].kind == k) n++;
    return n;
}

/* time of the BATCH_SELECT entry for job id, -1 if none */
static int64_t chosen_at(const Sim *s, int32_t id)
{
    size_t i;
    for (i = 0; i < s->log.len; i++)
        if (s->log.e[i].kind == LOG_BATCH_SELECT && s->log.e[i].job == id) return s->log.e[i].t;
    return -1;
}

#ifdef APRM_DEBUG
static void check_inv(const Sim *s)
{
    const char *why = NULL;
    CHECK(sim_check_invariants(s, &why) == 0);
}
#else
static void check_inv(const Sim *s) { (void)s; }
#endif

/* Machine 16 cores / 32768 MB; every job needs all 16 cores, so they run one
 * at a time. Jobs: 1 (arr 0, dur 5, p1), 2 (1, 8, p9), 3 (2, 2, p3),
 * 4 (3, 4, p4), 5 (3, 2, p0). Volume of a job = p * (1 + 1000/32768), zeta = 2 gamma.
 *  t=0  job 1 arrives. Window 1 comes at t=1: job 2 arrives at the same tick
 *       (arrivals before the window) but only durations <= 1 are eligible: nothing.
 *  t=2  window 2 (zeta 4): job 3 (dur 2, vol 2.06) is the only candidate, chosen,
 *       starts 2, finishes 4. Jobs 1 and 2 are longer than 2.
 *  t=3  jobs 4, 5 arrive.
 *  t=4  job 3 finishes; window 4 (zeta 8): candidates 4 (dur 4, vol 4.12) and 5
 *       (dur 2, vol 2.06): 6.18 <= 8, both chosen. WSJF: 4 / 5 = 0.8 < 2 / 1 = 2,
 *       so job 4 first: starts 4, finishes 8.
 *  t=8  job 4 finishes; window 8 (zeta 16): candidates 1 (dur 5, vol 5.15) and 2
 *       (dur 8, vol 8.25): 13.4 <= 16, both chosen (batch 2). Job 5 (batch 1) goes
 *       first: starts 8, finishes 10. Batch 2 by WSJF: job 2 8 / 10 = 0.8 < job 1
 *       5 / 2 = 2.5: job 2 starts 10, finishes 18, job 1 starts 18, finishes 23. */
static void test_engine_worked_schedule(void)
{
    Sim *s = mk(16, 32768, 100);
    addj(s, 1, 0, 5, 16, 1000, 1);
    addj(s, 2, 1, 8, 16, 1000, 9);
    addj(s, 3, 2, 2, 16, 1000, 3);
    addj(s, 4, 3, 4, 16, 1000, 4);
    addj(s, 5, 3, 2, 16, 1000, 0);
    run_all(s);
    CHECK(start_of(s, 3) == 2 && start_of(s, 4) == 4 && start_of(s, 5) == 8);
    CHECK(start_of(s, 2) == 10 && start_of(s, 1) == 18);
    CHECK(chosen_at(s, 3) == 2 && chosen_at(s, 4) == 4 && chosen_at(s, 5) == 4);
    CHECK(chosen_at(s, 2) == 8 && chosen_at(s, 1) == 8);
    CHECK(log_count(s, LOG_BATCH_SELECT) == 5);
    CHECK(s->n_pool == 0 && s->win_done == 8);
    check_inv(s);
    sim_destroy(s);
}

/* A job arriving at t = 600 is not considered before 1024 (BLUEPRINT 3.6
 * consequences); a job arriving exactly at a boundary is considered there.
 * Window times seen in the log are all powers of two. */
static void test_engine_windows_at_powers_of_two(void)
{
    Sim *s = mk(4, 4000, 100);
    size_t i;
    int all_pow2 = 1;
    addj(s, 1, 600, 1, 1, 1, 0);    /* eligible at 1024 */
    addj(s, 2, 4, 4, 1, 1, 0);      /* arrives exactly at 4, duration 4: chosen at 4 */
    addj(s, 3, 5, 4, 1, 1, 0);      /* arrives at 5: next window is 8 */
    addj(s, 4, 0, 5, 1, 1, 0);      /* duration 5: first window with gamma >= 5 is 8 */
    addj(s, 5, 0, 1, 1, 1, 0);      /* duration 1: chosen at 1 */
    run_all(s);
    CHECK(chosen_at(s, 5) == 1 && start_of(s, 5) == 1);
    CHECK(chosen_at(s, 2) == 4 && start_of(s, 2) == 4);
    CHECK(chosen_at(s, 3) == 8 && start_of(s, 3) == 8);
    CHECK(chosen_at(s, 4) == 8 && start_of(s, 4) == 8);
    CHECK(chosen_at(s, 1) == 1024 && start_of(s, 1) == 1024);
    for (i = 0; i < s->log.len; i++) {
        int64_t t = s->log.e[i].t;
        if (s->log.e[i].kind == LOG_BATCH_SELECT && (t < 1 || (t & (t - 1)) != 0)) all_pow2 = 0;
    }
    CHECK(all_pow2);
    check_inv(s);
    sim_destroy(s);
}

/* Unchosen jobs do not start between windows even when they would fit.
 * Machine 4 cores / 1000 MB; five jobs arrive at 0, each 2 cores, 1 MB,
 * duration 4, priority 0. Volume 4 * (2/4 + 1/1000) = 2.004; zeta = 8 at the
 * window t = 4. eps = 0.1, n = 5: C = 50, each size floor(12.525) = 12, so four
 * jobs fit (48 <= 50) and five do not (60). Equal values: the first four by id
 * are chosen; job 5 is left in the pool.
 *  t=4  jobs 1, 2 start (the machine holds two), finish at 8.
 *  t=8  jobs 3, 4 start, finish at 12.
 *       Job 5 is left in the pool: it is not started even though a window-free
 *       tick with room could exist. The next boundary is 8 (a finish and a
 *       window share the tick; finishes come first): window 8 (zeta 16)
 *       chooses job 5, but jobs 3 and 4 (chosen earlier, lower batch positions)
 *       start first and fill the machine; job 5 starts at 12. */
static void test_engine_unchosen_waits_for_next_window(void)
{
    Sim *s = mk(4, 1000, 100);
    int32_t id;
    for (id = 1; id <= 5; id++) addj(s, id, 0, 4, 2, 1, 0);
    run_all(s);
    CHECK(start_of(s, 1) == 4 && start_of(s, 2) == 4 && start_of(s, 3) == 8 && start_of(s, 4) == 8);
    CHECK(chosen_at(s, 4) == 4 && chosen_at(s, 5) == 8);
    CHECK(start_of(s, 5) == 12);
    check_inv(s);
    sim_destroy(s);
}

/* A chosen job that does not fit yet starts as soon as it fits, before an
 * unchosen one, and a later chosen job that does fit may start before it.
 * Machine 4 / 4. Job 1 (dur 8, 3 cores, p9) and job 2 (dur 8, 3 cores, p0)
 * and job 3 (dur 2, 1 core, p0), all arriving at 0.
 *  window 8 (zeta 16): all three are candidates (duration <= 8) -- job 3 was
 *  also a candidate at windows 2 and 4... it is chosen at window 2 already: dur
 *  2 <= 2, vol 2 * (1/4 + 1/4) = 1 <= 4. Starts at 2, finishes 4.
 *  Window 8: jobs 1 and 2: vol 8 * (3/4 + 1/4) = 8 each, 16 total <= 16 but with
 *  eps = 0.1 and n = 2 the sizes are floor(8 * 2000 / (100 * 16 * 1)) = 10 each
 *  (C = 20), so both fit. WSJF: job 1 8/10 < job 2 8/1: job 1 first.
 *  t=8: job 1 starts (3 of 4 cores, finishes 16); job 2 needs 3 cores, 1 is
 *  free: it is skipped (chosen, waiting). t=16: job 1 finishes; job 2 starts.
 *  The schedule: 3 -> [2,4), 1 -> [8,16), 2 -> [16,24). */
static void test_engine_chosen_waits_for_fit(void)
{
    Sim *s = mk(4, 4, 100);
    addj(s, 1, 0, 8, 3, 1, 9);
    addj(s, 2, 0, 8, 3, 1, 0);
    addj(s, 3, 0, 2, 1, 1, 0);
    run_all(s);
    CHECK(start_of(s, 3) == 2);
    CHECK(start_of(s, 1) == 8 && start_of(s, 2) == 16);
    CHECK(chosen_at(s, 3) == 2 && chosen_at(s, 1) == 8 && chosen_at(s, 2) == 8);
    check_inv(s);
    sim_destroy(s);
}

/* Reset restarts the windows (win_done, batch positions, pool): a second run
 * gives the same schedule and the same log. */
static void test_engine_reset_and_determinism(void)
{
    Sim *a = mk(16, 32768, 100), *b = mk(16, 32768, 100);
    size_t i, len;
    int same = 1;
    int32_t id;
    for (id = 1; id <= 12; id++) {
        addj(a, id, (id * 7) % 20, 1 + (id * 5) % 9, 1 + id % 16, 1000 * (1 + id % 7), id % 10);
        addj(b, id, (id * 7) % 20, 1 + (id * 5) % 9, 1 + id % 16, 1000 * (1 + id % 7), id % 10);
    }
    run_all(a);
    run_all(b);
    CHECK(a->log.len == b->log.len && a->fin_len == b->fin_len);
    for (i = 0; i < a->log.len && i < b->log.len; i++)
        if (memcmp(&a->log.e[i], &b->log.e[i], sizeof a->log.e[i]) != 0) same = 0;
    CHECK(same);
    len = a->log.len;
    CHECK(sim_reset(a) == APRM_OK);
    CHECK(a->win_done == 0 && a->batch_seq == 0 && a->n_pool == 0 && a->log.len == 0);
    for (id = 1; id <= 12; id++)
        addj(a, id, (id * 7) % 20, 1 + (id * 5) % 9, 1 + id % 16, 1000 * (1 + id % 7), id % 10);
    run_all(a);
    CHECK(a->log.len == len);
    same = 1;
    for (i = 0; i < len; i++)
        if (memcmp(&a->log.e[i], &b->log.e[i], sizeof a->log.e[i]) != 0) same = 0;
    CHECK(same);
    sim_destroy(a);
    sim_destroy(b);
}

/* Random workloads: every job finishes, never before its arrival, resources are
 * never exceeded (the debug build checks after every step), and a job is never
 * started before the window that chose it. Also eps at both ends. */
static void test_engine_random_feasible(void)
{
    int it, bad = 0;
    for (it = 0; it < 300; it++) {
        int64_t cpu = rnd_in(1, 16), mem = rnd_in(1, 4096);
        int n = (int)rnd_in(1, 30), k;
        Sim *s = mk(cpu, mem, it % 2 ? 10 : 1000);
        size_t i;
        for (k = 0; k < n; k++)
            addj(s, k, rnd_in(0, 60), rnd_in(1, 40), rnd_in(1, cpu), rnd_in(1, mem), (int32_t)rnd_in(0, 9));
        run_all(s);
        if ((int)s->fin_len != n) bad++;
        for (i = 0; i < s->fin_len; i++) {
            const RunEntry *r = &s->fin[i];
            int64_t c = chosen_at(s, r->job.id);
            if (r->start < r->job.arrival || r->finish - r->start != r->job.duration) bad++;
            if (c < 0 || c > r->start || c < r->job.arrival || c < r->job.duration || (c & (c - 1)) != 0) bad++;
        }
        if (log_count(s, LOG_BATCH_SELECT) != n) bad++;
        check_inv(s);
        sim_destroy(s);
    }
    CHECK(bad == 0);
}

#ifdef APRM_DEBUG
static void test_invariant_checker(void)
{
    const char *why = NULL;
    Sim *s = mk(4, 4, 100);
    addj(s, 1, 0, 8, 3, 1, 9);
    addj(s, 2, 0, 8, 3, 1, 0);
    CHECK(sim_run_until(s, 1) == APRM_OK);
    CHECK(sim_check_invariants(s, &why) == 0);
    s->n_pool += 1;  /* pool counter out of step with the heap */
    CHECK(sim_check_invariants(s, &why) == 1);
    s->n_pool -= 1;
    s->win_done = 3;  /* not a power of two */
    CHECK(sim_check_invariants(s, &why) == 1);
    s->win_done = 1;
    CHECK(sim_check_invariants(s, &why) == 0);
    sim_destroy(s);
}
#endif

int main(void)
{
    test_plan();
    test_plan_capped();
    test_plan_sweep();
    test_plan_guards();
    test_scaled_size_values();
#ifdef __SIZEOF_INT128__
    test_scaled_size_vs_int128();
#endif
    test_scaled_size_extremes();
    test_scaled_size_guards();
    test_dp_vs_brute_force();
    test_dp_vs_reference_medium();
    test_table_cap_hit();
    test_select_guards();
    test_reserve_for_upper_bound();
    test_ties_prefer_earlier();
    test_determinism_select();
    test_wsjf_order();
    test_engine_worked_schedule();
    test_engine_windows_at_powers_of_two();
    test_engine_unchosen_waits_for_next_window();
    test_engine_chosen_waits_for_fit();
    test_engine_reset_and_determinism();
    test_engine_random_feasible();
#ifdef APRM_DEBUG
    test_invariant_checker();
#endif
    return TEST_REPORT();
}
