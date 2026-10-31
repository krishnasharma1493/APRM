/* test_csv.c: jobs.csv reader and results.csv writer (K-05). */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../../core/csv.h"
#include "test_main.h"

#define H "id,arrival,duration,cpu,mem,priority\n"

/* Reads a NUL-terminated string; fills the output arguments. */
static int rd(const char *s, int64_t max, Job **jobs, int64_t *n, CsvError *e)
{
    return csv_read_jobs(s, strlen(s), max, jobs, n, e);
}

/* Expects an error: code, line, column; checks *out NULL and *n 0. */
static void expect_err(const char *s, int code, int64_t line, const char *col)
{
    Job *j = (Job *)1;
    int64_t n = 99;
    CsvError e;
    int rc = rd(s, 100, &j, &n, &e);
    CHECK(rc == code);
    CHECK(e.code == code);
    CHECK(e.line == line);
    CHECK(strcmp(e.column, col) == 0);
    CHECK(j == NULL && n == 0);
    CHECK(e.message[0] == 'L');
    if (rc == APRM_OK || j != NULL) free(j);
}

static void test_csv_valid(void)
{
    Job *j = NULL;
    int64_t n = 0;
    CsvError e;
    CHECK(rd(H "1,0,30,8,20480,2\n2,1,5,2,1024,7\n", 10, &j, &n, &e) == APRM_OK);
    CHECK(n == 2 && j != NULL);
    CHECK(e.code == 0 && e.message[0] == '\0');
    if (n == 2) {
        CHECK(j[0].id == 1 && j[0].arrival == 0 && j[0].duration == 30 && j[0].cpu == 8 &&
              j[0].mem == 20480 && j[0].priority == 2);
        CHECK(j[1].id == 2 && j[1].arrival == 1 && j[1].duration == 5 && j[1].cpu == 2 &&
              j[1].mem == 1024 && j[1].priority == 7);
    }
    free(j);

    /* No final newline; boundary values; header only; more than 16 rows (growth). */
    CHECK(rd(H "2147483647,1000000000,1000000,1,1,9", 10, &j, &n, &e) == APRM_OK);
    CHECK(n == 1 && j[0].id == INT32_MAX && j[0].arrival == 1000000000 && j[0].duration == 1000000 && j[0].priority == 9);
    free(j);
    CHECK(rd(H, 10, &j, &n, &e) == APRM_OK);
    CHECK(n == 0 && j == NULL);
    char big[4096] = H;
    for (int i = 0; i < 40; i++) {
        char row[64];
        snprintf(row, sizeof row, "%d,%d,1,1,1,0\n", i, i);
        strcat(big, row);
    }
    CHECK(rd(big, 100, &j, &n, &e) == APRM_OK);
    CHECK(n == 40 && j[39].id == 39);
    free(j);
}

static void test_csv_missing_header(void)
{
    expect_err("1,0,30,8,20480,2\n", APRM_PARSE_ERROR, 1, "");
    expect_err("", APRM_PARSE_ERROR, 1, "");
    expect_err("id,arrival,duration,cpu,mem\n", APRM_PARSE_ERROR, 1, "");
    expect_err("ID,arrival,duration,cpu,mem,priority\n", APRM_PARSE_ERROR, 1, "");
    expect_err("id,arrival,duration,cpu,mem,priority,\n", APRM_PARSE_ERROR, 1, "");
}

static void test_csv_wrong_columns(void)
{
    expect_err(H "1,0,30,8,20480\n", APRM_PARSE_ERROR, 2, "");
    expect_err(H "1,0,30,8,20480,2,5\n", APRM_PARSE_ERROR, 2, "");
    expect_err(H "1,0,30,8,20480,2,\n", APRM_PARSE_ERROR, 2, "");   /* trailing comma */
    expect_err(H "1,0,30,8,20480,2\n3,4\n", APRM_PARSE_ERROR, 3, "");
    /* Columns out of order: header differs. */
    expect_err("arrival,id,duration,cpu,mem,priority\n1,0,30,8,20480,2\n", APRM_PARSE_ERROR, 1, "");
    expect_err(H "\n", APRM_PARSE_ERROR, 2, "");                    /* empty line */
    expect_err(H "1,0,30,8,20480,2\n\n2,1,5,2,1024,7\n", APRM_PARSE_ERROR, 3, "");
    expect_err(H "1,0,30,8,20480,2\n\n", APRM_PARSE_ERROR, 3, "");  /* only ONE final newline is ignored */
}

