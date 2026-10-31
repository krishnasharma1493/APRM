/*
 * engine.h: public API of the simulation engine (PRD section 5, issue K-08).
 *
 * The Sim type is opaque: the CLI, the WebAssembly layer and Python cannot
 * reach inside, so the core controls every invariant. All state lives in the
 * Sim; there is no global or static mutable state, so several Sims can exist
 * at once. Functions return APRM_OK (0) or a negative APRM_* code from job.h.
 *
 * Declared here as they are implemented. sim_step, sim_run_until, the JSON
 * outputs and exact_solve arrive with K-09, K-11 and K-33.
 */
#ifndef APRM_ENGINE_H
#define APRM_ENGINE_H

#include <stdint.h>
#include "job.h"

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

#endif /* APRM_ENGINE_H */
