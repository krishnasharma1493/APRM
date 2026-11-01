/* test_reserve.c: reservation (EASY-style backfilling), issue K-26.
 * BLUEPRINT 3.5; DECISIONS D18 and the answer to O-14 (a reservation is never
 * cancelled or moved). Every expected number below was worked out by hand
 * (see the comment above each test). Part 1 tests the pure functions in
 * core/reserve.c; part 2 runs whole schedules through the engine. */
#define APRM_ENGINE_INTERNAL  /* read the Sim: reservation, finished list, log */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "../../core/config.h"
#include "../../core/engine_internal.h"
#include "../../core/reserve.h"
#include "test_main.h"

/* ================= part 1: pure functions ================= */

static RunSlot slot(int64_t finish, int64_t cpu, int64_t mem)
{
    RunSlot r;
    r.finish = finish; r.cpu = cpu; r.mem = mem;
    return r;
}

/* Machine 10 cores / 100 MB. Running: A finishes 10 (2 cores, 20 MB), B
 * finishes 20 (2, 30), C finishes 30 (2, 10). Used 6 cores / 60 MB, so free
 * 4 / 40. h needs 2 cores / 70 MB. After A: 60 MB free, not enough. After B:
 * 90 MB free >= 70 (cores 8 >= 2): shadow = 20. Extra room: 8 - 2 = 6 cores,
 * 90 - 70 = 20 MB. The input is deliberately not sorted. */
static void test_shadow_time(void)
{
    RunSlot runs[3];
    Reservation r;
    runs[0] = slot(30, 2, 10); runs[1] = slot(10, 2, 20); runs[2] = slot(20, 2, 30);
    CHECK(reserve_compute(runs, 3, 4, 40, 7, 2, 70, &r) == APRM_OK);
    CHECK(r.active == 1 && r.id == 7);
    CHECK(r.shadow_time == 20);
    CHECK(r.extra_cpu == 6 && r.extra_mem == 20);
}

/* Two jobs finish at the same tick 20 (30 MB each); C finishes at 40 (10 MB).
 * Machine 10 / 100, used 70 MB, free 30 MB, cores free 7. h needs 1 core and
 * 60 MB. Releasing only A would already fit (60 MB), but A and B end at the
 * same tick, so both are released: free 90 MB, extra = 90 - 60 = 30 MB (not
 * 0, which a one-at-a-time walk would give). Shadow = 20. */
static void test_shadow_ties_released_together(void)
{
    RunSlot runs[3];
    Reservation r;
    runs[0] = slot(20, 1, 30); runs[1] = slot(20, 1, 30); runs[2] = slot(40, 1, 10);
    CHECK(reserve_compute(runs, 3, 7, 30, 1, 1, 60, &r) == APRM_OK);
    CHECK(r.shadow_time == 20 && r.extra_cpu == 7 + 2 - 1 && r.extra_mem == 30);
}

/* CPU is the binding resource. Machine 10 cores / 100 MB. A (finish 10) and B
 * (finish 20) use 4 cores and 1 MB each: free 2 / 98. h needs 8 cores, 5 MB.
 * After A: 6 cores, not enough. After B: 10 >= 8: shadow 20, extra 2 cores,
 * 100 - 5 = 95 MB. */
static void test_shadow_cpu_binding(void)
{
    RunSlot runs[2];
    Reservation r;
    runs[0] = slot(10, 4, 1); runs[1] = slot(20, 4, 1);
    CHECK(reserve_compute(runs, 2, 2, 98, 3, 8, 5, &r) == APRM_OK);
    CHECK(r.shadow_time == 20 && r.extra_cpu == 2 && r.extra_mem == 95);
}

/* The first release is already enough: shadow = the earliest finish. */
static void test_shadow_first_release_enough(void)
{
    RunSlot runs[2];
    Reservation r;
    runs[0] = slot(5, 6, 60); runs[1] = slot(9, 1, 1);
    /* machine 10 / 100: used 7 / 61, free 3 / 39; h needs 8 cores, 90 MB.
     * After A (finish 5): 9 cores, 99 MB: fits. Shadow 5; the job finishing
     * at 9 is not released. Extra room 9 - 8 = 1 core, 99 - 90 = 9 MB. */
    CHECK(reserve_compute(runs, 2, 3, 39, 2, 8, 90, &r) == APRM_OK);
    CHECK(r.shadow_time == 5);
    CHECK(r.extra_cpu == 1 && r.extra_mem == 9);
}