static void test_csv_not_number(void)
{
    expect_err(H "1,0,30,8a,20480,2\n", APRM_PARSE_ERROR, 2, "cpu");
    expect_err(H "1,0,30,1.5,20480,2\n", APRM_PARSE_ERROR, 2, "cpu");
    expect_err(H "1,0,30,1e3,20480,2\n", APRM_PARSE_ERROR, 2, "cpu");
    expect_err(H "1,0,30,,20480,2\n", APRM_PARSE_ERROR, 2, "cpu");
    expect_err(H "1,0,30,+8,20480,2\n", APRM_PARSE_ERROR, 2, "cpu");
    expect_err(H "1,0,30, 8,20480,2\n", APRM_PARSE_ERROR, 2, "cpu");
    expect_err(H "1,0,30,8 ,20480,2\n", APRM_PARSE_ERROR, 2, "cpu");
    expect_err(H "1,0,30,-,20480,2\n", APRM_PARSE_ERROR, 2, "cpu");
    expect_err(H "x,0,30,8,20480,2\n", APRM_PARSE_ERROR, 2, "id");
    expect_err(H "1,0,30,8,20480,\n", APRM_PARSE_ERROR, 2, "priority");
    expect_err(H "1,0,30,8,20480,2\n2,1,5,2,0x10,7\n", APRM_PARSE_ERROR, 3, "mem");
}

static void test_csv_overflow(void)
{
    expect_err(H "1,99999999999999999999,30,8,20480,2\n", APRM_PARSE_ERROR, 2, "arrival");
    expect_err(H "1,9223372036854775808,30,8,20480,2\n", APRM_PARSE_ERROR, 2, "arrival");
    /* INT64_MAX itself parses, then fails the range check. */
    expect_err(H "1,9223372036854775807,30,8,20480,2\n", APRM_INVALID_FIELD, 2, "arrival");
    Job *j;
    int64_t n;
    CsvError e;
    CHECK(rd(H "1,99999999999999999999,30,8,20480,2\n", 10, &j, &n, &e) == APRM_PARSE_ERROR);
    CHECK(strcmp(e.message, "Line 2, column arrival: number too large.") == 0);
}

static void test_csv_ranges(void)
{
    expect_err(H "1,0,30,8,20480,10\n", APRM_INVALID_FIELD, 2, "priority");
    expect_err(H "1,0,30,8,20480,-1\n", APRM_INVALID_FIELD, 2, "priority");
    expect_err(H "1,0,0,8,20480,2\n", APRM_INVALID_FIELD, 2, "duration");
    expect_err(H "1,0,1000001,8,20480,2\n", APRM_INVALID_FIELD, 2, "duration");
    expect_err(H "1,-1,30,8,20480,2\n", APRM_INVALID_FIELD, 2, "arrival");
    expect_err(H "1,1000000001,30,8,20480,2\n", APRM_INVALID_FIELD, 2, "arrival");
    expect_err(H "-1,0,30,8,20480,2\n", APRM_INVALID_FIELD, 2, "id");
    expect_err(H "2147483648,0,30,8,20480,2\n", APRM_INVALID_FIELD, 2, "id");
    expect_err(H "1,0,30,0,20480,2\n", APRM_INVALID_FIELD, 2, "cpu");
    expect_err(H "1,0,30,8,0,2\n", APRM_INVALID_FIELD, 2, "mem");
    Job *j;
    int64_t n;
    CsvError e;
    CHECK(rd(H "1,0,30,8,20480,2\n12,0,30,8,20480,10\n", 10, &j, &n, &e) == APRM_INVALID_FIELD);
    CHECK(strcmp(e.message, "Line 3, column priority: must be 0 to 9.") == 0);
    CHECK(j == NULL);   /* the valid first row is not leaked or returned */
}

