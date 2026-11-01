/*
 * reserve.h: the reservation (EASY-style backfilling) of the `reserve`
 * policy (BLUEPRINT 3.5, DECISIONS D18 and the answer to O-14, issue K-26).
 *
 * At most one job holds a reservation. When the best waiting job h does not
 * fit and has waited at least T ticks, h gets a shadow time: the earliest
 * moment its CPU and memory are free if no new job starts, found by walking
 * the running jobs in order of finish time and giving their resources back.
 * The extra room is what is still spare at the shadow time after h starts.
 * Another job may start now only if it fits now and either finishes at or
 * before the shadow time or fits inside the extra room (which then shrinks).
 *
 * Pure functions on plain structs: no globals, no I/O. The engine
 * (engine.c) keeps one Reservation in the Sim and decides when to call these.
 */
#ifndef APRM_RESERVE_H
#define APRM_RESERVE_H

#include <stddef.h>
#include <stdint.h>
#include "job.h"

/* One running job as the shadow-time walk sees it. */
typedef struct {
    int64_t finish;   /* tick at which it frees its resources */
    int64_t cpu, mem; /* what it frees */
} RunSlot;

/* The reservation. active == 0 means none (the other fields are then 0).
 * Invariant while active: extra_cpu / extra_mem = capacity minus what the
 * running jobs that finish AFTER shadow_time use, minus what job `id` needs;
 * both are >= 0, so job `id` fits at shadow_time. */
typedef struct {
    int active;
    int32_t id;              /* the reserved job (it stays in the waiting heap) */
    int64_t shadow_time;     /* guaranteed start of that job */
    int64_t extra_cpu, extra_mem;
} Reservation;

/* Compute the reservation for job h_id (h_cpu, h_mem), which does NOT fit in
 * (free_cpu, free_mem) now. runs[0..n-1] are the running jobs; the array is
 * sorted by finish time IN PLACE (it is scratch owned by the caller). The
 * walk gives back every job that finishes at the same tick together, then
 * tests whether h fits; the first tick where it does is the shadow time, and
 * the extra room is (free after that release) minus h's demand. On success
 * fills *out (active = 1) and returns APRM_OK. Returns APRM_INVALID_ARGUMENT
 * for NULL pointers, for an h that already fits, or for an h that does not fit
 * even when everything has finished (a caller bug: jobs fit an empty
 * machine); *out is then untouched. Time O(n log n) for n running jobs,
 * extra space O(1) beyond the caller's array. */
int reserve_compute(RunSlot *runs, size_t n, int64_t free_cpu, int64_t free_mem,
                    int32_t h_id, int64_t h_cpu, int64_t h_mem, Reservation *out);

/* The backfill rule (BLUEPRINT 3.5 step 4). Returns 1 if job j may start now,
 * else 0. With no active reservation (r->active == 0) every job that fits now
 * passes. With one, j must fit in (free_cpu, free_mem) now AND either finish
 * at or before the shadow time (now + duration <= shadow; checked first, the
 * extra room is not touched) or fit inside the extra room, which then shrinks
 * by j's demand. If by_time is non-NULL it is set to 1 when the first reason
 * held, else 0 (only meaningful when 1 is returned). now + duration is
 * overflow-checked: if it would overflow int64 the job does not finish
 * before the shadow time. r is changed only when 1 is returned and the extra
 * room was used. NULL r or j gives 0. O(1) time and space. */
int reserve_backfill(Reservation *r, int64_t now, int64_t free_cpu, int64_t free_mem,
                     const Job *j, int *by_time);

#endif /* APRM_RESERVE_H */
