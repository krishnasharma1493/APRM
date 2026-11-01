/* test_metrics.c: state, results and metrics JSON and the metrics maths
 * (issue K-11, decisions D61, D62, D63).
 *
 * The golden expectations are literal JSON strings. They were derived by hand
 * from the golden cases fcfs_basic and fcfs_skip (machine 16 cores, 32768 MB);
 * the working is in the comments next to each string. A 1,000-workload test
 * recomputes every metric a second, independent way (128-bit integers in the
 * test only) from the result rows and compares the text exactly. */
#define APRM_ENGINE_INTERNAL
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../../core/config.h"
#include "../../core/csv.h"
#include "../../core/engine_internal.h"
#include "../../core/json.h"
#include "../../core/metrics.h"
#include "test_main.h"

/* ---- helpers ---- */

static SimConfig make_cfg(PolicyKind pol, int64_t cpu, int64_t mem)
{
    SimConfig c;
    c.cpu_cap = cpu;
    c.mem_cap = mem;
    c.policy = pol;
    c.alpha_milli = APRM_ALPHA_MILLI_DEFAULT;
    c.reserve_threshold = APRM_RESERVE_T_DEFAULT;
    c.knapsack_eps = APRM_KNAPSACK_EPS_DEFAULT;
    c.max_jobs = 1000;
    return c;
}

static Sim *make_sim(PolicyKind pol, int64_t cpu, int64_t mem)
{
    SimConfig c = make_cfg(pol, cpu, mem);
    Sim *s = NULL;
    CHECK(sim_create(&c, &s) == APRM_OK);
    return s;
}

static void add(Sim *s, int id, int64_t arr, int64_t dur, int64_t cpu, int64_t mem, int prio)
{
    Job j;
    j.id = id; j.arrival = arr; j.duration = dur; j.cpu = cpu; j.mem = mem; j.priority = prio;
    CHECK(sim_add_job(s, &j) == APRM_OK);
}

/* Golden case fcfs_basic (tests/cases/fcfs_basic.csv). */
static Sim *basic_sim(void)
{
    Sim *s = make_sim(POL_FCFS, 16, 32768);
    add(s, 1, 0, 10, 16, 32768, 0);
    add(s, 2, 2, 5, 8, 16384, 3);
    add(s, 3, 4, 3, 16, 8192, 9);
    return s;
}

/* Golden case fcfs_skip (tests/cases/fcfs_skip.csv). */
static Sim *skip_sim(void)
{
    Sim *s = make_sim(POL_FCFS, 16, 32768);
    add(s, 1, 0, 10, 4, 24000, 2);
    add(s, 2, 1, 6, 4, 16000, 5);
    add(s, 3, 2, 3, 2, 4000, 1);
    return s;
}

static void run_all(Sim *s)
{
    while (sim_step(s) > 0) { }
}

/* The JSON text of one report, copied into a fixed buffer. fn is one of the
 * three sim_*_json functions. Returns the status. */
typedef int (*JsonFn)(const Sim *, JsonBuf *);
static int text_of(JsonFn fn, const Sim *s, char *buf, size_t cap)
{
    JsonBuf j;
    int rc;
    json_init(&j);
    rc = fn(s, &j);
    snprintf(buf, cap, "%s", json_cstr(&j));
    json_free(&j);
    return rc;
}

/* Expect the report to equal the literal text exactly. */
static void expect_json(JsonFn fn, const Sim *s, const char *want, int line)
{
    char got[16384];
    int rc = text_of(fn, s, got, sizeof got);
    aprm_checks_run++;
    if (rc != APRM_OK || strcmp(got, want) != 0) {
        aprm_checks_failed++;
        printf("FAIL %s:%d (rc %d)\n  got : %s\n  want: %s\n", __FILE__, line, rc, got, want);
    }
}
#define EXPECT(fn, s, want) expect_json((fn), (s), (want), __LINE__)

/* Balanced {} [] and quotes, outside and inside strings, with no stray
 * characters: a small validity check (the writer in json.c is tested in
 * test_json.c; this guards the reports built on it). */
static int json_is_balanced(const char *p)
{
    char stack[64];
    int depth = 0, in_str = 0;
    for (; *p; p++) {
        if (in_str) {
            if (*p == '\\') { if (!p[1]) return 0; p++; }
            else if (*p == '"') in_str = 0;
            continue;
        }
        if (*p == '"') in_str = 1;
        else if (*p == '{' || *p == '[') { if (depth >= 64) return 0; stack[depth++] = *p; }
        else if (*p == '}' || *p == ']') {
            if (depth == 0 || stack[depth - 1] != (*p == '}' ? '{' : '[')) return 0;
            depth--;
        } else if (*p == '\n' || *p == ' ') return 0;   /* compact output only */
    }
    return depth == 0 && !in_str;
}