/* Bad calls: NULL, h already fits, h never fits (caller bugs). */
static void test_compute_errors(void)
{
    RunSlot runs[1];
    Reservation r;
    runs[0] = slot(10, 2, 2);
    CHECK(reserve_compute(runs, 1, 1, 1, 1, 1, 1, NULL) == APRM_INVALID_ARGUMENT);
    CHECK(reserve_compute(NULL, 1, 1, 1, 1, 5, 5, &r) == APRM_INVALID_ARGUMENT);
    CHECK(reserve_compute(runs, 1, 5, 5, 1, 2, 2, &r) == APRM_INVALID_ARGUMENT);  /* fits now */
    CHECK(reserve_compute(runs, 1, 1, 1, 1, 50, 50, &r) == APRM_INVALID_ARGUMENT); /* never fits */
    CHECK(reserve_compute(NULL, 0, 1, 1, 1, 5, 5, &r) == APRM_INVALID_ARGUMENT);   /* nothing to wait for */
}

static Job mkjob(int64_t dur, int64_t cpu, int64_t mem)
{
    Job j;
    memset(&j, 0, sizeof j);
    j.id = 1; j.duration = dur; j.cpu = cpu; j.mem = mem;
    return j;
}

/* Reservation: shadow 20, extra room 4 cores / 20 MB, now 12, free 6 / 50. */
static Reservation sample_reservation(void)
{
    Reservation r;
    memset(&r, 0, sizeof r);
    r.active = 1; r.id = 9; r.shadow_time = 20; r.extra_cpu = 4; r.extra_mem = 20;
    return r;
}

static void test_backfill_rule(void)
{
    Reservation r = sample_reservation();
    Job j;
    int by_time = -1;

    /* finish 12 + 8 = 20 == shadow: allowed (at or before), extra untouched */
    j = mkjob(8, 1, 40);
    CHECK(reserve_backfill(&r, 12, 6, 50, &j, &by_time) == 1 && by_time == 1);
    CHECK(r.extra_cpu == 4 && r.extra_mem == 20);

    /* finish 21 > shadow and 40 MB > 20 MB extra: refused, nothing changes */
    j = mkjob(9, 1, 40);
    CHECK(reserve_backfill(&r, 12, 6, 50, &j, &by_time) == 0);
    CHECK(r.extra_cpu == 4 && r.extra_mem == 20);

    /* finish 21 but 2 cores / 15 MB fit the extra room: allowed, room shrinks */
    j = mkjob(9, 2, 15);
    CHECK(reserve_backfill(&r, 12, 6, 50, &j, &by_time) == 1 && by_time == 0);
    CHECK(r.extra_cpu == 2 && r.extra_mem == 5);

    /* the shrunk room refuses a third long job: 3 cores > 2 */
    j = mkjob(100, 3, 1);
    CHECK(reserve_backfill(&r, 12, 6, 50, &j, &by_time) == 0);
    /* and one that is short on memory: 6 MB > 5 */
    j = mkjob(100, 1, 6);
    CHECK(reserve_backfill(&r, 12, 6, 50, &j, &by_time) == 0);
    /* exactly the room that is left (2 cores, 5 MB): allowed, room is now 0 / 0 */
    j = mkjob(100, 2, 5);
    CHECK(reserve_backfill(&r, 12, 6, 50, &j, &by_time) == 1);
    CHECK(r.extra_cpu == 0 && r.extra_mem == 0);

    /* a job that does not fit now is refused even if it ends in time */
    r = sample_reservation();
    j = mkjob(1, 7, 1);                                  /* 7 cores > 6 free */
    CHECK(reserve_backfill(&r, 12, 6, 50, &j, &by_time) == 0);
    j = mkjob(1, 1, 51);                                 /* 51 MB > 50 free */
    CHECK(reserve_backfill(&r, 12, 6, 50, &j, &by_time) == 0);

    /* no reservation: nothing to protect, any fitting job passes */
    r.active = 0;
    j = mkjob(1000, 6, 50);
    CHECK(reserve_backfill(&r, 12, 6, 50, &j, &by_time) == 1);
    CHECK(reserve_backfill(NULL, 12, 6, 50, &j, &by_time) == 0);
    CHECK(reserve_backfill(&r, 12, 6, 50, NULL, &by_time) == 0);
}

/* now + duration would overflow int64: it is NOT "before the shadow time"
 * (and the arithmetic must not wrap into a small number). */
