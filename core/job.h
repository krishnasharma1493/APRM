/*
 * job.h: the shared types and error codes (PRD section 5).
 * Declarations only: no mutable state lives in this header.
 */
#ifndef APRM_JOB_H
#define APRM_JOB_H

#include <stdint.h>

/* Scheduling policy. Order is part of the contract (PRD section 5). */
typedef enum {
    POL_FCFS,
    POL_PRIORITY,
    POL_SJF,
    POL_AGING,
    POL_AGING_RESERVE,
    POL_KNAPSACK
} PolicyKind;

/* Simulation settings. Every field is validated against PRD section 3. */
typedef struct {
    int64_t cpu_cap, mem_cap;   /* machine capacity: cores, MB */
    PolicyKind policy;
    int64_t alpha_milli;        /* aging rate alpha x 1000, 0..10000 */
    int64_t reserve_threshold;  /* T, ticks */
    int64_t knapsack_eps_milli; /* epsilon x 1000, 10..1000 (D72) */
    int64_t max_jobs;           /* CLI 1,000,000; website 5,000 */
} SimConfig;

/* One job. Times are 64-bit ticks so start + duration cannot overflow. */
typedef struct {
    int32_t id;                 /* 0..2147483647, unique */
    int64_t arrival, duration, cpu, mem;
    int32_t priority;           /* 0..9, higher = more important */
} Job;

/* Error codes (PRD section 5). Functions return 0 on success, a negative
 * code on failure. */
#define APRM_OK                0
#define APRM_INVALID_ARGUMENT -1  /* null pointer, bad handle, bad policy */
#define APRM_INVALID_FIELD    -2  /* a field outside its range */
#define APRM_CAPACITY_EXCEEDED -3 /* job needs more than the machine has */
#define APRM_ARRIVAL_IN_PAST  -4  /* mid-run job arriving before now */
#define APRM_DUPLICATE_ID     -5  /* same id added twice */
#define APRM_LIMIT_REACHED    -6  /* too many jobs */
#define APRM_OUT_OF_MEMORY    -7  /* allocation failed */
#define APRM_PARSE_ERROR      -8  /* bad CSV */
#define APRM_TOO_LARGE        -9  /* exact solver asked for > 9 jobs */

#endif /* APRM_JOB_H */