/* Writes into keys the object keys of the JSON text in order of appearance,
 * each followed by ',' (a string followed by ':' is a key). */
static void key_list(const char *p, char *keys, size_t cap)
{
    size_t n = 0;
    keys[0] = '\0';
    while (*p) {
        if (*p == '"') {
            const char *q = p + 1;
            while (*q && *q != '"') q++;
            if (q[1] == ':') {
                size_t len = (size_t)(q - p - 1);
                if (n + len + 2 < cap) {
                    memcpy(keys + n, p + 1, len);
                    n += len;
                    keys[n++] = ',';
                    keys[n] = '\0';
                }
            }
            p = *q ? q + 1 : q;
        } else {
            p++;
        }
    }
}

/* ---- number formatting ---- */

static U128 u(uint64_t v) { U128 r; r.hi = 0; r.lo = v; return r; }

static void expect_ratio(uint64_t num, uint64_t den, uint64_t whole, uint32_t frac, int line)
{
    uint64_t w = 99;
    uint32_t f = 99;
    int ok = metrics_ratio9(u(num), u(den), &w, &f);
    aprm_checks_run++;
    if (!ok || w != whole || f != frac) {
        aprm_checks_failed++;
        printf("FAIL %s:%d: %llu/%llu gave ok=%d %llu.%09u\n", __FILE__, line,
               (unsigned long long)num, (unsigned long long)den, ok,
               (unsigned long long)w, (unsigned)f);
    }
}

static void test_ratio9(void)
{
    uint64_t w = 7;
    uint32_t f = 7;
    U128 big, bigden;
    expect_ratio(1, 3, 0, 333333333, __LINE__);
    expect_ratio(2, 3, 0, 666666667, __LINE__);          /* rounds up */
    expect_ratio(19, 3, 6, 333333333, __LINE__);         /* avg_wait of fcfs_basic */
    expect_ratio(37, 3, 12, 333333333, __LINE__);
    expect_ratio(248, 288, 0, 861111111, __LINE__);
    expect_ratio(0, 5, 0, 0, __LINE__);
    expect_ratio(5, 5, 1, 0, __LINE__);
    expect_ratio(124, 10, 12, 400000000, __LINE__);      /* PRD example 12.4 */
    /* Half up on an exact tie: 1/2e9 = 0.0000000005 -> 0.000000001. */
    expect_ratio(1, 2000000000u, 0, 1, __LINE__);
    /* Just under the tie rounds down: 1/(2e9+1) < 5e-10. */
    expect_ratio(1, 2000000001u, 0, 0, __LINE__);
    /* Carry into the integer part: 1999999999/2000000000 = 0.9999999995 -> 1. */
    expect_ratio(1999999999u, 2000000000u, 1, 0, __LINE__);
    /* 348000 / 524288 = 10875/16384 = 0.66375732421875 exactly (fcfs_skip memory). */
    expect_ratio(348000, 524288, 0, 663757324, __LINE__);
    /* Zero denominator is reported as "no value". */
    CHECK(metrics_ratio9(u(1), u(0), &w, &f) == 0 && w == 7 && f == 7);
    /* Beyond 64 bits: 10^21 / 10^21 = 1 and 3*10^21 / 2*10^21 = 1.5.
     * 10^21 = 54210108624 * 2^64 + 3875820019684212736 (hi, lo). */
    big.hi = 54210108624u; big.lo = 3875820019684212736u;
    CHECK(metrics_ratio9(big, big, &w, &f) == 1 && w == 1 && f == 0);
    bigden.hi = 108420217248u; bigden.lo = 7751640039368425472u;   /* 2 x 10^21 */
    big.hi = 162630325872u; big.lo = 11627460059052638208u;        /* 3 x 10^21 */
    CHECK(metrics_ratio9(big, bigden, &w, &f) == 1 && w == 1 && f == 500000000);
}

static void test_json_fixed9(void)
{
    JsonBuf j;
    json_init(&j);
    json_arr_begin(&j);
    json_fixed9(&j, 12, 400000000u);
    json_fixed9(&j, 0, 0);
    json_fixed9(&j, 0, 999999999u);
    json_arr_end(&j);
    CHECK(strcmp(json_cstr(&j), "[12.400000000,0.000000000,0.999999999]") == 0);
    json_reset(&j);
    json_fixed9(&j, 1, 1000000000u);   /* misuse: frac too large */
    CHECK(json_status(&j) == APRM_INVALID_ARGUMENT);
    json_free(&j);
}

/* ---- golden cases ---- */

