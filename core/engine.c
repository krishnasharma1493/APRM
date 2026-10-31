/*
 * engine.c: Sim lifecycle and job validation (issue K-08).
 *
 * Rule D29: validate first, then modify. sim_add_job runs every check that can
 * fail without touching the Sim; only then does it do the steps that can run
 * out of memory, in an order that leaves the Sim unchanged if one fails.
 */
#define APRM_ENGINE_INTERNAL
#include "engine_internal.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "config.h"

/* ---- error storage ---- */

/* Fill *e (if non-NULL) with code, field and a printf-style message.
 * Returns code so callers can write "return fail(...)". O(1). */
static int fail(SimError *e, int code, const char *field, const char *fmt, ...)
{
    va_list ap;
    if (e) {
        e->code = code;
        snprintf(e->field, sizeof e->field, "%s", field);
        va_start(ap, fmt);
        vsnprintf(e->message, sizeof e->message, fmt, ap);
        va_end(ap);
    }
    return code;
}

/* ---- heap compare functions (every compare ends with arrival, then id) ---- */

/* Pending arrivals: earlier arrival first, then lower id. O(1). */
static int cmp_pending(const void *a, const void *b, void *ctx)
{
    const Job *x = a, *y = b;
    (void)ctx;
    if (x->arrival != y->arrival) return x->arrival < y->arrival ? -1 : 1;
    return (x->id > y->id) - (x->id < y->id);
}

/* Waiting: smaller key first, then arrival, then id. O(1). */
static int cmp_waiting(const void *a, const void *b, void *ctx)
{
    const WaitEntry *x = a, *y = b;
    (void)ctx;
    if (x->key != y->key) return x->key < y->key ? -1 : 1;
    return cmp_pending(&x->job, &y->job, NULL);
}

/* Running: earlier finish first, then arrival, then id. O(1). */
static int cmp_running(const void *a, const void *b, void *ctx)
{
    const RunEntry *x = a, *y = b;
    (void)ctx;
    if (x->finish != y->finish) return x->finish < y->finish ? -1 : 1;
    return cmp_pending(&x->job, &y->job, NULL);
}

/* ---- id set: open addressing, linear probing, load factor <= 1/2 ---- */

/* 32-bit integer mixer (murmur3 finaliser): deterministic, no state. O(1). */
static uint32_t id_hash(int32_t id)
{
    uint32_t h = (uint32_t)id;
    h ^= h >> 16; h *= 0x85ebca6bu;
    h ^= h >> 13; h *= 0xc2b2ae35u;
    h ^= h >> 16;
    return h;
}

/* True if id is in the set. Expected O(1); terminates because the table is
 * never more than half full. */
static int idset_has(const IdSet *set, int32_t id)
{
    size_t mask, i;
    if (set->cap == 0) return 0;
    mask = set->cap - 1;
    for (i = id_hash(id) & mask; set->slot[i] != -1; i = (i + 1) & mask)
        if (set->slot[i] == id) return 1;
    return 0;
}

/* Put id in a set known not to contain it and to have room. O(1) expected. */
static void idset_put(IdSet *set, int32_t id)
{
    size_t mask = set->cap - 1, i = id_hash(id) & mask;
    while (set->slot[i] != -1) i = (i + 1) & mask;
    set->slot[i] = id;
    set->len++;
}

/* Make room for one more id, doubling and rehashing when needed. Returns
 * APRM_OK or APRM_OUT_OF_MEMORY (the set is then unchanged). Amortised O(1),
 * O(n) in the call that grows. The set owns its slots. */
static int idset_reserve(IdSet *set)
{
    size_t ncap, i;
    int32_t *nslot;
    IdSet old = *set;
    if ((set->len + 1) * 2 <= set->cap) return APRM_OK;
    if (set->cap > SIZE_MAX / 2 / sizeof(int32_t)) return APRM_OUT_OF_MEMORY;
    ncap = set->cap ? set->cap * 2 : 16;
    nslot = malloc(ncap * sizeof *nslot);
    if (!nslot) return APRM_OUT_OF_MEMORY;
    for (i = 0; i < ncap; i++) nslot[i] = -1;
    set->slot = nslot;
    set->cap = ncap;
    set->len = 0;
    for (i = 0; i < old.cap; i++)
        if (old.slot[i] != -1) idset_put(set, old.slot[i]);
    free(old.slot);
    return APRM_OK;
}

