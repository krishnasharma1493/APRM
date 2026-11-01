/*
 * engine.h: public API of the simulation engine (PRD section 5, issue K-08).
 *
 * The Sim type is opaque: the CLI, the WebAssembly layer and Python cannot
 * reach inside, so the core controls every invariant. All state lives in the
 * Sim; there is no global or static mutable state, so several Sims can exist
 * at once. Functions return APRM_OK (0) or a negative APRM_* code from job.h.
 *
 * Declared here as they are implemented. The JSON outputs and exact_solve
 * arrive with K-11 and K-33.
 */
#ifndef APRM_ENGINE_H
#define APRM_ENGINE_H

#include <stdint.h>
#include "csv.h"
#include "job.h"
#include "json.h"

typedef struct Sim Sim;  /* opaque */

/* The last failed call on a Sim: code, the field that caused it (empty when
 * no single field applies) and one sentence for the user. This is the
 * storage behind aprm_last_error (K-13), which renders it as the JSON error
 * envelope. Extra to PRD section 5 (see DECISIONS D55). */
typedef struct {
    int  code;           /* 0 = no error yet, else a negative APRM_* code */
    char field[24];      /* e.g. "priority"; "" when not tied to one field */
    char message[160];   /* e.g. "priority must be 0 to 9." */
} SimError;

/* Check cfg against PRD section 3 without creating anything. Returns APRM_OK,
 * APRM_INVALID_ARGUMENT (NULL cfg, unknown policy) or APRM_INVALID_FIELD
 * (field out of range; err->field names it). If err is non-NULL it is filled
 * in on failure and zeroed on success. Pure: touches only *err. O(1).
 * Extra to PRD section 5: it lets K-13 report why aprm_create failed when
 * there is no handle to ask (O-10 stays open). */
int  sim_validate_config(const SimConfig *cfg, SimError *err);

/* Create an empty simulation with a copy of *cfg and store the handle in
 * *out. Validation order: cfg/out non-NULL, then sim_validate_config. On
 * failure *out is set to NULL (when out is non-NULL) and nothing is
 * leaked. O(1). The caller owns the Sim; free it with sim_destroy. */
int  sim_create(const SimConfig *cfg, Sim **out);

/* Add one job, before or during a run (arrival >= now). Validation order and
 * codes are in issue K-08 / PRD section 5; nothing is modified unless every
 * check passes (D29). Any failure with a non-NULL s is also stored for
 * sim_last_error. A rejected job leaves the simulation unchanged. O(log n)
 * amortised time (id-set lookup O(1) expected, pending-heap insert O(log n)). */
int  sim_add_job(Sim *s, const Job *job);

/* Advance to the next event time (the earlier of the first pending arrival
 * and the first running finish) and handle it: finish every job ending then
 * (freeing CPU and memory), add every job arriving then, run the greedy-fill
 * selection step (BLUEPRINT 3.4: pop the best waiting job, start it if it
 * fits, else set it aside; stop when none are left or free CPU or memory is
 * 0; push the set-aside jobs back). Finishes come before arrivals at the same
 * tick (D9). Returns 1 = an event was handled, 0 = nothing left to do (no
 * pending, waiting or running job; the Sim is unchanged), or a negative
 * code: APRM_INVALID_ARGUMENT (NULL s, or the policy is not implemented
 * yet), APRM_OUT_OF_MEMORY, APRM_INVALID_FIELD (time too large to add a
 * duration; unreachable within PRD section 3 limits). On a negative code the
 * Sim is unchanged (every allocation is made before anything is modified).
 * If a job was added with arrival == now after the step for now ran, the next
 * call handles time now again: a second selection step at the same tick
 * (D59). Debug builds (APRM_DEBUG) check every PRD section 4 invariant at the
 * end and abort() on a violation (nothing is printed; call
 * sim_check_invariants from a test to read the message). Cost O((s + k) log n) for s jobs started and
 * k skipped; a full run has at most 2n events, so O(n^2 log n) worst case.
 * Extra space O(live queue) for the skip list; the finished list is O(n). */
