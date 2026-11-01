/* test_exact.c: the exact solver (K-33, BLUEPRINT 3.7, DECISIONS D71).
 * Objective: minimum TOTAL WAIT (sum of start - arrival) over every feasible
 * non-preemptive schedule; ties go to the lexicographically smallest start
 * vector in (arrival, id) order. Every hand-worked number is explained above
 * its test. The brute force below shares no code or idea with the solver: it
 * tries every integer start time of every job and checks the load at every
 * single tick. */
#define APRM_ENGINE_INTERNAL
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "../../core/config.h"
#include "../../core/engine_internal.h"
#include "../../core/exact.h"
#include "test_main.h"

static SimConfig mkcfg(int64_t cpu, int64_t mem, PolicyKind p)
{
    SimConfig c;
    memset(&c, 0, sizeof c);
    c.cpu_cap = cpu; c.mem_cap = mem; c.policy = p;
    c.alpha_milli = 100; c.reserve_threshold = 5; c.knapsack_eps_milli = 100;
    c.max_jobs = 1000;
    return c;
}

static Job mkjob(int32_t id, int64_t arr, int64_t dur, int64_t cpu, int64_t mem, int32_t pr)
{
    Job j;
    j.id = id; j.arrival = arr; j.duration = dur; j.cpu = cpu; j.mem = mem; j.priority = pr;
    return j;
}

/* ---- tiny deterministic random generator (state is a local, no globals) ---- */
typedef struct { uint64_t x; } Rng;
static int64_t rnd(Rng *r, int64_t lo, int64_t hi)
{
    r->x ^= r->x << 13; r->x ^= r->x >> 7; r->x ^= r->x << 17;
    return lo + (int64_t)(r->x % (uint64_t)(hi - lo + 1));
}

/* A random instance with n jobs on a small machine; ids distinct. */
static void gen(Rng *r, int n, SimConfig *cfg, Job *jobs)
{
    int64_t cc = rnd(r, 3, 8), mc = rnd(r, 3, 8) * 100;
    int i;
    *cfg = mkcfg(cc, mc, POL_FCFS);
    for (i = 0; i < n; i++)
        jobs[i] = mkjob((int32_t)(10 * i + rnd(r, 0, 9)), rnd(r, 0, 6), rnd(r, 1, 8),
                        rnd(r, 1, cc), rnd(r, 1, mc), (int32_t)rnd(r, 0, 9));
}

/* ================= hand-worked cases ================= */

/* n = 0: nothing to schedule, total wait 0, empty schedule. */
static void test_empty(void)
{
    SimConfig c = mkcfg(4, 100, POL_FCFS);
    ExactResult r;
    JsonBuf j;
    CHECK(exact_schedule(&c, NULL, 0, &r) == APRM_OK && r.total_wait == 0);
    json_init(&j);
    CHECK(exact_solve(&c, NULL, 0, &j) == APRM_OK);
    CHECK(strcmp(json_cstr(&j), "{\"ok\":true,\"data\":{\"total_wait\":0,\"schedule\":[]}}") == 0);
    json_free(&j);
}

/* One job starts at its arrival: wait 0. */
static void test_one_job(void)
{
    SimConfig c = mkcfg(4, 100, POL_FCFS);
    Job a = mkjob(1, 5, 3, 4, 100, 0);   /* fills the whole machine, arrives at 5 */
    ExactResult r;
    CHECK(exact_schedule(&c, &a, 1, &r) == APRM_OK);
    CHECK(r.total_wait == 0 && r.start[0] == 5);
}

/* Two jobs that cannot share (3 + 3 cores > 4). A: 10 ticks, B: 2 ticks, both
 * arrive at 0. A first: B waits 10 (total 10). B first: A waits 2 (total 2).
 * Optimum 2 with B at 0 and A at 2. */
static void test_two_jobs(void)
{
    SimConfig c = mkcfg(4, 100, POL_FCFS);
    Job j[2] = { mkjob(1, 0, 10, 3, 10, 0), mkjob(2, 0, 2, 3, 10, 0) };
    ExactResult r;
    CHECK(exact_schedule(&c, j, 2, &r) == APRM_OK);
    CHECK(r.total_wait == 2 && r.start[0] == 2 && r.start[1] == 0);
}

/* Three mutually exclusive jobs (3 cores each of 4), durations 5, 1, 2, all at
 * 0. Shortest first: starts 0, 1, 3 -> waits 0 + 1 + 3 = 4 (id2 at 0, id3 at 1,
 * id1 at 3). Any other order is worse (e.g. 5,1,2 -> 0+5+6 = 11). */
