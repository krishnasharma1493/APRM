/*
 * native_check.c: a deterministic driver for wasm/api.c built natively under
 * AddressSanitizer and UBSan (no Node, no input files). It calls the exported
 * functions with the boundary values the JavaScript tests use and checks the
 * handle and pointer rules. CI step "native_check"; locally:
 *   cc -std=c11 -Wall -Wextra -Werror -g -fsanitize=address,undefined -Icore \
 *      core/<all .c> wasm/api.c wasm/native_check.c -o build/native_check && build/native_check
 */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int aprm_create(double, double, double, double, double, double);
int aprm_add_job(int, double, double, double, double, double, double);
int aprm_step(int);
int aprm_run_until(int, double);
const char *aprm_state(int);
const char *aprm_log(int, double);
const char *aprm_results(int);
const char *aprm_metrics(int);
const char *aprm_last_error(int);
const char *aprm_exact(int);
int aprm_reset(int);
int aprm_destroy(int);

static int checks;
#define CHECK(c) do { checks++; if (!(c)) { fprintf(stderr, "FAILED line %d: %s\n", __LINE__, #c); exit(1); } } while (0)
#define HAS(s, sub) (strstr((s), (sub)) != NULL)

int main(void)
{
    const double P53 = 9007199254740992.0;
    int a, b, i, hs[64];
    const char *pa, *pb;
    char copy[4096];

    /* lifecycle and reuse */
    a = aprm_create(16, 32768, 0, 100, 50, 0.1);
    b = aprm_create(16, 32768, 0, 100, 50, 0.1);
    CHECK(a >= 1 && b == a + 1);
    CHECK(aprm_destroy(a) == 0);
    CHECK(aprm_create(16, 32768, 0, 100, 50, 0.1) == a);
    CHECK(aprm_destroy(a) == 0);
    CHECK(aprm_destroy(b) == 0);
    CHECK(aprm_destroy(a) == -1);                 /* double destroy */
    CHECK(aprm_step(a) == -1);                    /* use after destroy */
    CHECK(HAS(aprm_last_error(0), "\"code\":-1"));

    /* invalid handles never crash and always give an envelope */
    for (i = -2; i <= 3; i += 5) {
        CHECK(aprm_step(i) == -1);
        CHECK(aprm_add_job(i, 1, 0, 1, 1, 1, 0) == -1);
        CHECK(HAS(aprm_state(i), "\"ok\":false"));
        CHECK(HAS(aprm_log(i, 0), "\"ok\":false"));
        CHECK(HAS(aprm_results(i), "\"ok\":false"));
        CHECK(HAS(aprm_metrics(i), "\"ok\":false"));
        CHECK(HAS(aprm_exact(i), "\"ok\":false"));
    }

    /* create failures: no handle, error under handle 0 (D64) */
    CHECK(aprm_create(NAN, 1, 0, 0, 0, 0.1) == -2);
    CHECK(HAS(aprm_last_error(0), "cpu_cap must be a whole number within 2^53"));
    CHECK(aprm_create(INFINITY, 1, 0, 0, 0, 0.1) == -2);
    CHECK(aprm_create(P53 + 2, 1, 0, 0, 0, 0.1) == -2);
    CHECK(HAS(aprm_last_error(0), "within 2^53"));
    CHECK(aprm_create(P53, 1, 0, 0, 0, 0.1) == -2);   /* passes the number check, engine range says no */
    CHECK(HAS(aprm_last_error(0), "cpu_cap must be 1 to 1000000."));
    CHECK(aprm_create(1.5, 1, 0, 0, 0, 0.1) == -2);
    CHECK(HAS(aprm_last_error(0), "cpu_cap must be a whole number."));
    CHECK(aprm_create(1, 1, 6, 0, 0, 0.1) == -1);
    CHECK(HAS(aprm_last_error(0), "Unknown policy 6."));
    CHECK(aprm_create(1, 1, 0, 0, 0, NAN) == -2);

    /* job number checks and their messages */
    a = aprm_create(4, 100, 0, 100, 50, 0.1);
    CHECK(aprm_add_job(a, P53 + 2, 0, 1, 1, 1, 0) == -2);
    CHECK(HAS(aprm_last_error(a), "id must be a whole number within 2^53"));
    CHECK(aprm_add_job(a, 2147483648.0, 0, 1, 1, 1, 0) == -2);
    CHECK(HAS(aprm_last_error(a), "id does not fit in 32 bits."));
    CHECK(aprm_add_job(a, 1, 0, 1, 1, 1, 2147483648.0) == -2);
    CHECK(HAS(aprm_last_error(a), "priority does not fit in 32 bits."));
    CHECK(aprm_add_job(a, 1, 0, 1, 1, P53, 0) == -3);  /* 2^53 passes the number check; capacity says no */
    CHECK(aprm_add_job(a, 1, 0, 1, 1, P53 + 2, 0) == -2);
    CHECK(aprm_add_job(a, 1, -0.5, 1, 1, 1, 0) == -2);
    CHECK(aprm_add_job(a, 1, 0, 3, 1, 1, 0) == 0);
    CHECK(aprm_add_job(a, 1, 0, 3, 1, 1, 0) == -5);

    /* pointer rules: separate buffers per handle; copy before the next call */
    b = aprm_create(4, 100, 0, 100, 50, 0.1);
    CHECK(aprm_add_job(b, 7, 0, 2, 1, 1, 0) == 0);
    pa = aprm_state(a);
    snprintf(copy, sizeof copy, "%s", pa);
    pb = aprm_state(b);
    CHECK(pa != pb);
    CHECK(strcmp(pa, copy) == 0);                  /* a call on b left a's string alone */
    while (aprm_step(a) > 0) { }
    CHECK(HAS(aprm_results(a), "\"finish\":3"));
    CHECK(HAS(aprm_metrics(a), "\"makespan\":3"));
    CHECK(HAS(aprm_log(a, 0), "\"kind\":\"START\""));
    CHECK(HAS(aprm_exact(a), "\"total_wait\":"));      /* K-33: success envelope */
    CHECK(HAS(aprm_exact(a), "\"schedule\":[{"));
    CHECK(HAS(aprm_exact(a), "\"ok\":true"));
    {
        int c = aprm_create(4, 100, 0, 100, 50, 0.1), k;
        for (k = 0; k < 10; k++) CHECK(aprm_add_job(c, k, 0, 1, 1, 1, 0) == 0);
        CHECK(HAS(aprm_exact(c), "\"code\":-9"));
        CHECK(HAS(aprm_exact(c), "Exact solver supports up to 9 jobs."));
        CHECK(aprm_destroy(c) == 0);
    }
    CHECK(aprm_reset(a) == 0);
    CHECK(HAS(aprm_last_error(a), "\"data\":null"));
    CHECK(aprm_run_until(a, P53 * 2) == -2);
    CHECK(aprm_step(b) == 1);                      /* reset of a did not touch b */

    /* handle table fills at 4096 and recovers */
    CHECK(aprm_destroy(a) == 0);
    CHECK(aprm_destroy(b) == 0);
    for (i = 0; i < 64; i++) hs[i] = aprm_create(1, 1, 0, 0, 0, 0.1);
    for (i = 0; i < 64; i++) CHECK(hs[i] >= 1);
    {
        int n = 64, h;
        int *all = malloc(4200 * sizeof *all);
        CHECK(all != NULL);
        memcpy(all, hs, sizeof hs);
        while ((h = aprm_create(1, 1, 0, 0, 0, 0.1)) > 0) all[n++] = h;
        CHECK(n == 4096 && h == -6);
        CHECK(HAS(aprm_last_error(0), "At most 4096 simulations at once."));
        for (i = 0; i < n; i++) CHECK(aprm_destroy(all[i]) == 0);
        free(all);
    }
    printf("native_check: %d checks passed\n", checks);
    return 0;
}
