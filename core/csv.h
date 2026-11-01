/*
 * csv.h: the validating jobs.csv reader and the results.csv writer (PRD
 * section 5, "CSV formats").
 *
 * The core does no file I/O and no printing. The reader parses text that is
 * already in memory; the writer appends text to an in-memory buffer. The
 * console program (K-12) and the website glue read and write the files.
 *
 * Everything here is stateless: no globals, no statics.
 */
#ifndef APRM_CSV_H
#define APRM_CSV_H

#include <stddef.h>
#include <stdint.h>
#include "job.h"

/* Exact header lines (PRD section 5), without the line terminator. */
#define CSV_JOBS_HEADER "id,arrival,duration,cpu,mem,priority"
#define CSV_RESULTS_HEADER "id,arrival,start,finish,wait,turnaround,priority,cpu,mem"

/* Longest accepted input line in bytes, not counting the line terminator.
 * A longer line is a PARSE_ERROR (the longest valid row is under 90 bytes). */
#define CSV_MAX_LINE 256

/* Number of columns in jobs.csv and in results.csv. */
#define CSV_JOBS_COLUMNS 6
#define CSV_RESULTS_COLUMNS 9

/*
 * Error report from csv_read_jobs. All text is NUL-terminated.
 *  code    the same value the function returned (0 on success)
 *  line    1-based line number, the header being line 1 (0 if none)
 *  column  name of the offending column ("id", "arrival", ...), or "" when
 *          the error concerns the whole line
 *  message full text, e.g. "Line 12, column cpu: not a number."
 */
typedef struct {
    int code;
    int64_t line;
    char column[16];
    char message[160];
} CsvError;

/*
 * CsvText: a small growable text buffer owned by the caller.
 *  data  NULL until the first append; afterwards always NUL-terminated
 *  len   bytes used, not counting the NUL
 *  cap   bytes allocated for data
 * Ownership: the buffer owns data. Initialise with csv_text_init and release
 * with csv_text_free. The struct itself is never allocated by this module.
 */
typedef struct {
    char *data;
    size_t len;
    size_t cap;
} CsvText;

/*
 * ResultRow: one line of results.csv, columns in the PRD order
 * id,arrival,start,finish,wait,turnaround,priority,cpu,mem.
 * Plain data, no pointers, no ownership. The writer prints the values as
 * given and does not recompute wait or turnaround.
 */
typedef struct {
    int32_t id;
    int64_t arrival, start, finish, wait, turnaround;
    int32_t priority;
    int64_t cpu, mem;
} ResultRow;

/* Sets t to the empty state (no allocation). t must not be NULL. */
void csv_text_init(CsvText *t);

/* Frees t->data and resets t to the empty state. Safe on an empty or already
 * freed buffer. */
void csv_text_free(CsvText *t);

/* Appends n bytes of s to t and keeps t NUL-terminated. Amortised O(n) with
 * doubling growth and overflow-checked sizes. Returns APRM_OK,
 * APRM_INVALID_ARGUMENT (NULL t, or NULL s with n > 0) or
 * APRM_OUT_OF_MEMORY; on failure t is unchanged and still valid. */
int csv_text_append(CsvText *t, const char *s, size_t n);

/*
 * Parses jobs.csv text of length len (not necessarily NUL-terminated) into a
 * newly allocated array of jobs.
 *
 * Accepted: header line exactly CSV_JOBS_HEADER; "\n" or "\r\n" line endings;
 * one optional final line terminator; integer fields only (optional leading
 * '-', then digits); at most CSV_MAX_LINE bytes per line.
 * Rejected, with line and column in err->message:
 *  - missing or different header, wrong column count, empty line, line
 *    longer than CSV_MAX_LINE, empty or non-numeric field, a number that does
 *    not fit in int64_t                      -> APRM_PARSE_ERROR
 *  - a number outside its PRD section 3 range (id, arrival, duration,
 *    priority; cpu and mem must be >= 1)     -> APRM_INVALID_FIELD
 *  - more than max_jobs data rows            -> APRM_LIMIT_REACHED
 *  - allocation failure                      -> APRM_OUT_OF_MEMORY
 * The first problem found (top to bottom, left to right) is reported. The
 * limit is checked as soon as a data row beyond max_jobs is seen, before that
 * row is parsed. Capacity checks and duplicate ids are not done here.
 *
 * max_jobs must be >= 0. text, out and n must not be NULL (else
 * APRM_INVALID_ARGUMENT). err may be NULL; otherwise it is always filled
 * (code 0, empty message on success).
 *
 * On success *out is a malloc'd array of *n jobs in file order, or NULL when
 * *n is 0 (header only). The caller owns it and frees it with free().
 * On error *out is NULL, *n is 0 and nothing is left allocated.
 * Time O(len), one pass; space O(n).
 */
int csv_read_jobs(const char *text, size_t len, int64_t max_jobs,
                  Job **out, int64_t *n, CsvError *err);

/*
 * The 1-based line number of data row `index` (0-based, in file order) that
 * csv_read_jobs returned: index + 2. This holds because the reader accepts no
 * blank or comment lines and the header is line 1, so row i is always the
 * (i + 2)th line. The console program uses it to say "(line N)" when
 * sim_add_job rejects job i (D54). Pure, O(1); index must be >= 0 and below
 * INT64_MAX - 1.
 */
int64_t csv_job_line(int64_t index);

/*
 * Appends CSV_RESULTS_HEADER and one line per row to out, each line ending in
 * "\n". The values are printed as given. rows may be NULL only when n is 0;
 * n must be >= 0. Output is deterministic and byte-identical on every
 * platform (integers only). Time O(n); the buffer grows as needed.
 * Returns APRM_OK, APRM_INVALID_ARGUMENT or APRM_OUT_OF_MEMORY; on failure
 * out is restored to its length before the call.
 */
int csv_write_results(CsvText *out, const ResultRow *rows, int64_t n);

#endif /* APRM_CSV_H */