static void test_state_shape(void)
{
    Sim *s = basic_sim();
    char got[4096], keys[1024];
    /* Before any step: nothing has arrived. */
    EXPECT(sim_state_json, s,
        "{\"ok\":true,\"data\":{\"now\":0,\"done\":0,\"total\":3,\"cap\":{\"cpu\":16,\"mem\":32768},"
        "\"free\":{\"cpu\":16,\"mem\":32768},\"waiting\":[],\"running\":[],\"reservation\":null}}");
    /* Step 1, t=0: job 1 arrives and takes the whole machine. */
    CHECK(sim_step(s) == 1);
    EXPECT(sim_state_json, s,
        "{\"ok\":true,\"data\":{\"now\":0,\"done\":0,\"total\":3,\"cap\":{\"cpu\":16,\"mem\":32768},"
        "\"free\":{\"cpu\":0,\"mem\":0},\"waiting\":[],"
        "\"running\":[{\"id\":1,\"start\":0,\"finish\":10,\"cpu\":16,\"mem\":32768}],"
        "\"reservation\":null}}");
    /* Step 2, t=2: job 2 arrives and waits. FCFS has no score: null (D63). */
    CHECK(sim_step(s) == 1);
    EXPECT(sim_state_json, s,
        "{\"ok\":true,\"data\":{\"now\":2,\"done\":0,\"total\":3,\"cap\":{\"cpu\":16,\"mem\":32768},"
        "\"free\":{\"cpu\":0,\"mem\":0},"
        "\"waiting\":[{\"id\":2,\"score\":null,\"priority\":3,\"arrival\":2,\"duration\":5,"
        "\"cpu\":8,\"mem\":16384}],"
        "\"running\":[{\"id\":1,\"start\":0,\"finish\":10,\"cpu\":16,\"mem\":32768}],"
        "\"reservation\":null}}");
    /* Step 3, t=4: job 3 joins; best first = job 2 (earlier arrival). */
    CHECK(sim_step(s) == 1);
    CHECK(text_of(sim_state_json, s, got, sizeof got) == APRM_OK);
    key_list(got, keys, sizeof keys);
    CHECK(strcmp(keys,
        "ok,data,now,done,total,cap,cpu,mem,free,cpu,mem,waiting,"
        "id,score,priority,arrival,duration,cpu,mem,"
        "id,score,priority,arrival,duration,cpu,mem,"
        "running,id,start,finish,cpu,mem,reservation,") == 0);
    CHECK(json_is_balanced(got));
    CHECK(strstr(got, "\"waiting\":[{\"id\":2,") != NULL);
    CHECK(strstr(got, "},{\"id\":3,\"score\":null,\"priority\":9,") != NULL);
    CHECK(strstr(got, "\"reservation\":null}}") != NULL);
    /* End of run. */
    run_all(s);
    EXPECT(sim_state_json, s,
        "{\"ok\":true,\"data\":{\"now\":18,\"done\":3,\"total\":3,\"cap\":{\"cpu\":16,\"mem\":32768},"
        "\"free\":{\"cpu\":16,\"mem\":32768},\"waiting\":[],\"running\":[],\"reservation\":null}}");
    sim_destroy(s);
}

static void test_state_skip_case(void)
{
    Sim *s = skip_sim();
    CHECK(sim_step(s) == 1);   /* t=0: job 1 starts */
    CHECK(sim_step(s) == 1);   /* t=1: job 2 needs 16000 MB, only 8768 free: it waits */
    EXPECT(sim_state_json, s,
        "{\"ok\":true,\"data\":{\"now\":1,\"done\":0,\"total\":3,\"cap\":{\"cpu\":16,\"mem\":32768},"
        "\"free\":{\"cpu\":12,\"mem\":8768},"
        "\"waiting\":[{\"id\":2,\"score\":null,\"priority\":5,\"arrival\":1,\"duration\":6,"
        "\"cpu\":4,\"mem\":16000}],"
        "\"running\":[{\"id\":1,\"start\":0,\"finish\":10,\"cpu\":4,\"mem\":24000}],"
        "\"reservation\":null}}");
    CHECK(sim_step(s) == 1);   /* t=2: job 3 fits and starts ahead of the stuck job 2 */
    /* running is ordered by finish: job 3 (5) before job 1 (10). */
    EXPECT(sim_state_json, s,
        "{\"ok\":true,\"data\":{\"now\":2,\"done\":0,\"total\":3,\"cap\":{\"cpu\":16,\"mem\":32768},"
        "\"free\":{\"cpu\":10,\"mem\":4768},"
        "\"waiting\":[{\"id\":2,\"score\":null,\"priority\":5,\"arrival\":1,\"duration\":6,"
        "\"cpu\":4,\"mem\":16000}],"
        "\"running\":[{\"id\":3,\"start\":2,\"finish\":5,\"cpu\":2,\"mem\":4000},"
        "{\"id\":1,\"start\":0,\"finish\":10,\"cpu\":4,\"mem\":24000}],"
        "\"reservation\":null}}");
    sim_destroy(s);
}