static void test_backfill_overflow(void)
{
    Reservation r = sample_reservation();
    Job j = mkjob(100, 1, 1000);
    int by_time = -1;
    j.mem = 1000;
    r.extra_mem = 5;
    CHECK(reserve_backfill(&r, INT64_MAX - 5, 6, 5000, &j, &by_time) == 0);
    j.mem = 1;
    CHECK(reserve_backfill(&r, INT64_MAX - 5, 6, 5000, &j, &by_time) == 1 && by_time == 0);
}

/* ================= part 2: whole schedules ================= */

static Sim *mk(int64_t cpu, int64_t mem, int64_t alpha, int64_t T, PolicyKind pol)
{
    SimConfig c;
    Sim *s = NULL;
    memset(&c, 0, sizeof c);
    c.cpu_cap = cpu; c.mem_cap = mem; c.policy = pol;
    c.alpha_milli = alpha; c.reserve_threshold = T; c.knapsack_eps_milli = 100;
    c.max_jobs = 5000;
    CHECK(sim_create(&c, &s) == APRM_OK);
    return s;
}

static void addj(Sim *s, int32_t id, int64_t arr, int64_t dur, int64_t cpu, int64_t mem, int32_t prio)
{
    Job j;
    j.id = id; j.arrival = arr; j.duration = dur; j.cpu = cpu; j.mem = mem; j.priority = prio;
    CHECK(sim_add_job(s, &j) == APRM_OK);
}

static void run_all(Sim *s)
{
    int rc;
    while ((rc = sim_step(s)) == 1) { }
    CHECK(rc == 0);
}

/* Start time of a finished job, -1 if not found. */
static int64_t start_of(const Sim *s, int32_t id)
{
    size_t i;
    for (i = 0; i < s->fin_len; i++)
        if (s->fin[i].job.id == id) return s->fin[i].start;
    return -1;
}

/* Number of log entries of a kind (for job, or -1 for any job). */
static int log_count(const Sim *s, LogKind k, int32_t job)
{
    size_t i;
    int n = 0;
    for (i = 0; i < s->log.len; i++)
        if (s->log.e[i].kind == k && (job < 0 || s->log.e[i].job == job)) n++;
    return n;
}

/* The log entry of kind k for a job (first one), or NULL. */
static const LogEntry *log_find(const Sim *s, LogKind k, int32_t job)
{
    size_t i;
    for (i = 0; i < s->log.len; i++)
        if (s->log.e[i].kind == k && s->log.e[i].job == job) return &s->log.e[i];
    return NULL;
}

static void state_has(const Sim *s, const char *needle)
{
    JsonBuf j;
    json_init(&j);
    CHECK(sim_state_json(s, &j) == APRM_OK);
    if (strstr(json_cstr(&j), needle) == NULL) {
        CHECK(0 && "state json lacks the expected text");
    } else {
        CHECK(1);
    }
    json_free(&j);
}

/* Build the S1 workload (machine 10 cores / 100 MB, alpha 0 so the order is
 * priority, then arrival, then id):
 *   1: arr 0  dur 20 cpu 2 mem 60 prio 0   runs 0..20
 *   2: arr 1  dur 5  cpu 2 mem 70 prio 9   the big job h
 *   3: arr 6  dur 4  cpu 1 mem 10 prio 0
 *   4: arr 7  dur 50 cpu 1 mem 25 prio 0
 *   5: arr 16 dur 50 cpu 1 mem 10 prio 0
 * Worked with T = 5:
 *  t=0  job 1 starts (free 8 / 40).
 *  t=1  job 2 needs 70 MB > 40: set aside, waited 0 < 5: no reservation.
 *  t=6  job 3 arrives. Job 2 is best, does not fit, waited 6 - 1 = 5 >= 5:
 *       reservation. Running: job 1 (finish 20). After it: 100 MB: fits.
 *       Shadow 20. Extra room: 10 - 2 = 8 cores, 100 - 70 = 30 MB.
 *       Job 3: fits (10 MB <= 40), finishes 6 + 4 = 10 <= 20: backfilled, 6..10.
 *  t=7  job 4 (1, 25): fits (free MB 30), finishes 57 > 20, but 1 <= 8 and
 *       25 <= 30: backfilled via the extra room, 7..57. Extra room: 7 / 5.
 *  t=10 job 3 finishes (free MB 100 - 60 - 25 = 15).
 *  t=16 job 5 (1, 10) arrives: fits (10 <= 15), finishes 66 > 20, 10 MB > 5
 *       extra: refused, waits.
 *  t=20 job 1 finishes: free 100 - 25 = 75 MB >= 70: job 2 starts first, 20..25.
 *       Reservation cleared. Job 5: free MB 5 < 10: waits (waited 4 < 5: no
 *       new reservation).
 *  t=25 job 2 finishes, free MB 75: job 5 starts 25..75.
 * Starts: 1:0, 2:20, 3:6, 4:7, 5:25. */
