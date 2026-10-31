/*
 * main.c: the APRM console program (PRD section 5 "Console program", K-12).
 *
 *   aprm --in jobs.csv --out results.csv [--policy fcfs|priority|sjf|aging|reserve|knapsack]
 *        [--cpu 16] [--mem 32768] [--alpha-milli 100] [--threshold 50] [--eps 0.1]
 *        [--log log.txt] [--metrics metrics.json] [--exact] [--help]
 *
 * This file is the only place that touches files, stdout and stderr; core/
 * stays pure. The program is all-or-nothing (DECISIONS D54): jobs are added
 * in file order, the first rejected job stops everything, nothing runs and
 * no output file is written. Output files are written to "<name>.tmp" and
 * renamed only when every output was written, so a failed run never leaves a
 * partial file (and never touches an existing one).
 *
 * Exit codes: 0 success, 1 bad arguments, 2 input file error (cannot open or
 * read, too large, CSV PARSE_ERROR), 3 invalid job, 4 internal error (out of
 * memory, unimplemented policy, cannot write an output file). Every error is
 * one line on stderr: "<NAME>: <message>" with the PRD section 5 error name.
 */
#include <errno.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "config.h"
#include "csv.h"
#include "engine.h"
#include "eventlog.h"
#include "job.h"
#include "json.h"

#define EXIT_OK 0
#define EXIT_BAD_ARGS 1
#define EXIT_INPUT 2
#define EXIT_INVALID_JOB 3
#define EXIT_INTERNAL 4

/* Largest input file accepted: 128 MiB. 1,000,000 jobs at the longest legal
 * row (about 90 bytes) is under 90 MB, so every legal file fits. */
#define MAX_INPUT_BYTES ((size_t)128 * 1024 * 1024)

/* Policy names in PolicyKind order. "reserve" is POL_AGING_RESERVE. */
static const char *const POLICY_NAMES[] = { "fcfs", "priority", "sjf", "aging", "reserve", "knapsack" };
#define POLICY_COUNT 6

static const char USAGE[] =
    "usage: aprm --in jobs.csv --out results.csv [--policy fcfs|priority|sjf|aging|reserve|knapsack]\n"
    "            [--cpu 16] [--mem 32768] [--alpha-milli 100] [--threshold 50] [--eps 0.1]\n"
    "            [--log log.txt] [--metrics metrics.json] [--exact] [--help]\n"
    "exit codes: 0 success, 1 bad arguments, 2 input file error, 3 invalid job, 4 internal error\n";

/* Parsed command line. Strings point into argv (not owned). */
typedef struct {
    const char *in, *out, *log, *metrics;
    SimConfig cfg;
    int exact, help;
} Args;

/* PRD section 5 error name for a code (static text). O(1). */
static const char *code_name(int code)
{
    switch (code) {
    case APRM_INVALID_ARGUMENT: return "INVALID_ARGUMENT";
    case APRM_INVALID_FIELD: return "INVALID_FIELD";
    case APRM_CAPACITY_EXCEEDED: return "CAPACITY_EXCEEDED";
    case APRM_ARRIVAL_IN_PAST: return "ARRIVAL_IN_PAST";
    case APRM_DUPLICATE_ID: return "DUPLICATE_ID";
    case APRM_LIMIT_REACHED: return "LIMIT_REACHED";
    case APRM_OUT_OF_MEMORY: return "OUT_OF_MEMORY";
    case APRM_PARSE_ERROR: return "PARSE_ERROR";
    case APRM_TOO_LARGE: return "TOO_LARGE";
    default: return "INTERNAL_ERROR";
    }
}

/* Prints one stderr line "<NAME>: <message>" and returns exit code `exit_code`.
 * `line` > 0 appends " (line N)". Messages never contain a newline. */
static int fail_line(int exit_code, const char *name, const char *msg, int64_t line)
{
    if (line > 0) fprintf(stderr, "%s: %s (line %" PRId64 ")\n", name, msg, line);
    else fprintf(stderr, "%s: %s\n", name, msg);
    return exit_code;
}

