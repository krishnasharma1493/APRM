/*
 * eventlog.h: typed event-log entries and their plain-English sentences
 * (issue K-10, decision D60).
 *
 * The engine appends one entry per decision. An entry stores numbers, not
 * text: the sentence is built from them when it is asked for
 * (eventlog_format, or while writing the JSON), so the text always matches
 * the numbers the engine used and an entry stays small (56 bytes).
 *
 * Ownership: an EventLog owns its entry array. No globals; every log is
 * independent. Entry i (counting from 0) has seq == i + 1: seq starts at 1,
 * grows by 1 per entry and restarts after eventlog_clear.
 */
#ifndef APRM_EVENTLOG_H
#define APRM_EVENTLOG_H

#include <stddef.h>
#include <stdint.h>
#include "json.h"

/* Log kinds, in PRD section 5 order. LOG_REJECT is reserved and never
 * emitted (D54); LOG_PROMOTE_INFO is reserved and never emitted (D60). */
typedef enum {
    LOG_ARRIVE, LOG_START, LOG_SKIP, LOG_RESERVE, LOG_BACKFILL,
    LOG_FINISH, LOG_REJECT, LOG_BATCH_SELECT, LOG_PROMOTE_INFO
} LogKind;

#define LOG_KIND_COUNT 9

/* Longest sentence, including the NUL. Sentences are built with snprintf
 * into a buffer of this size (callers may pass any size; see
 * eventlog_format for truncation). */
#define LOG_MSG_MAX 256

/* The number slots a[0..3] mean, per kind (all int64, unused slots are 0):
 *   ARRIVE        a0 = priority
 *   START         a0 = cpu, a1 = mem the job needs; a2 = free cpu, a3 = free mem
 *                 just before it started
 *   SKIP          a0 = cpu, a1 = mem the job needs; a2 = free cpu, a3 = free mem
 *   FINISH        a0 = ticks it ran; a1 = cpu, a2 = mem freed
 *   RESERVE       a0 = shadow time (guaranteed start)
 *   BACKFILL      a0 = its finish time, a1 = shadow time of the reservation
 *   BATCH_SELECT  a0 = number of jobs in the chosen batch
 *   REJECT, PROMOTE_INFO: unused (reserved) */
typedef struct {
    int64_t seq;        /* 1, 2, 3, ... */
    int64_t t;          /* simulation time of the decision */
    int32_t job;        /* job id the sentence is about */
    LogKind kind;
    int64_t a[4];
} LogEntry;

typedef struct {
    LogEntry *e;        /* owned array, NULL until first reserve */
    size_t len, cap;
    size_t max_cap;     /* 0 = no limit; else growth beyond it is OUT_OF_MEMORY
                           (the test hook for out-of-memory, like JsonBuf) */
} EventLog;

/* Empty log, no allocation. O(1). */
void eventlog_init(EventLog *l);

/* Free the array; the log may be re-initialised. Safe on a zeroed log. O(1). */
void eventlog_free(EventLog *l);

/* Drop every entry, keep the buffer; the next entry gets seq 1 again.
 * Cannot fail. O(1). */
void eventlog_clear(EventLog *l);

/* Make room for `extra` more entries. Returns APRM_OK, or APRM_OUT_OF_MEMORY
 * (size overflow, allocation failure or max_cap exceeded) with the log
 * unchanged. Capacity at least doubles, so appends are O(1) amortised; the
 * call that grows costs O(len). The log owns the memory. */
int eventlog_reserve(EventLog *l, size_t extra);

/* Append one entry with the next seq. Returns APRM_OK, or
 * APRM_OUT_OF_MEMORY if there is no reserved room (the log is then
 * unchanged). Never allocates, so after a successful eventlog_reserve it
 * cannot fail. O(1). */
int eventlog_push(EventLog *l, int64_t t, LogKind kind, int32_t job,
                  int64_t a0, int64_t a1, int64_t a2, int64_t a3);

/* "ARRIVE", "START", ... ; "?" for an unknown kind. O(1). Static text. */
const char *eventlog_kind_name(LogKind kind);

/* Write the sentence for *e into buf (size n) with snprintf. The result is
 * always NUL-terminated when n > 0 and never overruns: a sentence longer than
 * n - 1 bytes is cut (sentences are plain ASCII, so a cut never splits a
 * character). Returns the length actually stored. Pure. O(1). */
size_t eventlog_format(const LogEntry *e, char *buf, size_t n);

/* Write the PRD section 5 envelope {"ok":true,"data":[ {seq,t,kind,job,msg},
 * ... ]} with the entries whose seq > since_seq (since_seq <= 0: all; at or
 * beyond the last seq: an empty array). Returns APRM_OK or the sticky error
 * of the JsonBuf (APRM_OUT_OF_MEMORY). Does not modify the log. O(k) for the
 * k entries returned (the first one is found in O(1): seq = index + 1). */
int eventlog_json(const EventLog *l, int64_t since_seq, JsonBuf *out);

#endif /* APRM_EVENTLOG_H */
