/*
 * csv.c: jobs.csv reader and results.csv writer. See csv.h for the contract.
 * Pure C11, no I/O, no printing, no mutable global state.
 */
#include "csv.h"

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "config.h"

/* ---- CsvText ---------------------------------------------------------- */

/* Sets t to empty. O(1). No allocation. */
void csv_text_init(CsvText *t)
{
    t->data = NULL;
    t->len = 0;
    t->cap = 0;
}

/* Frees the buffer and resets t. O(1). Caller keeps ownership of t itself. */
void csv_text_free(CsvText *t)
{
    if (t == NULL) return;
    free(t->data);
    csv_text_init(t);
}

/* Appends n bytes and a NUL. Amortised O(n). The buffer stays owned by t. */
int csv_text_append(CsvText *t, const char *s, size_t n)
{
    if (t == NULL || (s == NULL && n > 0)) return APRM_INVALID_ARGUMENT;
    if (n > SIZE_MAX - t->len - 1) return APRM_OUT_OF_MEMORY;
    size_t need = t->len + n + 1;
    if (need > t->cap) {
        size_t cap = t->cap == 0 ? 64 : t->cap;
        while (cap < need) {
            if (cap > SIZE_MAX / 2) {
                cap = need;
                break;
            }
            cap *= 2;
        }
        char *p = realloc(t->data, cap);
        if (p == NULL) return APRM_OUT_OF_MEMORY;
        t->data = p;
        t->cap = cap;
    }
    if (n > 0) memcpy(t->data + t->len, s, n);
    t->len += n;
    t->data[t->len] = '\0';
    return APRM_OK;
}

/* ---- reader ----------------------------------------------------------- */

static const char *const COLUMN_NAMES[CSV_JOBS_COLUMNS] = {
    "id", "arrival", "duration", "cpu", "mem", "priority"
};

/* Fills err (if not NULL) and returns code. No ownership involved. O(1). */
static int fail(CsvError *err, int code, int64_t line, const char *column,
                const char *what)
{
    if (err == NULL) return code;
    err->code = code;
    err->line = line;
    snprintf(err->column, sizeof err->column, "%s", column);
    if (column[0] != '\0')
        snprintf(err->message, sizeof err->message, "Line %" PRId64 ", column %s: %s",
                 line, column, what);
    else
        snprintf(err->message, sizeof err->message, "Line %" PRId64 ": %s", line, what);
    return code;
}

/* Strict integer: optional '-', then 1 or more digits, nothing else.
 * Returns 0 and sets *v, 1 if not a number, 2 if it does not fit in int64_t.
 * Overflow test before v = v*10 + d: v > (INT64_MAX - d) / 10. O(len). */
static int parse_int(const char *s, size_t len, int64_t *v)
{
    size_t i = 0;
    int neg = 0;
    if (len > 0 && s[0] == '-') {
        neg = 1;
        i = 1;
    }
    if (i == len) return 1;
    for (size_t k = i; k < len; k++)
        if (s[k] < '0' || s[k] > '9') return 1;
    int64_t acc = 0;
    for (; i < len; i++) {
        int d = s[i] - '0';
        if (acc > (INT64_MAX - d) / 10) return 2;
        acc = acc * 10 + d;
    }
    *v = neg ? -acc : acc;
    return 0;
}

/* Checks value v of column col against PRD section 3. Returns 1 if valid. */
static int in_range(int col, int64_t v)
{
    switch (col) {
    case 0: return v >= APRM_JOB_ID_MIN && v <= APRM_JOB_ID_MAX;
    case 1: return v >= APRM_ARRIVAL_MIN && v <= APRM_ARRIVAL_MAX;
    case 2: return v >= APRM_DURATION_MIN && v <= APRM_DURATION_MAX;
    case 3: return v >= 1;
    case 4: return v >= 1;
    default: return v >= APRM_PRIORITY_MIN && v <= APRM_PRIORITY_MAX;
    }
}

/* Range message for column col. */
static const char *range_text(int col)
{
    switch (col) {
    case 0: return "must be 0 to 2147483647.";
    case 1: return "must be 0 to 1000000000.";
    case 2: return "must be 1 to 1000000.";
    case 3: return "must be at least 1.";
    case 4: return "must be at least 1.";
    default: return "must be 0 to 9.";
    }
}

/* Finds the end of the line starting at p (before any "\r\n"/"\n").
 * Sets *next to the start of the following line (== len at end of text) and
 * returns the line length without terminator. O(line length). */
static size_t split_line(const char *text, size_t len, size_t p, size_t *next)
{
    const char *nl = memchr(text + p, '\n', len - p);
    if (nl == NULL) {
        *next = len;
        return len - p;
    }
    size_t end = (size_t)(nl - text);
    *next = end + 1;
    if (end > p && text[end - 1] == '\r') end--;
    return end - p;
}

/* Parses one data row (line of length n at s) into *job. Returns APRM_OK or
 * an error already written to err. O(n). */
