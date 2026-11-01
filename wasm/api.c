/*
 * api.c: the WebAssembly face of the engine (PRD section 5 "WebAssembly
 * exports", issue K-13, decisions D26, D27, D53, D54, D55, D64).
 *
 * Flat functions: JavaScript passes plain numbers and gets back a status
 * (0 or a negative APRM_* code, or a handle >= 1) or a pointer to a UTF-8 JSON
 * string, so JavaScript never builds a C struct. Every number crosses as a
 * JavaScript number (a double). Before a number becomes an int64_t it is
 * checked to be a whole number within +-2^53 (the safe-integer range), so a
 * value that JavaScript could not represent exactly is rejected instead of
 * silently rounded; the engine then checks the PRD section 3 ranges.
 *
 * Ownership of returned strings: every handle owns exactly one JsonBuf. A
 * JSON function (aprm_state, aprm_log, aprm_results, aprm_metrics, aprm_exact,
 * aprm_last_error) replaces that buffer's contents (D53) and returns a pointer
 * into it. The pointer is valid until the next call of ANY function on the
 * same handle; copy the text first (UTF8ToString copies it out of the
 * WebAssembly memory). The caller never frees it. A different handle's buffer
 * is never touched. A JSON function never returns NULL: if the engine fails,
 * the string is an error envelope {"ok":false,"error":{...}} (PRD section 5).
 *
 * The only mutable global state in the project lives in THIS file, never in
 * core/ (CLAUDE.md rule 2 is about core/):
 *   g_slots, g_cap   the handle table (handle h is slot h-1)
 *   g_orphan_err     the last failure that had no handle (see below)
 *   g_orphan_buf     the JsonBuf that renders it
 * Each is documented where it is declared. All access is single-threaded
 * (JavaScript calls in one at a time).
 *
 * O-10 (decision D64): when aprm_create fails there is no handle to hold the
 * error, so it is kept in g_orphan_err. aprm_last_error(0) reads it; so does
 * aprm_last_error(h) for any h that is not a live handle, and any call that
 * is given a non-live handle records its INVALID_ARGUMENT there too. It holds
 * the most recent such failure only and is replaced by the next one. It is
 * not simulation state and is not in core/.
 *
 * Time (D59): aprm_run_until(h, t) does not move the clock to t; "now" stays
 * at the last event handled, which can be earlier than t. The website's
 * mid-run "add job" must use arrival >= the state's "now". Adding a job with
 * arrival == now is the D59 edge case: it is an ordinary pending job, and the
 * next aprm_step handles time "now" a second time (a second selection step at
 * the same tick), so a job added at the current tick can start at that tick if
 * it fits.
 *
 * Every function: O(1) for the table lookup and range checks, plus the cost
 * of the engine call it wraps (stated in core/engine.h).
 */
#include <stdarg.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "config.h"
#include "engine.h"
#include "job.h"
#include "json.h"

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define APRM_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define APRM_EXPORT /* native build: syntax and sanitizer checks only */
#endif

/* Largest integer a JavaScript number holds exactly: 2^53. */
#define SAFE_INT_MAX 9007199254740992.0

/* Most simulations alive at once (handles are 1..this). */
#define API_MAX_HANDLES 4096

/* One simulation and its output buffer. sim == NULL means the slot is free. */
typedef struct {
    Sim      *sim;
    JsonBuf   buf;   /* text returned by the last JSON call on this handle */
    SimError  err;   /* last failure on this handle (code 0 = none) */
} Slot;

static Slot     *g_slots;      /* handle table, g_cap slots, malloc'd, grows by doubling */
static size_t    g_cap;
static SimError  g_orphan_err; /* last failure with no live handle (O-10, D64) */
static JsonBuf   g_orphan_buf; /* renders g_orphan_err; JsonBuf is zero-initialised = empty */

/* Returned when even the error envelope cannot be built (out of memory). */
static const char OOM_JSON[] =
    "{\"ok\":false,\"error\":{\"code\":-7,\"message\":\"Out of memory.\"}}";

/* The generic sentence for a code when the engine stored none. O(1). */
static const char *default_message(int code)
{
    switch (code) {
    case APRM_INVALID_ARGUMENT:  return "Invalid argument.";
    case APRM_INVALID_FIELD:     return "A field is out of range.";
    case APRM_CAPACITY_EXCEEDED: return "Job needs more than the machine has.";
    case APRM_ARRIVAL_IN_PAST:   return "Arrival is before the current time.";
    case APRM_DUPLICATE_ID:      return "Job id already exists.";
    case APRM_LIMIT_REACHED:     return "Too many jobs.";
    case APRM_OUT_OF_MEMORY:     return "Out of memory.";
    case APRM_PARSE_ERROR:       return "Bad CSV.";
    case APRM_TOO_LARGE:         return "Exact solver supports up to 9 jobs.";
    default:                     return "Unknown error.";
    }
}

