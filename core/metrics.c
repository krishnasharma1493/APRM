/*
 * metrics.c: metrics from result rows (see metrics.h). Pure C11, no globals.
 */
#include "metrics.h"

#include <stddef.h>

/* ---- 128-bit helpers (just what the division needs) ---- */

static U128 u128_from(uint64_t v)
{
    U128 r;
    r.hi = 0;
    r.lo = v;
    return r;
}

static int u128_ge(U128 a, U128 b)
{
    return a.hi != b.hi ? a.hi > b.hi : a.lo >= b.lo;
}

static int u128_is_zero(U128 a)
{
    return a.hi == 0 && a.lo == 0;
}

/* a + b; our sums stay below 2^80, so the carry out of hi is impossible. O(1). */
static U128 u128_add(U128 a, U128 b)
{
    U128 r;
    r.lo = a.lo + b.lo;
    r.hi = a.hi + b.hi + (r.lo < a.lo ? 1 : 0);
    return r;
}

/* a - b, requires a >= b. O(1). */
static U128 u128_sub(U128 a, U128 b)
{
    U128 r;
    r.lo = a.lo - b.lo;
    r.hi = a.hi - b.hi - (a.lo < b.lo ? 1 : 0);
    return r;
}

/* a shifted left by one bit; the top bit is dropped (callers keep a < 2^127). */
static U128 u128_shl1(U128 a)
{
    U128 r;
    r.hi = (a.hi << 1) | (a.lo >> 63);
    r.lo = a.lo << 1;
    return r;
}

/* Full 64 x 64 -> 128-bit product with four 32-bit partial products. O(1). */
static U128 u128_mul64(uint64_t a, uint64_t b)
{
    uint64_t a0 = a & 0xffffffffu, a1 = a >> 32;
    uint64_t b0 = b & 0xffffffffu, b1 = b >> 32;
    uint64_t p00 = a0 * b0, p01 = a0 * b1, p10 = a1 * b0, p11 = a1 * b1;
    uint64_t mid = (p00 >> 32) + (p01 & 0xffffffffu) + (p10 & 0xffffffffu);
    U128 r;
    r.lo = (p00 & 0xffffffffu) | (mid << 32);
    r.hi = p11 + (p01 >> 32) + (p10 >> 32) + (mid >> 32);
    return r;
}

/* Binary long division: *q = num / den, *r = num % den. den must be non-zero
 * and below 2^127 (ours are below 2^71), so the remainder shifted left never
 * overflows. 128 steps. */
static void u128_divmod(U128 num, U128 den, U128 *q, U128 *r)
{
    int i;
    U128 rem = u128_from(0), quo = u128_from(0);
    for (i = 127; i >= 0; i--) {
        uint64_t bit = i >= 64 ? (num.hi >> (i - 64)) & 1u : (num.lo >> i) & 1u;
        rem = u128_shl1(rem);
        rem.lo |= bit;
        if (u128_ge(rem, den)) {
            rem = u128_sub(rem, den);
            if (i >= 64) quo.hi |= (uint64_t)1 << (i - 64);
            else quo.lo |= (uint64_t)1 << i;
        }
    }
    *q = quo;
    *r = rem;
}

/* See metrics.h. */
int metrics_ratio9(U128 num, U128 den, uint64_t *whole, uint32_t *frac)
{
    U128 q, r, r2;
    uint32_t f = 0;
    int d, k;
    if (u128_is_zero(den) || den.hi >= ((uint64_t)1 << 56)) return 0;  /* keeps r * 10 in range */
    u128_divmod(num, den, &q, &r);
    if (q.hi != 0 || q.lo == UINT64_MAX) return 0;
    for (d = 0; d < 9; d++) {
        r2 = u128_shl1(r);
        r = u128_add(u128_shl1(u128_shl1(r2)), r2);   /* r * 8 + r * 2 = r * 10 */
        for (k = 0; u128_ge(r, den); k++) r = u128_sub(r, den);
        f = f * 10u + (uint32_t)k;                    /* r < den before, so k is 0..9 */
    }
    if (u128_ge(u128_shl1(r), den)) f++;              /* half up: remainder >= den / 2 */
    if (f == 1000000000u) { f = 0; q.lo++; }
    *whole = q.lo;
    *frac = f;
    return 1;
}

/* ---- sums ---- */

