/* test_engine.c: Sim lifecycle and job validation (K-08). One test per error
 * code, rejected jobs change nothing, reset/destroy are clean. */
#define APRM_ENGINE_INTERNAL  /* lets the test read counters and set sim->now */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "../../core/config.h"
#include "../../core/engine_internal.h"
#include "test_main.h"

static SimConfig cfg_default(void)
{
    SimConfig c;
    memset(&c, 0, sizeof c);
    c.cpu_cap = 16; c.mem_cap = 32768; c.policy = POL_FCFS;
    c.alpha_milli = 100; c.reserve_threshold = 50; c.knapsack_eps = 0.1;
    c.max_jobs = 5000;
    return c;
}

static Job job_ok(int32_t id)
{
    Job j;
    j.id = id; j.arrival = 0; j.duration = 10; j.cpu = 2; j.mem = 1024; j.priority = 3;
    return j;
}

static Sim *make(SimConfig c)
{
    Sim *s = NULL;
    CHECK(sim_create(&c, &s) == APRM_OK);
    CHECK(s != NULL);
    return s;
}

/* Everything observable that a rejected job must not change. */
typedef struct {
    int64_t now, free_cpu, free_mem, n_total, n_finished;
    size_t pending, waiting, running, ids;
    int64_t top_arrival; int32_t top_id;
} Snap;

static Snap snap(const Sim *s)
{
    Snap x;
    Job top;
    memset(&x, 0, sizeof x);
    x.now = s->now; x.free_cpu = s->free_cpu; x.free_mem = s->free_mem;
    x.n_total = s->n_total; x.n_finished = s->n_finished;
    x.pending = heap_size(&s->pending); x.waiting = heap_size(&s->waiting);
    x.running = heap_size(&s->running); x.ids = s->ids.len;
    if (heap_peek(&s->pending, &top) == APRM_OK) { x.top_arrival = top.arrival; x.top_id = top.id; }
    return x;
}

static int same(Snap a, Snap b) { return memcmp(&a, &b, sizeof a) == 0; }

/* Add j, expect code, and check the stored error and that nothing changed. */
static void expect_reject(Sim *s, Job j, int code, const char *field)
{
    Snap before = snap(s);
    CHECK(sim_add_job(s, &j) == code);
    CHECK(same(before, snap(s)));
    CHECK(sim_last_error(s)->code == code);
    CHECK(strcmp(sim_last_error(s)->field, field) == 0);
    CHECK(sim_last_error(s)->message[0] != '\0');
}

static void test_create_null(void)
{
    SimConfig c = cfg_default();
    Sim *s = NULL;
    CHECK(sim_create(NULL, &s) == APRM_INVALID_ARGUMENT);
    CHECK(sim_create(&c, NULL) == APRM_INVALID_ARGUMENT);
    CHECK(s == NULL);
    sim_destroy(NULL);  /* must be safe */
    CHECK(sim_add_job(NULL, &(Job){0}) == APRM_INVALID_ARGUMENT);
    CHECK(sim_reset(NULL) == APRM_INVALID_ARGUMENT);
    CHECK(sim_last_error(NULL) == NULL);
    s = make(c);
    CHECK(sim_add_job(s, NULL) == APRM_INVALID_ARGUMENT);
    CHECK(sim_last_error(s)->code == APRM_INVALID_ARGUMENT);
    CHECK(strcmp(sim_last_error(s)->message, "Job is missing.") == 0);
    sim_destroy(s);
}

/* One bad field at a time; check the code, the named field and no Sim made. */
static void create_bad(SimConfig c, int code, const char *field)
{
    Sim *s = (Sim *)1;
    SimError e;
    CHECK(sim_validate_config(&c, &e) == code);
    CHECK(strcmp(e.field, field) == 0);
    CHECK(e.message[0] != '\0');
    CHECK(sim_create(&c, &s) == code);
    CHECK(s == NULL);
}

static void test_create_bad_field(void)
{
    SimConfig c;
    SimError e;
    CHECK(sim_validate_config(&(SimConfig){0}, NULL) != APRM_OK);  /* NULL err is allowed */
    c = cfg_default(); CHECK(sim_validate_config(&c, &e) == APRM_OK); CHECK(e.code == 0);
    c = cfg_default(); c.cpu_cap = 0;                create_bad(c, APRM_INVALID_FIELD, "cpu_cap");
    c = cfg_default(); c.cpu_cap = 1000001;          create_bad(c, APRM_INVALID_FIELD, "cpu_cap");
    c = cfg_default(); c.mem_cap = 0;                create_bad(c, APRM_INVALID_FIELD, "mem_cap");
    c = cfg_default(); c.mem_cap = 1000000001LL;     create_bad(c, APRM_INVALID_FIELD, "mem_cap");
    c = cfg_default(); c.alpha_milli = 10001;        create_bad(c, APRM_INVALID_FIELD, "alpha_milli");
    c = cfg_default(); c.alpha_milli = -1;           create_bad(c, APRM_INVALID_FIELD, "alpha_milli");
    c = cfg_default(); c.reserve_threshold = -1;     create_bad(c, APRM_INVALID_FIELD, "reserve_threshold");
    c = cfg_default(); c.reserve_threshold = 1000001; create_bad(c, APRM_INVALID_FIELD, "reserve_threshold");
    c = cfg_default(); c.knapsack_eps = 0.009;       create_bad(c, APRM_INVALID_FIELD, "knapsack_eps");
    c = cfg_default(); c.knapsack_eps = 1.5;         create_bad(c, APRM_INVALID_FIELD, "knapsack_eps");
    c = cfg_default(); c.knapsack_eps = strtod("nan", NULL);
    create_bad(c, APRM_INVALID_FIELD, "knapsack_eps");  /* NaN */
    c = cfg_default(); c.max_jobs = 0;               create_bad(c, APRM_INVALID_FIELD, "max_jobs");
    /* Boundaries are accepted. */
    c = cfg_default(); c.cpu_cap = 1; c.mem_cap = 1; c.alpha_milli = 0; c.reserve_threshold = 0;
    c.knapsack_eps = 0.01; c.max_jobs = 1;
    CHECK(sim_validate_config(&c, NULL) == APRM_OK);
    c.cpu_cap = 1000000; c.mem_cap = 1000000000; c.alpha_milli = 10000;
    c.reserve_threshold = 1000000; c.knapsack_eps = 1;
    CHECK(sim_validate_config(&c, NULL) == APRM_OK);
}