static Sim *build_s1(int64_t T, PolicyKind pol)
{
    Sim *s = mk(10, 100, 0, T, pol);
    addj(s, 1, 0, 20, 2, 60, 0);
    addj(s, 2, 1, 5, 2, 70, 9);
    addj(s, 3, 6, 4, 1, 10, 0);
    addj(s, 4, 7, 50, 1, 25, 0);
    addj(s, 5, 16, 50, 1, 10, 0);
    return s;
}

static void test_s1_schedule_and_state(void)
{
    Sim *s = build_s1(5, POL_AGING_RESERVE);
    const LogEntry *e;
    char msg[256];
    size_t i;

    CHECK(sim_run_until(s, 1) == APRM_OK);
    CHECK(s->resv.active == 0);
    state_has(s, "\"reservation\":null");

    CHECK(sim_run_until(s, 6) == APRM_OK);                 /* t = 6 */
    CHECK(s->now == 6 && s->resv.active == 1);
    CHECK(s->resv.id == 2 && s->resv.shadow_time == 20);
    CHECK(s->resv.extra_cpu == 8 && s->resv.extra_mem == 30 - 0);
    state_has(s, "\"reservation\":{\"id\":2,\"shadow_time\":20}");
    e = log_find(s, LOG_RESERVE, 2);
    CHECK(e != NULL && e->t == 6 && e->a[0] == 20);
    e = log_find(s, LOG_BACKFILL, 3);
    CHECK(e != NULL && e->t == 6 && e->a[0] == 10 && e->a[1] == 20);

    CHECK(sim_run_until(s, 7) == APRM_OK);                 /* t = 7: extra-room backfill */
    CHECK(s->resv.extra_cpu == 7 && s->resv.extra_mem == 5);
    e = log_find(s, LOG_BACKFILL, 4);
    CHECK(e != NULL && e->t == 7 && e->a[0] == 57 && e->a[1] == 20);

    CHECK(sim_run_until(s, 16) == APRM_OK);                /* t = 16: job 5 refused */
    CHECK(log_count(s, LOG_START, 5) == 0 && log_count(s, LOG_BACKFILL, 5) == 0);
    CHECK(heap_size(&s->waiting) == 2);                    /* jobs 2 and 5 */
    CHECK(s->resv.active == 1 && s->resv.shadow_time == 20);   /* unchanged */

    CHECK(sim_run_until(s, 20) == APRM_OK);                /* t = 20: h starts first */
    CHECK(s->now == 20 && s->resv.active == 0);
    state_has(s, "\"reservation\":null");
    run_all(s);

    CHECK(start_of(s, 1) == 0 && start_of(s, 2) == 20 && start_of(s, 3) == 6);
    CHECK(start_of(s, 4) == 7 && start_of(s, 5) == 25);
    CHECK(log_count(s, LOG_RESERVE, -1) == 1);
    CHECK(log_count(s, LOG_BACKFILL, -1) == 2);
    CHECK(log_count(s, LOG_START, -1) == 5);               /* every start has its START line */

    /* sentences */
    for (i = 0; i < s->log.len; i++) {
        if (s->log.e[i].kind == LOG_RESERVE) {
            CHECK(sim_log_message(s, (int64_t)i, msg, sizeof msg) > 0);
            CHECK(strcmp(msg, "Job 2 reserved: start guaranteed at t=20.") == 0);
        }
        if (s->log.e[i].kind == LOG_BACKFILL && s->log.e[i].job == 3) {
            CHECK(sim_log_message(s, (int64_t)i, msg, sizeof msg) > 0);
            CHECK(strcmp(msg, "Job 3 backfilled: finishes at t=10, before the reservation at t=20.") == 0);
        }
        if (s->log.e[i].kind == LOG_BACKFILL && s->log.e[i].job == 4) {
            CHECK(sim_log_message(s, (int64_t)i, msg, sizeof msg) > 0);
            CHECK(strstr(msg, "Job 4 backfilled: finishes at t=57, after the reservation at t=20") == msg);
        }
    }
    sim_destroy(s);
}