int  sim_step(Sim *s);

/* Call sim_step while the next event time is <= t. Does not move the clock
 * to t: now stays at the last event handled, so a job can still be added at
 * any arrival >= now. Returns APRM_OK, APRM_INVALID_ARGUMENT (NULL s) or the
 * first negative code sim_step returned. Same cost as the steps it takes. */
int  sim_run_until(Sim *s, int64_t t);

/* Write the event log as the PRD section 5 envelope {"ok":true,"data":[
 * {"seq","t","kind","job","msg"}, ... ]} with the entries whose seq >
 * since_seq (<= 0: all; at or beyond the last seq: []). Entries are added by
 * sim_step: ARRIVE, START, SKIP, FINISH (D60). Does not change the Sim. Calls
 * json_reset(out) first, so a reused JsonBuf is replaced, not appended to.
 * Returns APRM_OK, APRM_INVALID_ARGUMENT (NULL s or out) or the JsonBuf
 * error (APRM_OUT_OF_MEMORY). The caller owns out. O(k) for k entries. */
int  sim_log_json(const Sim *s, int64_t since_seq, JsonBuf *out);

/* Clear every job and restart the clock at 0, keeping the config. Also clears
 * the stored error. Cannot run out of memory (it reuses its buffers).
 * Returns APRM_OK or APRM_INVALID_ARGUMENT (NULL s). O(capacity of the id set). */
int  sim_reset(Sim *s);

/* Free everything. Safe on NULL. O(1) frees (buffers are not walked). */
void sim_destroy(Sim *s);

/* The last error stored by a failed sim_add_job on s, or NULL if s is NULL.
 * The pointer stays valid until the next failing call, sim_reset or
 * sim_destroy on the same Sim; the Sim owns it, the caller must not free it.
 * code == 0 means no error since create/reset. A successful call does not
 * clear it. Extra to PRD section 5. O(1). */
const SimError *sim_last_error(const Sim *s);

/* ---- Reports (K-11, PRD section 5 "JSON shapes"; engine_json.c) ----
 * Each *_json function replaces the contents of *out (it calls json_reset
 * first) with one complete envelope {"ok":true,"data":...}, only reads the
 * Sim, and returns APRM_OK, APRM_INVALID_ARGUMENT (NULL s or out) or
 * APRM_OUT_OF_MEMORY / APRM_INVALID_FIELD (sums too large for 64 bits;
 * unreachable within PRD section 3 except weighted completion on a
 * pathological input). On failure *out is left empty. The caller owns *out. */

/* State at the current time: waiting in service order (best first), running
 * ordered by finish; reservation null until K-26. O(n log n) time, O(n)
 * temporary space (it sorts copies of the two heaps, never the heaps). */
int  sim_state_json(const Sim *s, JsonBuf *out);

/* Finished jobs only, sorted by id, same columns as results.csv.
 * O(n log n) time, O(n) temporary space. */
int  sim_results_json(const Sim *s, JsonBuf *out);

/* Metrics over the finished jobs (metrics.h). O(n log n) time (it builds the
 * sorted rows first), O(n) temporary space. */
int  sim_metrics_json(const Sim *s, JsonBuf *out);

/* The rows of results.csv for the finished jobs, sorted by id, for the
 * console program's csv_write_results (K-12). On success *rows is a malloc'd
 * array of *n rows (NULL when *n is 0) that the caller frees with free().
 * On failure *rows is NULL and *n is 0. Returns APRM_OK,
 * APRM_INVALID_ARGUMENT or APRM_OUT_OF_MEMORY. O(n log n) time, O(n) space. */
int  sim_results_rows(const Sim *s, ResultRow **rows, int64_t *n);

#endif /* APRM_ENGINE_H */
