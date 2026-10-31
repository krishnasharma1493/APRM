/* test_config.c: constants in config.h and types in job.h agree with PRD 3/5. */
#include <stdint.h>
#include "../../core/config.h"
#include "../../core/job.h"
#include "test_main.h"

/* Every min <= default <= max, and sanity of fixed limits. */
static void test_config_ranges(void)
{
    CHECK(APRM_CPU_CAP_MIN <= APRM_CPU_CAP_DEFAULT && APRM_CPU_CAP_DEFAULT <= APRM_CPU_CAP_MAX);
    CHECK(APRM_MEM_CAP_MIN <= APRM_MEM_CAP_DEFAULT && APRM_MEM_CAP_DEFAULT <= APRM_MEM_CAP_MAX);
    CHECK(APRM_PRIORITY_MIN <= APRM_PRIORITY_MAX);
    CHECK(APRM_DURATION_MIN <= APRM_DURATION_MAX);
    CHECK(APRM_ARRIVAL_MIN <= APRM_ARRIVAL_MAX);
    CHECK(APRM_JOB_ID_MIN <= APRM_JOB_ID_MAX);
    CHECK(APRM_ALPHA_MILLI_MIN <= APRM_ALPHA_MILLI_DEFAULT && APRM_ALPHA_MILLI_DEFAULT <= APRM_ALPHA_MILLI_MAX);
    CHECK(APRM_RESERVE_T_MIN <= APRM_RESERVE_T_DEFAULT && APRM_RESERVE_T_DEFAULT <= APRM_RESERVE_T_MAX);
    CHECK(APRM_KNAPSACK_EPS_MIN <= APRM_KNAPSACK_EPS_DEFAULT && APRM_KNAPSACK_EPS_DEFAULT <= APRM_KNAPSACK_EPS_MAX);

    /* PRD 3 values, spelled out so a typo in config.h is caught. */
    CHECK(APRM_CPU_CAP_DEFAULT == 16 && APRM_CPU_CAP_MAX == 1000000);
    CHECK(APRM_MEM_CAP_DEFAULT == 32768 && APRM_MEM_CAP_MAX == 1000000000);
    CHECK(APRM_PRIORITY_MIN == 0 && APRM_PRIORITY_MAX == 9);
    CHECK(APRM_DURATION_MAX == 1000000 && APRM_ARRIVAL_MAX == 1000000000);
    CHECK(APRM_JOB_ID_MAX == INT32_MAX);
    CHECK(APRM_ALPHA_MILLI_DEFAULT == 100 && APRM_ALPHA_MILLI_MAX == 10000);
    CHECK(APRM_RESERVE_T_DEFAULT == 50 && APRM_RESERVE_T_MAX == 1000000);
    CHECK(APRM_KNAPSACK_EPS_DEFAULT == 0.1 && APRM_KNAPSACK_EPS_MIN == 0.01 && APRM_KNAPSACK_EPS_MAX == 1);
    CHECK(APRM_JOB_ID_MIN == 0 && APRM_ARRIVAL_MIN == 0 && APRM_DURATION_MIN == 1);
    CHECK(APRM_ALPHA_MILLI_MIN == 0 && APRM_RESERVE_T_MIN == 0);
    CHECK(APRM_EXACT_MAX_JOBS == 9);
    CHECK(APRM_MAX_JOBS_CLI == 1000000 && APRM_MAX_JOBS_WEB == 5000);
}

/* Codes are 0 and -1 .. -9, all distinct. */
static void test_error_codes(void)
{
    const int codes[] = { APRM_INVALID_ARGUMENT, APRM_INVALID_FIELD,
        APRM_CAPACITY_EXCEEDED, APRM_ARRIVAL_IN_PAST, APRM_DUPLICATE_ID,
        APRM_LIMIT_REACHED, APRM_OUT_OF_MEMORY, APRM_PARSE_ERROR, APRM_TOO_LARGE };
    int i, j;
    CHECK(APRM_OK == 0);
    for (i = 0; i < 9; i++) {
        CHECK(codes[i] == -(i + 1));
        for (j = i + 1; j < 9; j++)
            CHECK(codes[i] != codes[j]);
    }
}

/* Field types match PRD 5: 64-bit times and sizes, 32-bit id and priority. */
static void test_job_types(void)
{
    Job j;
    SimConfig c;
    CHECK(sizeof(j.id) == 4 && sizeof(j.priority) == 4);
    CHECK(sizeof(j.arrival) == 8 && sizeof(j.duration) == 8);
    CHECK(sizeof(j.cpu) == 8 && sizeof(j.mem) == 8);
    CHECK(sizeof(c.cpu_cap) == 8 && sizeof(c.mem_cap) == 8);
    CHECK(sizeof(c.alpha_milli) == 8 && sizeof(c.reserve_threshold) == 8);
    CHECK(sizeof(c.max_jobs) == 8 && sizeof(c.knapsack_eps) == 8);
    CHECK((int)POL_FCFS == 0 && (int)POL_KNAPSACK == 5);
}

int main(void)
{
    test_config_ranges();
    test_error_codes();
    test_job_types();
    return TEST_REPORT();
}