static void test_create_bad_policy(void)
{
    SimConfig c = cfg_default();
    SimError e;
    c.policy = (PolicyKind)9;
    create_bad(c, APRM_INVALID_ARGUMENT, "policy");
    CHECK(sim_validate_config(&c, &e) == APRM_INVALID_ARGUMENT);
    CHECK(strcmp(e.message, "Unknown policy 9.") == 0);
    c.policy = (PolicyKind)-1;
    create_bad(c, APRM_INVALID_ARGUMENT, "policy");
}

static void test_create_ok(void)
{
    SimConfig c = cfg_default();
    Sim *s = make(c);
    CHECK(s->now == 0 && s->free_cpu == 16 && s->free_mem == 32768 && s->n_total == 0);
    CHECK(heap_size(&s->pending) == 0 && heap_size(&s->waiting) == 0 && heap_size(&s->running) == 0);
    CHECK(sim_last_error(s)->code == 0);
    c.cpu_cap = 99;  /* the Sim holds a copy of the config */
    CHECK(s->cfg.cpu_cap == 16);
    sim_destroy(s);
}

static void test_two_sims(void)
{
    SimConfig c = cfg_default();
    Sim *a = make(c), *b;
    Job j = job_ok(1);
    c.cpu_cap = 4;
    b = make(c);
    CHECK(sim_add_job(a, &j) == APRM_OK);
    CHECK(sim_add_job(b, &j) == APRM_OK);  /* same id in another Sim is fine */
    CHECK(a->n_total == 1 && b->n_total == 1);
    j.id = 2; j.cpu = 8;
    CHECK(sim_add_job(a, &j) == APRM_OK);
    CHECK(sim_add_job(b, &j) == APRM_CAPACITY_EXCEEDED);
    CHECK(a->n_total == 2 && b->n_total == 1);
    CHECK(sim_last_error(a)->code == 0);  /* b's error is not a's */
    sim_destroy(a);
    sim_destroy(b);
}

static void test_add_ok_order(void)
{
    Sim *s = make(cfg_default());
    int32_t ids[] = {5, 3, 9, 1, 7};
    int64_t arr[] = {10, 10, 0, 10, 4};
    int32_t want[] = {9, 7, 1, 3, 5};  /* (arrival, id) ascending */
    size_t i;
    for (i = 0; i < 5; i++) {
        Job j = job_ok(ids[i]);
        j.arrival = arr[i];
        CHECK(sim_add_job(s, &j) == APRM_OK);
    }
    CHECK(s->n_total == 5 && heap_size(&s->pending) == 5 && s->ids.len == 5);
    CHECK(s->free_cpu == 16 && s->free_mem == 32768);  /* adding does not allocate resources */
    for (i = 0; i < 5; i++) {
        Job j;
        CHECK(heap_pop(&s->pending, &j) == APRM_OK);
        CHECK(j.id == want[i]);
    }
    sim_destroy(s);
}

static void test_add_ranges(void)
{
    Sim *s = make(cfg_default());
    Job j;
    j = job_ok(1); j.priority = 10;          expect_reject(s, j, APRM_INVALID_FIELD, "priority");
    j = job_ok(1); j.priority = -1;          expect_reject(s, j, APRM_INVALID_FIELD, "priority");
    j = job_ok(1); j.duration = 0;           expect_reject(s, j, APRM_INVALID_FIELD, "duration");
    j = job_ok(1); j.duration = 1000001;     expect_reject(s, j, APRM_INVALID_FIELD, "duration");
    j = job_ok(1); j.arrival = -1;           expect_reject(s, j, APRM_INVALID_FIELD, "arrival");
    j = job_ok(1); j.arrival = 1000000001LL; expect_reject(s, j, APRM_INVALID_FIELD, "arrival");
    j = job_ok(-1);                          expect_reject(s, j, APRM_INVALID_FIELD, "id");
    j = job_ok(1); j.cpu = 0;                expect_reject(s, j, APRM_INVALID_FIELD, "cpu");
    j = job_ok(1); j.mem = 0;                expect_reject(s, j, APRM_INVALID_FIELD, "mem");
    CHECK(strcmp(sim_last_error(s)->message, "mem must be at least 1.") == 0);
    /* Boundaries are accepted. */
    j = job_ok(0); j.priority = 0; j.duration = 1; j.arrival = 0; j.cpu = 1; j.mem = 1;
    CHECK(sim_add_job(s, &j) == APRM_OK);
    j = job_ok(INT32_MAX); j.priority = 9; j.duration = 1000000; j.arrival = 1000000000LL;
    CHECK(sim_add_job(s, &j) == APRM_OK);
    sim_destroy(s);
}

static void test_add_capacity(void)
{
    Sim *s = make(cfg_default());
    Job j = job_ok(4);
    j.mem = 40960;
    expect_reject(s, j, APRM_CAPACITY_EXCEEDED, "mem");
    CHECK(strcmp(sim_last_error(s)->message, "Job 4 needs 40960 MB; machine has 32768 MB.") == 0);
    j = job_ok(4); j.cpu = 17;
    expect_reject(s, j, APRM_CAPACITY_EXCEEDED, "cpu");
    j = job_ok(4); j.cpu = 16; j.mem = 32768;  /* exactly the machine: fits */
    CHECK(sim_add_job(s, &j) == APRM_OK);
    sim_destroy(s);
}