static void test_three_jobs(void)
{
    SimConfig c = mkcfg(4, 100, POL_FCFS);
    Job j[3] = { mkjob(1, 0, 5, 3, 1, 0), mkjob(2, 0, 1, 3, 1, 0), mkjob(3, 0, 2, 3, 1, 0) };
    ExactResult r;
    CHECK(exact_schedule(&c, j, 3, &r) == APRM_OK);
    CHECK(r.total_wait == 4 && r.start[0] == 3 && r.start[1] == 0 && r.start[2] == 1);
}

/* The big_job_trap case (tests/cases), machine 6 cores / 6000 MB. Job 1 needs
 * the whole machine for 20 ticks and arrives at 0; five 1-core jobs of 2 ticks
 * arrive at 1 and can all run together. Greedy FCFS starts job 1 at 0 (the
 * others cannot start until 20): waits 0 + 5 * 19 = 95. Optimum by hand: leave
 * the machine idle at tick 0, start the five small jobs at 1 (wait 0), job 1
 * at 3 (wait 3): total 3. Nothing is better: if job 1 starts at 0 the small
 * jobs wait at least 19 each; if not, job 1 starts after tick 1, and cannot
 * share with any small job, so it either waits for all of them (start 3) or
 * makes them wait at least 20. This is a schedule NO online non-idling policy
 * produces, and it is unique. */
static void test_big_job_trap(void)
{
    SimConfig c = mkcfg(6, 6000, POL_FCFS);
    Job j[6];
    ExactResult r;
    int i;
    j[0] = mkjob(1, 0, 20, 6, 6000, 0);
    for (i = 1; i < 6; i++) j[i] = mkjob(i + 1, 1, 2, 1, 1000, 9);
    CHECK(exact_schedule(&c, j, 6, &r) == APRM_OK);
    CHECK(r.total_wait == 3 && r.start[0] == 3);
    for (i = 1; i < 6; i++) CHECK(r.start[i] == 1);
}

/* Ties. Two identical exclusive jobs, ids 7 and 3, both at 0, 4 ticks: either
 * order costs 0 + 4 = 4. Tie-break: lexicographically smallest start vector in
 * (arrival, id) order, i.e. (id 3, id 7) = (0, 4): id 3 first. The result must
 * not depend on the order the jobs are passed in. */
static void test_tie_break(void)
{
    SimConfig c = mkcfg(1, 1, POL_FCFS);
    Job a[2] = { mkjob(7, 0, 4, 1, 1, 0), mkjob(3, 0, 4, 1, 1, 0) };
    Job b[2] = { mkjob(3, 0, 4, 1, 1, 0), mkjob(7, 0, 4, 1, 1, 0) };
    ExactResult r;
    CHECK(exact_schedule(&c, a, 2, &r) == APRM_OK);
    CHECK(r.total_wait == 4 && r.start[0] == 4 && r.start[1] == 0);   /* id7 at 4, id3 at 0 */
    CHECK(exact_schedule(&c, b, 2, &r) == APRM_OK);
    CHECK(r.total_wait == 4 && r.start[0] == 0 && r.start[1] == 4);   /* id3 at 0, id7 at 4 */
}

/* A tie across arrivals: A (id 1) arrives at 0, B (id 2) at 1, both 2 ticks and
 * exclusive. A,B: A at 0, B at 2 (wait 1) = 1. B,A: B at 1, A at 3 = 3. Unique
 * optimum 1. Then a genuine tie with different vectors: three exclusive 1-tick
 * jobs ids 1,2,3 at 0 (waits 0+1+2 = 3 in any order): the smallest vector is
 * (0,1,2) in id order. */
static void test_more_ties(void)
{
    SimConfig c = mkcfg(1, 1, POL_FCFS);
    Job ab[2] = { mkjob(1, 0, 2, 1, 1, 0), mkjob(2, 1, 2, 1, 1, 0) };
    Job t3[3] = { mkjob(3, 0, 1, 1, 1, 0), mkjob(1, 0, 1, 1, 1, 0), mkjob(2, 0, 1, 1, 1, 0) };
    ExactResult r;
    CHECK(exact_schedule(&c, ab, 2, &r) == APRM_OK);
    CHECK(r.total_wait == 1 && r.start[0] == 0 && r.start[1] == 2);
    CHECK(exact_schedule(&c, t3, 3, &r) == APRM_OK);
    CHECK(r.total_wait == 3 && r.start[0] == 2 && r.start[1] == 0 && r.start[2] == 1);
}

