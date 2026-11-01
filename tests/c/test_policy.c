/* test_policy.c: the ordering policies (K-19): static priority, SJF and
 * adaptive aging. Key order, tie-breaks, no re-sort over time, alpha 0 =
 * static priority, key limits, determinism. */
#define APRM_ENGINE_INTERNAL  /* lets the test read the waiting heap and finished list */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "../../core/config.h"
#include "../../core/engine_internal.h"
#include "test_main.h"

static Job mk(int32_t id, int64_t arrival, int64_t duration, int32_t priority)
{
    Job j;
    j.id = id; j.arrival = arrival; j.duration = duration;
    j.cpu = 16; j.mem = 1000; j.priority = priority;
    return j;
}

static SimConfig cfg_for(PolicyKind p, int64_t alpha_milli)
{
    SimConfig c;
    memset(&c, 0, sizeof c);
    c.cpu_cap = 16; c.mem_cap = 32768; c.policy = p;
    c.alpha_milli = alpha_milli; c.reserve_threshold = 50; c.knapsack_eps = 0.1;
    c.max_jobs = 5000;
    return c;
}

/* sign of a compare result */
static int sgn(int v) { return (v > 0) - (v < 0); }

/* Aging key K = 1000 b - alpha_milli r, asserting success. */
static int64_t akey(const Job *j, int64_t alpha_milli)
{
    int64_t k = 0;
    CHECK(policy_aging_key(j, alpha_milli, &k) == APRM_OK);
    return k;
}

/* ---- key order of each compare ---- */

static void test_priority_order(void)
{
    Job hi = mk(5, 9, 100, 7), lo = mk(1, 0, 1, 2);
    Job early = mk(8, 1, 3, 7), late = mk(2, 2, 3, 7);
    Job low_id = mk(3, 4, 3, 7), high_id = mk(9, 4, 3, 7);
    CHECK(policy_priority_compare(&hi, &lo) < 0);       /* higher priority first, though later */
    CHECK(policy_priority_compare(&lo, &hi) > 0);
    CHECK(policy_priority_compare(&early, &late) < 0);  /* tie: earlier arrival, even with higher id */
    CHECK(policy_priority_compare(&low_id, &high_id) < 0);  /* tie: lower id */
    CHECK(policy_priority_compare(&hi, &hi) == 0);
    CHECK(sgn(policy_priority_compare(&hi, &lo)) == -sgn(policy_priority_compare(&lo, &hi)));
}

static void test_sjf_order(void)
{
    Job shortj = mk(5, 9, 2, 0), longj = mk(1, 0, 50, 9);
    Job early = mk(8, 1, 4, 0), late = mk(2, 2, 4, 9);
    Job low_id = mk(3, 4, 4, 0), high_id = mk(9, 4, 4, 0);
    CHECK(policy_sjf_compare(&shortj, &longj) < 0);     /* shorter first; priority ignored */
    CHECK(policy_sjf_compare(&longj, &shortj) > 0);
    CHECK(policy_sjf_compare(&early, &late) < 0);       /* tie: earlier arrival */
    CHECK(policy_sjf_compare(&low_id, &high_id) < 0);   /* tie: lower id */
    CHECK(policy_sjf_compare(&shortj, &shortj) == 0);
}

static void test_fcfs_compare_for_table(void)
{
    CHECK(policy_compare_for(POL_FCFS) == policy_fcfs_compare);
    CHECK(policy_compare_for(POL_PRIORITY) == policy_priority_compare);
    CHECK(policy_compare_for(POL_SJF) == policy_sjf_compare);
    CHECK(policy_compare_for(POL_AGING) != NULL);
    CHECK(policy_compare_for(POL_AGING_RESERVE) == NULL);   /* K-26 */
    CHECK(policy_compare_for(POL_KNAPSACK) == NULL);        /* K-34 */
}

/* ---- aging key ---- */