static void test_add_duplicate(void)
{
    Sim *s = make(cfg_default());
    Job j = job_ok(3);
    CHECK(sim_add_job(s, &j) == APRM_OK);
    expect_reject(s, j, APRM_DUPLICATE_ID, "id");
    CHECK(strcmp(sim_last_error(s)->message, "Job id 3 already exists.") == 0);
    sim_destroy(s);
}

static void test_add_limit(void)
{
    SimConfig c = cfg_default();
    Sim *s;
    int32_t i;
    c.max_jobs = 3;
    s = make(c);
    for (i = 1; i <= 3; i++) { Job j = job_ok(i); CHECK(sim_add_job(s, &j) == APRM_OK); }
    expect_reject(s, job_ok(4), APRM_LIMIT_REACHED, "");
    CHECK(strcmp(sim_last_error(s)->message, "Limit is 3 jobs.") == 0);
    sim_destroy(s);
    c.max_jobs = APRM_MAX_JOBS_WEB;
    s = make(c);
    s->n_total = APRM_MAX_JOBS_WEB;  /* pretend the limit was reached */
    expect_reject(s, job_ok(1), APRM_LIMIT_REACHED, "");
    CHECK(strcmp(sim_last_error(s)->message, "Limit is 5000 jobs.") == 0);
    s->n_total = 0;
    sim_destroy(s);
}

static void test_add_past(void)
{
    Sim *s = make(cfg_default());
    Job j = job_ok(1);
    s->now = 42;  /* test hook: set the clock directly */
    j.arrival = 10;
    expect_reject(s, j, APRM_ARRIVAL_IN_PAST, "arrival");
    CHECK(strcmp(sim_last_error(s)->message, "Arrival 10 is before current time 42.") == 0);
    j.arrival = 42;  /* arrival == now is allowed */
    CHECK(sim_add_job(s, &j) == APRM_OK);
    sim_destroy(s);
}

/* Validation order: ranges before capacity before past before duplicate before limit. */
static void test_add_order(void)
{
    SimConfig c = cfg_default();
    Sim *s;
    Job j = job_ok(1);
    c.max_jobs = 1;
    s = make(c);
    CHECK(sim_add_job(s, &j) == APRM_OK);   /* now full, id 1 taken */
    s->now = 50;
    j.arrival = 10; j.mem = 99999; j.priority = 11;
    CHECK(sim_add_job(s, &j) == APRM_INVALID_FIELD);
    j.priority = 1;
    CHECK(sim_add_job(s, &j) == APRM_CAPACITY_EXCEEDED);
    j.mem = 1;
    CHECK(sim_add_job(s, &j) == APRM_ARRIVAL_IN_PAST);
    j.arrival = 60;
    CHECK(sim_add_job(s, &j) == APRM_DUPLICATE_ID);
    j.id = 2;
    CHECK(sim_add_job(s, &j) == APRM_LIMIT_REACHED);
    sim_destroy(s);
}

static void test_reject_unchanged(void)
{
    Sim *s = make(cfg_default());
    Snap before;
    Job j;
    int32_t i;
    int32_t *slots_before;
    size_t ncap;
    for (i = 1; i <= 20; i++) { j = job_ok(i); j.arrival = i * 3; CHECK(sim_add_job(s, &j) == APRM_OK); }
    s->now = 5;
    before = snap(s);
    ncap = s->ids.cap;
    slots_before = malloc(ncap * sizeof *slots_before);
    CHECK(slots_before != NULL);
    if (!slots_before) { sim_destroy(s); return; }
    memcpy(slots_before, s->ids.slot, ncap * sizeof *slots_before);
    j = job_ok(100); j.priority = 99;          expect_reject(s, j, APRM_INVALID_FIELD, "priority");
    j = job_ok(100); j.mem = 99999999;         expect_reject(s, j, APRM_CAPACITY_EXCEEDED, "mem");
    j = job_ok(100); j.arrival = 1;            expect_reject(s, j, APRM_ARRIVAL_IN_PAST, "arrival");
    j = job_ok(7);   j.arrival = 50;           expect_reject(s, j, APRM_DUPLICATE_ID, "id");
    CHECK(same(before, snap(s)));
    CHECK(s->ids.cap == ncap && memcmp(slots_before, s->ids.slot, ncap * sizeof *slots_before) == 0);
    free(slots_before);
    /* The rejected id 100 was never remembered: the corrected job is accepted. */
    j = job_ok(100); j.arrival = 6;
    CHECK(sim_add_job(s, &j) == APRM_OK);
    CHECK(s->n_total == 21);
    sim_destroy(s);
}

static void test_error_kept_until_reset(void)
{
    Sim *s = make(cfg_default());
    Job j = job_ok(1);
    j.priority = 12;
    CHECK(sim_add_job(s, &j) == APRM_INVALID_FIELD);
    j.priority = 1;
    CHECK(sim_add_job(s, &j) == APRM_OK);
    CHECK(sim_last_error(s)->code == APRM_INVALID_FIELD);  /* success does not clear it */
    CHECK(strcmp(sim_last_error(s)->message, "priority must be 0 to 9.") == 0);
    CHECK(sim_reset(s) == APRM_OK);
    CHECK(sim_last_error(s)->code == 0 && sim_last_error(s)->message[0] == '\0');
    sim_destroy(s);
}

static void test_id_set_growth(void)
{
    SimConfig c = cfg_default();
    Sim *s;
    int32_t i;
    c.max_jobs = 100000;
    s = make(c);
    for (i = 0; i < 50000; i++) {
        Job j = job_ok(i * 7 + 3);  /* spread ids */
        CHECK(sim_add_job(s, &j) == APRM_OK);
    }
    for (i = 0; i < 50000; i++) {
        Job j = job_ok(i * 7 + 3);
        if (sim_add_job(s, &j) != APRM_DUPLICATE_ID) { CHECK(0); break; }
    }
    CHECK(s->n_total == 50000 && s->ids.len == 50000 && s->ids.len * 2 <= s->ids.cap);
    sim_destroy(s);
}