/* Strict integer: optional '-', then 1 or more digits, nothing else (no '+',
 * no spaces, no decimal point, no exponent, no empty string). Returns 1 and
 * sets *v if it is a number that fits in int64_t, else 0. O(len). */
static int parse_i64(const char *s, int64_t *v)
{
    size_t i = 0;
    int neg = 0;
    int64_t acc = 0;
    if (s[0] == '-') { neg = 1; i = 1; }
    if (s[i] == '\0') return 0;
    for (; s[i] != '\0'; i++) {
        int d;
        if (s[i] < '0' || s[i] > '9') return 0;
        d = s[i] - '0';
        if (acc > (INT64_MAX - d) / 10) return 0;
        acc = acc * 10 + d;
    }
    *v = neg ? -acc : acc;
    return 1;
}

/* Reads the value of integer flag `flag` into *dst, checked against
 * [lo, hi]. Returns 0 or an exit code (after printing the error). O(len). */
static int int_flag(const char *flag, const char *val, int64_t lo, int64_t hi, int64_t *dst)
{
    char msg[160];
    int64_t v;
    if (!parse_i64(val, &v)) {
        snprintf(msg, sizeof msg, "%s needs a whole number, got '%.40s'.", flag, val);
        return fail_line(EXIT_BAD_ARGS, "INVALID_ARGUMENT", msg, 0);
    }
    if (v < lo || v > hi) {
        snprintf(msg, sizeof msg, "%s must be %" PRId64 " to %" PRId64 ".", flag, lo, hi);
        return fail_line(EXIT_BAD_ARGS, "INVALID_FIELD", msg, 0);
    }
    *dst = v;
    return 0;
}

/* Reads --eps: plain decimal digits[.digits] (no sign, no exponent, at most
 * 12 characters), in [APRM_KNAPSACK_EPS_MIN, APRM_KNAPSACK_EPS_MAX]. The text
 * is validated by hand first, so strtod only ever sees a safe string.
 * Returns 0 or an exit code. O(len). */
static int eps_flag(const char *val, double *dst)
{
    char msg[160];
    size_t i = 0, len = strlen(val);
    int dots = 0, digits = 0;
    double v;
    for (; i < len; i++) {
        if (val[i] == '.') dots++;
        else if (val[i] >= '0' && val[i] <= '9') digits++;
        else break;
    }
    if (i != len || dots > 1 || digits == 0 || len > 12 || val[0] == '.' || val[len - 1] == '.') {
        snprintf(msg, sizeof msg, "--eps needs a decimal number like 0.1, got '%.40s'.", val);
        return fail_line(EXIT_BAD_ARGS, "INVALID_ARGUMENT", msg, 0);
    }
    v = strtod(val, NULL);
    if (!(v >= APRM_KNAPSACK_EPS_MIN && v <= APRM_KNAPSACK_EPS_MAX)) {
        snprintf(msg, sizeof msg, "--eps must be %g to %g.", (double)APRM_KNAPSACK_EPS_MIN,
                 (double)APRM_KNAPSACK_EPS_MAX);
        return fail_line(EXIT_BAD_ARGS, "INVALID_FIELD", msg, 0);
    }
    *dst = v;
    return 0;
}

/* Parses argv into *a with the defaults from config.h. Returns 0 or an exit
 * code (error already printed). O(argc). */