static int parse_row(const char *s, size_t n, int64_t lineno, Job *job, CsvError *err)
{
    int commas = 0;
    for (size_t i = 0; i < n; i++)
        if (s[i] == ',') commas++;
    if (commas + 1 != CSV_JOBS_COLUMNS) {
        char what[64];
        snprintf(what, sizeof what, "expected %d columns, found %d.", CSV_JOBS_COLUMNS, commas + 1);
        return fail(err, APRM_PARSE_ERROR, lineno, "", what);
    }
    int64_t v[CSV_JOBS_COLUMNS];
    size_t start = 0;
    for (int c = 0; c < CSV_JOBS_COLUMNS; c++) {
        size_t end = start;
        while (end < n && s[end] != ',') end++;
        int r = parse_int(s + start, end - start, &v[c]);
        if (r == 1) return fail(err, APRM_PARSE_ERROR, lineno, COLUMN_NAMES[c], "not a number.");
        if (r == 2) return fail(err, APRM_PARSE_ERROR, lineno, COLUMN_NAMES[c], "number too large.");
        if (!in_range(c, v[c]))
            return fail(err, APRM_INVALID_FIELD, lineno, COLUMN_NAMES[c], range_text(c));
        start = end + 1;
    }
    job->id = (int32_t)v[0];
    job->arrival = v[1];
    job->duration = v[2];
    job->cpu = v[3];
    job->mem = v[4];
    job->priority = (int32_t)v[5];
    return APRM_OK;
}

/* See csv.h. Owns the job array until it returns success. O(len). */
int csv_read_jobs(const char *text, size_t len, int64_t max_jobs,
                  Job **out, int64_t *n, CsvError *err)
{
    if (err != NULL) {
        err->code = APRM_OK;
        err->line = 0;
        err->column[0] = '\0';
        err->message[0] = '\0';
    }
    if (out == NULL || n == NULL) return fail(err, APRM_INVALID_ARGUMENT, 0, "", "null pointer.");
    *out = NULL;
    *n = 0;
    if (text == NULL || max_jobs < 0)
        return fail(err, APRM_INVALID_ARGUMENT, 0, "", "invalid argument.");

    Job *jobs = NULL;
    size_t count = 0, cap = 0;
    int64_t lineno = 1;
    size_t p = 0, next = 0;
    int code = APRM_OK;

    /* Header (line 1). An empty text has no header. */
    if (len == 0) return fail(err, APRM_PARSE_ERROR, 1, "", "missing header, expected " CSV_JOBS_HEADER ".");
    size_t ll = split_line(text, len, p, &next);
    if (ll > CSV_MAX_LINE) return fail(err, APRM_PARSE_ERROR, 1, "", "line too long.");
    if (ll != strlen(CSV_JOBS_HEADER) || memcmp(text, CSV_JOBS_HEADER, ll) != 0)
        return fail(err, APRM_PARSE_ERROR, 1, "", "header must be " CSV_JOBS_HEADER ".");
    p = next;

    while (p < len) {
        lineno++;
        ll = split_line(text, len, p, &next);
        if (ll > CSV_MAX_LINE) { code = fail(err, APRM_PARSE_ERROR, lineno, "", "line too long."); goto bad; }
        if (ll == 0) { code = fail(err, APRM_PARSE_ERROR, lineno, "", "empty line."); goto bad; }
        if ((int64_t)count >= max_jobs) {
            char what[64];
            snprintf(what, sizeof what, "more than %" PRId64 " jobs.", max_jobs);
            code = fail(err, APRM_LIMIT_REACHED, lineno, "", what);
            goto bad;
        }
        if (count == cap) {
            size_t ncap = cap == 0 ? 16 : cap * 2;   /* cap < max_jobs <= INT64_MAX, doubling is bounded by input size */
            if (ncap > SIZE_MAX / sizeof *jobs) { code = fail(err, APRM_OUT_OF_MEMORY, lineno, "", "out of memory."); goto bad; }
            Job *g = realloc(jobs, ncap * sizeof *jobs);
            if (g == NULL) { code = fail(err, APRM_OUT_OF_MEMORY, lineno, "", "out of memory."); goto bad; }
            jobs = g;
            cap = ncap;
        }
        code = parse_row(text + p, ll, lineno, &jobs[count], err);
        if (code != APRM_OK) goto bad;
        count++;
        p = next;
    }

    *out = jobs;
    *n = (int64_t)count;
    return APRM_OK;

bad:
    free(jobs);
    return code;
}

/* See csv.h. O(1). */
int64_t csv_job_line(int64_t index)
{
    return index + 2;
}

/* ---- writer ----------------------------------------------------------- */

/* See csv.h. Appends to out; rolls back on failure. O(n). */
int csv_write_results(CsvText *out, const ResultRow *rows, int64_t n)
{
    if (out == NULL || n < 0 || (rows == NULL && n > 0)) return APRM_INVALID_ARGUMENT;
    size_t keep = out->len;
    int rc = csv_text_append(out, CSV_RESULTS_HEADER "\n", strlen(CSV_RESULTS_HEADER) + 1);
    for (int64_t i = 0; rc == APRM_OK && i < n; i++) {
        const ResultRow *r = &rows[i];
        char line[256];   /* 9 numbers of at most 20 chars, 8 commas, newline */
        int w = snprintf(line, sizeof line,
                         "%" PRId32 ",%" PRId64 ",%" PRId64 ",%" PRId64 ",%" PRId64 ",%" PRId64
                         ",%" PRId32 ",%" PRId64 ",%" PRId64 "\n",
                         r->id, r->arrival, r->start, r->finish, r->wait, r->turnaround,
                         r->priority, r->cpu, r->mem);
        if (w < 0 || (size_t)w >= sizeof line) { rc = APRM_INVALID_ARGUMENT; break; }
        rc = csv_text_append(out, line, (size_t)w);
    }
    if (rc != APRM_OK && out->data != NULL) {
        out->len = keep;
        out->data[keep] = '\0';
    }
    return rc;
}