static void test_reset_destroy(void)
{
    SimConfig c = cfg_default();
    Sim *s;
    int32_t i;
    Job j;
    c.max_jobs = 2000;
    c.policy = POL_AGING;
    s = make(c);
    for (i = 0; i < 1000; i++) { j = job_ok(i); j.arrival = 1000 - i; CHECK(sim_add_job(s, &j) == APRM_OK); }
    s->now = 7; s->free_cpu = 3; s->n_finished = 4;
    CHECK(sim_reset(s) == APRM_OK);
    CHECK(s->now == 0 && s->free_cpu == 16 && s->free_mem == 32768);
    CHECK(s->n_total == 0 && s->n_finished == 0 && s->ids.len == 0);
    CHECK(heap_size(&s->pending) == 0);
    CHECK(s->cfg.policy == POL_AGING && s->cfg.max_jobs == 2000 && s->cfg.cpu_cap == 16);  /* config kept */
    for (i = 0; i < 1000; i++) { j = job_ok(i); CHECK(sim_add_job(s, &j) == APRM_OK); }  /* same ids again */
    CHECK(s->n_total == 1000);
    sim_destroy(s);
}


/* ===================== event loop (K-09) ===================== */

static Job mkjob(int32_t id, int64_t arrival, int64_t dur, int64_t cpu, int64_t mem)
{
    Job j;
    j.id = id; j.arrival = arrival; j.duration = dur; j.cpu = cpu; j.mem = mem; j.priority = 0;
    return j;
}

/* Step until finished (bounded). Returns the number of steps taken. */
static int run_all(Sim *s)
{
    int n = 0, rc;
    while ((rc = sim_step(s)) == 1 && n < 1000000) n++;
    CHECK(rc == 0);
    return n;
}

/* The finished entry for id, or NULL. */
static const RunEntry *fin_of(const Sim *s, int32_t id)
{
    size_t i;
    for (i = 0; i < s->fin_len; i++) if (s->fin[i].job.id == id) return &s->fin[i];
    return NULL;
}

static void expect_sched(const Sim *s, int32_t id, int64_t start, int64_t finish)
{
    const RunEntry *r = fin_of(s, id);
    if (!r) printf("expect_sched: job %d did not finish\n", (int)id);
    CHECK(r != NULL);
    if (r) { CHECK(r->start == start); CHECK(r->finish == finish); }
}

static void test_step_null_and_policy(void)
{
    SimConfig c = cfg_default();
    Sim *s;
    Job j = job_ok(1);
    CHECK(sim_step(NULL) == APRM_INVALID_ARGUMENT);
    CHECK(sim_run_until(NULL, 5) == APRM_INVALID_ARGUMENT);
    c.policy = POL_SJF;  /* not built yet: refused, Sim untouched */
    s = make(c);
    CHECK(sim_add_job(s, &j) == APRM_OK);
    CHECK(sim_step(s) == APRM_INVALID_ARGUMENT);
    CHECK(sim_last_error(s)->code == APRM_INVALID_ARGUMENT);
    CHECK(strcmp(sim_last_error(s)->field, "policy") == 0);
    CHECK(s->now == 0 && heap_size(&s->pending) == 1 && s->fin_len == 0);
    sim_destroy(s);
}

static void test_step_empty(void)
{
    Sim *s = make(cfg_default());
    CHECK(sim_step(s) == 0);
    CHECK(sim_step(s) == 0);  /* stays finished */
    CHECK(sim_run_until(s, 100) == APRM_OK);
    CHECK(s->now == 0 && s->n_total == 0);
    sim_destroy(s);
}

static void test_step_single(void)
{
    Sim *s = make(cfg_default());
    Job j = mkjob(1, 5, 7, 2, 1024);
    CHECK(sim_add_job(s, &j) == APRM_OK);
    CHECK(sim_step(s) == 1);                    /* t=5: arrives and starts */
    CHECK(s->now == 5 && heap_size(&s->running) == 1 && heap_size(&s->pending) == 0);
    CHECK(s->free_cpu == 14 && s->free_mem == 32768 - 1024);
    CHECK(sim_step(s) == 1);                    /* t=12: finishes */
    CHECK(s->now == 12 && s->fin_len == 1 && s->n_finished == 1);
    CHECK(s->free_cpu == 16 && s->free_mem == 32768);
    expect_sched(s, 1, 5, 12);
    CHECK(sim_step(s) == 0);
    CHECK(s->now == 12);
    sim_destroy(s);
}

static void test_finish_before_arrival(void)
{
    Sim *s = make(cfg_default());
    Job a = mkjob(1, 0, 5, 8, 30000), b = mkjob(2, 5, 4, 8, 30000);
    CHECK(sim_add_job(s, &a) == APRM_OK && sim_add_job(s, &b) == APRM_OK);
    run_all(s);
    expect_sched(s, 1, 0, 5);
    expect_sched(s, 2, 5, 9);  /* B fits only because A's finish at 5 was processed first */
    sim_destroy(s);

    /* Several jobs finishing at the same tick are all freed in one step. */
    s = make(cfg_default());
    {
        Job x = mkjob(1, 0, 6, 4, 4000), y = mkjob(2, 0, 6, 4, 4000), z = mkjob(3, 0, 6, 4, 4000);
        Job w = mkjob(4, 6, 2, 16, 32768);
        CHECK(sim_add_job(s, &x) == APRM_OK && sim_add_job(s, &y) == APRM_OK);
        CHECK(sim_add_job(s, &z) == APRM_OK && sim_add_job(s, &w) == APRM_OK);
        CHECK(sim_step(s) == 1);              /* t=0 */
        CHECK(sim_step(s) == 1);              /* t=6: three finish, w arrives and fits */
        CHECK(s->now == 6 && s->fin_len == 3 && heap_size(&s->running) == 1);
        run_all(s);
        expect_sched(s, 4, 6, 8);
    }
    sim_destroy(s);
}