/* Fill *e with a code, optional field name and a printf-style message.
 * snprintf truncates safely. O(1). */
static void set_err(SimError *e, int code, const char *field, const char *fmt, ...)
    __attribute__((format(printf, 4, 5)));

static void set_err(SimError *e, int code, const char *field, const char *fmt, ...)
{
    va_list ap;
    memset(e, 0, sizeof *e);
    e->code = code;
    if (field) snprintf(e->field, sizeof e->field, "%s", field);
    va_start(ap, fmt);
    vsnprintf(e->message, sizeof e->message, fmt, ap);
    va_end(ap);
}

/* Record a failure on slot s from an engine return code: copy the engine's
 * stored error when it matches the code, else use the generic sentence.
 * Returns code. O(1). */
static int slot_fail(Slot *s, int code)
{
    const SimError *e = sim_last_error(s->sim);
    if (e != NULL && e->code == code)
        s->err = *e;
    else
        set_err(&s->err, code, NULL, "%s", default_message(code));
    return code;
}

/* Write the error envelope for *e into b (replacing its contents). For
 * code 0 ("no error yet") the envelope is {"ok":true,"data":null}. O(1). */
static void render_error(JsonBuf *b, const SimError *e)
{
    json_reset(b);
    if (e->code == 0) {
        json_ok_begin(b);
        json_null(b);
        json_ok_end(b);
    } else {
        json_error(b, e->code, e->message, e->field[0] ? e->field : NULL);
    }
}

/* The text in b, or the fixed out-of-memory envelope if b is unusable. O(1). */
static const char *text_of(const JsonBuf *b)
{
    if (json_status(b) != APRM_OK || json_len(b) == 0) return OOM_JSON;
    return json_cstr(b);
}

/* The live slot for handle h, or NULL. O(1). */
static Slot *lookup(int h)
{
    if (h < 1 || (size_t)h > g_cap || g_slots[h - 1].sim == NULL) return NULL;
    return &g_slots[h - 1];
}

/* The error envelope for "no live handle h", built in g_orphan_buf. The
 * caller has already recorded the failure. O(1). */
static const char *orphan_text(void)
{
    render_error(&g_orphan_buf, &g_orphan_err);
    return text_of(&g_orphan_buf);
}

/* The standard failure for a handle that is not live. Returns -1. O(1). */
static int bad_handle(int h)
{
    set_err(&g_orphan_err, APRM_INVALID_ARGUMENT, "handle", "Unknown handle %d.", h);
    return APRM_INVALID_ARGUMENT;
}

/* Convert the JavaScript number v to an int64_t if it is a whole number with
 * |v| <= 2^53; otherwise fill *e (INVALID_FIELD, naming field) and return
 * the code. NaN and infinities fail the comparison. O(1). */
static int to_i64(double v, const char *field, int64_t *out, SimError *e)
{
    int64_t i;
    if (!(v >= -SAFE_INT_MAX && v <= SAFE_INT_MAX)) {
        set_err(e, APRM_INVALID_FIELD, field, "%s must be a whole number within 2^53 either way.", field);
        return APRM_INVALID_FIELD;
    }
    i = (int64_t)v;
    if ((double)i != v) {
        set_err(e, APRM_INVALID_FIELD, field, "%s must be a whole number.", field);
        return APRM_INVALID_FIELD;
    }
    *out = i;
    return APRM_OK;
}

/* Same, and also require the value to fit an int32_t (job id, priority), so
 * the cast to the Job field cannot wrap. O(1). */
static int to_i32(double v, const char *field, int32_t *out, SimError *e)
{
    int64_t i;
    int rc = to_i64(v, field, &i, e);
    if (rc != APRM_OK) return rc;
    if (i < INT32_MIN || i > INT32_MAX) {
        set_err(e, APRM_INVALID_FIELD, field, "%s does not fit in 32 bits.", field);
        return APRM_INVALID_FIELD;
    }
    *out = (int32_t)i;
    return APRM_OK;
}

/* Find a free slot (lowest index first, so handles are reused in a fixed
 * order), growing the table by doubling up to API_MAX_HANDLES. Returns the
 * slot or NULL (and sets *code to LIMIT_REACHED or OUT_OF_MEMORY). O(table). */
