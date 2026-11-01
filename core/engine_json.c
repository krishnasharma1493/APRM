/*
 * engine_json.c: the state, results and metrics outputs of the engine
 * (issue K-11, PRD section 5 "JSON shapes"). Split from engine.c so the
 * event loop and these read-only reports do not share a file.
 *
 * Everything here only READS the Sim. Metrics are computed at report time, in
 * O(n), from the finished list (D61): the list already holds every number
 * needed, so there is no second copy of the totals to keep in step, and
 * sim_step stays exactly as it was (all-or-nothing, no extra work per event).
 */
#define APRM_ENGINE_INTERNAL
#include "engine_internal.h"

#include <stdlib.h>
#include "csv.h"
#include "exact.h"
#include "heap.h"
#include "json.h"
#include "metrics.h"

/* qsort compare for ResultRow by id (ids are unique). O(1). */
static int cmp_row_id(const void *a, const void *b)
{
    const ResultRow *x = a, *y = b;
    return (x->id > y->id) - (x->id < y->id);
}

int sim_results_rows(const Sim *s, ResultRow **rows, int64_t *n)
{
    ResultRow *r;
    size_t i;
    if (rows) *rows = NULL;
    if (n) *n = 0;
    if (!s || !rows || !n) return APRM_INVALID_ARGUMENT;
    if (s->fin_len == 0) return APRM_OK;
    if (s->fin_len > SIZE_MAX / sizeof *r) return APRM_OUT_OF_MEMORY;
    r = malloc(s->fin_len * sizeof *r);
    if (!r) return APRM_OUT_OF_MEMORY;
    for (i = 0; i < s->fin_len; i++) {
        const RunEntry *e = &s->fin[i];
        r[i].id = e->job.id;
        r[i].arrival = e->job.arrival;
        r[i].start = e->start;
        r[i].finish = e->finish;
        r[i].wait = e->start - e->job.arrival;
        r[i].turnaround = e->finish - e->job.arrival;
        r[i].priority = e->job.priority;
        r[i].cpu = e->job.cpu;
        r[i].mem = e->job.mem;
    }
    qsort(r, s->fin_len, sizeof *r, cmp_row_id);
    *rows = r;
    *n = (int64_t)s->fin_len;
    return APRM_OK;
}

int sim_results_json(const Sim *s, JsonBuf *out)
{
    ResultRow *rows = NULL;
    int64_t n = 0, i;
    int rc;
    if (!s || !out) return APRM_INVALID_ARGUMENT;
    json_reset(out);
    rc = sim_results_rows(s, &rows, &n);
    if (rc != APRM_OK) return rc;
    json_ok_begin(out);
    json_arr_begin(out);
    for (i = 0; i < n; i++) {
        json_obj_begin(out);
        json_key(out, "id");         json_i64(out, rows[i].id);
        json_key(out, "arrival");    json_i64(out, rows[i].arrival);
        json_key(out, "start");      json_i64(out, rows[i].start);
        json_key(out, "finish");     json_i64(out, rows[i].finish);
        json_key(out, "wait");       json_i64(out, rows[i].wait);
        json_key(out, "turnaround"); json_i64(out, rows[i].turnaround);
        json_key(out, "priority");   json_i64(out, rows[i].priority);
        json_key(out, "cpu");        json_i64(out, rows[i].cpu);
        json_key(out, "mem");        json_i64(out, rows[i].mem);
        json_obj_end(out);
    }
    json_arr_end(out);
    json_ok_end(out);
    free(rows);
    rc = json_status(out);
    if (rc != APRM_OK) json_reset(out);
    return rc;
}

int sim_metrics_json(const Sim *s, JsonBuf *out)
{
    ResultRow *rows = NULL;
    int64_t n = 0;
    Metrics m;
    int rc;
    if (!s || !out) return APRM_INVALID_ARGUMENT;
    json_reset(out);
    rc = sim_results_rows(s, &rows, &n);
    if (rc != APRM_OK) return rc;
    rc = metrics_from_rows(rows, n, s->cfg.cpu_cap, s->cfg.mem_cap, &m);
    free(rows);
    if (rc != APRM_OK) return rc;
    json_ok_begin(out);
    metrics_write_json(&m, out);
    json_ok_end(out);
    rc = json_status(out);
    if (rc != APRM_OK) json_reset(out);
    return rc;
}

/* Make dst a private copy of the heap src, same order and compare, without
 * touching src. The copy is already a valid heap, so heap_build's heapify
 * does no swaps. O(n) time and space; dst owns its buffer (heap_free it). */
static int heap_copy(const Heap *src, Heap *dst)
{
    int rc = heap_init(dst, src->elem_size, src->cmp, src->ctx);
    if (rc != APRM_OK) return rc;
    rc = heap_build(dst, src->data, src->len);
    if (rc != APRM_OK) heap_free(dst);
    return rc;
}