static void test_greedy_skip(void)
{
    Sim *s = make(cfg_default());
    Job a = mkjob(1, 0, 10, 4, 24000), b = mkjob(2, 1, 6, 4, 16000), c = mkjob(3, 2, 3, 2, 4000);
    CHECK(sim_add_job(s, &a) == APRM_OK && sim_add_job(s, &b) == APRM_OK && sim_add_job(s, &c) == APRM_OK);
    CHECK(sim_run_until(s, 2) == APRM_OK);
    CHECK(s->now == 2);
    CHECK(fin_of(s, 3) == NULL && heap_size(&s->running) == 2);  /* c running, b still waiting */
    CHECK(heap_size(&s->waiting) == 1);
    run_all(s);
    expect_sched(s, 3, 2, 5);
    expect_sched(s, 2, 10, 16);
    sim_destroy(s);
}

/* Several skipped jobs return to the queue in their original order. */
static void test_skip_pushback_order(void)
{
    Sim *s;
    SimConfig c = cfg_default();
    int32_t id;
    c.cpu_cap = 10; c.mem_cap = 100;
    s = make(c);
    { Job a = mkjob(1, 0, 4, 9, 10); CHECK(sim_add_job(s, &a) == APRM_OK); }
    for (id = 2; id <= 6; id++) { Job j = mkjob(id, 0, 2, 5, 10); CHECK(sim_add_job(s, &j) == APRM_OK); }
    run_all(s);
    expect_sched(s, 1, 0, 4);
    expect_sched(s, 2, 4, 6);  /* two 5-core jobs at a time: 2,3 then 4,5 then 6 */
    expect_sched(s, 3, 4, 6);
    expect_sched(s, 4, 6, 8);
    expect_sched(s, 5, 6, 8);
    expect_sched(s, 6, 8, 10);
    sim_destroy(s);
}

static void test_run_until(void)
{
    Sim *s = make(cfg_default());
    Job a = mkjob(1, 3, 4, 1, 1), b = mkjob(2, 10, 4, 1, 1);
    CHECK(sim_add_job(s, &a) == APRM_OK && sim_add_job(s, &b) == APRM_OK);
    CHECK(sim_run_until(s, -1) == APRM_OK && s->now == 0 && heap_size(&s->pending) == 2);
    CHECK(sim_run_until(s, 2) == APRM_OK && s->now == 0);
    CHECK(sim_run_until(s, 3) == APRM_OK && s->now == 3 && heap_size(&s->running) == 1);  /* inclusive */
    CHECK(sim_run_until(s, 6) == APRM_OK && s->now == 3);   /* finish is at 7 */
    CHECK(sim_run_until(s, 7) == APRM_OK && s->now == 7 && s->fin_len == 1);
    CHECK(sim_run_until(s, 9) == APRM_OK && s->now == 7);   /* clock stays at the last event */
    { Job c = mkjob(3, 8, 1, 1, 1); CHECK(sim_add_job(s, &c) == APRM_OK); }  /* 8 >= now: accepted */
    { Job d = mkjob(4, 6, 1, 1, 1); CHECK(sim_add_job(s, &d) == APRM_ARRIVAL_IN_PAST); }
    CHECK(sim_run_until(s, 1000000) == APRM_OK);
    CHECK(sim_step(s) == 0);
    expect_sched(s, 2, 10, 14);
    expect_sched(s, 3, 8, 9);
    sim_destroy(s);
}

static void test_reset_rerun(void)
{
    Sim *s = make(cfg_default());
    Job a = mkjob(1, 0, 10, 16, 32768), b = mkjob(2, 2, 5, 8, 16384);
    CHECK(sim_add_job(s, &a) == APRM_OK && sim_add_job(s, &b) == APRM_OK);
    run_all(s);
    expect_sched(s, 2, 10, 15);
    CHECK(sim_reset(s) == APRM_OK);
    CHECK(s->fin_len == 0 && s->n_finished == 0 && s->now == 0);
    CHECK(sim_step(s) == 0);
    CHECK(sim_add_job(s, &a) == APRM_OK && sim_add_job(s, &b) == APRM_OK);
    run_all(s);
    expect_sched(s, 1, 0, 10);
    expect_sched(s, 2, 10, 15);
    sim_destroy(s);
}

/* Time near the int64 limit: the step refuses, before changing anything, when
 * start + duration could overflow; just inside the limit it works. Jobs are
 * put in the pending heap directly (sim_add_job caps arrival at 1e9). Also
 * the largest legal values through the public API. */
static void test_overflow(void)
{
    Sim *s;
    Snap before;
    Job j;
    int64_t lim = INT64_MAX - APRM_DURATION_MAX;

    /* legal extremes: arrival 1e9, duration 1e6, full machine */
    s = make(cfg_default());
    j = mkjob(1, APRM_ARRIVAL_MAX, APRM_DURATION_MAX, 16, 32768);
    CHECK(sim_add_job(s, &j) == APRM_OK);
    j = mkjob(2, APRM_ARRIVAL_MAX, APRM_DURATION_MAX, 16, 32768);
    CHECK(sim_add_job(s, &j) == APRM_OK);
    run_all(s);
    expect_sched(s, 1, 1000000000, 1001000000);
    expect_sched(s, 2, 1001000000, 1002000000);
    sim_destroy(s);

    /* exactly at the limit: allowed, finish == INT64_MAX */
    s = make(cfg_default());
    j = mkjob(1, lim, APRM_DURATION_MAX, 1, 1);
    CHECK(heap_push(&s->pending, &j) == APRM_OK); s->n_total = 1;
    CHECK(sim_step(s) == 1);
    {
        RunEntry r;
        CHECK(heap_peek(&s->running, &r) == APRM_OK && r.finish == INT64_MAX);
    }
    CHECK(sim_step(s) == 1 && s->now == INT64_MAX);
    CHECK(sim_step(s) == 0);
    sim_destroy(s);

    /* one tick past the limit: refused with the Sim unchanged */
    s = make(cfg_default());
    j = mkjob(1, lim + 1, APRM_DURATION_MAX, 1, 1);
    CHECK(heap_push(&s->pending, &j) == APRM_OK); s->n_total = 1;
    before = snap(s);
    CHECK(sim_step(s) == APRM_INVALID_FIELD);
    CHECK(same(before, snap(s)));
    CHECK(sim_last_error(s)->code == APRM_INVALID_FIELD);
    CHECK(sim_run_until(s, INT64_MAX) == APRM_INVALID_FIELD);
    sim_destroy(s);
}

