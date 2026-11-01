/*
 * exact.c: exact minimum-total-wait schedule for up to 9 jobs (K-33).
 * The model, the objective and the tie-break are written in exact.h.
 *
 * Method: depth-first search over job orders with serial schedule generation
 * and branch and bound.
 *   - A node is a partial order: some jobs already placed.
 *   - To extend it with job k, k is placed at the earliest time t >= arrival
 *     where it fits beside the already placed jobs for its whole duration.
 *   - A branch whose cost so far is already larger than the best complete
 *     schedule is cut. Equal cost is NOT cut, so that equal optima can be
 *     compared by the tie-break; the result is then independent of search order.
 *
 * Why trying all orders is enough (proof). Let S be any feasible schedule.
 * List the jobs by start time in S (ties by index) and run serial generation in
 * that order. Claim: job j gets a start s'_j <= s_j. Induction: the jobs listed
 * before j start no later than before, so at any time t in [s_j, s_j + d_j) a
 * job i listed before j that is running in the new partial schedule has
 * s'_i <= t < s'_i + d_i <= s_i + d_i and s_i <= s_j <= t, i.e. it is running in
 * S at t too. So the load of those jobs at t is at most their load in S, and S
 * is feasible at s_j with j included, so s_j is a feasible start for j in the new
 * schedule; the earliest feasible start is therefore <= s_j. Hence every start
 * is no later, every wait is no larger, and the generated schedule costs no more
 * than S. Total wait is a regular objective (it never improves by starting a job
 * later), so the minimum over all job orders equals the minimum over all
 * schedules. Moreover an optimal S is generated exactly: if serial generation
 * started some job strictly earlier, that job could be moved earlier in S
 * without touching any other job (the same load argument), lowering the total,
 * so S would not be optimal. Hence the search sees every optimal start vector
 * and the lexicographic tie-break is over all optimal schedules. (Kolisch 1996
 * proves the general statement for project scheduling; not cited as the proof
 * here.)
 *
 * Earliest feasible start. With the placed jobs fixed, the load only drops at
 * the end of a placed job, so the earliest feasible t is the arrival or the end
 * time of a placed job. Feasibility of [t, t+d): the load is piecewise constant
 * and rises only when a job starts, so it is enough to test the instant t and
 * every placed start strictly inside the window.
 *
 * Complexity: at most n! leaves; each placement tries up to n candidate times,
 * each with up to n checkpoints, each summing up to n jobs: O(n^3) per
 * placement, O(n! * n^3) worst case (O-3: the stated n! * n^2 omitted a factor).
 * Space O(n); nothing is allocated; the recursion is at most n deep.
 */
#include <stdint.h>
#include <string.h>

#include "exact.h"

/* Search state; lives on the caller's stack, so there is no global state. */
typedef struct {
    int       n;
    int64_t   cpu_cap, mem_cap;
    /* The jobs sorted by (arrival, id): index 0..n-1. */
    int64_t   arr[APRM_EXACT_MAX_JOBS], dur[APRM_EXACT_MAX_JOBS];
    int64_t   cpu[APRM_EXACT_MAX_JOBS], mem[APRM_EXACT_MAX_JOBS];
    /* Placed jobs in placement order (depth 0..), for the load checks. */
    int64_t   ps[APRM_EXACT_MAX_JOBS], pe[APRM_EXACT_MAX_JOBS];
    int64_t   pc[APRM_EXACT_MAX_JOBS], pm[APRM_EXACT_MAX_JOBS];
    int64_t   cur[APRM_EXACT_MAX_JOBS];    /* start per sorted index, current branch */
    int64_t   best[APRM_EXACT_MAX_JOBS];   /* start per sorted index, best so far */
    int64_t   best_cost;                   /* -1 until a first complete schedule exists */
    int       err;                         /* sticky: APRM_OK or a negative code */
} Search;

/* *r = a + b if it does not overflow int64; else returns 0. O(1). */
static int add_ok(int64_t a, int64_t b, int64_t *r)
{
    if ((b > 0 && a > INT64_MAX - b) || (b < 0 && a < INT64_MIN - b)) return 0;
    *r = a + b;
    return 1;
}