/* Limits and errors. n = 9 works; n = 10 is TOO_LARGE even if a job is bad
 * (the size check comes first); a job bigger than the machine, a bad field, a
 * duplicate id and NULL pointers each give their code and zero the result. */
static void test_limits_and_errors(void)
{
    SimConfig c = mkcfg(1, 1, POL_FCFS);
    Job j[10];
    ExactResult r;
    JsonBuf out;
    int i;
    for (i = 0; i < 10; i++) j[i] = mkjob(i, 0, 5, 1, 1, 0);
    /* 9 exclusive jobs of 5 ticks: waits 0,5,...,40 = 180. */
    CHECK(exact_schedule(&c, j, 9, &r) == APRM_OK && r.total_wait == 180);
    CHECK(APRM_EXACT_MAX_JOBS == 9);
    j[9].duration = 0;                                            /* also invalid */
    CHECK(exact_schedule(&c, j, 10, &r) == APRM_TOO_LARGE);
    CHECK(r.total_wait == 0 && r.start[0] == 0);
    json_init(&out);
    CHECK(exact_solve(&c, j, 10, &out) == APRM_TOO_LARGE && json_len(&out) == 0);

    j[0] = mkjob(1, 0, 5, 2, 1, 0);                               /* 2 cores on a 1-core machine */
    CHECK(exact_schedule(&c, j, 1, &r) == APRM_CAPACITY_EXCEEDED);
    j[0] = mkjob(1, 0, 5, 1, 2, 0);
    CHECK(exact_schedule(&c, j, 1, &r) == APRM_CAPACITY_EXCEEDED);
    j[0] = mkjob(1, 0, 0, 1, 1, 0);
    CHECK(exact_schedule(&c, j, 1, &r) == APRM_INVALID_FIELD);
    j[0] = mkjob(1, 0, 5, 1, 1, 10);
    CHECK(exact_schedule(&c, j, 1, &r) == APRM_INVALID_FIELD);
    j[0] = mkjob(-1, 0, 5, 1, 1, 0);
    CHECK(exact_schedule(&c, j, 1, &r) == APRM_INVALID_FIELD);
    /* Overflow guard: a time near INT64_MAX is outside PRD section 3 and rejected,
     * so start + duration can never wrap. */
    j[0] = mkjob(1, INT64_MAX - 2, 5, 1, 1, 0);
    CHECK(exact_schedule(&c, j, 1, &r) == APRM_INVALID_FIELD);
    j[0] = mkjob(1, 0, INT64_MAX, 1, 1, 0);
    CHECK(exact_schedule(&c, j, 1, &r) == APRM_INVALID_FIELD);
    j[0] = mkjob(4, 0, 5, 1, 1, 0); j[1] = mkjob(4, 1, 5, 1, 1, 0);
    CHECK(exact_schedule(&c, j, 2, &r) == APRM_DUPLICATE_ID);
    CHECK(exact_schedule(NULL, j, 1, &r) == APRM_INVALID_ARGUMENT);
    CHECK(exact_schedule(&c, NULL, 1, &r) == APRM_INVALID_ARGUMENT);
    CHECK(exact_schedule(&c, j, -1, &r) == APRM_INVALID_ARGUMENT);
    CHECK(exact_schedule(&c, j, 1, NULL) == APRM_INVALID_ARGUMENT);
    CHECK(exact_solve(&c, j, 1, NULL) == APRM_INVALID_ARGUMENT);
    c.cpu_cap = 0;
    CHECK(exact_schedule(&c, j, 1, &r) == APRM_INVALID_ARGUMENT);
    json_free(&out);
}

/* The largest legal values: 9 exclusive jobs of 10^6 ticks arriving at 10^9.
 * Waits 0, 1e6, ..., 8e6 = 36e6. No overflow, exact answer. */
static void test_large_values(void)
{
    SimConfig c = mkcfg(APRM_CPU_CAP_MAX, APRM_MEM_CAP_MAX, POL_FCFS);
    Job j[9];
    ExactResult r;
    int i;
    for (i = 0; i < 9; i++)
        j[i] = mkjob(i, APRM_ARRIVAL_MAX, APRM_DURATION_MAX, APRM_CPU_CAP_MAX, APRM_MEM_CAP_MAX, 9);
    CHECK(exact_schedule(&c, j, 9, &r) == APRM_OK);
    CHECK(r.total_wait == 36000000);
    CHECK(r.start[8] == (int64_t)APRM_ARRIVAL_MAX + 8 * (int64_t)APRM_DURATION_MAX);
}