/* ---- reference simulator: tick by tick, no heaps, written independently ---- */

typedef struct { Job j; int64_t start; int started, done; } RefJob;

/* Brute-force FCFS with greedy fill. jobs[] must be sorted by (arrival, id). */
static void ref_fcfs(RefJob *r, int n, int64_t cpu_cap, int64_t mem_cap)
{
    int64_t t, fc = cpu_cap, fm = mem_cap;
    int i, left = n;
    for (t = 0; left > 0; t++) {
        for (i = 0; i < n; i++)  /* finishes first */
            if (r[i].started && !r[i].done && r[i].start + r[i].j.duration == t) {
                r[i].done = 1; fc += r[i].j.cpu; fm += r[i].j.mem; left--;
            }
        for (i = 0; i < n; i++)  /* then the queue in FCFS order (arrivals are implicit) */
            if (!r[i].started && r[i].j.arrival <= t && r[i].j.cpu <= fc && r[i].j.mem <= fm) {
                r[i].started = 1; r[i].start = t; fc -= r[i].j.cpu; fm -= r[i].j.mem;
            }
    }
}

static uint64_t rng_state;
static uint64_t rng(void)  /* xorshift64*: deterministic, test-only */
{
    rng_state ^= rng_state >> 12; rng_state ^= rng_state << 25; rng_state ^= rng_state >> 27;
    return rng_state * 2685821657736338717ull;
}
static int64_t rnd(int64_t lo, int64_t hi) { return lo + (int64_t)(rng() % (uint64_t)(hi - lo + 1)); }

static int cmp_refjob(const void *a, const void *b)
{
    const Job *x = &((const RefJob *)a)->j, *y = &((const RefJob *)b)->j;
    if (x->arrival != y->arrival) return x->arrival < y->arrival ? -1 : 1;
    return (x->id > y->id) - (x->id < y->id);
}

/* 1,000 random small workloads. In this (debug) build the PRD section 4
 * checker runs after every step and aborts on a violation. Each schedule is
 * also compared with the independent tick-by-tick reference, and with the
 * same workload added one arrival time at a time while running ("mid-run"):
 * all three must be identical. */
static void test_invariants_random(void)
{
    int w, i, n, k;
    for (w = 0; w < 1000; w++) {
        SimConfig c = cfg_default();
        RefJob rj[40];
        Sim *a, *b;
        int64_t cpu_cap = rnd(1, 12), mem_cap = rnd(1, 12) * 1000;
        n = (int)rnd(0, 30);
        rng_state = 0x9E3779B97F4A7C15ull ^ (uint64_t)(w + 1) * 0xD1B54A32D192ED03ull;
        cpu_cap = rnd(1, 12); mem_cap = rnd(1, 12) * 1000;
        c.cpu_cap = cpu_cap; c.mem_cap = mem_cap;
        for (i = 0; i < n; i++) {
            Job j = mkjob((int32_t)(rnd(0, 9) * 100 + i), rnd(0, 25), rnd(1, 10),
                          rnd(1, cpu_cap), rnd(1, mem_cap / 1000) * 1000 - rnd(0, 500));
            if (j.mem < 1) j.mem = 1;
            j.priority = (int32_t)rnd(0, 9);
            rj[i].j = j; rj[i].started = rj[i].done = 0; rj[i].start = -1;
        }
        a = make(c); b = make(c);
        for (i = 0; i < n; i++) CHECK(sim_add_job(a, &rj[i].j) == APRM_OK);
        run_all(a);  /* checker active after every step */
        CHECK(a->fin_len == (size_t)n);

        qsort(rj, (size_t)n, sizeof rj[0], cmp_refjob);
        ref_fcfs(rj, n, cpu_cap, mem_cap);
        for (i = 0; i < n; i++) {
            const RunEntry *r = fin_of(a, rj[i].j.id);
            CHECK(r != NULL && r->start == rj[i].start);
            if (!r || r->start != rj[i].start) { printf("workload %d job %d\n", w, (int)rj[i].j.id); break; }
        }

        /* Mid-run: before the step for time T, add every job arriving at T. */
        for (i = 0; i < n; i = k) {
            int64_t T = rj[i].j.arrival;
            CHECK(sim_run_until(b, T - 1) == APRM_OK);
            for (k = i; k < n && rj[k].j.arrival == T; k++) CHECK(sim_add_job(b, &rj[k].j) == APRM_OK);
        }
        run_all(b);
        CHECK(b->fin_len == a->fin_len);
        for (i = 0; i < n; i++) {
            const RunEntry *x = fin_of(a, rj[i].j.id), *y = fin_of(b, rj[i].j.id);
            CHECK(x && y && x->start == y->start && x->finish == y->finish);
        }
        for (i = 1; i < n; i++) {  /* finished list sorted by (finish, arrival, id) */
            const RunEntry *p = &a->fin[i - 1], *q = &a->fin[i];
            CHECK(p->finish < q->finish || (p->finish == q->finish &&
                  (p->job.arrival < q->job.arrival || (p->job.arrival == q->job.arrival && p->job.id < q->job.id))));
        }
        /* and in the same order of finishing */
        for (i = 0; i < n && (size_t)i < b->fin_len; i++) CHECK(a->fin[i].job.id == b->fin[i].job.id);
        sim_destroy(a); sim_destroy(b);
    }
}