static int parse_args(int argc, char **argv, Args *a)
{
    int i, rc;
    char msg[160];
    memset(a, 0, sizeof *a);
    a->cfg.cpu_cap = APRM_CPU_CAP_DEFAULT;
    a->cfg.mem_cap = APRM_MEM_CAP_DEFAULT;
    a->cfg.policy = POL_FCFS;
    a->cfg.alpha_milli = APRM_ALPHA_MILLI_DEFAULT;
    a->cfg.reserve_threshold = APRM_RESERVE_T_DEFAULT;
    a->cfg.knapsack_eps = APRM_KNAPSACK_EPS_DEFAULT;
    a->cfg.max_jobs = APRM_MAX_JOBS_CLI;

    for (i = 1; i < argc; i++) {
        const char *f = argv[i];
        const char *val;
        if (strcmp(f, "--help") == 0 || strcmp(f, "-h") == 0) { a->help = 1; continue; }
        if (strcmp(f, "--exact") == 0) { a->exact = 1; continue; }
        if (strncmp(f, "--", 2) != 0 || strchr(f, '=') != NULL ||
            (strcmp(f, "--in") && strcmp(f, "--out") && strcmp(f, "--policy") && strcmp(f, "--cpu") &&
             strcmp(f, "--mem") && strcmp(f, "--alpha-milli") && strcmp(f, "--threshold") &&
             strcmp(f, "--eps") && strcmp(f, "--log") && strcmp(f, "--metrics"))) {
            snprintf(msg, sizeof msg, "unknown argument '%.60s'. Try --help.", f);
            return fail_line(EXIT_BAD_ARGS, "INVALID_ARGUMENT", msg, 0);
        }
        if (i + 1 >= argc) {
            snprintf(msg, sizeof msg, "%s needs a value.", f);
            return fail_line(EXIT_BAD_ARGS, "INVALID_ARGUMENT", msg, 0);
        }
        val = argv[++i];
        rc = 0;
        if (strcmp(f, "--in") == 0) a->in = val;
        else if (strcmp(f, "--out") == 0) a->out = val;
        else if (strcmp(f, "--log") == 0) a->log = val;
        else if (strcmp(f, "--metrics") == 0) a->metrics = val;
        else if (strcmp(f, "--policy") == 0) {
            int k, found = 0;
            for (k = 0; k < POLICY_COUNT; k++)
                if (strcmp(val, POLICY_NAMES[k]) == 0) { a->cfg.policy = (PolicyKind)k; found = 1; }
            if (!found) {
                snprintf(msg, sizeof msg, "unknown policy '%.40s'; use fcfs, priority, sjf, aging, reserve or knapsack.", val);
                return fail_line(EXIT_BAD_ARGS, "INVALID_ARGUMENT", msg, 0);
            }
        }
        else if (strcmp(f, "--cpu") == 0) rc = int_flag(f, val, APRM_CPU_CAP_MIN, APRM_CPU_CAP_MAX, &a->cfg.cpu_cap);
        else if (strcmp(f, "--mem") == 0) rc = int_flag(f, val, APRM_MEM_CAP_MIN, APRM_MEM_CAP_MAX, &a->cfg.mem_cap);
        else if (strcmp(f, "--alpha-milli") == 0)
            rc = int_flag(f, val, APRM_ALPHA_MILLI_MIN, APRM_ALPHA_MILLI_MAX, &a->cfg.alpha_milli);
        else if (strcmp(f, "--threshold") == 0)
            rc = int_flag(f, val, APRM_RESERVE_T_MIN, APRM_RESERVE_T_MAX, &a->cfg.reserve_threshold);
        else rc = eps_flag(val, &a->cfg.knapsack_eps);   /* --eps */
        if (rc != 0) return rc;
    }
    if (a->help) return 0;
    if (a->exact) return fail_line(EXIT_BAD_ARGS, "INVALID_ARGUMENT", "exact solver not built yet", 0);
    if (a->in == NULL) return fail_line(EXIT_BAD_ARGS, "INVALID_ARGUMENT", "missing --in (the jobs.csv file).", 0);
    if (a->out == NULL) return fail_line(EXIT_BAD_ARGS, "INVALID_ARGUMENT", "missing --out (the results.csv file).", 0);
    if (a->in[0] == '\0' || a->out[0] == '\0' || (a->log && a->log[0] == '\0') || (a->metrics && a->metrics[0] == '\0'))
        return fail_line(EXIT_BAD_ARGS, "INVALID_ARGUMENT", "a file name must not be empty.", 0);
    /* Two outputs with one name would overwrite each other. */
    if ((a->log && strcmp(a->log, a->out) == 0) || (a->metrics && strcmp(a->metrics, a->out) == 0) ||
        (a->log && a->metrics && strcmp(a->log, a->metrics) == 0) || strcmp(a->in, a->out) == 0 ||
        (a->log && strcmp(a->log, a->in) == 0) || (a->metrics && strcmp(a->metrics, a->in) == 0))
        return fail_line(EXIT_BAD_ARGS, "INVALID_ARGUMENT", "--in, --out, --log and --metrics must be different files.", 0);
    return 0;
}