static void test_results_sorted(void)
{
    Sim *s = skip_sim();
    ResultRow *rows = NULL;
    int64_t n = 0;
    CsvText txt;
    run_all(s);
    /* Job 3 finishes first (5), then 1 (10), then 2 (16), but results are by id. */
    CHECK(s->fin[0].job.id == 3);
    EXPECT(sim_results_json, s,
        "{\"ok\":true,\"data\":["
        "{\"id\":1,\"arrival\":0,\"start\":0,\"finish\":10,\"wait\":0,\"turnaround\":10,\"priority\":2,\"cpu\":4,\"mem\":24000},"
        "{\"id\":2,\"arrival\":1,\"start\":10,\"finish\":16,\"wait\":9,\"turnaround\":15,\"priority\":5,\"cpu\":4,\"mem\":16000},"
        "{\"id\":3,\"arrival\":2,\"start\":2,\"finish\":5,\"wait\":0,\"turnaround\":3,\"priority\":1,\"cpu\":2,\"mem\":4000}"
        "]}");
    /* The same rows feed csv_write_results and match the golden file. */
    CHECK(sim_results_rows(s, &rows, &n) == APRM_OK && n == 3);
    csv_text_init(&txt);
    CHECK(csv_write_results(&txt, rows, n) == APRM_OK);
    CHECK(strcmp(txt.data,
        "id,arrival,start,finish,wait,turnaround,priority,cpu,mem\n"
        "1,0,0,10,0,10,2,4,24000\n"
        "2,1,10,16,9,15,5,4,16000\n"
        "3,2,2,5,0,3,1,2,4000\n") == 0);
    csv_text_free(&txt);
    free(rows);
    /* Argument checks and the empty case. */
    CHECK(sim_results_rows(NULL, &rows, &n) == APRM_INVALID_ARGUMENT);
    CHECK(sim_results_rows(s, NULL, &n) == APRM_INVALID_ARGUMENT);
    sim_destroy(s);
    s = basic_sim();
    CHECK(sim_results_rows(s, &rows, &n) == APRM_OK && rows == NULL && n == 0);
    EXPECT(sim_results_json, s, "{\"ok\":true,\"data\":[]}");
    sim_destroy(s);
}

static void test_metrics_values(void)
{
    Sim *s = basic_sim();
    run_all(s);
    /* fcfs_basic rows (id: wait, turnaround, finish, priority):
     *   1: 0, 10, 10, p0     2: 8, 13, 15, p3     3: 11, 14, 18, p9
     * avg_wait = (0+8+11)/3 = 19/3 = 6.333333333; max_wait = 11
     * avg_turnaround = (10+13+14)/3 = 37/3 = 12.333333333
     * weighted = 1*10 + 4*15 + 10*18 = 10 + 60 + 180 = 250; makespan = 18
     * busy cpu = 16*10 + 8*5 + 16*3 = 248; capacity x makespan = 16*18 = 288
     *   util_cpu = 248/288 = 31/36 = 0.861111111
     * busy mem = 32768*10 + 16384*5 + 8192*3 = 434176; 32768*18 = 589824
     *   util_mem = 434176/589824 = 53/72 = 0.736111111
     * per priority: p0 0, p3 8, p9 11, every other level has no job: null (D62). */
    EXPECT(sim_metrics_json, s,
        "{\"ok\":true,\"data\":{\"avg_wait\":6.333333333,\"max_wait\":11,"
        "\"avg_turnaround\":12.333333333,\"weighted_completion\":250,\"makespan\":18,"
        "\"util_cpu\":0.861111111,\"util_mem\":0.736111111,"
        "\"avg_wait_by_priority\":[0.000000000,null,null,8.000000000,null,null,null,null,null,"
        "11.000000000]}}");
    sim_destroy(s);

    s = skip_sim();
    run_all(s);
    /* fcfs_skip rows: 1: wait 0, tat 10, finish 10, p2;  2: wait 9, tat 15, finish 16, p5;
     *                 3: wait 0, tat 3, finish 5, p1.
     * avg_wait = 9/3 = 3.000000000; max_wait = 9; avg_turnaround = 28/3 = 9.333333333
     * weighted = 3*10 + 6*16 + 2*5 = 30 + 96 + 10 = 136; makespan = 16
     * busy cpu = 4*10 + 4*6 + 2*3 = 70; 16*16 = 256; 70/256 = 0.2734375 -> 0.273437500
     * busy mem = 24000*10 + 16000*6 + 4000*3 = 348000; 32768*16 = 524288;
     *   348000/524288 = 10875/16384 = 0.66375732421875 -> 0.663757324 (next digit 2: rounds down)
     * per priority: p1 0, p2 0, p5 9. */
    EXPECT(sim_metrics_json, s,
        "{\"ok\":true,\"data\":{\"avg_wait\":3.000000000,\"max_wait\":9,"
        "\"avg_turnaround\":9.333333333,\"weighted_completion\":136,\"makespan\":16,"
        "\"util_cpu\":0.273437500,\"util_mem\":0.663757324,"
        "\"avg_wait_by_priority\":[null,0.000000000,0.000000000,null,null,9.000000000,null,null,"
        "null,null]}}");
    sim_destroy(s);
}

