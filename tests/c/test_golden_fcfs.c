/* test_golden_fcfs.c: runs every FCFS golden case (tests/cases/fcfs_*.csv,
 * worked by hand in K-07) through the C API and compares the whole results
 * file with <case>.fcfs.expected.csv, byte for byte (K-09).
 *
 * Test code may read files; core/ may not, so the files are read here and
 * handed to the core as text. The test must be run from the repository root
 * (make does); it also tries ../ and ../../ so running the binary from
 * build/ works. Machine for every case: 16 cores, 32768 MB (tests/cases/README.md).
 * A case with a <case>.expected.exit file is a console-level case (D54), not
 * a schedule, and is skipped here. */
#define _POSIX_C_SOURCE 200809L  /* opendir */
#define APRM_ENGINE_INTERNAL
#include <dirent.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../../core/config.h"
#include "../../core/csv.h"
#include "../../core/engine_internal.h"
#include "test_main.h"

#define MAX_CASES 256

static const char *const DIRS[] = { "tests/cases", "../tests/cases", "../../tests/cases",
                                    "../../../tests/cases" };
static const char *cases_dir = NULL;

/* Read a whole file into a malloc'd NUL-terminated string; NULL if missing. */
static char *read_file(const char *path, size_t *len_out)
{
    FILE *f = fopen(path, "rb");
    char *buf;
    long n;
    size_t got;
    if (!f) return NULL;
    if (fseek(f, 0, SEEK_END) != 0 || (n = ftell(f)) < 0 || fseek(f, 0, SEEK_SET) != 0) {
        fclose(f);
        return NULL;
    }
    buf = malloc((size_t)n + 1);
    if (!buf) { fclose(f); return NULL; }
    got = fread(buf, 1, (size_t)n, f);
    fclose(f);
    buf[got] = '\0';
    if (len_out) *len_out = got;
    return buf;
}

static int cmp_str(const void *a, const void *b)
{
    return strcmp(*(char *const *)a, *(char *const *)b);
}

static int cmp_row_id(const void *a, const void *b)
{
    const ResultRow *x = a, *y = b;
    return (x->id > y->id) - (x->id < y->id);
}

/* Run one case; name is e.g. "fcfs_basic". Returns after recording CHECKs. */
static void run_case(const char *name)
{
    char path[512], *in, *want;
    size_t in_len, want_len;
    Job *jobs = NULL;
    int64_t n = 0, i;
    CsvError cerr;
    SimConfig cfg;
    Sim *s = NULL;
    ResultRow *rows;
    CsvText out;
    int steps = 0, rc;

    snprintf(path, sizeof path, "%s/%s.expected.exit", cases_dir, name);
    in = read_file(path, NULL);
    if (in) { free(in); printf("skip %s (console-level case)\n", name); return; }

    snprintf(path, sizeof path, "%s/%s.csv", cases_dir, name);
    in = read_file(path, &in_len);
    snprintf(path, sizeof path, "%s/%s.fcfs.expected.csv", cases_dir, name);
    want = read_file(path, &want_len);
    if (!in || !want) {
        printf("FAIL: cannot read input or expected file for %s\n", name);
        CHECK(in != NULL && want != NULL);
        free(in); free(want);
        return;
    }

    memset(&cfg, 0, sizeof cfg);
    cfg.cpu_cap = APRM_CPU_CAP_DEFAULT; cfg.mem_cap = APRM_MEM_CAP_DEFAULT;
    cfg.policy = POL_FCFS; cfg.alpha_milli = APRM_ALPHA_MILLI_DEFAULT;
    cfg.reserve_threshold = APRM_RESERVE_T_DEFAULT; cfg.knapsack_eps_milli = APRM_KNAPSACK_EPS_MILLI_DEFAULT;
    cfg.max_jobs = APRM_MAX_JOBS_CLI;

    CHECK(csv_read_jobs(in, in_len, cfg.max_jobs, &jobs, &n, &cerr) == APRM_OK);
    CHECK(sim_create(&cfg, &s) == APRM_OK);
    for (i = 0; i < n; i++) CHECK(sim_add_job(s, &jobs[i]) == APRM_OK);
    while ((rc = sim_step(s)) == 1 && steps < 100000) steps++;
    CHECK(rc == 0);
    CHECK(s->n_finished == n);

    rows = malloc((size_t)(n > 0 ? n : 1) * sizeof *rows);
    CHECK(rows != NULL);
    for (i = 0; rows && i < n; i++) {
        const RunEntry *r = &s->fin[i];
        rows[i].id = r->job.id; rows[i].arrival = r->job.arrival;
        rows[i].start = r->start; rows[i].finish = r->finish;
        rows[i].wait = r->start - r->job.arrival;
        rows[i].turnaround = r->finish - r->job.arrival;
        rows[i].priority = r->job.priority; rows[i].cpu = r->job.cpu; rows[i].mem = r->job.mem;
    }
    if (rows) qsort(rows, (size_t)n, sizeof *rows, cmp_row_id);  /* results are sorted by id */
    csv_text_init(&out);
    CHECK(rows && csv_write_results(&out, rows, n) == APRM_OK);
    if (!out.data || strcmp(out.data, want) != 0) {
        printf("MISMATCH in %s\n--- got\n%s--- want\n%s", name, out.data ? out.data : "(null)", want);
        CHECK(0);
    } else {
        CHECK(1);
        printf("ok   %s (%lld jobs)\n", name, (long long)n);
    }
    csv_text_free(&out);
    free(rows); free(jobs); free(in); free(want);
    sim_destroy(s);
}

int main(void)
{
    char *names[MAX_CASES];
    size_t n_names = 0, i, k;
    DIR *d = NULL;
    struct dirent *e;

    for (k = 0; k < sizeof DIRS / sizeof DIRS[0] && !d; k++)
        if ((d = opendir(DIRS[k])) != NULL) cases_dir = DIRS[k];
    CHECK(d != NULL);
    if (!d) { printf("cannot find tests/cases (run from the repository root)\n"); return TEST_REPORT(); }

    while ((e = readdir(d)) != NULL && n_names < MAX_CASES) {
        size_t L = strlen(e->d_name);
        if (strncmp(e->d_name, "fcfs_", 5) == 0 && L > 9 && strcmp(e->d_name + L - 4, ".csv") == 0
            && strstr(e->d_name, ".expected.") == NULL) {
            names[n_names] = malloc(L - 3);
            if (!names[n_names]) { CHECK(0); break; }
            memcpy(names[n_names], e->d_name, L - 4);
            names[n_names][L - 4] = '\0';
            n_names++;
        }
    }
    closedir(d);
    qsort(names, n_names, sizeof names[0], cmp_str);  /* fixed order */

    CHECK(n_names >= 4);  /* K-07 shipped four FCFS cases; never pass by finding none */
    for (i = 0; i < n_names; i++) { run_case(names[i]); free(names[i]); }
    return TEST_REPORT();
}