/* *a += b with overflow check; 1 on success, 0 on overflow (b >= 0). O(1). */
static int add_i64(int64_t *a, int64_t b)
{
    if (b > INT64_MAX - *a) return 0;
    *a += b;
    return 1;
}

int metrics_from_rows(const ResultRow *rows, int64_t n, int64_t cpu_cap, int64_t mem_cap,
                      Metrics *m)
{
    int64_t i, wait, tat, dur;
    int p;
    if (!m) return APRM_INVALID_ARGUMENT;
    *m = (Metrics){0};
    if (n < 0 || (n > 0 && !rows) || cpu_cap < 1 || mem_cap < 1) return APRM_INVALID_ARGUMENT;
    for (i = 0; i < n; i++) {
        const ResultRow *r = &rows[i];
        if (r->start < r->arrival || r->finish <= r->start || r->arrival < 0 || r->priority < 0 ||
            r->priority >= METRICS_LEVELS || r->cpu < 1 || r->mem < 1)
            return APRM_INVALID_FIELD;
        wait = r->start - r->arrival;             /* 0 <= arrival <= start: no overflow */
        tat = r->finish - r->arrival;
        dur = r->finish - r->start;
        p = r->priority;
        if (!add_i64(&m->sum_wait, wait) || !add_i64(&m->sum_turnaround, tat) ||
            !add_i64(&m->level_sum_wait[p], wait))
            return APRM_INVALID_FIELD;
        /* (priority + 1) x finish: check the product, then the sum (D17). */
        if (r->finish > INT64_MAX / (p + 1)) return APRM_INVALID_FIELD;
        if (!add_i64(&m->weighted_completion, (int64_t)(p + 1) * r->finish))
            return APRM_INVALID_FIELD;
        if (wait > m->max_wait) m->max_wait = wait;
        if (r->finish > m->makespan) m->makespan = r->finish;
        m->level_n[p]++;
        /* cpu x duration and mem x duration each fit 64 bits unless the row
         * is far outside the PRD limits; the sum over rows goes in 128 bits. */
        if ((uint64_t)r->cpu > UINT64_MAX / (uint64_t)dur ||
            (uint64_t)r->mem > UINT64_MAX / (uint64_t)dur)
            return APRM_INVALID_FIELD;
        m->busy_cpu = u128_add(m->busy_cpu, u128_from((uint64_t)r->cpu * (uint64_t)dur));
        m->busy_mem = u128_add(m->busy_mem, u128_from((uint64_t)r->mem * (uint64_t)dur));
    }
    m->n = n;
    m->den_cpu = u128_mul64((uint64_t)cpu_cap, (uint64_t)m->makespan);
    m->den_mem = u128_mul64((uint64_t)mem_cap, (uint64_t)m->makespan);
    return APRM_OK;
}

/* ---- JSON ---- */

/* Write num/den with nine decimals, or null if undefined. O(1). */
static void put_ratio(JsonBuf *out, U128 num, U128 den)
{
    uint64_t whole;
    uint32_t frac;
    if (metrics_ratio9(num, den, &whole, &frac)) json_fixed9(out, whole, frac);
    else json_null(out);
}

/* See metrics.h. */
void metrics_write_json(const Metrics *m, JsonBuf *out)
{
    int p;
    json_obj_begin(out);
    json_key(out, "avg_wait");
    put_ratio(out, u128_from((uint64_t)m->sum_wait), u128_from((uint64_t)m->n));
    json_key(out, "max_wait");
    json_i64(out, m->max_wait);
    json_key(out, "avg_turnaround");
    put_ratio(out, u128_from((uint64_t)m->sum_turnaround), u128_from((uint64_t)m->n));
    json_key(out, "weighted_completion");
    json_i64(out, m->weighted_completion);
    json_key(out, "makespan");
    json_i64(out, m->makespan);
    json_key(out, "util_cpu");
    put_ratio(out, m->busy_cpu, m->den_cpu);
    json_key(out, "util_mem");
    put_ratio(out, m->busy_mem, m->den_mem);
    json_key(out, "avg_wait_by_priority");
    json_arr_begin(out);
    for (p = 0; p < METRICS_LEVELS; p++)
        put_ratio(out, u128_from((uint64_t)m->level_sum_wait[p]),
                  u128_from((uint64_t)m->level_n[p]));
    json_arr_end(out);
    json_obj_end(out);
}