static void test_metrics_shape_keys(void)
{
    Sim *s = basic_sim();
    char got[4096], keys[512];
    run_all(s);
    CHECK(text_of(sim_metrics_json, s, got, sizeof got) == APRM_OK);
    key_list(got, keys, sizeof keys);
    CHECK(strcmp(keys, "ok,data,avg_wait,max_wait,avg_turnaround,weighted_completion,makespan,"
                       "util_cpu,util_mem,avg_wait_by_priority,") == 0);
    CHECK(json_is_balanced(got));
    CHECK(text_of(sim_results_json, s, got, sizeof got) == APRM_OK);
    key_list(got, keys, sizeof keys);
    CHECK(strncmp(keys, "ok,data,id,arrival,start,finish,wait,turnaround,priority,cpu,mem,id,", 30) == 0);
    CHECK(json_is_balanced(got));
    sim_destroy(s);
}

/* Nothing finished yet, and after sim_reset: ratios are null, sums 0 (D62). */
static void test_metrics_empty_and_reset(void)
{
    static const char *const EMPTY =
        "{\"ok\":true,\"data\":{\"avg_wait\":null,\"max_wait\":0,\"avg_turnaround\":null,"
        "\"weighted_completion\":0,\"makespan\":0,\"util_cpu\":null,\"util_mem\":null,"
        "\"avg_wait_by_priority\":[null,null,null,null,null,null,null,null,null,null]}}";
    Sim *s = basic_sim();
    EXPECT(sim_metrics_json, s, EMPTY);
    CHECK(sim_step(s) == 1);   /* a job is running, none has finished */
    EXPECT(sim_metrics_json, s, EMPTY);
    run_all(s);
    CHECK(sim_reset(s) == APRM_OK);
    EXPECT(sim_metrics_json, s, EMPTY);
    EXPECT(sim_results_json, s, "{\"ok\":true,\"data\":[]}");
    sim_destroy(s);
}

/* No job at priority 5 (or most levels): null, not 0 and not a missing entry. */
static void test_empty_priority_level(void)
{
    Sim *s = make_sim(POL_FCFS, 4, 100);
    char got[2048];
    add(s, 1, 0, 3, 4, 100, 4);
    add(s, 2, 0, 3, 4, 100, 6);
    run_all(s);   /* waits: job 1 = 0, job 2 = 3 */
    CHECK(text_of(sim_metrics_json, s, got, sizeof got) == APRM_OK);
    CHECK(strstr(got, "\"avg_wait_by_priority\":[null,null,null,null,0.000000000,null,"
                      "3.000000000,null,null,null]}}") != NULL);
    sim_destroy(s);
}

static void test_weighted_completion(void)
{
    /* One job at a time (each takes the whole machine). Priority 0 job: finish 4,
     * weight 1. Priority 9 job: starts at 4, finish 10, weight 10.
     * weighted = 1*4 + 10*10 = 104. */
    Sim *s = make_sim(POL_FCFS, 16, 32768);
    char got[2048];
    add(s, 1, 0, 4, 16, 32768, 0);
    add(s, 2, 0, 6, 16, 32768, 9);
    run_all(s);
    CHECK(text_of(sim_metrics_json, s, got, sizeof got) == APRM_OK);
    CHECK(strstr(got, "\"weighted_completion\":104,\"makespan\":10,") != NULL);
    sim_destroy(s);
}

/* Utilisation by hand, and the interval rule (D61): [0, makespan]. */
static void test_utilisation(void)
{
    char got[2048];
    Sim *s = make_sim(POL_FCFS, 2, 100);
    /* One job: cpu 1, mem 50, 10 ticks, from 0. busy cpu 10 of 2*10 = 20; mem 500 of 1000. */
    add(s, 1, 0, 10, 1, 50, 0);
    run_all(s);
    CHECK(text_of(sim_metrics_json, s, got, sizeof got) == APRM_OK);
    CHECK(strstr(got, "\"makespan\":10,\"util_cpu\":0.500000000,\"util_mem\":0.500000000,") != NULL);
    sim_destroy(s);

    /* Same job arriving at 5: it runs 5..15. The interval is [0, 15], so the
     * idle first 5 ticks count: 10/(2*15) = 1/3, 500/(100*15) = 1/3. */
    s = make_sim(POL_FCFS, 2, 100);
    add(s, 1, 5, 10, 1, 50, 0);
    run_all(s);
    CHECK(text_of(sim_metrics_json, s, got, sizeof got) == APRM_OK);
    CHECK(strstr(got, "\"makespan\":15,\"util_cpu\":0.333333333,\"util_mem\":0.333333333,") != NULL);
    sim_destroy(s);

    /* A full machine all the time is exactly 1.000000000. */
    s = make_sim(POL_FCFS, 2, 100);
    add(s, 1, 0, 7, 2, 100, 0);
    run_all(s);
    CHECK(text_of(sim_metrics_json, s, got, sizeof got) == APRM_OK);
    CHECK(strstr(got, "\"util_cpu\":1.000000000,\"util_mem\":1.000000000,") != NULL);
    sim_destroy(s);
}