/* ---- lifecycle ---- */

int sim_validate_config(const SimConfig *cfg, SimError *err)
{
    if (err) memset(err, 0, sizeof *err);
    if (!cfg) return fail(err, APRM_INVALID_ARGUMENT, "", "Configuration is missing.");
    if (cfg->cpu_cap < APRM_CPU_CAP_MIN || cfg->cpu_cap > APRM_CPU_CAP_MAX)
        return fail(err, APRM_INVALID_FIELD, "cpu_cap", "cpu_cap must be %d to %d.",
                    APRM_CPU_CAP_MIN, APRM_CPU_CAP_MAX);
    if (cfg->mem_cap < APRM_MEM_CAP_MIN || cfg->mem_cap > APRM_MEM_CAP_MAX)
        return fail(err, APRM_INVALID_FIELD, "mem_cap", "mem_cap must be %d to %d.",
                    APRM_MEM_CAP_MIN, APRM_MEM_CAP_MAX);
    if (cfg->alpha_milli < APRM_ALPHA_MILLI_MIN || cfg->alpha_milli > APRM_ALPHA_MILLI_MAX)
        return fail(err, APRM_INVALID_FIELD, "alpha_milli", "alpha_milli must be %d to %d.",
                    APRM_ALPHA_MILLI_MIN, APRM_ALPHA_MILLI_MAX);
    if (cfg->reserve_threshold < APRM_RESERVE_T_MIN || cfg->reserve_threshold > APRM_RESERVE_T_MAX)
        return fail(err, APRM_INVALID_FIELD, "reserve_threshold",
                    "reserve_threshold must be %d to %d.", APRM_RESERVE_T_MIN, APRM_RESERVE_T_MAX);
    /* Written so that NaN fails the test. */
    if (!(cfg->knapsack_eps >= APRM_KNAPSACK_EPS_MIN && cfg->knapsack_eps <= APRM_KNAPSACK_EPS_MAX))
        return fail(err, APRM_INVALID_FIELD, "knapsack_eps", "knapsack_eps must be %.2f to %d.",
                    APRM_KNAPSACK_EPS_MIN, APRM_KNAPSACK_EPS_MAX);
    if (cfg->max_jobs < 1)
        return fail(err, APRM_INVALID_FIELD, "max_jobs", "max_jobs must be at least 1.");
    if ((int)cfg->policy < (int)POL_FCFS || (int)cfg->policy > (int)POL_KNAPSACK)
        return fail(err, APRM_INVALID_ARGUMENT, "policy", "Unknown policy %d.", (int)cfg->policy);
    return APRM_OK;
}

/* Put a Sim in its empty starting state (config untouched). O(1). */
static void sim_clear_scalars(Sim *s)
{
    s->now = 0;
    s->free_cpu = s->cfg.cpu_cap;
    s->free_mem = s->cfg.mem_cap;
    s->n_total = 0;
    s->n_finished = 0;
    memset(&s->err, 0, sizeof s->err);
}

int sim_create(const SimConfig *cfg, Sim **out)
{
    Sim *s;
    int rc;
    if (!cfg || !out) return APRM_INVALID_ARGUMENT;
    *out = NULL;
    rc = sim_validate_config(cfg, NULL);
    if (rc != APRM_OK) return rc;
    s = calloc(1, sizeof *s);
    if (!s) return APRM_OUT_OF_MEMORY;
    s->cfg = *cfg;
    sim_clear_scalars(s);
    if (heap_init(&s->pending, sizeof(Job), cmp_pending, NULL) != APRM_OK ||
        heap_init(&s->waiting, sizeof(WaitEntry), cmp_waiting, NULL) != APRM_OK ||
        heap_init(&s->running, sizeof(RunEntry), cmp_running, NULL) != APRM_OK) {
        sim_destroy(s);  /* heap_free is safe on a heap that failed to init */
        return APRM_OUT_OF_MEMORY;
    }
    *out = s;
    return APRM_OK;
}

void sim_destroy(Sim *s)
{
    if (!s) return;
    heap_free(&s->pending);
    heap_free(&s->waiting);
    heap_free(&s->running);
    free(s->ids.slot);
    free(s);
}