static void test_aging_key_values(void)
{
    /* BLUEPRINT 3.3 / golden aging_tiebreak: alpha_milli 100. */
    Job j1 = mk(1, 0, 14, 9), j2 = mk(2, 1, 3, 2), j3 = mk(3, 11, 3, 3), j4 = mk(4, 5, 3, 1);
    CHECK(akey(&j1, 100) == 9000);
    CHECK(akey(&j2, 100) == 1900);
    CHECK(akey(&j3, 100) == 1900);
    CHECK(akey(&j4, 100) == 500);
    CHECK(akey(&j1, 0) == 9000);        /* alpha 0: arrival does not matter */
    CHECK(akey(&j3, 0) == 3000);
}

static void test_aging_key_limits(void)
{
    /* PRD section 3 extremes: arrival 10^9, alpha_milli 10,000, priority 0 and 9. */
    Job a = mk(1, APRM_ARRIVAL_MAX, 1, 0), b = mk(2, APRM_ARRIVAL_MAX, 1, 9), c = mk(3, 0, 1, 9);
    int64_t k = 0;
    CHECK(akey(&a, APRM_ALPHA_MILLI_MAX) == -(int64_t)10000 * 1000000000LL);   /* -10^13 exactly */
    CHECK(akey(&b, APRM_ALPHA_MILLI_MAX) == 9000 - (int64_t)10000 * 1000000000LL);
    CHECK(akey(&c, APRM_ALPHA_MILLI_MAX) == 9000);
    CHECK(akey(&a, 0) == 0);
    /* The engine heap key (smaller first) is the negation, and negating cannot overflow. */
    CHECK(policy_wait_key(POL_AGING, APRM_ALPHA_MILLI_MAX, &a, &k) == APRM_OK);
    CHECK(k == (int64_t)10000 * 1000000000LL);
    /* Out-of-range input is refused instead of overflowing. */
    a.arrival = INT64_MAX;
    CHECK(policy_aging_key(&a, APRM_ALPHA_MILLI_MAX, &k) == APRM_INVALID_FIELD);
    a.arrival = 0;
    CHECK(policy_aging_key(&a, INT64_MAX, &k) == APRM_INVALID_FIELD);
    CHECK(policy_aging_key(&a, -1, &k) == APRM_INVALID_FIELD);
    CHECK(policy_aging_key(NULL, 100, &k) == APRM_INVALID_ARGUMENT);
    CHECK(policy_aging_key(&a, 100, NULL) == APRM_INVALID_ARGUMENT);
    /* Other policies have no key (0). */
    CHECK(policy_wait_key(POL_PRIORITY, 100, &a, &k) == APRM_OK && k == 0);
    CHECK(policy_wait_key(POL_SJF, 100, &a, &k) == APRM_OK && k == 0);
    CHECK(policy_wait_key(POL_FCFS, 100, &a, &k) == APRM_OK && k == 0);
}

static void test_aging_bound(void)
{
    /* BLUEPRINT 3.3: alpha_milli 100, priorities 0..9: after 1000*(9-0)/100 = 90 ticks no
     * new arrival outranks a priority-0 job. A priority-9 job arriving 91 ticks later ranks below. */
    Job old0 = mk(1, 0, 5, 0), new9_91 = mk(2, 91, 5, 9), new9_90 = mk(3, 90, 5, 9);
    CHECK(akey(&old0, 100) > akey(&new9_91, 100));      /* 0 > 9000 - 9100 = -100 */
    CHECK(akey(&old0, 100) == 0 && akey(&new9_91, 100) == -100);
    CHECK(akey(&old0, 100) == akey(&new9_90, 100));     /* exactly 90: a tie on the key ... */
    /* ... resolved by arrival (old0 first). */
    Sim *s = NULL;
    SimConfig c = cfg_for(POL_AGING, 100);
    Job blocker = mk(10, 0, 200, 9);  /* occupies the machine until 200 */
    WaitEntry top;
    CHECK(sim_create(&c, &s) == APRM_OK);
    CHECK(sim_add_job(s, &blocker) == APRM_OK);
    CHECK(sim_add_job(s, &old0) == APRM_OK);
    CHECK(sim_add_job(s, &new9_91) == APRM_OK);
    while (s->now < 91 && sim_step(s) == 1) { }
    CHECK(heap_peek(&s->waiting, &top) == APRM_OK && top.job.id == 1);
    sim_destroy(s);
}