static void test_csv_long_line(void)
{
    char *s = malloc(10100);
    CHECK(s != NULL);
    if (s == NULL) return;
    strcpy(s, H "1,0,30,8,20480,2\n");
    size_t k = strlen(s);
    memset(s + k, '1', 10000);
    strcpy(s + k + 10000, "\n");
    expect_err(s, APRM_PARSE_ERROR, 3, "");
    /* A long header line is also rejected, as line 1. */
    memset(s, 'a', 300);
    strcpy(s + 300, "\n");
    expect_err(s, APRM_PARSE_ERROR, 1, "");
    /* Exactly CSV_MAX_LINE bytes is accepted by the length rule (here: not a number). */
    strcpy(s, H);
    k = strlen(s);
    memset(s + k, '1', CSV_MAX_LINE);
    strcpy(s + k + CSV_MAX_LINE, "\n");
    Job *j;
    int64_t n;
    CsvError e;
    CHECK(rd(s, 10, &j, &n, &e) == APRM_PARSE_ERROR);
    CHECK(strstr(e.message, "too long") == NULL);
    memset(s + k, '1', CSV_MAX_LINE + 1);
    strcpy(s + k + CSV_MAX_LINE + 1, "\n");
    CHECK(rd(s, 10, &j, &n, &e) == APRM_PARSE_ERROR);
    CHECK(strstr(e.message, "too long") != NULL);
    free(s);
}

static void test_csv_crlf(void)
{
    Job *j = NULL;
    int64_t n = 0;
    CsvError e;
    CHECK(rd("id,arrival,duration,cpu,mem,priority\r\n1,0,30,8,20480,2\r\n2,1,5,2,1024,7\r\n", 10, &j, &n, &e) == APRM_OK);
    CHECK(n == 2 && j[1].priority == 7 && j[0].mem == 20480);
    free(j);
    /* Lone CR inside a line is a bad character. */
    expect_err(H "1,0,30,8,2\r0480,2\n", APRM_PARSE_ERROR, 2, "mem");
    /* Error line numbers count CRLF lines correctly. */
    expect_err("id,arrival,duration,cpu,mem,priority\r\n1,0,30,8,20480,2\r\n2,1,5,x,1024,7\r\n", APRM_PARSE_ERROR, 3, "cpu");
}

/* csv_job_line: row i is on line i + 2, also with CRLF and a missing final
 * newline, and it matches the line the reader reports for a bad row. */
static void test_csv_job_line(void)
{
    Job *j = NULL;
    int64_t n = 0, i;
    CsvError e;
    CHECK(csv_job_line(0) == 2 && csv_job_line(1) == 3 && csv_job_line(999999) == 1000001);
    CHECK(rd(H "1,0,3,1,1,0\r\n2,0,3,1,1,0\n3,0,3,1,1,0", 10, &j, &n, &e) == APRM_OK && n == 3);
    for (i = 0; i < n; i++) CHECK(j[i].id == (int32_t)(i + 1));
    free(j);
    for (i = 0; i < 4; i++) {
        char text[256], row[40];
        int k;
        snprintf(text, sizeof text, "%s", H);
        for (k = 0; k < 4; k++) {
            snprintf(row, sizeof row, k == i ? "%d,0,3,x,1,0\n" : "%d,0,3,1,1,0\n", k + 1);
            strcat(text, row);
        }
        CHECK(rd(text, 10, &j, &n, &e) == APRM_PARSE_ERROR);
        CHECK(e.line == csv_job_line(i));
    }
}

static void test_csv_limit(void)
{
    Job *j = NULL;
    int64_t n = 0;
    CsvError e;
    const char *three = H "1,0,1,1,1,0\n2,0,1,1,1,0\n3,0,1,1,1,0\n";
    CHECK(rd(three, 3, &j, &n, &e) == APRM_OK && n == 3);
    free(j);
    CHECK(rd(three, 2, &j, &n, &e) == APRM_LIMIT_REACHED);
    CHECK(j == NULL && n == 0 && e.line == 4);
    CHECK(rd(H, 0, &j, &n, &e) == APRM_OK && n == 0);
    CHECK(rd(H "1,0,1,1,1,0\n", 0, &j, &n, &e) == APRM_LIMIT_REACHED);
}

static void test_csv_bad_arguments(void)
{
    Job *j = (Job *)1;
    int64_t n = 5;
    CsvError e;
    CHECK(csv_read_jobs(NULL, 0, 10, &j, &n, &e) == APRM_INVALID_ARGUMENT);
    CHECK(j == NULL && n == 0);
    CHECK(csv_read_jobs(H, strlen(H), -1, &j, &n, &e) == APRM_INVALID_ARGUMENT);
    CHECK(csv_read_jobs(H, strlen(H), 10, NULL, &n, &e) == APRM_INVALID_ARGUMENT);
    CHECK(csv_read_jobs(H, strlen(H), 10, &j, NULL, &e) == APRM_INVALID_ARGUMENT);
    CHECK(csv_read_jobs(H "x\n", strlen(H "x\n"), 10, &j, &n, NULL) == APRM_PARSE_ERROR);   /* err optional */
    /* len is respected: text is not NUL-terminated at len. */
    CHECK(csv_read_jobs(H "1,0,1,1,1,0\n2,0,1,1,1,0\n", strlen(H) + 12, 10, &j, &n, &e) == APRM_OK && n == 1);
    free(j);
}

