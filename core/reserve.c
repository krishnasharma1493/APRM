/*
 * reserve.c: shadow time, extra room and the backfill rule (see reserve.h).
 * No globals, no static mutable state, no I/O.
 */
#include <stdlib.h>
#include "reserve.h"

/* qsort compare: earlier finish first. Equal finishes compare equal; that is
 * fine because the walk releases all jobs of one finish tick together, so
 * their order cannot change the result. O(1). */
static int cmp_slot_finish(const void *a, const void *b)
{
    const RunSlot *x = a, *y = b;
    return (x->finish > y->finish) - (x->finish < y->finish);
}

/* See reserve.h. O(n log n) time (the sort dominates), O(1) extra space. */
int reserve_compute(RunSlot *runs, size_t n, int64_t free_cpu, int64_t free_mem,
                    int32_t h_id, int64_t h_cpu, int64_t h_mem, Reservation *out)
{
    size_t i = 0;
    int64_t cpu = free_cpu, mem = free_mem, f;
    if (!out || (n > 0 && !runs)) return APRM_INVALID_ARGUMENT;
    if (h_cpu <= free_cpu && h_mem <= free_mem) return APRM_INVALID_ARGUMENT;  /* fits now */
    if (n > 1) qsort(runs, n, sizeof *runs, cmp_slot_finish);
    while (i < n) {
        f = runs[i].finish;
        /* Give back every job that ends at tick f. Sums stay within the
         * machine capacity, but check anyway so a bad caller cannot wrap. */
        while (i < n && runs[i].finish == f) {
            if (runs[i].cpu < 0 || runs[i].mem < 0 ||
                runs[i].cpu > INT64_MAX - cpu || runs[i].mem > INT64_MAX - mem)
                return APRM_INVALID_ARGUMENT;
            cpu += runs[i].cpu;
            mem += runs[i].mem;
            i++;
        }
        if (h_cpu <= cpu && h_mem <= mem) {
            out->active = 1;
            out->id = h_id;
            out->shadow_time = f;
            out->extra_cpu = cpu - h_cpu;
            out->extra_mem = mem - h_mem;
            return APRM_OK;
        }
    }
    return APRM_INVALID_ARGUMENT;  /* h does not fit even on an empty machine */
}

/* See reserve.h. O(1). */
int reserve_backfill(Reservation *r, int64_t now, int64_t free_cpu, int64_t free_mem,
                     const Job *j, int *by_time)
{
    int in_time;
    if (!r || !j) return 0;
    if (j->cpu > free_cpu || j->mem > free_mem) return 0;     /* must fit now */
    if (by_time) *by_time = 0;
    if (!r->active) return 1;
    /* Finishes at or before the shadow time? now + duration, overflow-safe. */
    in_time = j->duration <= INT64_MAX - now && now + j->duration <= r->shadow_time;
    if (in_time) {
        if (by_time) *by_time = 1;
        return 1;                                             /* extra room untouched */
    }
    if (j->cpu <= r->extra_cpu && j->mem <= r->extra_mem) {
        r->extra_cpu -= j->cpu;                               /* the room shrinks */
        r->extra_mem -= j->mem;
        return 1;
    }
    return 0;
}
