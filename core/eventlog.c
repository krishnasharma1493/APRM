/*
 * eventlog.c: growing array of typed entries and the sentence formatter
 * (issue K-10, decision D60).
 */
#include "eventlog.h"

#include <stdio.h>
#include <stdlib.h>
#include "job.h"

void eventlog_init(EventLog *l)
{
    l->e = NULL;
    l->len = 0;
    l->cap = 0;
    l->max_cap = 0;
}

void eventlog_free(EventLog *l)
{
    free(l->e);
    l->e = NULL;
    l->len = 0;
    l->cap = 0;
}

void eventlog_clear(EventLog *l)
{
    l->len = 0;
}

int eventlog_reserve(EventLog *l, size_t extra)
{
    size_t need, ncap;
    LogEntry *grown;
    if (extra > SIZE_MAX - l->len) return APRM_OUT_OF_MEMORY;
    need = l->len + extra;
    if (need <= l->cap) return APRM_OK;
    if (l->max_cap != 0 && need > l->max_cap) return APRM_OUT_OF_MEMORY;
    ncap = (l->cap <= SIZE_MAX / 2 && l->cap * 2 > need) ? l->cap * 2 : need;
    if (ncap < 64) ncap = 64;
    if (l->max_cap != 0 && ncap > l->max_cap) ncap = l->max_cap;
    if (ncap > SIZE_MAX / sizeof *grown) return APRM_OUT_OF_MEMORY;
    grown = realloc(l->e, ncap * sizeof *grown);
    if (!grown) return APRM_OUT_OF_MEMORY;
    l->e = grown;
    l->cap = ncap;
    return APRM_OK;
}

int eventlog_push(EventLog *l, int64_t t, LogKind kind, int32_t job,
                  int64_t a0, int64_t a1, int64_t a2, int64_t a3)
{
    LogEntry *x;
    if (l->len >= l->cap) return APRM_OUT_OF_MEMORY;
    x = &l->e[l->len];
    x->seq = (int64_t)l->len + 1;
    x->t = t;
    x->job = job;
    x->kind = kind;
    x->a[0] = a0; x->a[1] = a1; x->a[2] = a2; x->a[3] = a3;
    l->len++;
    return APRM_OK;
}

const char *eventlog_kind_name(LogKind kind)
{
    switch (kind) {
    case LOG_ARRIVE:       return "ARRIVE";
    case LOG_START:        return "START";
    case LOG_SKIP:         return "SKIP";
    case LOG_RESERVE:      return "RESERVE";
    case LOG_BACKFILL:     return "BACKFILL";
    case LOG_FINISH:       return "FINISH";
    case LOG_REJECT:       return "REJECT";
    case LOG_BATCH_SELECT: return "BATCH_SELECT";
    case LOG_PROMOTE_INFO: return "PROMOTE_INFO";
    }
    return "?";
}

/* "" for 1, "s" otherwise: "1 core", "8 cores", "1 tick". O(1). */
static const char *pl(int64_t n)
{
    return n == 1 ? "" : "s";
}

size_t eventlog_format(const LogEntry *e, char *buf, size_t n)
{
    int w;
    const int64_t *a = e->a;
    long long id = (long long)e->job;
    if (n == 0) return 0;
    switch (e->kind) {
    case LOG_ARRIVE:
        w = snprintf(buf, n, "Job %lld arrived with priority %lld.", id, (long long)a[0]);
        break;
    case LOG_START:
        w = snprintf(buf, n,
                     "Job %lld started: needs %lld core%s and %lld MB; %lld core%s and %lld MB free.",
                     id, (long long)a[0], pl(a[0]), (long long)a[1],
                     (long long)a[2], pl(a[2]), (long long)a[3]);
        break;
    case LOG_SKIP: {
        /* Name only the resource(s) that are short; if the numbers say
         * neither is short (a caller bug), name both so nothing is hidden. */
        int cpu_short = a[0] > a[2], mem_short = a[1] > a[3];
        if (cpu_short && !mem_short)
            w = snprintf(buf, n, "Job %lld skipped: needs %lld core%s, only %lld core%s free.",
                         id, (long long)a[0], pl(a[0]), (long long)a[2], pl(a[2]));
        else if (mem_short && !cpu_short)
            w = snprintf(buf, n, "Job %lld skipped: needs %lld MB, only %lld MB free.",
                         id, (long long)a[1], (long long)a[3]);
        else
            w = snprintf(buf, n,
                         "Job %lld skipped: needs %lld core%s and %lld MB, only %lld core%s and %lld MB free.",
                         id, (long long)a[0], pl(a[0]), (long long)a[1],
                         (long long)a[2], pl(a[2]), (long long)a[3]);
        break;
    }
    case LOG_FINISH:
        w = snprintf(buf, n, "Job %lld finished after %lld tick%s; freed %lld core%s and %lld MB.",
                     id, (long long)a[0], pl(a[0]), (long long)a[1], pl(a[1]), (long long)a[2]);
        break;
    case LOG_RESERVE:
        w = snprintf(buf, n, "Job %lld reserved: start guaranteed at t=%lld.", id, (long long)a[0]);
        break;
    case LOG_BACKFILL:
        /* a0 <= a1: it ends in time. a0 > a1: it runs past the shadow time but
         * fits the room the reserved job leaves free (K-26; D66). */
        if (a[0] <= a[1])
            w = snprintf(buf, n, "Job %lld backfilled: finishes at t=%lld, before the reservation at t=%lld.",
                         id, (long long)a[0], (long long)a[1]);
        else
            w = snprintf(buf, n,
                         "Job %lld backfilled: finishes at t=%lld, after the reservation at t=%lld, but fits the spare room.",
                         id, (long long)a[0], (long long)a[1]);
        break;
    case LOG_BATCH_SELECT:
        w = snprintf(buf, n, "Job %lld chosen for the best batch of %lld job%s.",
                     id, (long long)a[0], pl(a[0]));
        break;
    case LOG_REJECT:
        w = snprintf(buf, n, "Job %lld rejected (reserved kind, never emitted; see the error message).", id);
        break;
    case LOG_PROMOTE_INFO:
        w = snprintf(buf, n, "Job %lld promotion note (reserved kind, never emitted).", id);
        break;
    default:
        w = snprintf(buf, n, "Job %lld: unknown event.", id);
        break;
    }
    if (w < 0) { buf[0] = '\0'; return 0; }
    return (size_t)w < n ? (size_t)w : n - 1;  /* snprintf reports the untruncated length */
}

int eventlog_json(const EventLog *l, int64_t since_seq, JsonBuf *out)
{
    size_t i;
    char msg[LOG_MSG_MAX];
    /* seq = index + 1, so entries with seq > since_seq start at index since_seq. */
    i = since_seq <= 0 ? 0 : ((uint64_t)since_seq >= l->len ? l->len : (size_t)since_seq);
    json_ok_begin(out);
    json_arr_begin(out);
    for (; i < l->len; i++) {
        const LogEntry *x = &l->e[i];
        eventlog_format(x, msg, sizeof msg);
        json_obj_begin(out);
        json_key(out, "seq");  json_i64(out, x->seq);
        json_key(out, "t");    json_i64(out, x->t);
        json_key(out, "kind"); json_str(out, eventlog_kind_name(x->kind));
        json_key(out, "job");  json_i64(out, x->job);
        json_key(out, "msg");  json_str(out, msg);
        json_obj_end(out);
    }
    json_arr_end(out);
    json_ok_end(out);
    return json_status(out);
}