/* The JSON envelope for the two-job case, byte for byte: rows sorted by id,
 * then total_wait. B (id 2) at 0..2, A (id 1) at 2..12. */
static void test_json_shape(void)
{
    SimConfig c = mkcfg(4, 100, POL_FCFS);
    Job j[2] = { mkjob(2, 0, 2, 3, 10, 5), mkjob(1, 0, 10, 3, 10, 0) };
    JsonBuf out;
    const char *want =
        "{\"ok\":true,\"data\":{\"total_wait\":2,\"schedule\":["
        "{\"id\":1,\"arrival\":0,\"start\":2,\"finish\":12,\"wait\":2,\"turnaround\":12,\"priority\":0,\"cpu\":3,\"mem\":10},"
        "{\"id\":2,\"arrival\":0,\"start\":0,\"finish\":2,\"wait\":0,\"turnaround\":2,\"priority\":5,\"cpu\":3,\"mem\":10}"
        "]}}";
    json_init(&out);
    CHECK(exact_solve(&c, j, 2, &out) == APRM_OK);
    CHECK(strcmp(json_cstr(&out), want) == 0);
    /* A reused buffer is replaced, not appended to. */
    CHECK(exact_solve(&c, j, 2, &out) == APRM_OK && strcmp(json_cstr(&out), want) == 0);
    json_free(&out);
}

/* ================= independent brute force ================= */

typedef struct {
    int n;
    int64_t cap_c, cap_m, horizon;
    int64_t arr[5], dur[5], cpu[5], mem[5];
    int64_t cur[5], best[5], best_cost;
} Brute;

/* 1 if job k started at t is compatible with jobs 0..k-1 (already placed in
 * b->cur), checking the load at every tick of [t, t+dur). */
static int brute_ok(const Brute *b, int k, int64_t t)
{
    int64_t u;
    int i;
    for (u = t; u < t + b->dur[k]; u++) {
        int64_t c = b->cpu[k], m = b->mem[k];
        for (i = 0; i < k; i++)
            if (b->cur[i] <= u && u < b->cur[i] + b->dur[i]) { c += b->cpu[i]; m += b->mem[i]; }
        if (c > b->cap_c || m > b->cap_m) return 0;
    }
    return 1;
}

/* All start vectors in lexicographic order; keeps the first strictly better. */
static void brute_dfs(Brute *b, int k, int64_t cost)
{
    int64_t t;
    if (b->best_cost >= 0 && cost > b->best_cost) return;
    if (k == b->n) {
        if (b->best_cost < 0 || cost < b->best_cost) {
            b->best_cost = cost;
            memcpy(b->best, b->cur, sizeof b->cur);
        }
        return;
    }
    for (t = b->arr[k]; t <= b->horizon; t++) {
        if (!brute_ok(b, k, t)) continue;
        b->cur[k] = t;
        brute_dfs(b, k + 1, cost + (t - b->arr[k]));
    }
}

/* Sort jobs by (arrival, id) into b and run the brute force. */
static void brute(const SimConfig *c, const Job *jobs, int n, Brute *b, int *order)
{
    int i, j;
    int64_t sum = 0, maxa = 0;
    memset(b, 0, sizeof *b);
    for (i = 0; i < n; i++) {
        for (j = i; j > 0; j--) {
            const Job *p = &jobs[order[j - 1]], *q = &jobs[i];
            if (p->arrival < q->arrival || (p->arrival == q->arrival && p->id < q->id)) break;
            order[j] = order[j - 1];
        }
        order[j] = i;
    }
    for (i = 0; i < n; i++) {
        const Job *q = &jobs[order[i]];
        b->arr[i] = q->arrival; b->dur[i] = q->duration; b->cpu[i] = q->cpu; b->mem[i] = q->mem;
        sum += q->duration;
        if (q->arrival > maxa) maxa = q->arrival;
    }
    b->n = n; b->cap_c = c->cpu_cap; b->cap_m = c->mem_cap;
    b->horizon = maxa + sum;
    b->best_cost = -1;
    brute_dfs(b, 0, 0);
}

