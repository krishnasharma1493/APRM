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
#include "eventlog.h"
#include "policy.h"

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

/* Waiting: smaller key first, then the policy's compare (ctx is the Sim),
 * then arrival, then id (the final tie-break always applies). O(1). */
static int cmp_waiting(const void *a, const void *b, void *ctx)
{
    const WaitEntry *x = a, *y = b;
    const Sim *s = ctx;
    int r;
    if (x->key != y->key) return x->key < y->key ? -1 : 1;
    if (s && s->policy_cmp) {
        r = s->policy_cmp(&x->job, &y->job);
        if (r != 0) return r;
    }
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
    s->fin_len = 0;
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
    s->policy_cmp = policy_compare_for(cfg->policy);
    eventlog_init(&s->log);
    if (heap_init(&s->pending, sizeof(Job), cmp_pending, NULL) != APRM_OK ||
        heap_init(&s->waiting, sizeof(WaitEntry), cmp_waiting, s) != APRM_OK ||
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
    free(s->fin);
    free(s->skip);
    eventlog_free(&s->log);
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
    eventlog_clear(&s->log);
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

/* ---- event loop (issue K-09) ---- */

/* New capacity for an array that must hold at least need items of elem
 * bytes: at least double, minimum 16. Returns 0 if the byte size would
 * overflow size_t. O(1). */
static size_t grown_cap(size_t cap, size_t need, size_t elem)
{
    size_t ncap = (cap <= SIZE_MAX / 2 && cap * 2 > need) ? cap * 2 : need;
    if (ncap < 16) ncap = 16;
    if (ncap > SIZE_MAX / elem) return 0;
    return ncap;
}

/* Make the finished list hold at least need entries. Returns APRM_OK or
 * APRM_OUT_OF_MEMORY (list unchanged). O(n) when it grows, else O(1). The
 * Sim owns the array. */
static int reserve_fin(Sim *s, size_t need)
{
    RunEntry *grown;
    size_t ncap;
    if (need <= s->fin_cap) return APRM_OK;
    ncap = grown_cap(s->fin_cap, need, sizeof *grown);
    if (ncap == 0) return APRM_OUT_OF_MEMORY;
    grown = realloc(s->fin, ncap * sizeof *grown);
    if (!grown) return APRM_OUT_OF_MEMORY;
    s->fin = grown;
    s->fin_cap = ncap;
    return APRM_OK;
}

/* Same for the skip-list scratch buffer. */
static int reserve_skip(Sim *s, size_t need)
{
    WaitEntry *grown;
    size_t ncap;
    if (need <= s->skip_cap) return APRM_OK;
    ncap = grown_cap(s->skip_cap, need, sizeof *grown);
    if (ncap == 0) return APRM_OUT_OF_MEMORY;
    grown = realloc(s->skip, ncap * sizeof *grown);
    if (!grown) return APRM_OUT_OF_MEMORY;
    s->skip = grown;
    s->skip_cap = ncap;
    return APRM_OK;
}

/* Time of the next event into *t: the earlier of the first pending arrival
 * and the first running finish. If only waiting jobs remain (cannot happen
 * after a selection step, since a job fits an empty machine) the next event
 * is "now". Returns 1 if there is an event, 0 if the simulation is finished.
 * O(1). */
static int next_event(const Sim *s, int64_t *t)
{
    Job a;
    RunEntry r;
    int has_a = heap_peek(&s->pending, &a) == APRM_OK;
    int has_r = heap_peek(&s->running, &r) == APRM_OK;
    if (has_a && has_r) *t = a.arrival < r.finish ? a.arrival : r.finish;
    else if (has_a) *t = a.arrival;
    else if (has_r) *t = r.finish;
    else if (heap_size(&s->waiting) > 0) *t = s->now;
    else return 0;
    return 1;
}

int sim_step(Sim *s)
{
    int64_t t, w_max, r_max;
    size_t skipped = 0, i;
    int rc;
    Job jb;
    RunEntry re;
    WaitEntry we;

    if (!s) return APRM_INVALID_ARGUMENT;
    if (!s->policy_cmp) {
        fail(&s->err, APRM_INVALID_ARGUMENT, "policy", "Policy %d is not implemented yet.",
             (int)s->cfg.policy);
        return APRM_INVALID_ARGUMENT;
    }
    if (!next_event(s, &t)) return 0;

    /* Reserve every buffer this step can need, so that nothing below can
     * fail halfway (a step is all-or-nothing). Bounds are the live counts,
     * not n_total, so memory follows the queue, not the whole workload. */
    w_max = (int64_t)(heap_size(&s->waiting) + heap_size(&s->pending));

    /* Overflow guard, before anything changes. A job can only start if one is
     * waiting or pending; every start is at t and every duration is at most
     * APRM_DURATION_MAX, so start + duration fits when t is below the limit. */
    if (w_max > 0 && t > INT64_MAX - APRM_DURATION_MAX) {
        fail(&s->err, APRM_INVALID_FIELD, "duration", "Time %lld is too large to add a duration.",
             (long long)t);
        return APRM_INVALID_FIELD;
    }

    r_max = (int64_t)heap_size(&s->running) + w_max;
    if (r_max > s->cfg.cpu_cap) r_max = s->cfg.cpu_cap;  /* each running job uses >= 1 core */
    if (heap_reserve(&s->waiting, (size_t)w_max) != APRM_OK ||
        heap_reserve(&s->running, (size_t)r_max) != APRM_OK ||
        reserve_skip(s, (size_t)w_max) != APRM_OK ||
        reserve_fin(s, s->fin_len + heap_size(&s->running)) != APRM_OK ||
        /* log entries: <= one per finish, arrival and examined waiting job (D60) */
        eventlog_reserve(&s->log, heap_size(&s->running) + heap_size(&s->pending) + (size_t)w_max) != APRM_OK) {
        fail(&s->err, APRM_OUT_OF_MEMORY, "", "Out of memory.");
        return APRM_OUT_OF_MEMORY;
    }

    s->now = t;

    /* 1. Finishes first (D9): free resources, append to the finished list.
     * Loop until no running job finishes at t (several can share a tick).
     * Finished-list order: by finish time, and within one tick by the
     * running-heap order (arrival, then id): K-10's FINISH lines rely on it.
     * One FINISH log entry each, in that order. */
    while (heap_peek(&s->running, &re) == APRM_OK && re.finish <= t) {
        heap_pop(&s->running, &re);
        s->free_cpu += re.job.cpu;
        s->free_mem += re.job.mem;
        eventlog_push(&s->log, t, LOG_FINISH, re.job.id, re.finish - re.start,
                      re.job.cpu, re.job.mem, 0);  /* cannot fail: reserved above */
        s->fin[s->fin_len++] = re;
        s->n_finished++;
    }

    /* 2. Arrivals at t join the waiting heap (one ARRIVE log entry each). */
    while (heap_peek(&s->pending, &jb) == APRM_OK && jb.arrival <= t) {
        heap_pop(&s->pending, &jb);
        we.job = jb;
        eventlog_push(&s->log, t, LOG_ARRIVE, jb.id, jb.priority, 0, 0, 0);  /* reserved above */
        we.skipmask = 0;
        we.key = 0;  /* FCFS has no key; the compare is arrival, then id */
        rc = heap_push(&s->waiting, &we);  /* cannot fail: reserved above */
        if (rc != APRM_OK) return rc;
    }

    /* 3. Greedy fill (BLUEPRINT 3.4). A job that does not fit is parked in
     * the skip list and pushed back only after the loop, so it is never
     * popped twice in one step. One START or SKIP log entry per job popped. */
    while (heap_size(&s->waiting) > 0 && s->free_cpu > 0 && s->free_mem > 0) {
        heap_pop(&s->waiting, &we);
        if (we.job.cpu <= s->free_cpu && we.job.mem <= s->free_mem) {
            eventlog_push(&s->log, t, LOG_START, we.job.id, we.job.cpu, we.job.mem,
                          s->free_cpu, s->free_mem);  /* free before it starts; reserved above */
            re.job = we.job;
            re.start = t;
            re.finish = t + we.job.duration;  /* cannot overflow: guarded above */
            s->free_cpu -= we.job.cpu;
            s->free_mem -= we.job.mem;
            rc = heap_push(&s->running, &re);  /* cannot fail: reserved above */
            if (rc != APRM_OK) return rc;
        } else {
            /* Log a SKIP only the first time, and again only when the set of
             * short resources changes (D60): at most 3 per job. */
            int mask = (we.job.cpu > s->free_cpu ? 1 : 0) | (we.job.mem > s->free_mem ? 2 : 0);
            if (mask != we.skipmask) {
                eventlog_push(&s->log, t, LOG_SKIP, we.job.id, we.job.cpu, we.job.mem,
                              s->free_cpu, s->free_mem);  /* reserved above */
                we.skipmask = mask;
            }
            s->skip[skipped++] = we;
        }
    }
    for (i = 0; i < skipped; i++) {
        rc = heap_push(&s->waiting, &s->skip[i]);
        if (rc != APRM_OK) return rc;
    }

#ifdef APRM_DEBUG
    {
        const char *why = NULL;
        /* A violation is a bug in the engine: stop at once. No printing in
         * core/; a debugger shows `why`, and tests call the checker directly. */
        if (sim_check_invariants(s, &why)) abort();
    }
#endif
    return 1;
}

int sim_log_json(const Sim *s, int64_t since_seq, JsonBuf *out)
{
    if (!s || !out) return APRM_INVALID_ARGUMENT;
    return eventlog_json(&s->log, since_seq, out);
}

int sim_run_until(Sim *s, int64_t t)
{
    int64_t next;
    int rc;
    if (!s) return APRM_INVALID_ARGUMENT;
    while (next_event(s, &next) && next <= t) {
        rc = sim_step(s);
        if (rc < 0) return rc;
        if (rc == 0) break;
    }
    return APRM_OK;
}

#ifdef APRM_DEBUG
/* ---- invariant checker (debug builds only; PRD section 4) ---- */

int sim_check_invariants(const Sim *s, const char **why)
{
    int64_t used_cpu = 0, used_mem = 0;
    size_t i, n;
    const RunEntry *r;
    const WaitEntry *w;
    const Job *p;
#define BAD(msg) do { *why = (msg); return 1; } while (0)

    if (s->free_cpu < 0 || s->free_cpu > s->cfg.cpu_cap) BAD("free cpu outside 0..capacity");
    if (s->free_mem < 0 || s->free_mem > s->cfg.mem_cap) BAD("free memory outside 0..capacity");

    n = heap_size(&s->running);
    for (i = 0; i < n; i++) {
        r = (const RunEntry *)(s->running.data + i * s->running.elem_size);
        used_cpu += r->job.cpu;
        used_mem += r->job.mem;
        if (r->start < r->job.arrival) BAD("running job started before its arrival");
        if (r->start > s->now) BAD("running job starts in the future");
        if (r->finish - r->start != r->job.duration) BAD("running job finish - start != duration");
        if (r->finish <= s->now) BAD("running job should already have finished");
    }
    if (used_cpu > s->cfg.cpu_cap) BAD("used cpu above capacity");
    if (used_mem > s->cfg.mem_cap) BAD("used memory above capacity");
    if (used_cpu + s->free_cpu != s->cfg.cpu_cap) BAD("used + free cpu != capacity");
    if (used_mem + s->free_mem != s->cfg.mem_cap) BAD("used + free memory != capacity");

    for (i = 0; i < s->fin_len; i++) {
        if (s->fin[i].start < s->fin[i].job.arrival) BAD("finished job started before its arrival");
        if (s->fin[i].finish - s->fin[i].start != s->fin[i].job.duration)
            BAD("finished job finish - start != duration");
        if (s->fin[i].finish > s->now) BAD("finished job finishes after now");
    }
    if ((int64_t)s->fin_len != s->n_finished) BAD("finished list length != n_finished");

    n = heap_size(&s->waiting);
    for (i = 0; i < n; i++) {
        w = (const WaitEntry *)(s->waiting.data + i * s->waiting.elem_size);
        if (w->job.cpu > s->cfg.cpu_cap || w->job.mem > s->cfg.mem_cap)
            BAD("waiting job can never fit the machine");
        if (w->job.arrival > s->now) BAD("waiting job has not arrived yet");
        /* Greedy-fill post-condition: nothing left waiting could start now. */
        if (w->job.cpu <= s->free_cpu && w->job.mem <= s->free_mem)
            BAD("a waiting job fits but was not started");
    }
    for (i = 0; i < heap_size(&s->pending); i++) {
        p = (const Job *)(s->pending.data + i * s->pending.elem_size);
        if (p->arrival < s->now) BAD("pending job arrival is in the past");
    }

    if ((int64_t)(heap_size(&s->pending) + heap_size(&s->waiting) + heap_size(&s->running)
                  + s->fin_len) != s->n_total)
        BAD("pending + waiting + running + finished != total jobs");
    /* "At most one reservation, and it is in the waiting heap": there is no
     * reservation until K-26, so there is nothing to check yet. */
#undef BAD
    return 0;
}
#endif
