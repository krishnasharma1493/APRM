/*
 * engine_internal.h: the real definition of struct Sim.
 *
 * ONLY engine.c and the C tests may include this (it refuses to compile
 * unless APRM_ENGINE_INTERNAL is defined first). Tests use it to read the
 * counters, and to move the clock forward (sim->now) so the ARRIVAL_IN_PAST
 * case can be tested before sim_step exists (K-09). No function is added to
 * any production object, so nothing can call a test hook from the CLI or the
 * WebAssembly build.
 */
#ifndef APRM_ENGINE_INTERNAL_H
#define APRM_ENGINE_INTERNAL_H

#ifndef APRM_ENGINE_INTERNAL
#error "engine_internal.h is private to core/engine.c and the C tests"
#endif

#include <stddef.h>
#include <stdint.h>
#include "engine.h"
#include "heap.h"
#include "job.h"
#include "policy.h"

/* Waiting-heap element: the job and its policy key (smaller = served first). */
typedef struct { Job job; int64_t key; } WaitEntry;

/* Running-heap element: ordered by finish time. */
typedef struct { Job job; int64_t start, finish; } RunEntry;

/* Open-addressing hash set of job ids. slot[i] == -1 is empty (ids are >= 0).
 * cap is 0 or a power of two; len * 2 <= cap always. */
typedef struct {
    int32_t *slot;
    size_t cap, len;
} IdSet;

struct Sim {
    SimConfig cfg;
    int64_t now;                 /* current time, ticks */
    int64_t free_cpu, free_mem;
    int64_t n_total;             /* accepted jobs: pending+waiting+running+finished */
    int64_t n_finished;          /* == fin_len: jobs in the finished list */
    Heap pending;                /* Job, ordered by (arrival, id) */
    Heap waiting;                /* WaitEntry, ordered by (key, arrival, id) */
    Heap running;                /* RunEntry, ordered by (finish, arrival, id) */
    IdSet ids;
    SimError err;
    PolicyCompare policy_cmp;    /* NULL if the policy is not built yet */
    RunEntry *fin;               /* finished list, in order of finishing */
    size_t fin_len, fin_cap;
    WaitEntry *skip;             /* scratch: jobs set aside in one greedy fill */
    size_t skip_cap;
};

#ifdef APRM_DEBUG
/* Check every PRD section 4 invariant (plus the greedy-fill post-condition).
 * Returns 0 if all hold, else 1 and sets *why to a constant message. Pure
 * (reads only *s). O(n) in the number of jobs. Debug builds only. */
int sim_check_invariants(const Sim *s, const char **why);
#endif

#endif /* APRM_ENGINE_INTERNAL_H */