/* 1500 random instances of 1 to 5 jobs: the solver's total wait AND its start
 * vector (so the tie-break) equal the brute force's, which tries every integer
 * start time. This also tests the claim that serial generation (earliest start
 * per order) loses no optimum. */
static void test_exact_vs_brute(void)
{
    Rng r = { 88172645463325252ULL };
    int it;
    for (it = 0; it < 1500; it++) {
        SimConfig c;
        Job jobs[5];
        Brute b;
        int order[5], n = (int)rnd(&r, 1, 5), i;
        ExactResult e;
        gen(&r, n, &c, jobs);
        brute(&c, jobs, n, &b, order);
        CHECK(exact_schedule(&c, jobs, n, &e) == APRM_OK);
        CHECK(e.total_wait == b.best_cost);
        for (i = 0; i < n; i++) CHECK(e.start[order[i]] == b.best[i]);
    }
}

/* ================= exact is never beaten ================= */

/* Total wait of the schedule an online policy produces, or -1 if the policy
 * is not implemented (sim_step fails). */
static int64_t policy_wait(const SimConfig *base, PolicyKind p, const Job *jobs, int n)
{
    SimConfig c = *base;
    Sim *s = NULL;
    ResultRow *rows = NULL;
    int64_t cnt = 0, total = 0, i;
    int rc = 1, k;
    c.policy = p;
    if (sim_create(&c, &s) != APRM_OK) return -1;
    for (k = 0; k < n; k++)
        if (sim_add_job(s, &jobs[k]) != APRM_OK) { sim_destroy(s); return -1; }
    while ((rc = sim_step(s)) == 1) { }
    if (rc < 0 || sim_results_rows(s, &rows, &cnt) != APRM_OK || cnt != n) {
        free(rows); sim_destroy(s); return -1;
    }
    for (i = 0; i < cnt; i++) total += rows[i].wait;
    free(rows);
    sim_destroy(s);
    return total;
}

/* For 2000 random instances of 2 to 9 jobs, every implemented policy's total
 * wait is >= the exact optimum (a lower bound); and the optimum is strictly
 * smaller for at least some instances (so the test would notice a solver that
 * only copied a policy). Policies: fcfs, priority, sjf, aging, reserve (and
 * knapsack if it exists). */
static void test_exact_not_beaten(void)
{
    static const PolicyKind pols[] = { POL_FCFS, POL_PRIORITY, POL_SJF, POL_AGING, POL_AGING_RESERVE, POL_KNAPSACK };
    Rng r = { 0x9E3779B97F4A7C15ULL };
    int it, strictly = 0, ran[6] = {0, 0, 0, 0, 0, 0};
    for (it = 0; it < 2000; it++) {
        SimConfig c;
        Job jobs[9];
        ExactResult e;
        int n = (it % 20 == 0) ? 9 : (int)rnd(&r, 2, 8), k;
        gen(&r, n, &c, jobs);
        c.alpha_milli = rnd(&r, 0, 1000);
        c.reserve_threshold = rnd(&r, 0, 8);
        CHECK(exact_schedule(&c, jobs, n, &e) == APRM_OK);
        for (k = 0; k < 6; k++) {
            int64_t w = policy_wait(&c, pols[k], jobs, n);
            if (w < 0) continue;
            ran[k]++;
            CHECK(w >= e.total_wait);
            if (w > e.total_wait) strictly++;
        }
    }
    CHECK(ran[0] == 2000 && ran[1] == 2000 && ran[2] == 2000 && ran[3] == 2000 && ran[4] == 2000);
    CHECK(strictly > 0);
}

/* ================= speed and determinism ================= */

/* 9-job instances, including the hardest shapes (everything fits together, so
 * nothing can be cut; everything is exclusive; random mixes), each < 2 seconds
 * (PRD success metric). Release builds take well under 0.1 s. */
static void test_exact_speed(void)
{
    SimConfig c = mkcfg(6, 6000, POL_FCFS);
    Job j[9];
    Rng r = { 12345 };
    ExactResult e;
    int shape, i;
    for (shape = 0; shape < 4; shape++) {
        clock_t t0;
        for (i = 0; i < 9; i++) {
            if (shape == 0) j[i] = mkjob(i, i, 5, 1, 100, 0);                   /* all fit together */
            else if (shape == 1) j[i] = mkjob(i, 0, 1 + (int)rnd(&r, 0, 9), 4, 4000, 0);   /* exclusive */
            else if (shape == 2) j[i] = mkjob(i, 0, 5, 6, 6000, 0);              /* identical, exclusive */
            else j[i] = mkjob(i, rnd(&r, 0, 5), rnd(&r, 1, 10), rnd(&r, 1, 6), rnd(&r, 1, 6000), 0);
        }
        t0 = clock();
        CHECK(exact_schedule(&c, j, 9, &e) == APRM_OK);
        CHECK((double)(clock() - t0) / CLOCKS_PER_SEC < 2.0);
    }
}