/* The start of the reserved job is the shadow time, to the tick. */
static void test_h_starts_at_shadow(void)
{
    Sim *s = build_s1(5, POL_AGING_RESERVE);
    run_all(s);
    CHECK(start_of(s, 2) == 20);
    sim_destroy(s);
}

/* Trigger threshold T on the same workload.
 *  T = 5: reservation made at t = 6 (waited exactly T).
 *  T = 6: at t = 6 job 2 has waited 5 < 6: no reservation; job 3 starts by
 *         plain greedy fill. At t = 7 (job 4 arrives) job 2 has waited 6 >= 6:
 *         reservation, shadow 20 (running: job 3 ends 10, job 1 ends 20; after
 *         both 100 MB free), extra 8 / 30. Job 4 (1, 25): extra room, 7..57.
 *         The schedule is the same as for T = 5.
 *  T = 0: reservation already at t = 1, shadow 20, same schedule.
 *  T = 1000000 (never reached): no reservation ever; plain aging. Job 5 starts
 *         at 16 (fits), runs 16..66; job 2 needs 70 MB: job 4 (25 MB, 7..57)
 *         and job 5 (10 MB) hold 35 MB, so 65 MB are free after job 1 ends at
 *         20: job 2 waits until job 4 ends at 57 (then 90 MB free): start 57. */
static void test_trigger_threshold(void)
{
    Sim *s;
    const LogEntry *e;

    s = build_s1(5, POL_AGING_RESERVE); run_all(s);
    e = log_find(s, LOG_RESERVE, 2);
    CHECK(e != NULL && e->t == 6 && e->a[0] == 20);
    sim_destroy(s);

    s = build_s1(6, POL_AGING_RESERVE); run_all(s);
    e = log_find(s, LOG_RESERVE, 2);
    CHECK(e != NULL && e->t == 7 && e->a[0] == 20);
    CHECK(start_of(s, 2) == 20 && start_of(s, 3) == 6 && start_of(s, 4) == 7 && start_of(s, 5) == 25);
    sim_destroy(s);

    s = build_s1(0, POL_AGING_RESERVE); run_all(s);
    e = log_find(s, LOG_RESERVE, 2);
    CHECK(e != NULL && e->t == 1 && e->a[0] == 20);
    CHECK(start_of(s, 2) == 20 && start_of(s, 3) == 6 && start_of(s, 4) == 7 && start_of(s, 5) == 25);
    sim_destroy(s);

    s = build_s1(APRM_RESERVE_T_MAX, POL_AGING_RESERVE); run_all(s);
    CHECK(log_count(s, LOG_RESERVE, -1) == 0 && log_count(s, LOG_BACKFILL, -1) == 0);
    CHECK(start_of(s, 2) == 57 && start_of(s, 5) == 16 && start_of(s, 4) == 7);
    sim_destroy(s);

    /* the plain aging policy gives the same schedule as T = infinity */
    s = build_s1(5, POL_AGING); run_all(s);
    CHECK(start_of(s, 2) == 57 && start_of(s, 5) == 16);
    sim_destroy(s);
}

/* O-14: a newcomer that outranks the reserved job does not cancel or move the
 * reservation and cannot start unless the backfill rule lets it.
 * Machine 10 / 100, alpha 0, T = 0.
 *   1: arr 0 dur 20 cpu 2 mem 60 prio 0
 *   2: arr 1 dur 5  cpu 2 mem 70 prio 5   (h)
 *   3: arr 2 dur 30 cpu 1 mem 35 prio 9   (outranks h)
 * t=1: reservation for job 2, shadow 20, extra 8 / 30.
 * t=2: job 3 is now the best job. It fits (35 <= 40 free) but ends at 32 > 20
 *      and 35 MB > 30 extra: refused. The reservation is unchanged.
 * t=20: job 1 ends; free 100. Job 2 starts FIRST (20..25), free MB 30; job 3
 *      (35 MB) no longer fits (and, T = 0, now gets its own reservation, shadow
 *      25). t=25: job 3 starts 25..55. */