/* Capacity x makespan beyond 64 bits (memory 10^9 MB, makespan about 2 x 10^10):
 * the maths must not overflow. Tested on rows directly. */
static void test_large_resource_time(void)
{
    ResultRow r;
    Metrics m;
    JsonBuf j;
    /* One job: cpu 1, mem 10^9, runs 10^6 ticks from tick 2 x 10^10, so
     * makespan = 20001000000 and den_mem = 10^9 x 20001000000 = 2.0001 x 10^19,
     * which is above 2^64 = 1.8447 x 10^19. busy_mem = 10^9 x 10^6 = 10^15. */
    r.id = 1; r.arrival = 0; r.start = 20000000000LL; r.finish = 20001000000LL;
    r.wait = r.start; r.turnaround = r.finish; r.priority = 9; r.cpu = 1; r.mem = 1000000000;
    CHECK(metrics_from_rows(&r, 1, 1000000, 1000000000, &m) == APRM_OK);
    CHECK(m.den_mem.hi == 1);   /* really beyond 64 bits */
    json_init(&j);
    json_ok_begin(&j);
    metrics_write_json(&m, &j);
    json_ok_end(&j);
    /* util_mem = 10^15 / 2.0001e19 = 0.0000499975001...; nine decimals,
     * the tenth digit is 5 followed by more: rounds up to 0.000049998. */
    CHECK(strstr(json_cstr(&j), "\"util_mem\":0.000049998,") != NULL);
    json_free(&j);
}

static void test_invalid_rows(void)
{
    ResultRow r;
    Metrics m;
    r.id = 1; r.arrival = 5; r.start = 4; r.finish = 9; r.wait = 0; r.turnaround = 0;
    r.priority = 0; r.cpu = 1; r.mem = 1;
    CHECK(metrics_from_rows(&r, 1, 1, 1, &m) == APRM_INVALID_FIELD);   /* start < arrival */
    r.start = 5; r.priority = 10;
    CHECK(metrics_from_rows(&r, 1, 1, 1, &m) == APRM_INVALID_FIELD);
    r.priority = 0; r.finish = INT64_MAX;
    r.arrival = 0; r.start = 0;
    r.priority = 9;   /* (9 + 1) x INT64_MAX overflows */
    CHECK(metrics_from_rows(&r, 1, 1, 1, &m) == APRM_INVALID_FIELD);
    CHECK(metrics_from_rows(NULL, 1, 1, 1, &m) == APRM_INVALID_ARGUMENT);
    CHECK(metrics_from_rows(&r, 0, 0, 1, &m) == APRM_INVALID_ARGUMENT);
    CHECK(sim_metrics_json(NULL, NULL) == APRM_INVALID_ARGUMENT);
}

/* ---- score (D14, D63) and heap order ---- */

static void test_score_milli(void)
{
    /* Aging, alpha_milli 100, a priority-2 job that arrived at 0, now 42:
     * 1000*2 + 100*(42 - 0) = 6200 thousandths = 6.200. The job is put into
     * the waiting heap directly (the aging policy compare arrives in a later
     * issue, so sim_step cannot run it yet). */
    Sim *s = make_sim(POL_AGING, 16, 32768);
    WaitEntry we;
    char got[2048];
    memset(&we, 0, sizeof we);
    we.job.id = 7; we.job.arrival = 0; we.job.duration = 30; we.job.cpu = 8;
    we.job.mem = 20480; we.job.priority = 2;
    s->now = 42;
    s->n_total = 1;
    CHECK(heap_push(&s->waiting, &we) == APRM_OK);
    CHECK(text_of(sim_state_json, s, got, sizeof got) == APRM_OK);
    CHECK(strstr(got, "\"waiting\":[{\"id\":7,\"score\":6.200,\"priority\":2,\"arrival\":0,"
                      "\"duration\":30,\"cpu\":8,\"mem\":20480}]") != NULL);
    /* A job that arrived at 40 with priority 0: 0 + 100*2 = 200 -> 0.200. */
    we.job.id = 8; we.job.arrival = 40; we.job.priority = 0;
    s->n_total = 2;
    CHECK(heap_push(&s->waiting, &we) == APRM_OK);
    CHECK(text_of(sim_state_json, s, got, sizeof got) == APRM_OK);
    CHECK(strstr(got, "\"id\":8,\"score\":0.200,") != NULL);
    sim_destroy(s);

    /* The aging-with-reservation policy shows the same score. */
    s = make_sim(POL_AGING_RESERVE, 16, 32768);
    we.job.id = 7; we.job.arrival = 0; we.job.priority = 2;
    s->now = 42; s->n_total = 1;
    CHECK(heap_push(&s->waiting, &we) == APRM_OK);
    CHECK(text_of(sim_state_json, s, got, sizeof got) == APRM_OK);
    CHECK(strstr(got, "\"score\":6.200,") != NULL);
    sim_destroy(s);

    /* Every other policy: null (D63). */
    {
        PolicyKind others[4] = { POL_FCFS, POL_PRIORITY, POL_SJF, POL_KNAPSACK };
        int i;
        for (i = 0; i < 4; i++) {
            s = make_sim(others[i], 16, 32768);
            s->now = 42; s->n_total = 1;
            CHECK(heap_push(&s->waiting, &we) == APRM_OK);
            CHECK(text_of(sim_state_json, s, got, sizeof got) == APRM_OK);
            CHECK(strstr(got, "\"id\":7,\"score\":null,") != NULL);
            sim_destroy(s);
        }
    }
}