/* The same input gives the same output, and permuting the input order does not
 * change any job's start time. */
static void test_exact_deterministic(void)
{
    Rng r = { 777 };
    int it;
    for (it = 0; it < 100; it++) {
        SimConfig c;
        Job a[7], b[7];
        ExactResult x, y, z;
        JsonBuf j1, j2;
        int n = (int)rnd(&r, 1, 7), i, k;
        gen(&r, n, &c, a);
        for (i = 0; i < n; i++) b[i] = a[n - 1 - i];        /* reversed input order */
        CHECK(exact_schedule(&c, a, n, &x) == APRM_OK);
        CHECK(exact_schedule(&c, a, n, &y) == APRM_OK);
        CHECK(memcmp(&x, &y, sizeof x) == 0);
        CHECK(exact_schedule(&c, b, n, &z) == APRM_OK);
        CHECK(z.total_wait == x.total_wait);
        for (i = 0; i < n; i++) CHECK(z.start[n - 1 - i] == x.start[i]);
        json_init(&j1); json_init(&j2);
        CHECK(exact_solve(&c, a, n, &j1) == APRM_OK && exact_solve(&c, b, n, &j2) == APRM_OK);
        k = strcmp(json_cstr(&j1), json_cstr(&j2));
        CHECK(k == 0);
        json_free(&j1); json_free(&j2);
    }
}

/* ================= through the engine (aprm_exact's path) ================= */

/* sim_exact_json solves every job the Sim holds, even after the run: big_job_trap
 * gives total 3. More than 9 jobs is TOO_LARGE; the Sim is not changed. */
static void test_sim_exact_json(void)
{
    SimConfig c = mkcfg(6, 6000, POL_FCFS);
    Sim *s = NULL;
    JsonBuf out;
    int i;
    json_init(&out);
    CHECK(sim_create(&c, &s) == APRM_OK);
    CHECK(sim_exact_json(s, &out) == APRM_OK);     /* empty Sim */
    CHECK(strcmp(json_cstr(&out), "{\"ok\":true,\"data\":{\"total_wait\":0,\"schedule\":[]}}") == 0);
    {
        Job j = mkjob(1, 0, 20, 6, 6000, 0);
        CHECK(sim_add_job(s, &j) == APRM_OK);
    }
    for (i = 2; i <= 6; i++) {
        Job j = mkjob(i, 1, 2, 1, 1000, 9);
        CHECK(sim_add_job(s, &j) == APRM_OK);
    }
    CHECK(sim_step(s) == 1);                        /* job 1 is running, 5 pending */
    CHECK(sim_exact_json(s, &out) == APRM_OK);
    CHECK(strstr(json_cstr(&out), "\"total_wait\":3,") != NULL);
    while (sim_step(s) == 1) { }                    /* all finished */
    CHECK(sim_exact_json(s, &out) == APRM_OK);
    CHECK(strstr(json_cstr(&out), "\"total_wait\":3,") != NULL);
    for (i = 7; i <= 10; i++) {
        Job j = mkjob(i, 100, 2, 1, 1000, 9);
        CHECK(sim_add_job(s, &j) == APRM_OK);
    }
    CHECK(sim_exact_json(s, &out) == APRM_TOO_LARGE && json_len(&out) == 0);
    CHECK(sim_exact_json(NULL, &out) == APRM_INVALID_ARGUMENT);
    CHECK(sim_exact_json(s, NULL) == APRM_INVALID_ARGUMENT);
    sim_destroy(s);
    json_free(&out);
}

int main(void)
{
    test_empty();
    test_one_job();
    test_two_jobs();
    test_three_jobs();
    test_big_job_trap();
    test_tie_break();
    test_more_ties();
    test_limits_and_errors();
    test_large_values();
    test_json_shape();
    test_exact_vs_brute();
    test_exact_not_beaten();
    test_exact_speed();
    test_exact_deterministic();
    test_sim_exact_json();
    return TEST_REPORT();
}