/* 1 if job k fits beside the first `depth` placed jobs during [t, t + d_k),
 * where tend = t + d_k. Tests the instant t and every placed start strictly
 * inside the window. O(depth^2). */
static int fits(const Search *s, int depth, int k, int64_t t, int64_t tend)
{
    int a, i;
    for (a = -1; a < depth; a++) {
        int64_t cp = (a < 0) ? t : s->ps[a];
        int64_t c = s->cpu[k], m = s->mem[k];
        if (a >= 0 && !(cp > t && cp < tend)) continue;
        for (i = 0; i < depth; i++)
            if (s->ps[i] <= cp && cp < s->pe[i]) { c += s->pc[i]; m += s->pm[i]; }
        if (c > s->cpu_cap || m > s->mem_cap) return 0;
    }
    return 1;
}

/* The earliest feasible start of job k after `depth` placed jobs, into *out.
 * Candidates are the arrival and the end times of placed jobs after it.
 * Sets s->err and returns 0 on int64 overflow. O(depth^3). */
static int earliest(Search *s, int depth, int k, int64_t *out)
{
    int64_t best = -1, tend;
    int i;
    for (i = -1; i < depth; i++) {
        int64_t t = (i < 0) ? s->arr[k] : s->pe[i];
        if (t < s->arr[k] || (best >= 0 && t >= best)) continue;
        if (!add_ok(t, s->dur[k], &tend)) { s->err = APRM_INVALID_FIELD; return 0; }
        if (fits(s, depth, k, t, tend)) best = t;
    }
    /* The latest end of all placed jobs (or the arrival) is always feasible,
     * so best >= 0 here. */
    *out = best;
    return best >= 0;
}

/* Record the complete schedule in s->cur (total cost `cost`) if it is better
 * than the best, or equal and lexicographically smaller in start vector. O(n). */
static void leaf(Search *s, int64_t cost)
{
    int i;
    if (s->best_cost >= 0 && cost > s->best_cost) return;
    if (s->best_cost == cost) {
        for (i = 0; i < s->n && s->cur[i] == s->best[i]; i++) { }
        if (i == s->n || s->cur[i] > s->best[i]) return;
    }
    s->best_cost = cost;
    memcpy(s->best, s->cur, sizeof s->cur);
}

/* Extend the partial order of `depth` placed jobs (used = bit mask over sorted
 * indexes) whose total wait is `cost`. Cuts a branch whose cost already exceeds
 * the best; keeps equal cost. Recursion depth <= n. */
static void dfs(Search *s, int depth, unsigned used, int64_t cost)
{
    int k;
    if (depth == s->n) { leaf(s, cost); return; }
    for (k = 0; k < s->n && s->err == APRM_OK; k++) {
        int64_t t, fin, nc;
        if (used & (1u << k)) continue;
        if (!earliest(s, depth, k, &t)) return;
        if (!add_ok(t, s->dur[k], &fin) || !add_ok(cost, t - s->arr[k], &nc)) {
            s->err = APRM_INVALID_FIELD;
            return;
        }
        if (s->best_cost >= 0 && nc > s->best_cost) continue;
        s->ps[depth] = t;  s->pe[depth] = fin;
        s->pc[depth] = s->cpu[k];  s->pm[depth] = s->mem[k];
        s->cur[k] = t;
        dfs(s, depth + 1, used | (1u << k), nc);
    }
}

/* Check cfg, n and every job against PRD section 3. Returns APRM_OK or the
 * code. O(n^2) (the duplicate-id check). */
static int validate(const SimConfig *cfg, const Job *jobs, int n)
{
    int i, j;
    if (!cfg) return APRM_INVALID_ARGUMENT;
    if (n < 0 || (n > 0 && !jobs)) return APRM_INVALID_ARGUMENT;
    if (cfg->cpu_cap < APRM_CPU_CAP_MIN || cfg->cpu_cap > APRM_CPU_CAP_MAX ||
        cfg->mem_cap < APRM_MEM_CAP_MIN || cfg->mem_cap > APRM_MEM_CAP_MAX)
        return APRM_INVALID_ARGUMENT;
    if (n > APRM_EXACT_MAX_JOBS) return APRM_TOO_LARGE;
    for (i = 0; i < n; i++) {
        const Job *b = &jobs[i];
        if (b->id < APRM_JOB_ID_MIN ||
            b->arrival < APRM_ARRIVAL_MIN || b->arrival > APRM_ARRIVAL_MAX ||
            b->duration < APRM_DURATION_MIN || b->duration > APRM_DURATION_MAX ||
            b->cpu < 1 || b->mem < 1 ||
            b->priority < APRM_PRIORITY_MIN || b->priority > APRM_PRIORITY_MAX)
            return APRM_INVALID_FIELD;
        if (b->cpu > cfg->cpu_cap || b->mem > cfg->mem_cap) return APRM_CAPACITY_EXCEEDED;
        for (j = 0; j < i; j++)
            if (jobs[j].id == b->id) return APRM_DUPLICATE_ID;
    }
    return APRM_OK;
}

