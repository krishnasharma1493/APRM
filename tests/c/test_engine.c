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
    s->n_total = APRM_MAX_JOBS_WEB;  /* pretend the web limit was reached */
    expect_reject(s, job_ok(1), APRM_LIMIT_REACHED, "");
    CHECK(strcmp(sim_last_error(s)->message, "Website limit is 5000 jobs.") == 0);
    s->n_total = 0;
    sim_destroy(s);
}

static void test_add_past(void)
{
    Sim *s = make(cfg_default());
    Job j = job_ok(1);
    s->now = 42;  /* test hook: sim_step does not exist yet (K-09) */
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
    for (i = 1; i <= 20; i++) { j = job_ok(i); j.arrival = i * 3; CHECK(sim_add_job(s, &j) == APRM_OK); }
    s->now = 5;
    before = snap(s);
    j = job_ok(100); j.priority = 99;          expect_reject(s, j, APRM_INVALID_FIELD, "priority");
    j = job_ok(100); j.mem = 99999999;         expect_reject(s, j, APRM_CAPACITY_EXCEEDED, "mem");
    j = job_ok(100); j.arrival = 1;            expect_reject(s, j, APRM_ARRIVAL_IN_PAST, "arrival");
    j = job_ok(7);   j.arrival = 50;           expect_reject(s, j, APRM_DUPLICATE_ID, "id");
    CHECK(same(before, snap(s)));
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
    return TEST_REPORT();
}