/* Reads the whole file `path` into a malloc'd, NUL-terminated buffer.
 * Reads at most MAX_INPUT_BYTES; a longer file is an error. Detects open and
 * read errors (a directory fails at fread). On success *buf is owned by the
 * caller (free). Returns 0 or EXIT_INPUT/EXIT_INTERNAL (error printed).
 * O(file size) time and space (the buffer doubles). */
static int read_input(const char *path, char **buf, size_t *len)
{
    char msg[256];
    size_t cap = 4096, n = 0;
    char *p = malloc(cap);
    FILE *f;
    *buf = NULL;
    *len = 0;
    if (p == NULL) return fail_line(EXIT_INTERNAL, "OUT_OF_MEMORY", "Out of memory.", 0);
    f = fopen(path, "rb");
    if (f == NULL) {
        snprintf(msg, sizeof msg, "cannot open input file '%.120s': %s.", path, strerror(errno));
        free(p);
        return fail_line(EXIT_INPUT, "INVALID_ARGUMENT", msg, 0);
    }
    for (;;) {
        size_t got;
        if (n + 1 >= cap) {                       /* keep room for the NUL */
            char *g;
            if (cap > MAX_INPUT_BYTES) break;     /* already past the limit: handled below */
            cap *= 2;
            g = realloc(p, cap);
            if (g == NULL) {
                fclose(f);
                free(p);
                return fail_line(EXIT_INTERNAL, "OUT_OF_MEMORY", "Out of memory.", 0);
            }
            p = g;
        }
        got = fread(p + n, 1, cap - 1 - n, f);
        n += got;
        if (n > MAX_INPUT_BYTES) {
            fclose(f);
            free(p);
            snprintf(msg, sizeof msg, "input file '%.120s' is larger than %zu MiB.", path, MAX_INPUT_BYTES / (1024 * 1024));
            return fail_line(EXIT_INPUT, "INVALID_ARGUMENT", msg, 0);
        }
        if (got == 0 || feof(f)) break;
    }
    if (ferror(f)) {
        snprintf(msg, sizeof msg, "cannot read input file '%.120s': %s.", path, strerror(errno));
        fclose(f);
        free(p);
        return fail_line(EXIT_INPUT, "INVALID_ARGUMENT", msg, 0);
    }
    fclose(f);
    p[n] = '\0';
    *buf = p;
    *len = n;
    return 0;
}

/* Writes data[0..len) to "<path>.tmp". Returns 0, or EXIT_INTERNAL after
 * printing the error (the temp file is removed). O(len). */
static int write_temp(const char *path, const char *data, size_t len)
{
    char tmp[1100], msg[1300];
    FILE *f;
    int ok;
    if (snprintf(tmp, sizeof tmp, "%s.tmp", path) >= (int)sizeof tmp)
        return fail_line(EXIT_INTERNAL, "INVALID_ARGUMENT", "output file name is too long.", 0);
    f = fopen(tmp, "wb");
    if (f == NULL) {
        snprintf(msg, sizeof msg, "cannot write '%.200s': %s.", tmp, strerror(errno));
        return fail_line(EXIT_INTERNAL, "INVALID_ARGUMENT", msg, 0);
    }
    ok = (len == 0 || fwrite(data, 1, len, f) == len);
    ok = (fflush(f) == 0) && ok;
    ok = (fclose(f) == 0) && ok;
    if (!ok) {
        snprintf(msg, sizeof msg, "cannot write '%.200s': %s.", tmp, strerror(errno));
        remove(tmp);
        return fail_line(EXIT_INTERNAL, "INVALID_ARGUMENT", msg, 0);
    }
    return 0;
}