/* The stop conditions of greedy fill: a job needing exactly the 1 MB (or 1
 * core) that is free starts, and the loop then stops with free == 0. */
static void test_exact_one_free(void)
{
    SimConfig c = cfg_default();
    Sim *s;
    Job a, b, d;
    c.cpu_cap = 10; c.mem_cap = 10;
    s = make(c);
    a = mkjob(1, 0, 5, 1, 9); b = mkjob(2, 0, 3, 1, 1); d = mkjob(3, 0, 2, 1, 1);
    CHECK(sim_add_job(s, &a) == APRM_OK && sim_add_job(s, &b) == APRM_OK && sim_add_job(s, &d) == APRM_OK);
    CHECK(sim_step(s) == 1);
    CHECK(s->free_mem == 0 && s->free_cpu == 8 && heap_size(&s->running) == 2);  /* a and b */
    run_all(s);
    expect_sched(s, 1, 0, 5);
    expect_sched(s, 2, 0, 3);
    expect_sched(s, 3, 3, 5);  /* d waited for memory although cores were free */
    sim_destroy(s);

    s = make(c);
    a = mkjob(1, 0, 5, 9, 1); b = mkjob(2, 0, 3, 1, 1); d = mkjob(3, 0, 2, 1, 1);
    CHECK(sim_add_job(s, &a) == APRM_OK && sim_add_job(s, &b) == APRM_OK && sim_add_job(s, &d) == APRM_OK);
    CHECK(sim_step(s) == 1);
    CHECK(s->free_cpu == 0 && s->free_mem == 8 && heap_size(&s->running) == 2);
    run_all(s);
    expect_sched(s, 2, 0, 3);
    expect_sched(s, 3, 3, 5);
    sim_destroy(s);
}

/* Finished-list order is part of the contract (K-10's FINISH lines use it):
 * by finish time, and jobs finishing together by arrival, then id. */
static void test_finished_order(void)
{
    Sim *s = make(cfg_default());
    Job j[4];
    const int32_t want[4] = { 7, 3, 9, 1 };
    int i;
    j[0] = mkjob(9, 0, 6, 1, 1);   /* finish 6, arrival 0, id 9 */
    j[1] = mkjob(1, 1, 5, 1, 1);   /* finish 6, arrival 1 */
    j[2] = mkjob(3, 0, 6, 1, 1);   /* finish 6, arrival 0, id 3 */
    j[3] = mkjob(7, 2, 2, 1, 1);   /* finish 4 */
    for (i = 0; i < 4; i++) CHECK(sim_add_job(s, &j[i]) == APRM_OK);
    run_all(s);
    CHECK(s->fin_len == 4);
    for (i = 0; i < 4; i++) CHECK(s->fin[i].job.id == want[i]);
    sim_destroy(s);
}

/* O-13 (D59): a job added with arrival == now AFTER the step for now has run
 * gets a second selection step at the same tick, at the next sim_step. */
static void test_o13_same_tick(void)
{
    Sim *s = make(cfg_default());
    Job a = mkjob(1, 0, 10, 4, 1000), late = mkjob(2, 0, 3, 4, 1000);
    CHECK(sim_add_job(s, &a) == APRM_OK);
    CHECK(sim_step(s) == 1 && s->now == 0 && heap_size(&s->running) == 1);
    CHECK(sim_add_job(s, &late) == APRM_OK);   /* arrival == now: accepted */
    CHECK(sim_step(s) == 1);                   /* second selection step at t=0 */
    CHECK(s->now == 0 && heap_size(&s->running) == 2 && heap_size(&s->pending) == 0);
    run_all(s);
    expect_sched(s, 2, 0, 3);
    sim_destroy(s);

    /* If it does not fit at that tick it simply waits, as any waiting job. */
    s = make(cfg_default());
    a = mkjob(1, 0, 10, 16, 1000);
    CHECK(sim_add_job(s, &a) == APRM_OK && sim_step(s) == 1);
    CHECK(sim_add_job(s, &late) == APRM_OK);
    CHECK(sim_step(s) == 1 && s->now == 0 && heap_size(&s->waiting) == 1);
    run_all(s);
    expect_sched(s, 2, 10, 13);
    sim_destroy(s);

    /* Same on an idle machine after everything finished: the clock stays at
     * the last event and the new job (arrival == now) starts immediately. */
    s = make(cfg_default());
    a = mkjob(1, 0, 4, 1, 1);
    CHECK(sim_add_job(s, &a) == APRM_OK);
    run_all(s);
    CHECK(s->now == 4);
    late = mkjob(2, 4, 2, 1, 1);
    CHECK(sim_add_job(s, &late) == APRM_OK);
    run_all(s);
    expect_sched(s, 2, 4, 6);
    sim_destroy(s);
}

/* The edge case behind D59: added BEFORE the step for its arrival time, the
 * schedule equals "add all first"; added after, a lower-id job cannot jump
 * ahead of a job the first pass already started. Both are deterministic. */
static void test_o13_edge(void)
{
    SimConfig c = cfg_default();
    Sim *all, *before, *after;
    Job x = mkjob(5, 0, 10, 10, 1000), y = mkjob(1, 0, 10, 10, 1000);
    c.cpu_cap = 16;
    all = make(c); before = make(c); after = make(c);

    CHECK(sim_add_job(all, &x) == APRM_OK && sim_add_job(all, &y) == APRM_OK);
    run_all(all);
    expect_sched(all, 1, 0, 10);   /* lower id first */
    expect_sched(all, 5, 10, 20);

    CHECK(sim_add_job(before, &x) == APRM_OK);
    CHECK(sim_run_until(before, -1) == APRM_OK);          /* step for t=0 has NOT run */
    CHECK(sim_add_job(before, &y) == APRM_OK);
    run_all(before);
    expect_sched(before, 1, 0, 10);
    expect_sched(before, 5, 10, 20);

    CHECK(sim_add_job(after, &x) == APRM_OK);
    CHECK(sim_step(after) == 1);                          /* step for t=0 ran: x started */
    CHECK(sim_add_job(after, &y) == APRM_OK);
    run_all(after);
    expect_sched(after, 5, 0, 10);   /* differs, by design: x already started */
    expect_sched(after, 1, 10, 20);
    sim_destroy(all); sim_destroy(before); sim_destroy(after);
}