/* Run a workload to the end; start times by id go into start[] (size n_ids). */
static void run(const SimConfig *c, const Job *jobs, size_t n, int64_t *start, int32_t max_id)
{
    Sim *s = NULL;
    size_t i;
    CHECK(sim_create(c, &s) == APRM_OK);
    for (i = 0; i < n; i++) CHECK(sim_add_job(s, &jobs[i]) == APRM_OK);
    while (sim_step(s) == 1) { }
    for (i = 0; i <= (size_t)max_id; i++) start[i] = -1;
    for (i = 0; i < s->fin_len; i++) start[s->fin[i].job.id] = s->fin[i].start;
    CHECK(s->fin_len == n);
    sim_destroy(s);
}

static void test_aging_no_resort(void)
{
    /* The blocker holds the machine for 1000 ticks; five jobs wait while time passes.
     * The head of the waiting heap must be the same job at every step (order never changes),
     * and the start order afterwards is the key order. */
    Sim *s = NULL;
    SimConfig c = cfg_for(POL_AGING, 100);
    Job blocker = mk(0, 0, 1000, 9);
    Job w[5];
    WaitEntry top;
    int32_t head = -1;
    int64_t start[8];
    Job all[6];
    /* keys at alpha 100: j1 = 1000*3 - 100*10 = 2000, j2 = 5000 - 3000 = 2000 (tie: j1 arrived
     * earlier), j3 = 0 - 100*100 = -10000, j4 = 9000 - 100*500 = -41000, j5 = 1000 - 100*600 = -59000 */
    int i;
    w[0] = mk(1, 10, 5, 3); w[1] = mk(2, 30, 5, 5); w[2] = mk(3, 100, 5, 0);
    w[3] = mk(4, 500, 5, 9); w[4] = mk(5, 600, 5, 1);
    CHECK(sim_create(&c, &s) == APRM_OK);
    CHECK(sim_add_job(s, &blocker) == APRM_OK);
    for (i = 0; i < 5; i++) CHECK(sim_add_job(s, &w[i]) == APRM_OK);
    while (s->now < 999 && sim_step(s) == 1) {
        if (heap_peek(&s->waiting, &top) == APRM_OK) {
            /* once job 1 is the head, it stays the head until it starts (nothing outranks it) */
            if (top.job.id == 1) head = 1;
            if (head == 1 && s->now < 1000) CHECK(top.job.id == 1);
        }
    }
    CHECK(head == 1);
    sim_destroy(s);
    all[0] = blocker;
    for (i = 0; i < 5; i++) all[i + 1] = w[i];
    run(&c, all, 6, start, 5);
    CHECK(start[1] == 1000 && start[2] == 1005 && start[3] == 1010 && start[4] == 1015 && start[5] == 1020);
}

