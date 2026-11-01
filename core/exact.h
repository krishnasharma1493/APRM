/*
 * exact.h: the exact solver for tiny inputs (BLUEPRINT 3.7, PRD section 5,
 * issue K-33, decision D24, answers O-3 as D71).
 *
 * WHAT IS OPTIMISED. Given every job up front (it knows the future), find the
 * schedule with the smallest TOTAL WAIT, total wait = sum over jobs of
 * (start - arrival). Total turnaround = total wait + sum of durations, and the
 * durations are fixed, so the same schedule also minimises total turnaround
 * (PRD E6, D40). The answer is therefore a lower bound on the total wait of
 * every online scheduler in this project.
 *
 * MACHINE MODEL (the same as the simulator). One machine with cpu_cap cores and
 * mem_cap MB. A job occupies its cpu and mem for the whole of [start, start +
 * duration); at no instant may the jobs running exceed either capacity. A job
 * never starts before its arrival and, once started, runs to the end (no
 * preemption). All times are integers.
 *
 * WHERE IT DIFFERS FROM THE SIMULATOR. The simulator is online and greedy: at
 * each event it starts waiting jobs that fit, in policy order, and it never
 * leaves a job waiting when that job fits. The exact solver ranges over ALL
 * feasible non-preemptive schedules, including ones that deliberately keep a
 * job waiting (idle resources) because a job arriving later is better started
 * first (the big_job_trap case). It also sees the future arrivals. So its total
 * wait is <= the total wait of any schedule a policy can produce, and may be
 * strictly smaller.
 *
 * TIE-BREAK (O-3). Several schedules can have the same minimum total wait.
 * Number the jobs 0..n-1 in order of (arrival, id). The solver returns the
 * schedule whose start-time vector (start of job 0, start of job 1, ...) is
 * lexicographically smallest among ALL schedules of minimum total wait. This
 * does not depend on the order jobs are passed in or on the search order.
 *
 * No global or static mutable state, no I/O, no printing.
 */
#ifndef APRM_EXACT_H
#define APRM_EXACT_H

#include <stdint.h>
#include "config.h"
#include "job.h"
#include "json.h"

/* The optimal schedule: start[i] is the start time of jobs[i] (the caller's
 * order, not the sorted order); finish is start + duration. Plain data. */
typedef struct {
    int64_t total_wait;
    int64_t start[APRM_EXACT_MAX_JOBS];
} ExactResult;

/* Solve exactly. Fills *res. Returns APRM_OK or APRM_INVALID_ARGUMENT (NULL
 * cfg, res, or jobs with n > 0; n < 0; cpu_cap or mem_cap outside PRD section
 * 3), APRM_TOO_LARGE (n > APRM_EXACT_MAX_JOBS; checked before the jobs are
 * read), APRM_INVALID_FIELD (a job field outside PRD section 3),
 * APRM_CAPACITY_EXCEEDED (a job needs more than the whole machine),
 * APRM_DUPLICATE_ID, or APRM_INVALID_FIELD if a time would overflow int64 (not
 * reachable inside the PRD limits). n == 0 is valid (total_wait 0). On any
 * error *res is zeroed. Worst case O(n! * n^3) time (n! orders; each placement
 * tries O(n) start times with an O(n^2) check); typical far less because of
 * branch and bound. O(n) extra space; allocates nothing. */
int exact_schedule(const SimConfig *cfg, const Job *jobs, int n, ExactResult *res);

/* exact_schedule, written as the PRD envelope
 * {"ok":true,"data":{"total_wait":W,"schedule":[ {id,arrival,start,finish,
 * wait,turnaround,priority,cpu,mem}, ... ]}} with the rows sorted by id (the
 * same fields as results.csv). Calls json_reset(out) first. Returns what
 * exact_schedule returns, or APRM_OUT_OF_MEMORY (the JsonBuf error); on
 * failure *out is left empty. The caller owns *out. Same cost as
 * exact_schedule plus O(n log n) for the output. */
int exact_solve(const SimConfig *cfg, const Job *jobs, int n, JsonBuf *out);

#endif /* APRM_EXACT_H */