/* Two Sims stepped alternately behave exactly like each one run alone. */
static void test_step_two_sims_interleaved(void)
{
    SimConfig c1 = cfg_default(), c2 = cfg_default();
    Sim *a, *b, *ra, *rb;
    int i, ra_steps, rb_steps, rc1, rc2, na = 0, nb = 0;
    c2.cpu_cap = 5; c2.mem_cap = 5000;
    a = make(c1); b = make(c2); ra = make(c1); rb = make(c2);
    rng_state = 12345;
    for (i = 0; i < 40; i++) {
        Job j1 = mkjob(i, rnd(0, 30), rnd(1, 9), rnd(1, 16), rnd(1, 20000));
        Job j2 = mkjob(100 + i, rnd(0, 30), rnd(1, 9), rnd(1, 5), rnd(1, 5000));
        CHECK(sim_add_job(a, &j1) == APRM_OK && sim_add_job(ra, &j1) == APRM_OK);
        CHECK(sim_add_job(b, &j2) == APRM_OK && sim_add_job(rb, &j2) == APRM_OK);
    }
    ra_steps = run_all(ra); rb_steps = run_all(rb);
    for (;;) {
        rc1 = sim_step(a); rc2 = sim_step(b);
        if (rc1 == 1) na++;
        if (rc2 == 1) nb++;
        if (rc1 != 1 && rc2 != 1) break;
    }
    CHECK(na == ra_steps && nb == rb_steps);
    CHECK(a->fin_len == ra->fin_len && b->fin_len == rb->fin_len);
    CHECK(a->fin_len == 40 && b->fin_len == 40);
    for (i = 0; i < 40; i++) {
        CHECK(a->fin[i].job.id == ra->fin[i].job.id && a->fin[i].start == ra->fin[i].start);
        CHECK(b->fin[i].job.id == rb->fin[i].job.id && b->fin[i].start == rb->fin[i].start);
    }
    sim_destroy(a); sim_destroy(b); sim_destroy(ra); sim_destroy(rb);
}

#ifdef APRM_DEBUG
/* The checker really detects each kind of corruption (and passes a good Sim). */
static void test_checker_detects(void)
{
    Sim *s = make(cfg_default());
    Job a = mkjob(1, 0, 10, 4, 1000), b = mkjob(2, 50, 10, 4, 1000);
    const char *why = NULL;
    CHECK(sim_add_job(s, &a) == APRM_OK && sim_add_job(s, &b) == APRM_OK);
    CHECK(sim_check_invariants(s, &why) == 0);
    CHECK(sim_step(s) == 1);
    CHECK(sim_check_invariants(s, &why) == 0);

    s->free_cpu += 1;  CHECK(sim_check_invariants(s, &why) == 1); s->free_cpu -= 1;
    s->free_mem -= 1;  CHECK(sim_check_invariants(s, &why) == 1); s->free_mem += 1;
    s->n_total += 1;   CHECK(sim_check_invariants(s, &why) == 1); s->n_total -= 1;
    {
        RunEntry *r = (RunEntry *)s->running.data;
        r->finish += 1;  CHECK(sim_check_invariants(s, &why) == 1); r->finish -= 1;
        r->start -= 1;   CHECK(sim_check_invariants(s, &why) == 1); r->start += 1;
    }
    CHECK(sim_check_invariants(s, &why) == 0);
    run_all(s);
    CHECK(sim_check_invariants(s, &why) == 0);
    s->fin[0].finish += 1; CHECK(sim_check_invariants(s, &why) == 1); s->fin[0].finish -= 1;
    s->n_finished += 1;    CHECK(sim_check_invariants(s, &why) == 1); s->n_finished -= 1;
    s->fin[0].start = s->fin[0].job.arrival - 1; s->fin[0].finish = s->fin[0].start + 10;
    CHECK(sim_check_invariants(s, &why) == 1);
    sim_destroy(s);

    /* a waiting job that fits but was not started breaks the post-condition */
    s = make(cfg_default());
    a = mkjob(1, 0, 10, 4, 1000);
    CHECK(sim_add_job(s, &a) == APRM_OK);
    CHECK(heap_pop(&s->pending, &a) == APRM_OK);
    {
        WaitEntry w; w.job = a; w.key = 0; w.skipmask = 0;
        CHECK(heap_push(&s->waiting, &w) == APRM_OK);
    }
    CHECK(sim_check_invariants(s, &why) == 1);
    sim_destroy(s);
}
#endif

int main(void)
{
    test_create_null();
    test_create_bad_field();
    test_create_bad_policy();
    test_create_ok();
    test_two_sims();
    test_add_ok_order();
    test_add_ranges();
    test_add_capacity();
    test_add_duplicate();
    test_add_limit();
    test_add_past();
    test_add_order();
    test_reject_unchanged();
    test_error_kept_until_reset();
    test_id_set_growth();
    test_reset_destroy();
    test_step_null_and_policy();
    test_step_empty();
    test_step_single();
    test_finish_before_arrival();
    test_greedy_skip();
    test_skip_pushback_order();
    test_run_until();
    test_reset_rerun();
    test_overflow();
    test_invariants_random();
    test_exact_one_free();
    test_finished_order();
    test_o13_same_tick();
    test_o13_edge();
    test_step_two_sims_interleaved();
#ifdef APRM_DEBUG
    test_checker_detects();
#endif
    return TEST_REPORT();
}