int exact_schedule(const SimConfig *cfg, const Job *jobs, int n, ExactResult *res)
{
    Search s;
    int order[APRM_EXACT_MAX_JOBS];
    int i, j, rc;
    if (!res) return APRM_INVALID_ARGUMENT;
    memset(res, 0, sizeof *res);
    rc = validate(cfg, jobs, n);
    if (rc != APRM_OK) return rc;
    if (n == 0) return APRM_OK;

    /* order[r] = caller index of the r-th job by (arrival, id): insertion sort. */
    for (i = 0; i < n; i++) {
        for (j = i; j > 0; j--) {
            const Job *p = &jobs[order[j - 1]], *q = &jobs[i];
            if (p->arrival < q->arrival || (p->arrival == q->arrival && p->id < q->id)) break;
            order[j] = order[j - 1];
        }
        order[j] = i;
    }

    memset(&s, 0, sizeof s);
    s.n = n;
    s.cpu_cap = cfg->cpu_cap;
    s.mem_cap = cfg->mem_cap;
    s.best_cost = -1;
    for (i = 0; i < n; i++) {
        const Job *b = &jobs[order[i]];
        s.arr[i] = b->arrival;  s.dur[i] = b->duration;
        s.cpu[i] = b->cpu;      s.mem[i] = b->mem;
    }
    dfs(&s, 0, 0u, 0);
    if (s.err != APRM_OK) return s.err;

    res->total_wait = s.best_cost;
    for (i = 0; i < n; i++) res->start[order[i]] = s.best[i];
    return APRM_OK;
}

int exact_solve(const SimConfig *cfg, const Job *jobs, int n, JsonBuf *out)
{
    ExactResult r;
    int idx[APRM_EXACT_MAX_JOBS];
    int i, j, rc;
    if (!out) return APRM_INVALID_ARGUMENT;
    json_reset(out);
    rc = exact_schedule(cfg, jobs, n, &r);
    if (rc != APRM_OK) return rc;

    /* idx = caller indexes sorted by id (ids are unique). */
    for (i = 0; i < n; i++) {
        for (j = i; j > 0 && jobs[idx[j - 1]].id > jobs[i].id; j--) idx[j] = idx[j - 1];
        idx[j] = i;
    }
    json_ok_begin(out);
    json_obj_begin(out);
    json_key(out, "total_wait"); json_i64(out, r.total_wait);
    json_key(out, "schedule");
    json_arr_begin(out);
    for (i = 0; i < n; i++) {
        const Job *b = &jobs[idx[i]];
        int64_t st = r.start[idx[i]], fin = st + b->duration;   /* checked in the search */
        json_obj_begin(out);
        json_key(out, "id");         json_i64(out, b->id);
        json_key(out, "arrival");    json_i64(out, b->arrival);
        json_key(out, "start");      json_i64(out, st);
        json_key(out, "finish");     json_i64(out, fin);
        json_key(out, "wait");       json_i64(out, st - b->arrival);
        json_key(out, "turnaround"); json_i64(out, fin - b->arrival);
        json_key(out, "priority");   json_i64(out, b->priority);
        json_key(out, "cpu");        json_i64(out, b->cpu);
        json_key(out, "mem");        json_i64(out, b->mem);
        json_obj_end(out);
    }
    json_arr_end(out);
    json_obj_end(out);
    json_ok_end(out);
    rc = json_status(out);
    if (rc != APRM_OK) json_reset(out);
    return rc;
}