static void test_aging_alpha0(void)
{
    /* alpha_milli 0: aging is exactly static priority, for the same jobs. */
    Job jobs[7];
    int64_t sa[8], sp[8];
    int i;
    SimConfig ca = cfg_for(POL_AGING, 0), cp = cfg_for(POL_PRIORITY, 0);
    jobs[0] = mk(1, 0, 30, 0); jobs[1] = mk(2, 1, 2, 3); jobs[2] = mk(3, 2, 2, 8);
    jobs[3] = mk(4, 3, 2, 8);  jobs[4] = mk(5, 25, 2, 4); jobs[5] = mk(6, 3, 2, 8);
    jobs[6] = mk(7, 26, 2, 3);
    run(&ca, jobs, 7, sa, 7);
    run(&cp, jobs, 7, sp, 7);
    for (i = 1; i <= 7; i++) CHECK(sa[i] == sp[i]);
    /* and with alpha 100 the schedule differs (job 2 overtakes job 5), so the test can fail */
    {
        int64_t sd[8];
        SimConfig cd = cfg_for(POL_AGING, 100);
        run(&cd, jobs, 7, sd, 7);
        CHECK(sd[2] < sd[5]);
        CHECK(sp[5] < sp[2]);
    }
}

static void test_aging_overtakes_static_priority(void)
{
    /* job 2: priority 4, arrival 1 (key 3900); job 3: priority 5, arrival 12 (key 3800).
     * Static priority runs 3 first; aging runs 2 first. */
    Job jobs[4];
    int64_t sa[5], sp[5];
    SimConfig ca = cfg_for(POL_AGING, 100), cp = cfg_for(POL_PRIORITY, 100);
    jobs[0] = mk(1, 0, 20, 9); jobs[1] = mk(2, 1, 3, 4); jobs[2] = mk(3, 12, 3, 5); jobs[3] = mk(4, 15, 3, 5);
    run(&ca, jobs, 4, sa, 4);
    run(&cp, jobs, 4, sp, 4);
    CHECK(sa[2] == 20 && sa[3] == 23 && sa[4] == 26);
    CHECK(sp[3] == 20 && sp[4] == 23 && sp[2] == 26);
}

static void test_ties_end_to_end(void)
{
    /* Equal keys everywhere: arrival, then id decide, whatever the insertion order. */
    Job a[4], b[4];
    int64_t sa[8], sb[8];
    int i;
    SimConfig p = cfg_for(POL_PRIORITY, 100), j = cfg_for(POL_SJF, 100), g = cfg_for(POL_AGING, 0);
    SimConfig cs[3];
    cs[0] = p; cs[1] = j; cs[2] = g;
    a[0] = mk(1, 0, 10, 5);  a[1] = mk(7, 1, 3, 5); a[2] = mk(3, 1, 3, 5); a[3] = mk(2, 1, 3, 5);
    for (i = 0; i < 4; i++) b[i] = a[3 - i];   /* reversed insertion order */
    for (i = 0; i < 3; i++) {
        run(&cs[i], a, 4, sa, 7);
        run(&cs[i], b, 4, sb, 7);
        CHECK(sa[1] == 0 && sa[2] == 10 && sa[3] == 13 && sa[7] == 16);
        CHECK(sa[2] == sb[2] && sa[3] == sb[3] && sa[7] == sb[7]);   /* determinism */
    }
}

static void test_determinism_repeat(void)
{
    Job jobs[6];
    int64_t s1[7], s2[7];
    int i;
    SimConfig c = cfg_for(POL_AGING, 250);
    jobs[0] = mk(1, 0, 9, 2); jobs[1] = mk(2, 2, 4, 9); jobs[2] = mk(3, 3, 1, 0);
    jobs[3] = mk(4, 3, 7, 5); jobs[4] = mk(5, 8, 2, 5); jobs[5] = mk(6, 20, 2, 9);
    run(&c, jobs, 6, s1, 6);
    run(&c, jobs, 6, s2, 6);
    for (i = 1; i <= 6; i++) CHECK(s1[i] == s2[i]);
}

int main(void)
{
    test_priority_order();
    test_sjf_order();
    test_fcfs_compare_for_table();
    test_aging_key_values();
    test_aging_key_limits();
    test_aging_bound();
    test_aging_no_resort();
    test_aging_alpha0();
    test_aging_overtakes_static_priority();
    test_ties_end_to_end();
    test_determinism_repeat();
    return TEST_REPORT();
}