static Slot *alloc_slot(int *code)
{
    size_t i, ncap;
    Slot *t;
    for (i = 0; i < g_cap; i++)
        if (g_slots[i].sim == NULL) return &g_slots[i];
    if (g_cap >= API_MAX_HANDLES) {
        *code = APRM_LIMIT_REACHED;
        return NULL;
    }
    ncap = g_cap ? g_cap * 2 : 8;
    if (ncap > API_MAX_HANDLES) ncap = API_MAX_HANDLES;
    t = (Slot *)realloc(g_slots, ncap * sizeof *t);
    if (!t) {
        *code = APRM_OUT_OF_MEMORY;
        return NULL;
    }
    memset(t + g_cap, 0, (ncap - g_cap) * sizeof *t);
    i = g_cap;
    g_slots = t;
    g_cap = ncap;
    return &g_slots[i];
}

/* Create a simulation. policy is the PolicyKind number (0 fcfs, 1 priority,
 * 2 sjf, 3 aging, 4 reserve, 5 knapsack); T is the reservation threshold.
 * max_jobs is APRM_MAX_JOBS_WEB (D27). Returns a handle >= 1, or a negative
 * APRM_* code; on failure the reason is available from aprm_last_error(0)
 * (O-10, D64). Validation is complete before anything is allocated. */
APRM_EXPORT int aprm_create(double cpu, double mem, double policy, double alpha_milli,
                            double T, double eps)
{
    SimConfig cfg;
    SimError e;
    int64_t pol;
    int code = APRM_OK, rc;
    Slot *s;
    Sim *sim = NULL;

    memset(&cfg, 0, sizeof cfg);
    if ((rc = to_i64(cpu, "cpu_cap", &cfg.cpu_cap, &e)) != APRM_OK ||
        (rc = to_i64(mem, "mem_cap", &cfg.mem_cap, &e)) != APRM_OK ||
        (rc = to_i64(alpha_milli, "alpha_milli", &cfg.alpha_milli, &e)) != APRM_OK ||
        (rc = to_i64(T, "reserve_threshold", &cfg.reserve_threshold, &e)) != APRM_OK ||
        (rc = to_i64(policy, "policy", &pol, &e)) != APRM_OK) {
        g_orphan_err = e;
        return rc;
    }
    if (pol < (int64_t)POL_FCFS || pol > (int64_t)POL_KNAPSACK) {
        set_err(&g_orphan_err, APRM_INVALID_ARGUMENT, "policy", "Unknown policy %ld.", (long)pol);
        return APRM_INVALID_ARGUMENT;
    }
    cfg.policy = (PolicyKind)pol;
    cfg.knapsack_eps = eps;
    cfg.max_jobs = APRM_MAX_JOBS_WEB;
    rc = sim_validate_config(&cfg, &e);
    if (rc != APRM_OK) {
        g_orphan_err = e;
        return rc;
    }
    s = alloc_slot(&code);
    if (!s) {
        if (code == APRM_LIMIT_REACHED)
            set_err(&g_orphan_err, code, NULL, "At most %d simulations at once.", API_MAX_HANDLES);
        else
            set_err(&g_orphan_err, code, NULL, "Out of memory.");
        return code;
    }
    rc = sim_create(&cfg, &sim);
    if (rc != APRM_OK) {
        set_err(&g_orphan_err, rc, NULL, "%s", default_message(rc));
        return rc;
    }
    s->sim = sim;
    json_init(&s->buf);
    memset(&s->err, 0, sizeof s->err);
    return (int)(s - g_slots) + 1;
}

/* Add one job (before or during a run; arrival must be >= the current time,
 * see the D59 note at the top of this file). Returns 0 or a negative code;
 * on failure nothing changed and aprm_last_error(h) says why. The id and
 * priority must fit 32 bits; every value must be a whole number within 2^53. */
APRM_EXPORT int aprm_add_job(int h, double id, double arrival, double duration,
                             double cpu, double mem, double priority)
{
    Slot *s = lookup(h);
    Job j;
    int rc;
    if (!s) return bad_handle(h);
    memset(&j, 0, sizeof j);
    if ((rc = to_i32(id, "id", &j.id, &s->err)) != APRM_OK ||
        (rc = to_i64(arrival, "arrival", &j.arrival, &s->err)) != APRM_OK ||
        (rc = to_i64(duration, "duration", &j.duration, &s->err)) != APRM_OK ||
        (rc = to_i64(cpu, "cpu", &j.cpu, &s->err)) != APRM_OK ||
        (rc = to_i64(mem, "mem", &j.mem, &s->err)) != APRM_OK ||
        (rc = to_i32(priority, "priority", &j.priority, &s->err)) != APRM_OK)
        return rc;
    rc = sim_add_job(s->sim, &j);
    if (rc != APRM_OK) return slot_fail(s, rc);
    return APRM_OK;
}