int sim_reset(Sim *s)
{
    size_t i;
    if (!s) return APRM_INVALID_ARGUMENT;
    /* Keep the buffers, drop the contents: reset therefore cannot fail. */
    s->pending.len = 0;
    s->waiting.len = 0;
    s->running.len = 0;
    for (i = 0; i < s->ids.cap; i++) s->ids.slot[i] = -1;
    s->ids.len = 0;
    sim_clear_scalars(s);
    return APRM_OK;
}

const SimError *sim_last_error(const Sim *s)
{
    return s ? &s->err : NULL;
}

int sim_add_job(Sim *s, const Job *job)
{
    SimError *e;
    int rc;
    if (!s) return APRM_INVALID_ARGUMENT;
    e = &s->err;
    if (!job) return fail(e, APRM_INVALID_ARGUMENT, "", "Job is missing.");

    /* 1-2: every field range (PRD section 3). Nothing is modified below this
     * line until the final block. */
    if (job->id < APRM_JOB_ID_MIN)  /* the upper bound is INT32_MAX: the type itself */
        return fail(e, APRM_INVALID_FIELD, "id", "id must be %d to %d.", APRM_JOB_ID_MIN, APRM_JOB_ID_MAX);
    if (job->arrival < APRM_ARRIVAL_MIN || job->arrival > APRM_ARRIVAL_MAX)
        return fail(e, APRM_INVALID_FIELD, "arrival", "arrival must be %d to %d.",
                    APRM_ARRIVAL_MIN, APRM_ARRIVAL_MAX);
    if (job->duration < APRM_DURATION_MIN || job->duration > APRM_DURATION_MAX)
        return fail(e, APRM_INVALID_FIELD, "duration", "duration must be %d to %d.",
                    APRM_DURATION_MIN, APRM_DURATION_MAX);
    if (job->cpu < 1)
        return fail(e, APRM_INVALID_FIELD, "cpu", "cpu must be at least 1.");
    if (job->mem < 1)
        return fail(e, APRM_INVALID_FIELD, "mem", "mem must be at least 1.");
    if (job->priority < APRM_PRIORITY_MIN || job->priority > APRM_PRIORITY_MAX)
        return fail(e, APRM_INVALID_FIELD, "priority", "priority must be %d to %d.",
                    APRM_PRIORITY_MIN, APRM_PRIORITY_MAX);

    /* 3: the job must fit on an empty machine. */
    if (job->cpu > s->cfg.cpu_cap)
        return fail(e, APRM_CAPACITY_EXCEEDED, "cpu", "Job %d needs %lld cores; machine has %lld cores.",
                    (int)job->id, (long long)job->cpu, (long long)s->cfg.cpu_cap);
    if (job->mem > s->cfg.mem_cap)
        return fail(e, APRM_CAPACITY_EXCEEDED, "mem", "Job %d needs %lld MB; machine has %lld MB.",
                    (int)job->id, (long long)job->mem, (long long)s->cfg.mem_cap);

    /* 4: no arrivals in the past. */
    if (job->arrival < s->now)
        return fail(e, APRM_ARRIVAL_IN_PAST, "arrival", "Arrival %lld is before current time %lld.",
                    (long long)job->arrival, (long long)s->now);

    /* 5: unique id. */
    if (idset_has(&s->ids, job->id))
        return fail(e, APRM_DUPLICATE_ID, "id", "Job id %d already exists.", (int)job->id);

    /* 6: job limit. */
    if (s->n_total >= s->cfg.max_jobs) {
        /* Generic wording: the CLI and the website choose their own (D54). */
        return fail(e, APRM_LIMIT_REACHED, "", "Limit is %lld jobs.", (long long)s->cfg.max_jobs);
    }

    /* 7: modify. Order matters: the id set may grow (a bigger set is still the
     * same set), then the pending push (can fail; nothing else changed yet),
     * then the id insert and counter, which cannot fail. */
    rc = idset_reserve(&s->ids);
    if (rc == APRM_OK) rc = heap_push(&s->pending, job);
    if (rc != APRM_OK)
        return fail(e, APRM_OUT_OF_MEMORY, "", "Out of memory.");
    idset_put(&s->ids, job->id);
    s->n_total++;
    return APRM_OK;
}