static void test_csv_text_buffer(void)
{
    CsvText t;
    csv_text_init(&t);
    CHECK(t.data == NULL && t.len == 0);
    CHECK(csv_text_append(&t, "abc", 3) == APRM_OK);
    CHECK(t.len == 3 && strcmp(t.data, "abc") == 0);
    for (int i = 0; i < 1000; i++) CHECK(csv_text_append(&t, "xy", 2) == APRM_OK);
    CHECK(t.len == 2003 && t.data[t.len] == '\0');
    CHECK(csv_text_append(&t, "", 0) == APRM_OK && t.len == 2003);
    CHECK(csv_text_append(NULL, "a", 1) == APRM_INVALID_ARGUMENT);
    CHECK(csv_text_append(&t, NULL, 1) == APRM_INVALID_ARGUMENT);
    CHECK(csv_text_append(&t, "z", (size_t)-1) == APRM_OUT_OF_MEMORY);
    CHECK(t.len == 2003);
    csv_text_free(&t);
    CHECK(t.data == NULL && t.len == 0 && t.cap == 0);
    csv_text_free(&t);
}

static void test_csv_roundtrip(void)
{
    /* The PRD section 5 example, produced from the example input's schedule. */
    const ResultRow rows[2] = {
        {1, 0, 0, 30, 0, 30, 2, 8, 20480},
        {2, 1, 1, 6, 0, 5, 7, 2, 1024},
    };
    const char *expected =
        "id,arrival,start,finish,wait,turnaround,priority,cpu,mem\n"
        "1,0,0,30,0,30,2,8,20480\n"
        "2,1,1,6,0,5,7,2,1024\n";
    CsvText t;
    csv_text_init(&t);
    CHECK(csv_write_results(&t, rows, 2) == APRM_OK);
    CHECK(t.len == strlen(expected) && memcmp(t.data, expected, t.len) == 0);
    csv_text_free(&t);

    /* Zero rows: header only. NULL rows allowed when n == 0. */
    CHECK(csv_write_results(&t, NULL, 0) == APRM_OK);
    CHECK(strcmp(t.data, CSV_RESULTS_HEADER "\n") == 0);
    csv_text_free(&t);

    /* Extreme values print exactly. */
    ResultRow big = {INT32_MAX, INT64_MAX, 0, INT64_MAX, 0, INT64_MAX, 9, INT64_MAX, 1};
    CHECK(csv_write_results(&t, &big, 1) == APRM_OK);
    CHECK(strstr(t.data, "\n2147483647,9223372036854775807,0,9223372036854775807,0,"
                         "9223372036854775807,9,9223372036854775807,1\n") != NULL);

    /* Appends after existing text; bad arguments leave it unchanged. */
    size_t before = t.len;
    CHECK(csv_write_results(&t, NULL, 3) == APRM_INVALID_ARGUMENT);
    CHECK(csv_write_results(&t, rows, -1) == APRM_INVALID_ARGUMENT);
    CHECK(csv_write_results(NULL, rows, 1) == APRM_INVALID_ARGUMENT);
    CHECK(t.len == before);
    csv_text_free(&t);

    /* Written text re-read as columns: first data row has 9 fields. */
    CsvText u;
    csv_text_init(&u);
    CHECK(csv_write_results(&u, rows, 2) == APRM_OK);
    int commas = 0;
    for (const char *p = strchr(u.data, '\n') + 1; *p != '\n'; p++) commas += *p == ',';
    CHECK(commas + 1 == CSV_RESULTS_COLUMNS);
    csv_text_free(&u);
}

int main(void)
{
    test_csv_valid();
    test_csv_missing_header();
    test_csv_wrong_columns();
    test_csv_not_number();
    test_csv_overflow();
    test_csv_ranges();
    test_csv_long_line();
    test_csv_crlf();
    test_csv_job_line();
    test_csv_limit();
    test_csv_bad_arguments();
    test_csv_text_buffer();
    test_csv_roundtrip();
    return TEST_REPORT();
}