/* Renames "<path>.tmp" over path. Returns 0 or EXIT_INTERNAL. O(1). */
static int commit_temp(const char *path)
{
    char tmp[1100], msg[1300];
    snprintf(tmp, sizeof tmp, "%s.tmp", path);
    if (rename(tmp, path) != 0) {
        snprintf(msg, sizeof msg, "cannot replace '%.200s': %s.", path, strerror(errno));
        remove(tmp);
        return fail_line(EXIT_INTERNAL, "INVALID_ARGUMENT", msg, 0);
    }
    return 0;
}

/* Deletes "<path>.tmp" if it exists (ignores errors). O(1). */
static void remove_temp(const char *path)
{
    char tmp[1100];
    if (snprintf(tmp, sizeof tmp, "%s.tmp", path) < (int)sizeof tmp) remove(tmp);
}

/* Exit code for a sim_add_job failure (D54): OUT_OF_MEMORY and anything
 * unexpected are internal (4); the rest are an invalid job (3). */
static int add_exit_code(int rc)
{
    switch (rc) {
    case APRM_INVALID_FIELD:
    case APRM_CAPACITY_EXCEEDED:
    case APRM_ARRIVAL_IN_PAST:
    case APRM_DUPLICATE_ID:
    case APRM_LIMIT_REACHED:
        return EXIT_INVALID_JOB;
    default:
        return EXIT_INTERNAL;
    }
}

/* Builds the --log text: the sentence of every log entry, one per line.
 * Returns 0 or EXIT_INTERNAL. O(entries). */
static int build_log_text(const Sim *s, CsvText *out)
{
    int64_t i, n = sim_log_count(s);
    char line[LOG_MSG_MAX + 1];
    for (i = 0; i < n; i++) {
        size_t w = sim_log_message(s, i, line, LOG_MSG_MAX);
        line[w] = '\n';
        if (csv_text_append(out, line, w + 1) != APRM_OK)
            return fail_line(EXIT_INTERNAL, "OUT_OF_MEMORY", "Out of memory.", 0);
    }
    return 0;
}

/* Runs the whole job. Returns the exit code. All resources are released
 * before it returns. */