/* waiting comes out best first, and writing the state does not change the
 * heap (not even the byte order of its array). */
static void test_waiting_heap_order_not_mutated(void)
{
    Sim *s = make_sim(POL_AGING, 16, 32768);
    WaitEntry we;
    unsigned char *copy;
    size_t bytes;
    char got[4096];
    const char *p5, *p6, *p7, *p8, *p9;
    int64_t keys[5] = { 50, 10, 40, 20, 30 };
    int i;
    memset(&we, 0, sizeof we);
    we.job.cpu = 1; we.job.mem = 1; we.job.duration = 1;
    for (i = 0; i < 5; i++) {
        we.job.id = 5 + i;
        we.key = keys[i];
        CHECK(heap_push(&s->waiting, &we) == APRM_OK);
    }
    s->n_total = 5;
    bytes = s->waiting.len * s->waiting.elem_size;
    copy = malloc(bytes);
    CHECK(copy != NULL);
    memcpy(copy, s->waiting.data, bytes);
    CHECK(text_of(sim_state_json, s, got, sizeof got) == APRM_OK);
    CHECK(s->waiting.len == 5 && memcmp(copy, s->waiting.data, bytes) == 0);
    /* Keys 10, 20, 30, 40, 50 belong to ids 6, 8, 9, 7, 5. */
    p6 = strstr(got, "\"id\":6,"); p8 = strstr(got, "\"id\":8,"); p9 = strstr(got, "\"id\":9,");
    p7 = strstr(got, "\"id\":7,"); p5 = strstr(got, "\"id\":5,");
    CHECK(p5 && p6 && p7 && p8 && p9);
    CHECK(p6 < p8 && p8 < p9 && p9 < p7 && p7 < p5);
    free(copy);
    sim_destroy(s);
}

/* Writing a report twice into the same buffer gives the same text (it
 * replaces, never appends), and an out-of-memory buffer reports it. */
static void test_buffer_handling(void)
{
    Sim *s = basic_sim();
    JsonBuf j;
    char first[4096];
    run_all(s);
    json_init(&j);
    CHECK(sim_metrics_json(s, &j) == APRM_OK);
    snprintf(first, sizeof first, "%s", json_cstr(&j));
    CHECK(sim_metrics_json(s, &j) == APRM_OK);
    CHECK(strcmp(first, json_cstr(&j)) == 0);
    CHECK(sim_state_json(s, &j) == APRM_OK && json_is_balanced(json_cstr(&j)));
    json_free(&j);
    json_init(&j);
    json_set_limit(&j, 16);
    CHECK(sim_state_json(s, &j) == APRM_OUT_OF_MEMORY);
    CHECK(json_len(&j) == 0);
    CHECK(sim_results_json(s, &j) == APRM_OUT_OF_MEMORY);
    CHECK(sim_metrics_json(s, &j) == APRM_OUT_OF_MEMORY);
    json_free(&j);
    sim_destroy(s);
}

/* ---- 1,000 random workloads, metrics recomputed independently ---- */

#ifdef __SIZEOF_INT128__
typedef unsigned __int128 u128t;

/* Appends "whole.fraction" (nine digits, half up) of num/den, or "null". */
static void fmt_ratio(char *out, size_t cap, u128t num, u128t den)
{
    u128t scaled;
    if (den == 0) { snprintf(out, cap, "null"); return; }
    scaled = (num * 2 * 1000000000u + den) / (2 * den);
    snprintf(out, cap, "%llu.%09llu", (unsigned long long)(scaled / 1000000000u),
             (unsigned long long)(scaled % 1000000000u));
}

static uint64_t lcg_state;
static int64_t rnd(int64_t lo, int64_t hi)
{
    lcg_state = lcg_state * 6364136223846793005ULL + 1442695040888963407ULL;
    return lo + (int64_t)((lcg_state >> 33) % (uint64_t)(hi - lo + 1));
}

