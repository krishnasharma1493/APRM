/* test_null_args.c: K-30 hardening. Every public sim_* entry point, given NULL
 * where a pointer is expected, returns an error code (or a safe zero/NULL) and
 * never touches memory. Run under `make sanitize` this proves no NULL is
 * dereferenced. sim_state_json and sim_results_json had no NULL test before. */
#include <string.h>
#include "engine.h"
#include "test_main.h"

int main(void)
{
    SimConfig c;
    Sim *s = NULL;
    JsonBuf j;
    ResultRow *rows = (ResultRow *)1;
    int64_t n = 7;
    char buf[8];

    memset(&c, 0, sizeof c);
    c.cpu_cap = 4; c.mem_cap = 4; c.policy = POL_FCFS; c.alpha_milli = 100;
    c.reserve_threshold = 1; c.knapsack_eps = 0.1; c.max_jobs = 10;
    CHECK(sim_create(&c, &s) == APRM_OK);
    json_init(&j);

    CHECK(sim_validate_config(NULL, NULL) == APRM_INVALID_ARGUMENT);
    CHECK(sim_step(NULL) == APRM_INVALID_ARGUMENT);
    CHECK(sim_run_until(NULL, 5) == APRM_INVALID_ARGUMENT);
    CHECK(sim_state_json(NULL, &j) == APRM_INVALID_ARGUMENT);
    CHECK(sim_state_json(s, NULL) == APRM_INVALID_ARGUMENT);
    CHECK(sim_results_json(NULL, &j) == APRM_INVALID_ARGUMENT);
    CHECK(sim_results_json(s, NULL) == APRM_INVALID_ARGUMENT);
    CHECK(sim_metrics_json(NULL, &j) == APRM_INVALID_ARGUMENT);
    CHECK(sim_metrics_json(s, NULL) == APRM_INVALID_ARGUMENT);
    CHECK(sim_log_json(NULL, 0, &j) == APRM_INVALID_ARGUMENT);
    CHECK(sim_log_json(s, 0, NULL) == APRM_INVALID_ARGUMENT);
    CHECK(sim_results_rows(NULL, &rows, &n) == APRM_INVALID_ARGUMENT);
    CHECK(rows == NULL && n == 0);              /* outputs are cleared even on error */
    CHECK(sim_results_rows(s, NULL, &n) == APRM_INVALID_ARGUMENT);
    CHECK(sim_results_rows(s, &rows, NULL) == APRM_INVALID_ARGUMENT);
    CHECK(sim_log_count(NULL) == 0);
    CHECK(sim_log_message(NULL, 0, buf, sizeof buf) == 0);
    CHECK(sim_log_message(s, 0, NULL, sizeof buf) == 0);
    CHECK(sim_log_message(s, 0, buf, 0) == 0);
    CHECK(sim_log_message(s, -1, buf, sizeof buf) == 0);
    CHECK(sim_last_error(NULL) == NULL);
    CHECK(sim_reset(NULL) == APRM_INVALID_ARGUMENT);
    sim_destroy(NULL);

    /* None of the failed calls changed the simulation. */
    CHECK(sim_step(s) == 0);
    CHECK(sim_log_count(s) == 0);

    json_free(&j);
    sim_destroy(s);
    return TEST_REPORT();
}