static int run(const Args *a)
{
    int exit_code = EXIT_OK, rc;
    char *text = NULL;
    size_t text_len = 0;
    Job *jobs = NULL;
    int64_t n_jobs = 0, i, n_rows = 0;
    CsvError cerr;
    Sim *sim = NULL;
    ResultRow *rows = NULL;
    CsvText results, logtxt, mettxt;
    JsonBuf metrics;
    char msg[256];

    csv_text_init(&results);
    csv_text_init(&logtxt);
    csv_text_init(&mettxt);
    json_init(&metrics);

    if ((exit_code = read_input(a->in, &text, &text_len)) != 0) goto done;

    rc = csv_read_jobs(text, text_len, a->cfg.max_jobs, &jobs, &n_jobs, &cerr);
    if (rc != APRM_OK) {
        /* PARSE_ERROR keeps exit 2 (PRD section 5); a field outside its range
         * or too many jobs is an invalid job (3, D54); memory is 4. The
         * reader's message already contains "Line N". */
        exit_code = rc == APRM_PARSE_ERROR ? EXIT_INPUT : rc == APRM_OUT_OF_MEMORY ? EXIT_INTERNAL
                    : add_exit_code(rc);
        fail_line(exit_code, code_name(rc), cerr.message, 0);
        goto done;
    }

    rc = sim_create(&a->cfg, &sim);
    if (rc != APRM_OK) {
        exit_code = fail_line(EXIT_INTERNAL, code_name(rc), "cannot create the simulation.", 0);
        goto done;
    }

    /* All-or-nothing: the first rejected job stops the run (D54). */
    for (i = 0; i < n_jobs; i++) {
        rc = sim_add_job(sim, &jobs[i]);
        if (rc != APRM_OK) {
            const SimError *e = sim_last_error(sim);
            if (rc == APRM_LIMIT_REACHED) {
                snprintf(msg, sizeof msg, "too many jobs; the console program accepts at most %d.", APRM_MAX_JOBS_CLI);
                exit_code = fail_line(EXIT_INVALID_JOB, code_name(rc), msg, csv_job_line(i));
            } else {
                exit_code = fail_line(add_exit_code(rc), code_name(rc),
                                      e != NULL && e->message[0] != '\0' ? e->message : "job rejected.",
                                      csv_job_line(i));
            }
            goto done;
        }
    }

    while ((rc = sim_step(sim)) == 1) { }
    if (rc < 0) {
        const SimError *e = sim_last_error(sim);
        if (rc == APRM_INVALID_ARGUMENT && e != NULL && strcmp(e->field, "policy") == 0) {
            snprintf(msg, sizeof msg, "policy %s is not implemented yet.", POLICY_NAMES[a->cfg.policy]);
            exit_code = fail_line(EXIT_INTERNAL, code_name(rc), msg, 0);
        } else {
            exit_code = fail_line(EXIT_INTERNAL, code_name(rc), e != NULL && e->message[0] != '\0' ? e->message : "simulation failed.", 0);
        }
        goto done;
    }

    /* Build every output in memory first. */
    rc = sim_results_rows(sim, &rows, &n_rows);
    if (rc == APRM_OK) rc = csv_write_results(&results, rows, n_rows);
    if (rc == APRM_OK && a->metrics != NULL) rc = sim_metrics_json(sim, &metrics);
    if (rc != APRM_OK) {
        exit_code = fail_line(EXIT_INTERNAL, code_name(rc), "cannot build the results.", 0);
        goto done;
    }
    if (a->log != NULL && (exit_code = build_log_text(sim, &logtxt)) != 0) goto done;

    /* Write to temp names, then rename: either every file is replaced or
     * none is. (A rename can still fail after another succeeded; that is
     * reported as an internal error.) */
    if (a->metrics != NULL) {
        if (csv_text_append(&mettxt, json_cstr(&metrics), json_len(&metrics)) != APRM_OK ||
            csv_text_append(&mettxt, "\n", 1) != APRM_OK) {
            exit_code = fail_line(EXIT_INTERNAL, "OUT_OF_MEMORY", "Out of memory.", 0);
            goto done;
        }
    }
    if ((exit_code = write_temp(a->out, results.data, results.len)) != 0) goto cleanup_temps;
    if (a->log != NULL && (exit_code = write_temp(a->log, logtxt.data, logtxt.len)) != 0) goto cleanup_temps;
    if (a->metrics != NULL && (exit_code = write_temp(a->metrics, mettxt.data, mettxt.len)) != 0) goto cleanup_temps;
    if ((exit_code = commit_temp(a->out)) != 0) goto cleanup_temps;
    if (a->log != NULL && (exit_code = commit_temp(a->log)) != 0) goto cleanup_temps;
    if (a->metrics != NULL && (exit_code = commit_temp(a->metrics)) != 0) goto cleanup_temps;
    goto done;

cleanup_temps:
    remove_temp(a->out);
    if (a->log != NULL) remove_temp(a->log);
    if (a->metrics != NULL) remove_temp(a->metrics);

done:
    free(rows);
    free(jobs);
    free(text);
    sim_destroy(sim);
    csv_text_free(&results);
    csv_text_free(&logtxt);
    csv_text_free(&mettxt);
    json_free(&metrics);
    return exit_code;
}

/* Entry point: parse the arguments, then run. */
int main(int argc, char **argv)
{
    Args a;
    int rc = parse_args(argc, argv, &a);
    if (rc != 0) return rc;
    if (a.help) {
        fputs(USAGE, stdout);
        return EXIT_OK;
    }
    return run(&a);
}