static void test_random_workloads(void)
{
    int w;
    for (w = 0; w < 1000; w++) {
        int64_t cpu_cap, mem_cap, n, i, k;
        Sim *s;
        ResultRow *rows = NULL;
        int64_t nr = 0;
        u128t sum_wait = 0, sum_tat = 0, busy_cpu = 0, busy_mem = 0, weighted = 0;
        int64_t max_wait = 0, makespan = 0, lvl_n[10] = {0}, lvl_w[10] = {0};
        char want[4096], part[64], got[4096], lv[10][64];
        JsonBuf j;
        int ok = 1;

        lcg_state = 0x9e3779b97f4a7c15ULL ^ (uint64_t)(w + 1) * 0xd1342543de82ef95ULL;
        cpu_cap = rnd(1, 8);
        mem_cap = rnd(100, 1000);
        n = rnd(1, 30);
        s = make_sim(POL_FCFS, cpu_cap, mem_cap);
        for (i = 0; i < n; i++)
            add(s, (int)i, rnd(0, 40), rnd(1, 20), rnd(1, cpu_cap), rnd(1, mem_cap), (int)rnd(0, 9));
        run_all(s);
        CHECK(sim_results_rows(s, &rows, &nr) == APRM_OK && nr == n);
        for (i = 0; i < nr; i++) {
            const ResultRow *r = &rows[i];
            if (i > 0 && rows[i - 1].id >= r->id) ok = 0;   /* sorted by id */
            sum_wait += (u128t)r->wait;
            sum_tat += (u128t)r->turnaround;
            if (r->wait > max_wait) max_wait = r->wait;
            if (r->finish > makespan) makespan = r->finish;
            weighted += (u128t)(r->priority + 1) * (u128t)r->finish;
            busy_cpu += (u128t)r->cpu * (u128t)(r->finish - r->start);
            busy_mem += (u128t)r->mem * (u128t)(r->finish - r->start);
            lvl_n[r->priority]++;
            lvl_w[r->priority] += r->wait;
        }
        CHECK(ok);
        for (k = 0; k < 10; k++) fmt_ratio(lv[k], sizeof lv[k], (u128t)lvl_w[k], (u128t)lvl_n[k]);
        snprintf(want, sizeof want, "{\"ok\":true,\"data\":{\"avg_wait\":");
        fmt_ratio(part, sizeof part, sum_wait, (u128t)nr);
        strcat(want, part);
        snprintf(part, sizeof part, ",\"max_wait\":%lld,\"avg_turnaround\":", (long long)max_wait);
        strcat(want, part);
        fmt_ratio(part, sizeof part, sum_tat, (u128t)nr);
        strcat(want, part);
        snprintf(part, sizeof part, ",\"weighted_completion\":%llu,\"makespan\":%lld,\"util_cpu\":",
                 (unsigned long long)weighted, (long long)makespan);
        strcat(want, part);
        fmt_ratio(part, sizeof part, busy_cpu, (u128t)cpu_cap * (u128t)makespan);
        strcat(want, part);
        strcat(want, ",\"util_mem\":");
        fmt_ratio(part, sizeof part, busy_mem, (u128t)mem_cap * (u128t)makespan);
        strcat(want, part);
        strcat(want, ",\"avg_wait_by_priority\":[");
        for (k = 0; k < 10; k++) {
            if (k) strcat(want, ",");
            strcat(want, lv[k]);
        }
        strcat(want, "]}}");

        json_init(&j);
        CHECK(sim_metrics_json(s, &j) == APRM_OK);
        snprintf(got, sizeof got, "%s", json_cstr(&j));
        if (strcmp(got, want) != 0) {
            printf("workload %d differs\n  got : %s\n  want: %s\n", w, got, want);
        }
        CHECK(strcmp(got, want) == 0);
        CHECK(json_is_balanced(got));
        CHECK(sim_results_json(s, &j) == APRM_OK && json_is_balanced(json_cstr(&j)));
        CHECK(sim_state_json(s, &j) == APRM_OK && json_is_balanced(json_cstr(&j)));
        json_free(&j);
        free(rows);
        sim_destroy(s);
    }
}
#else
static void test_random_workloads(void)
{
    printf("skip test_random_workloads: no 128-bit integer type on this compiler\n");
}
#endif

int main(void)
{
    test_ratio9();
    test_json_fixed9();
    test_state_shape();
    test_state_skip_case();
    test_results_sorted();
    test_metrics_values();
    test_metrics_shape_keys();
    test_metrics_empty_and_reset();
    test_empty_priority_level();
    test_weighted_completion();
    test_utilisation();
    test_large_resource_time();
    test_invalid_rows();
    test_score_milli();
    test_waiting_heap_order_not_mutated();
    test_buffer_handling();
    test_random_workloads();
    return TEST_REPORT();
}