static void test_newcomer_outranks_reserved(void)
{
    Sim *s = mk(10, 100, 0, 0, POL_AGING_RESERVE);
    addj(s, 1, 0, 20, 2, 60, 0);
    addj(s, 2, 1, 5, 2, 70, 5);
    addj(s, 3, 2, 30, 1, 35, 9);
    CHECK(sim_run_until(s, 2) == APRM_OK);
    CHECK(s->resv.active == 1 && s->resv.id == 2 && s->resv.shadow_time == 20);
    CHECK(log_count(s, LOG_START, 3) == 0);
    CHECK(log_count(s, LOG_RESERVE, -1) == 1);
    run_all(s);
    CHECK(start_of(s, 2) == 20 && start_of(s, 3) == 25);
    CHECK(log_count(s, LOG_RESERVE, 2) == 1);            /* job 2 reserved once, never re-reserved */
    sim_destroy(s);

    /* the same input under plain aging: job 3 outranks job 2 and starts at 2 */
    s = mk(10, 100, 0, 0, POL_AGING);
    addj(s, 1, 0, 20, 2, 60, 0);
    addj(s, 2, 1, 5, 2, 70, 5);
    addj(s, 3, 2, 30, 1, 35, 9);
    run_all(s);
    CHECK(start_of(s, 3) == 2 && start_of(s, 2) == 32);
    sim_destroy(s);
}

/* CPU is the binding resource. Machine 4 cores / 1000 MB, alpha 0, T = 0.
 *   1: arr 0 dur 10 cpu 3 mem 10 prio 0
 *   2: arr 1 dur 5  cpu 3 mem 10 prio 5   (h)
 *   3: arr 2 dur 20 cpu 1 mem 10 prio 0
 * t=1: h needs 3 cores, free 1: reservation, shadow 10 (job 1 ends), extra
 *      4 - 3 = 1 core and 990 MB.
 * t=2: job 3 fits (1 core), ends 22 > 10, but 1 <= 1 core extra: backfilled
 *      via the extra room. Extra is now 0 cores.
 * t=10: job 1 ends: free cores 3 (job 3 holds 1): h starts 10..15. */
static void test_cpu_binding_engine(void)
{
    Sim *s = mk(4, 1000, 0, 0, POL_AGING_RESERVE);
    addj(s, 1, 0, 10, 3, 10, 0);
    addj(s, 2, 1, 5, 3, 10, 5);
    addj(s, 3, 2, 20, 1, 10, 0);
    CHECK(sim_run_until(s, 1) == APRM_OK);
    CHECK(s->resv.shadow_time == 10 && s->resv.extra_cpu == 1 && s->resv.extra_mem == 990);
    CHECK(sim_run_until(s, 2) == APRM_OK);
    CHECK(s->resv.extra_cpu == 0);
    run_all(s);
    CHECK(start_of(s, 3) == 2 && start_of(s, 2) == 10);
    sim_destroy(s);
}

/* Two running jobs finish at the same tick (engine level of the tie test).
 * Machine 10 / 100, alpha 0, T = 0.
 *   1: arr 0 dur 10 cpu 1 mem 40;  2: arr 0 dur 10 cpu 1 mem 40
 *   3: arr 1 dur 3  cpu 1 mem 60 prio 5   (h: free MB 20, does not fit)
 *   4: arr 2 dur 100 cpu 1 mem 20 prio 0
 * t=1: shadow 10 (both end at 10: 100 MB free), extra 9 cores / 100 - 60 = 40 MB.
 * t=2: job 4 fits (20 MB free) and 20 <= 40: backfilled. Start 2.
 * t=10: jobs 1 and 2 end; h starts 10. */
static void test_same_tick_finishes_engine(void)
{
    Sim *s = mk(10, 100, 0, 0, POL_AGING_RESERVE);
    addj(s, 1, 0, 10, 1, 40, 0);
    addj(s, 2, 0, 10, 1, 40, 0);
    addj(s, 3, 1, 3, 1, 60, 5);
    addj(s, 4, 2, 100, 1, 20, 0);
    CHECK(sim_run_until(s, 1) == APRM_OK);
    CHECK(s->resv.shadow_time == 10 && s->resv.extra_cpu == 9 && s->resv.extra_mem == 40);
    run_all(s);
    CHECK(start_of(s, 4) == 2 && start_of(s, 3) == 10);
    sim_destroy(s);
}

/* A job that finishes exactly at the shadow time is allowed; one tick later
 * it is refused (the rule is <=, not <). Machine 10 / 100, alpha 0, T = 0.
 *   1: arr 0 dur 10 cpu 1 mem 60 prio 0      ends 10
 *   2: arr 1 dur 3  cpu 1 mem 70 prio 5      h, shadow 10, extra mem 30
 *   3: arr 2 dur 8  cpu 1 mem 40 prio 0      ends 10 == shadow: allowed? it
 *      needs 40 MB, free is 40: fits; time branch: 2 + 8 = 10 <= 10: yes.
 *   (variant) job 3 with dur 9: ends 11 > 10 and 40 MB > 30 extra: refused,
 *      and then starts at 13 after job 2 (2 starts at 10, ends 13). */
