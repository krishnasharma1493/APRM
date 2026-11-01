/*
 * metrics.h: the measures of a finished schedule (BLUEPRINT section 2,
 * issue K-11, decisions D17, D61, D62).
 *
 * Pure functions over an array of ResultRow (the rows of results.csv): no
 * Sim, no I/O, no globals. The engine fills the rows (sim_results_rows in
 * engine.h) and calls these. The same code therefore serves the console
 * program, the website and the tests.
 *
 * Definitions, for each finished job: wait = start - arrival, turnaround =
 * finish - arrival, duration = finish - start.
 *  - weighted completion = sum of (priority + 1) x finish (D17)
 *  - makespan = largest finish (0 with no job)
 *  - utilisation of a resource = sum of (demand x duration) / (capacity x
 *    makespan), over the interval [0, makespan] (D61)
 *  - average wait of priority level p = mean wait of the jobs with priority p
 * Averages and utilisations are exact rationals printed with nine decimals,
 * rounded half up, using integers only (D61); a ratio with a zero
 * denominator is null (D62).
 */
#ifndef APRM_METRICS_H
#define APRM_METRICS_H

#include <stdint.h>
#include "csv.h"
#include "job.h"
#include "json.h"

#define METRICS_LEVELS 10   /* priority levels 0..9 */

/* Unsigned 128-bit integer (two 64-bit halves): resource-time can reach
 * about 10^21 (memory capacity 10^9 x makespan 10^12), beyond 64 bits. */
typedef struct { uint64_t hi, lo; } U128;

/* Integer totals from which every reported number is derived. Plain data. */
typedef struct {
    int64_t n;                           /* jobs counted */
    int64_t sum_wait, max_wait, sum_turnaround;
    int64_t weighted_completion;         /* sum of (priority + 1) x finish */
    int64_t makespan;
    U128    busy_cpu, busy_mem;          /* sum of cpu x duration, mem x duration */
    U128    den_cpu, den_mem;            /* cpu_cap x makespan, mem_cap x makespan */
    int64_t level_n[METRICS_LEVELS];     /* jobs per priority level */
    int64_t level_sum_wait[METRICS_LEVELS];
} Metrics;

/* Sum the n rows into *m. Uses start, finish, arrival, priority, cpu, mem of
 * each row (the wait and turnaround columns are recomputed, not trusted).
 * Returns APRM_OK; APRM_INVALID_ARGUMENT (NULL m, NULL rows with n > 0,
 * n < 0, capacity < 1); APRM_INVALID_FIELD (a row with start < arrival,
 * finish <= start, priority outside 0..9, or cpu/mem < 1, or a sum that does
 * not fit in int64_t: cannot happen within the PRD section 3 limits except
 * for weighted completion on a pathological 10^6-job input). Every addition
 * is overflow-checked. O(n) time, O(1) space; *m is caller-owned. */
int metrics_from_rows(const ResultRow *rows, int64_t n, int64_t cpu_cap, int64_t mem_cap,
                      Metrics *m);

/* num / den as a decimal with nine digits after the point, rounded half up on
 * the exact value: *whole is the integer part and *frac the fractional part
 * in billionths (0..999999999). Returns 1 on success, 0 if den is zero or the
 * integer part does not fit in 64 bits (*whole and *frac are then untouched).
 * Integer arithmetic only. O(1): 128 division steps plus 9 digit steps. */
int metrics_ratio9(U128 num, U128 den, uint64_t *whole, uint32_t *frac);

/* Write the metrics object (the value of "data" in PRD section 5) to out:
 * avg_wait, max_wait, avg_turnaround, weighted_completion, makespan,
 * util_cpu, util_mem, avg_wait_by_priority (10 entries). Writes only; errors
 * are sticky inside out (check json_status). O(1) in n (the totals are
 * already summed). */
void metrics_write_json(const Metrics *m, JsonBuf *out);

#endif /* APRM_METRICS_H */