/* The live aging score of w at time now, in thousandths (D14):
 * 1000 x priority + alpha_milli x (now - arrival). Returns 0 on overflow
 * (unreachable within PRD section 3: 10^4 x 10^12 + 9000), else 1. O(1). */
static int aging_score_milli(const Sim *s, const Job *j, int64_t *milli)
{
    int64_t dt = s->now - j->arrival;   /* a waiting job has arrived: dt >= 0 */
    int64_t a = s->cfg.alpha_milli;
    if (dt < 0 || (a > 0 && dt > (INT64_MAX - 9000) / a)) return 0;
    *milli = 1000 * (int64_t)j->priority + a * dt;
    return 1;
}

int sim_state_json(const Sim *s, JsonBuf *out)
{
    Heap w, r;
    WaitEntry we;
    RunEntry re;
    int rc, aging;
    int64_t milli;
    if (!s || !out) return APRM_INVALID_ARGUMENT;
    json_reset(out);
    /* Sorted views need a copy: popping the live heaps would change the
     * simulation. Two O(n) copies and n pops each: O(n log n) time, O(n)
     * extra space, freed before returning. */
    rc = heap_copy(&s->waiting, &w);
    if (rc != APRM_OK) return rc;
    rc = heap_copy(&s->running, &r);
    if (rc != APRM_OK) { heap_free(&w); return rc; }
    aging = s->cfg.policy == POL_AGING || s->cfg.policy == POL_AGING_RESERVE;

    json_ok_begin(out);
    json_obj_begin(out);
    json_key(out, "now");   json_i64(out, s->now);
    json_key(out, "done");  json_i64(out, s->n_finished);
    json_key(out, "total"); json_i64(out, s->n_total);
    json_key(out, "cap");
    json_obj_begin(out);
    json_key(out, "cpu"); json_i64(out, s->cfg.cpu_cap);
    json_key(out, "mem"); json_i64(out, s->cfg.mem_cap);
    json_obj_end(out);
    json_key(out, "free");
    json_obj_begin(out);
    json_key(out, "cpu"); json_i64(out, s->free_cpu);
    json_key(out, "mem"); json_i64(out, s->free_mem);
    json_obj_end(out);

    json_key(out, "waiting");
    json_arr_begin(out);
    while (heap_pop(&w, &we) == APRM_OK) {
        json_obj_begin(out);
        json_key(out, "id"); json_i64(out, we.job.id);
        json_key(out, "score");
        if (aging && aging_score_milli(s, &we.job, &milli)) json_milli(out, milli);
        else json_null(out);                                 /* D63 */
        json_key(out, "priority"); json_i64(out, we.job.priority);
        json_key(out, "arrival");  json_i64(out, we.job.arrival);
        json_key(out, "duration"); json_i64(out, we.job.duration);
        json_key(out, "cpu");      json_i64(out, we.job.cpu);
        json_key(out, "mem");      json_i64(out, we.job.mem);
        json_obj_end(out);
    }
    json_arr_end(out);

    json_key(out, "running");
    json_arr_begin(out);
    while (heap_pop(&r, &re) == APRM_OK) {
        json_obj_begin(out);
        json_key(out, "id");     json_i64(out, re.job.id);
        json_key(out, "start");  json_i64(out, re.start);
        json_key(out, "finish"); json_i64(out, re.finish);
        json_key(out, "cpu");    json_i64(out, re.job.cpu);
        json_key(out, "mem");    json_i64(out, re.job.mem);
        json_obj_end(out);
    }
    json_arr_end(out);

    json_key(out, "reservation");
    if (s->resv.active) {
        json_obj_begin(out);
        json_key(out, "id");          json_i64(out, s->resv.id);
        json_key(out, "shadow_time"); json_i64(out, s->resv.shadow_time);
        json_obj_end(out);
    } else {
        json_null(out);
    }

    json_obj_end(out);
    json_ok_end(out);
    heap_free(&w);
    heap_free(&r);
    rc = json_status(out);
    if (rc != APRM_OK) json_reset(out);
    return rc;
}

int sim_exact_json(const Sim *s, JsonBuf *out)
{
    Job all[APRM_EXACT_MAX_JOBS];
    size_t n = 0, i;
    if (!s || !out) return APRM_INVALID_ARGUMENT;
    json_reset(out);
    if (s->n_total > APRM_EXACT_MAX_JOBS) return APRM_TOO_LARGE;
    for (i = 0; i < s->pending.len; i++)
        all[n++] = ((const Job *)s->pending.data)[i];
    for (i = 0; i < s->waiting.len; i++)
        all[n++] = ((const WaitEntry *)s->waiting.data)[i].job;
    for (i = 0; i < s->running.len; i++)
        all[n++] = ((const RunEntry *)s->running.data)[i].job;
    for (i = 0; i < s->fin_len; i++)
        all[n++] = s->fin[i].job;
    return exact_solve(&s->cfg, all, (int)n, out);
}