static void test_boundary_finish_equals_shadow(void)
{
    Sim *s = mk(10, 100, 0, 0, POL_AGING_RESERVE);
    addj(s, 1, 0, 10, 1, 60, 0);
    addj(s, 2, 1, 3, 1, 70, 5);
    addj(s, 3, 2, 8, 1, 40, 0);
    run_all(s);
    CHECK(start_of(s, 3) == 2 && start_of(s, 2) == 10);
    sim_destroy(s);

    s = mk(10, 100, 0, 0, POL_AGING_RESERVE);
    addj(s, 1, 0, 10, 1, 60, 0);
    addj(s, 2, 1, 3, 1, 70, 5);
    addj(s, 3, 2, 9, 1, 40, 0);
    run_all(s);
    CHECK(start_of(s, 2) == 10 && start_of(s, 3) == 13);
    sim_destroy(s);
}

/* The reserved job starts before a higher-ranked job that also fits at the
 * shadow tick. Machine 10 / 100, alpha 0, T = 0.
 *   1: arr 0 dur 10 cpu 1 mem 60 prio 0
 *   2: arr 1 dur 3  cpu 1 mem 70 prio 1   (h, shadow 10)
 *   3: arr 10 dur 5 cpu 1 mem 70 prio 9   (arrives at the shadow tick, outranks h)
 * At t=10 job 1 finishes (100 MB free). Both jobs fit alone, not together.
 * Job 2 must start first (10..13); job 3 starts at 13. */
static void test_reserved_first_at_shadow_tick(void)
{
    Sim *s = mk(10, 100, 0, 0, POL_AGING_RESERVE);
    addj(s, 1, 0, 10, 1, 60, 0);
    addj(s, 2, 1, 3, 1, 70, 1);
    addj(s, 3, 10, 5, 1, 70, 9);
    run_all(s);
    CHECK(start_of(s, 2) == 10 && start_of(s, 3) == 13);
    sim_destroy(s);
}

/* sim_reset clears the reservation; the policy can be run again. */
static void test_reset_clears_reservation(void)
{
    Sim *s = build_s1(5, POL_AGING_RESERVE);
    CHECK(sim_run_until(s, 6) == APRM_OK);
    CHECK(s->resv.active == 1);
    CHECK(sim_reset(s) == APRM_OK);
    CHECK(s->resv.active == 0);
    state_has(s, "\"reservation\":null");
    addj(s, 1, 0, 20, 2, 60, 0);
    addj(s, 2, 1, 5, 2, 70, 9);
    addj(s, 3, 6, 4, 1, 10, 0);
    run_all(s);
    CHECK(start_of(s, 2) == 20);
    sim_destroy(s);
}

/* Other policies never create a reservation. */
static void test_other_policies_no_reservation(void)
{
    PolicyKind p[4] = { POL_FCFS, POL_PRIORITY, POL_SJF, POL_AGING };
    int i;
    for (i = 0; i < 4; i++) {
        Sim *s = build_s1(0, p[i]);
        run_all(s);
        CHECK(s->resv.active == 0);
        CHECK(log_count(s, LOG_RESERVE, -1) == 0 && log_count(s, LOG_BACKFILL, -1) == 0);
        sim_destroy(s);
    }
}

/* Small deterministic generator (no rand(): same numbers on every platform). */
static uint64_t lcg_state;
static uint64_t lcg(void)
{
    lcg_state = lcg_state * 6364136223846793005ULL + 1442695040888963407ULL;
    return lcg_state >> 33;
}

/* Random workloads: whenever a reservation appears, the reserved job starts
 * exactly at its shadow time (at or before it, and it cannot fit earlier), the
 * reservation never changes while it exists, and there is never more than one
 * (a reservation is one struct, so the check is that the job is the same
 * until it starts). Debug builds also run the engine's own invariant check
 * after every step (it aborts on a violation). */
