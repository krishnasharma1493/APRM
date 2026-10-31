/*
 * test_main.h: minimal check/report helpers for C tests.
 * Each test file is its own executable, so the counters are per-test-program.
 * Usage: CHECK(cond); ... return TEST_REPORT();
 */
#ifndef APRM_TEST_MAIN_H
#define APRM_TEST_MAIN_H

#include <stdio.h>

static int aprm_checks_run = 0;
static int aprm_checks_failed = 0;

/* Evaluate cond once; print file:line on failure; count both outcomes. */
#define CHECK(cond)                                                      \
    do {                                                                 \
        aprm_checks_run++;                                               \
        if (!(cond)) {                                                   \
            aprm_checks_failed++;                                        \
            printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);       \
        }                                                                \
    } while (0)

/* Print the summary and yield the process exit code (0 = all passed). */
#define TEST_REPORT()                                                    \
    (printf("%s: %d checks, %d failed\n", __FILE__, aprm_checks_run,     \
            aprm_checks_failed),                                         \
     aprm_checks_failed == 0 ? 0 : 1)

#endif /* APRM_TEST_MAIN_H */
