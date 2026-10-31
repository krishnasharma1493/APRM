/*
 * config.h: every default and limit from PRD section 3, one named constant
 * per row. This is the only place these numbers are written down; validation,
 * tests and the console program all read them from here.
 *
 * Times and sizes are 64-bit integers elsewhere; these constants are plain
 * integer literals and fit in int64_t (and, where noted, int32_t).
 */
#ifndef APRM_CONFIG_H
#define APRM_CONFIG_H

/* CPU capacity (cores). */
#define APRM_CPU_CAP_DEFAULT 16
#define APRM_CPU_CAP_MIN 1
#define APRM_CPU_CAP_MAX 1000000

/* Memory capacity (MB). */
#define APRM_MEM_CAP_DEFAULT 32768
#define APRM_MEM_CAP_MIN 1
#define APRM_MEM_CAP_MAX 1000000000

/* Job priority: higher is more important. */
#define APRM_PRIORITY_MIN 0
#define APRM_PRIORITY_MAX 9

/* Job duration (ticks). */
#define APRM_DURATION_MIN 1
#define APRM_DURATION_MAX 1000000

/* Job arrival time (ticks); time is stored as int64_t. */
#define APRM_ARRIVAL_MIN 0
#define APRM_ARRIVAL_MAX 1000000000

/* Job id, unique within a simulation (fits int32_t). */
#define APRM_JOB_ID_MIN 0
#define APRM_JOB_ID_MAX 2147483647

/* Aging rate alpha, stored as alpha_milli = alpha * 1000 (integer thousandths
 * of a priority level per tick). 0 turns aging into static priority. */
#define APRM_ALPHA_MILLI_DEFAULT 100
#define APRM_ALPHA_MILLI_MIN 0
#define APRM_ALPHA_MILLI_MAX 10000

/* Reservation threshold T (ticks). 0 reserves immediately. */
#define APRM_RESERVE_T_DEFAULT 50
#define APRM_RESERVE_T_MIN 0
#define APRM_RESERVE_T_MAX 1000000

/* Knapsack epsilon: smaller is more accurate and slower. The final
 * representation is an open decision (DECISIONS O-2). */
#define APRM_KNAPSACK_EPS_DEFAULT 0.1
#define APRM_KNAPSACK_EPS_MIN 0.01
#define APRM_KNAPSACK_EPS_MAX 1

/* Exact solver job limit: fixed, not configurable. Above this the solver
 * returns TOO_LARGE. */
#define APRM_EXACT_MAX_JOBS 9

/* Maximum jobs: SimConfig.max_jobs is set by cli/main.c and wasm/api.c. */
#define APRM_MAX_JOBS_CLI 1000000
#define APRM_MAX_JOBS_WEB 5000

#endif /* APRM_CONFIG_H */