static void test_h_starts_on_time_random(void)
{
    int seed;
    for (seed = 1; seed <= 300; seed++) {
        Sim *s;
        int n = 8 + (seed % 40), i;
        int64_t T = (seed % 4 == 0) ? 0 : (seed % 4 == 1) ? 3 : (seed % 4 == 2) ? 10 : 40;
        int32_t cur_id = -1;
        int64_t cur_shadow = -1;
        int reservations_seen = 0;
        int32_t ids[64];
        int64_t shadows[64];
        int rc, k;
        lcg_state = (uint64_t)seed * 7919u;
        s = mk(10, 100, (int64_t)(lcg() % 300), T, POL_AGING_RESERVE);
        for (i = 0; i < n; i++) {
            int64_t arr = (int64_t)(lcg() % 60);
            int64_t dur = 1 + (int64_t)(lcg() % 30);
            int64_t cpu = 1 + (int64_t)(lcg() % 10);
            int64_t mem = (lcg() % 3 == 0) ? 50 + (int64_t)(lcg() % 51) : 1 + (int64_t)(lcg() % 30);
            addj(s, i + 1, arr, dur, cpu, mem, (int32_t)(lcg() % 10));
        }
        while ((rc = sim_step(s)) == 1) {
            if (s->resv.active) {
                if (s->resv.id != cur_id) {
                    cur_id = s->resv.id; cur_shadow = s->resv.shadow_time;
                    CHECK(cur_shadow > s->now);
                    if (reservations_seen < 64) {
                        ids[reservations_seen] = cur_id; shadows[reservations_seen] = cur_shadow;
                    }
                    reservations_seen++;
                } else {
                    CHECK(s->resv.shadow_time == cur_shadow);   /* O-14: never moved */
                }
            } else {
                cur_id = -1;
            }
        }
        CHECK(rc == 0);
        CHECK(s->n_finished == n);
        for (k = 0; k < reservations_seen && k < 64; k++)
            CHECK(start_of(s, ids[k]) == shadows[k]);
        sim_destroy(s);
    }
}

/* Same input, same output: two runs give byte-identical logs and the same
 * start times. */
static void test_determinism(void)
{
    JsonBuf a, b;
    Sim *s1 = build_s1(5, POL_AGING_RESERVE);
    Sim *s2 = build_s1(5, POL_AGING_RESERVE);
    run_all(s1); run_all(s2);
    json_init(&a); json_init(&b);
    CHECK(sim_log_json(s1, 0, &a) == APRM_OK && sim_log_json(s2, 0, &b) == APRM_OK);
    CHECK(strcmp(json_cstr(&a), json_cstr(&b)) == 0);
    CHECK(json_len(&a) > 0);
    json_free(&a); json_free(&b);
    sim_destroy(s1); sim_destroy(s2);
}

#ifdef APRM_DEBUG
/* The debug checker catches a damaged reservation. */
static void test_invariant_checker(void)
{
    Sim *s = build_s1(5, POL_AGING_RESERVE);
    const char *why = NULL;
    Reservation saved;
    CHECK(sim_run_until(s, 6) == APRM_OK);
    CHECK(sim_check_invariants(s, &why) == 0);
    saved = s->resv;
    s->resv.id = 99;                              /* not in the waiting heap */
    CHECK(sim_check_invariants(s, &why) == 1 && why != NULL);
    s->resv = saved;
    s->resv.shadow_time = s->now;                 /* shadow must be in the future */
    CHECK(sim_check_invariants(s, &why) == 1);
    s->resv = saved;
    s->resv = saved;
    CHECK(sim_check_invariants(s, &why) == 0);
    sim_destroy(s);

    /* a non-reserve policy must never carry a reservation */
    s = build_s1(5, POL_AGING);
    CHECK(sim_run_until(s, 6) == APRM_OK);
    s->resv.active = 1; s->resv.id = 2; s->resv.shadow_time = 20;
    CHECK(sim_check_invariants(s, &why) == 1);
    sim_destroy(s);
}
#endif

int main(void)
{
    test_shadow_time();
    test_shadow_ties_released_together();
    test_shadow_cpu_binding();
    test_shadow_first_release_enough();
    test_compute_errors();
    test_backfill_rule();
    test_backfill_overflow();
    test_s1_schedule_and_state();
    test_h_starts_at_shadow();
    test_trigger_threshold();
    test_newcomer_outranks_reserved();
    test_cpu_binding_engine();
    test_same_tick_finishes_engine();
    test_boundary_finish_equals_shadow();
    test_reserved_first_at_shadow_tick();
    test_reset_clears_reservation();
    test_other_policies_no_reservation();
    test_h_starts_on_time_random();
    test_determinism();
#ifdef APRM_DEBUG
    test_invariant_checker();
#endif
    return TEST_REPORT();
}