/* Handle the next event time. Returns 1 (an event was handled), 0 (nothing
 * left to do) or a negative code (for example INVALID_ARGUMENT when the
 * policy is not implemented yet; the reason is in aprm_last_error(h)). */
APRM_EXPORT int aprm_step(int h)
{
    Slot *s = lookup(h);
    int rc;
    if (!s) return bad_handle(h);
    rc = sim_step(s->sim);
    if (rc < 0) return slot_fail(s, rc);
    return rc;
}

/* Step while the next event time is <= t. Does not move the clock to t (D59):
 * "now" stays at the last event handled. Returns 0 or a negative code. */
APRM_EXPORT int aprm_run_until(int h, double t)
{
    Slot *s = lookup(h);
    int64_t tt;
    int rc;
    if (!s) return bad_handle(h);
    if ((rc = to_i64(t, "t", &tt, &s->err)) != APRM_OK) return rc;
    rc = sim_run_until(s->sim, tt);
    if (rc < 0) return slot_fail(s, rc);
    return rc;
}

/* Run a JSON writer of the engine into the handle's buffer and return the
 * text; on failure return the error envelope instead. */
static const char *report(int h, int (*writer)(const Sim *, JsonBuf *))
{
    Slot *s = lookup(h);
    int rc;
    if (!s) {
        bad_handle(h);
        return orphan_text();
    }
    rc = writer(s->sim, &s->buf);
    if (rc != APRM_OK) {
        slot_fail(s, rc);
        render_error(&s->buf, &s->err);
    }
    return text_of(&s->buf);
}

/* The state JSON envelope (PRD section 5). Pointer rules: see the file top. */
APRM_EXPORT const char *aprm_state(int h) { return report(h, sim_state_json); }

/* The finished jobs, sorted by id. */
APRM_EXPORT const char *aprm_results(int h) { return report(h, sim_results_json); }

/* The metrics over the finished jobs. */
APRM_EXPORT const char *aprm_metrics(int h) { return report(h, sim_metrics_json); }

/* The event log entries with seq > since (since <= 0: all entries). */
APRM_EXPORT const char *aprm_log(int h, double since)
{
    Slot *s = lookup(h);
    int64_t sv;
    int rc;
    if (!s) {
        bad_handle(h);
        return orphan_text();
    }
    if ((rc = to_i64(since, "since", &sv, &s->err)) != APRM_OK) {
        render_error(&s->buf, &s->err);
        return text_of(&s->buf);
    }
    rc = sim_log_json(s->sim, sv, &s->buf);
    if (rc != APRM_OK) {
        slot_fail(s, rc);
        render_error(&s->buf, &s->err);
    }
    return text_of(&s->buf);
}

/* The JSON error envelope for the last failed call on handle h. A live h
 * returns that handle's last failure ({"ok":true,"data":null} if none yet).
 * h = 0, or any h that is not live, returns the last failure that had no
 * handle: a failed aprm_create or a call with an unknown handle (O-10, D64).
 * The pointer rules are the same as for the other JSON functions. */
APRM_EXPORT const char *aprm_last_error(int h)
{
    Slot *s = lookup(h);
    if (!s) return orphan_text();
    render_error(&s->buf, &s->err);
    return text_of(&s->buf);
}

/* The exact solver (K-33): the minimum-total-wait schedule for all jobs added
 * to this handle (n <= 9), as the exact_solve envelope {"total_wait","schedule"}.
 * More than 9 jobs is a TOO_LARGE error envelope. Does not change the
 * simulation. Worst case O(n! * n^3), well under a second at n = 9. */
APRM_EXPORT const char *aprm_exact(int h) { return report(h, sim_exact_json); }

/* Remove every job and restart the clock at 0, keeping the config. Also
 * clears the handle's last error. Returns 0 or a negative code. */
APRM_EXPORT int aprm_reset(int h)
{
    Slot *s = lookup(h);
    int rc;
    if (!s) return bad_handle(h);
    rc = sim_reset(s->sim);
    if (rc != APRM_OK) return slot_fail(s, rc);
    memset(&s->err, 0, sizeof s->err);
    return APRM_OK;
}

/* Free the simulation and its buffer; the handle number may be returned by a
 * later aprm_create. Every string pointer from this handle becomes invalid.
 * Returns 0, or INVALID_ARGUMENT for a handle that is not live (so a double
 * destroy is an error, not a crash). */
APRM_EXPORT int aprm_destroy(int h)
{
    Slot *s = lookup(h);
    if (!s) return bad_handle(h);
    sim_destroy(s->sim);
    json_free(&s->buf);
    memset(s, 0, sizeof *s);
    return APRM_OK;
}
