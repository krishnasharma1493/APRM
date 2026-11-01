/* test_eventlog.c: event log entries, sentences and sim_log_json (K-10, D60).
 * Golden sentences on tests/cases/fcfs_skip, since_seq, one START / FINISH
 * per job on 1,000 random workloads, SKIP resource naming, 100,000-entry
 * growth, JSON validity, reset, and all-or-nothing steps when the log cannot
 * grow. Run from the repository root (make does). */
#define APRM_ENGINE_INTERNAL
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../../core/config.h"
#include "../../core/csv.h"
#include "../../core/engine_internal.h"
#include "../../core/eventlog.h"
#include "test_main.h"

/* ---- helpers ---- */

static SimConfig cfg_with(int64_t cpu, int64_t mem)
{
    SimConfig c;
    memset(&c, 0, sizeof c);
    c.cpu_cap = cpu; c.mem_cap = mem; c.policy = POL_FCFS;
    c.alpha_milli = 100; c.reserve_threshold = 50; c.knapsack_eps = 0.1;
    c.max_jobs = APRM_MAX_JOBS_CLI;
    return c;
}

static Sim *make(int64_t cpu, int64_t mem)
{
    SimConfig c = cfg_with(cpu, mem);
    Sim *s = NULL;
    CHECK(sim_create(&c, &s) == APRM_OK);
    return s;
}

static void add(Sim *s, int32_t id, int64_t arr, int64_t dur, int64_t cpu, int64_t mem, int32_t pr)
{
    Job j;
    j.id = id; j.arrival = arr; j.duration = dur; j.cpu = cpu; j.mem = mem; j.priority = pr;
    CHECK(sim_add_job(s, &j) == APRM_OK);
}

static void run_all(Sim *s)
{
    int rc, steps = 0;
    while ((rc = sim_step(s)) == 1 && steps < 10000000) steps++;
    CHECK(rc == 0);
}

/* Sentence of entry i (0-based) into a static buffer. */
static const char *msg_of(const Sim *s, size_t i)
{
    static char buf[LOG_MSG_MAX];
    eventlog_format(&s->log.e[i], buf, sizeof buf);
    return buf;
}

static int count_kind(const Sim *s, LogKind k)
{
    size_t i;
    int n = 0;
    for (i = 0; i < s->log.len; i++) n += s->log.e[i].kind == k;
    return n;
}

/* ---- a small JSON checker: balanced {} [], strings closed, only legal
 * escapes, no raw control bytes inside strings. Returns 1 if valid. ---- */
static int json_ok(const char *p)
{
    char stack[64];
    int depth = 0, in_str = 0;
    for (; *p; p++) {
        unsigned char c = (unsigned char)*p;
        if (in_str) {
            if (c < 0x20) return 0;
            if (c == '\\') {
                p++;
                if (!*p || !strchr("\"\\/bfnrtu", *p)) return 0;
            } else if (c == '"') in_str = 0;
            continue;
        }
        if (c == '"') in_str = 1;
        else if (c == '{' || c == '[') { if (depth >= 64) return 0; stack[depth++] = (char)c; }
        else if (c == '}' || c == ']') {
            if (depth == 0) return 0;
            if ((c == '}') != (stack[depth - 1] == '{')) return 0;
            depth--;
        }
    }
    return depth == 0 && !in_str;
}

static char *read_file(const char *path)
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
    return buf;
}

/* Deterministic generator for the random workloads (no rand()). */
static uint64_t rng_state;
static int64_t rnd(int64_t lo, int64_t hi)
{
    rng_state = rng_state * 6364136223846793005ULL + 1442695040888963407ULL;
    return lo + (int64_t)((rng_state >> 33) % (uint64_t)(hi - lo + 1));
}

/* ---- tests ---- */

static void test_log_golden(void)
{
    static const char *const dirs[] = { "tests/cases", "../tests/cases", "../../tests/cases",
                                        "../../../tests/cases" };
    /* Derived by hand (16 cores, 32768 MB). Job 1 (arr 0, dur 10, 4c 24000MB),
     * job 2 (arr 1, dur 6, 4c 16000MB), job 3 (arr 2, dur 3, 2c 4000MB).
     * t=0: job 1 arrives and starts (everything free).
     * t=1: job 2 arrives; free 12c 8768MB; memory short -> SKIP (first time).
     * t=2: job 3 arrives; job 2 is examined again, still only memory short ->
     *      NO second SKIP (D60); job 3 starts (free 12c 8768MB before it).
     * t=5: job 3 finishes; job 2 still memory short -> no SKIP.
     * t=10: job 1 finishes; job 2 starts. t=16: job 2 finishes. */
    static const struct { int64_t t; const char *kind; int job; const char *msg; } want[] = {
        {  0, "ARRIVE", 1, "Job 1 arrived with priority 2." },
        {  0, "START",  1, "Job 1 started: needs 4 cores and 24000 MB; 16 cores and 32768 MB free." },
        {  1, "ARRIVE", 2, "Job 2 arrived with priority 5." },
        {  1, "SKIP",   2, "Job 2 skipped: needs 16000 MB, only 8768 MB free." },
        {  2, "ARRIVE", 3, "Job 3 arrived with priority 1." },
        {  2, "START",  3, "Job 3 started: needs 2 cores and 4000 MB; 12 cores and 8768 MB free." },
        {  5, "FINISH", 3, "Job 3 finished after 3 ticks; freed 2 cores and 4000 MB." },
        { 10, "FINISH", 1, "Job 1 finished after 10 ticks; freed 4 cores and 24000 MB." },
        { 10, "START",  2, "Job 2 started: needs 4 cores and 16000 MB; 16 cores and 32768 MB free." },
        { 16, "FINISH", 2, "Job 2 finished after 6 ticks; freed 4 cores and 16000 MB." },
    };
    size_t i, n_want = sizeof want / sizeof want[0], d;
    char path[512], *text = NULL;
    Job *jobs = NULL;
    int64_t n = 0;
    CsvError cerr;
    Sim *s = make(16, 32768);
    for (d = 0; d < sizeof dirs / sizeof dirs[0] && !text; d++) {
        snprintf(path, sizeof path, "%s/fcfs_skip.csv", dirs[d]);
        text = read_file(path);
    }
    CHECK(text != NULL);
    if (!text) { sim_destroy(s); return; }
    CHECK(csv_read_jobs(text, strlen(text), 100, &jobs, &n, &cerr) == APRM_OK);
    CHECK(n == 3);
    for (i = 0; i < (size_t)n; i++) CHECK(sim_add_job(s, &jobs[i]) == APRM_OK);
    run_all(s);
    CHECK(s->log.len == n_want);
    for (i = 0; i < n_want && i < s->log.len; i++) {
        const LogEntry *e = &s->log.e[i];
        CHECK(e->seq == (int64_t)i + 1);
        CHECK(e->t == want[i].t);
        CHECK(strcmp(eventlog_kind_name(e->kind), want[i].kind) == 0);
        CHECK(e->job == want[i].job);
        if (strcmp(msg_of(s, i), want[i].msg) != 0) {
            printf("entry %zu: got  \"%s\"\n         want \"%s\"\n", i, msg_of(s, i), want[i].msg);
            CHECK(0);
        }
    }
    free(jobs); free(text);
    sim_destroy(s);
}

static void test_log_since(void)
{
    Sim *s = make(16, 32768);
    JsonBuf j;
    size_t total, commas = 0, k;
    const char *p;
    add(s, 1, 0, 10, 4, 24000, 2);
    add(s, 2, 1, 6, 4, 16000, 5);
    run_all(s);
    total = s->log.len;
    CHECK(total > 3);

    json_init(&j);
    CHECK(sim_log_json(s, 0, &j) == APRM_OK);
    {
        static const char head[] = "{\"ok\":true,\"data\":[{\"seq\":1,\"t\":0,\"kind\":\"ARRIVE\",\"job\":1,"
                                   "\"msg\":\"Job 1 arrived with priority 2.\"},";
        CHECK(strncmp(json_cstr(&j), head, sizeof head - 1) == 0);
    }
    for (p = json_cstr(&j), k = 0; (p = strstr(p, "{\"seq\":")) != NULL; p++) k++;
    CHECK(k == total);
    CHECK(json_ok(json_cstr(&j)));
    (void)commas;

    /* negative since_seq behaves like 0 */
    json_reset(&j);
    CHECK(sim_log_json(s, -5, &j) == APRM_OK);
    for (p = json_cstr(&j), k = 0; (p = strstr(p, "{\"seq\":")) != NULL; p++) k++;
    CHECK(k == total);

    /* since 2: entries 3.. only */
    json_reset(&j);
    CHECK(sim_log_json(s, 2, &j) == APRM_OK);
    CHECK(strstr(json_cstr(&j), "{\"seq\":2,") == NULL);
    CHECK(strncmp(json_cstr(&j), "{\"ok\":true,\"data\":[{\"seq\":3,", 27) == 0);
    for (p = json_cstr(&j), k = 0; (p = strstr(p, "{\"seq\":")) != NULL; p++) k++;
    CHECK(k == total - 2);

    /* since = last seq, and beyond: empty array */
    json_reset(&j);
    CHECK(sim_log_json(s, (int64_t)total, &j) == APRM_OK);
    CHECK(strcmp(json_cstr(&j), "{\"ok\":true,\"data\":[]}") == 0);
    json_reset(&j);
    CHECK(sim_log_json(s, (int64_t)total + 1000, &j) == APRM_OK);
    CHECK(strcmp(json_cstr(&j), "{\"ok\":true,\"data\":[]}") == 0);
    json_reset(&j);
    CHECK(sim_log_json(s, INT64_MAX, &j) == APRM_OK);
    CHECK(strcmp(json_cstr(&j), "{\"ok\":true,\"data\":[]}") == 0);

    /* a reused JsonBuf gives the same valid JSON again (json_reset inside) */
    {
        char first[8192];
        json_reset(&j);
        CHECK(sim_log_json(s, 0, &j) == APRM_OK);
        CHECK(json_len(&j) < sizeof first);
        snprintf(first, sizeof first, "%s", json_cstr(&j));
        CHECK(sim_log_json(s, 0, &j) == APRM_OK);
        CHECK(strcmp(first, json_cstr(&j)) == 0 && json_ok(first));
    }

    /* argument checks */
    CHECK(sim_log_json(NULL, 0, &j) == APRM_INVALID_ARGUMENT);
    CHECK(sim_log_json(s, 0, NULL) == APRM_INVALID_ARGUMENT);
    json_free(&j);

    /* an empty log is an empty array */
    sim_reset(s);
    json_init(&j);
    CHECK(sim_log_json(s, 0, &j) == APRM_OK);
    CHECK(strcmp(json_cstr(&j), "{\"ok\":true,\"data\":[]}") == 0);
    json_free(&j);
    sim_destroy(s);
}

static void test_log_one_per_decision(void)
{
    int w;
    int32_t worst_skips = 0;
    for (w = 0; w < 1000; w++) {
        Sim *s = make(16, 32768);
        int64_t n = rnd(1, 25), i;
        size_t k;
        int32_t *started = calloc((size_t)n + 1, sizeof *started);
        int32_t *finished = calloc((size_t)n + 1, sizeof *finished);
        int32_t *arrived = calloc((size_t)n + 1, sizeof *arrived);
        int32_t *skips = calloc((size_t)n + 1, sizeof *skips);
        int64_t prev_t = 0;
        int32_t max_skips = 0;
        rng_state = 1000 + (uint64_t)w;
        CHECK(started && finished && arrived && skips);
        for (i = 1; i <= n; i++)
            add(s, (int32_t)i, rnd(0, 60), rnd(1, 30), rnd(1, 16), rnd(100, 32768), (int32_t)rnd(0, 9));
        run_all(s);
        CHECK(count_kind(s, LOG_START) == n);
        CHECK(count_kind(s, LOG_FINISH) == n);
        CHECK(count_kind(s, LOG_ARRIVE) == n);
        for (k = 0; k < s->log.len && started && finished && arrived && skips; k++) {
            const LogEntry *e = &s->log.e[k];
            CHECK(e->seq == (int64_t)k + 1);
            CHECK(e->t >= prev_t);  /* time never goes backwards */
            prev_t = e->t;
            CHECK(e->job >= 1 && e->job <= n);
            if (e->job < 1 || e->job > n) continue;
            if (e->kind == LOG_START) {
                CHECK(arrived[e->job] == 1 && started[e->job] == 0);  /* arrive before start */
                started[e->job]++;
            } else if (e->kind == LOG_FINISH) {
                CHECK(started[e->job] == 1 && finished[e->job] == 0);  /* start before finish */
                finished[e->job]++;
            } else if (e->kind == LOG_ARRIVE) {
                arrived[e->job]++;
            } else {
                CHECK(e->kind == LOG_SKIP && started[e->job] == 0);
                CHECK(arrived[e->job] == 1);          /* ARRIVE < every SKIP < START */
                skips[e->job]++;
                if (skips[e->job] > max_skips) max_skips = skips[e->job];
            }
        }
        /* FINISH order: by finish time, then arrival, then id (sim_step comment). */
        for (k = 0; k + 1 < s->fin_len; k++) {
            const RunEntry *a = &s->fin[k], *b = &s->fin[k + 1];
            CHECK(a->finish < b->finish ||
                  (a->finish == b->finish && (a->job.arrival < b->job.arrival ||
                   (a->job.arrival == b->job.arrival && a->job.id < b->job.id))));
        }
        {
            size_t fi = 0;
            for (k = 0; k < s->log.len; k++)
                if (s->log.e[k].kind == LOG_FINISH) {
                    CHECK(fi < s->fin_len && s->fin[fi].job.id == s->log.e[k].job);
                    fi++;
                }
            CHECK(fi == s->fin_len);
        }
        if (max_skips > worst_skips) worst_skips = max_skips;
        free(started); free(finished); free(arrived); free(skips);
        sim_destroy(s);
    }
    printf("1,000 random workloads: most SKIPs for one job = %d\n", (int)worst_skips);
}

static const char *first_skip_msg(Sim *s)
{
    size_t i;
    for (i = 0; i < s->log.len; i++)
        if (s->log.e[i].kind == LOG_SKIP) return msg_of(s, i);
    return "(no SKIP)";
}

static void test_log_skip_resource(void)
{
    /* Machine 4 cores, 1000 MB. Job 1 runs; job 2 arrives and cannot start. */
    Sim *s = make(4, 1000);
    add(s, 1, 0, 10, 3, 100, 0);
    add(s, 2, 1, 5, 2, 50, 0);           /* cpu short: needs 2, 1 free; mem fine */
    run_all(s);
    CHECK(strcmp(first_skip_msg(s), "Job 2 skipped: needs 2 cores, only 1 core free.") == 0);
    sim_destroy(s);

    s = make(4, 1000);
    add(s, 1, 0, 10, 1, 800, 0);
    add(s, 2, 1, 5, 1, 300, 0);          /* memory short only */
    run_all(s);
    CHECK(strcmp(first_skip_msg(s), "Job 2 skipped: needs 300 MB, only 200 MB free.") == 0);
    sim_destroy(s);

    s = make(4, 1000);
    add(s, 1, 0, 10, 3, 800, 0);
    add(s, 2, 1, 5, 2, 300, 0);          /* both short */
    run_all(s);
    CHECK(strcmp(first_skip_msg(s),
                 "Job 2 skipped: needs 2 cores and 300 MB, only 1 core and 200 MB free.") == 0);
    sim_destroy(s);

    /* Formatter alone, including the odd case where neither is short. */
    {
        LogEntry e;
        char buf[LOG_MSG_MAX];
        memset(&e, 0, sizeof e);
        e.kind = LOG_SKIP; e.job = 7;
        e.a[0] = 8; e.a[1] = 20480; e.a[2] = 8; e.a[3] = 8192;
        eventlog_format(&e, buf, sizeof buf);
        CHECK(strcmp(buf, "Job 7 skipped: needs 20480 MB, only 8192 MB free.") == 0);  /* PRD example */
        e.a[1] = 100;  /* nothing short: name both, hide nothing */
        eventlog_format(&e, buf, sizeof buf);
        CHECK(strstr(buf, "8 cores and 100 MB") != NULL);
    }
}

/* Every formatter, exact text (RESERVE, BACKFILL, BATCH_SELECT, REJECT and
 * PROMOTE_INFO are emitted by later issues or never; only the text is tested). */
static void test_log_formatters(void)
{
    static const struct { LogKind k; int64_t a[4]; const char *want; } c[] = {
        { LOG_ARRIVE,  { 2, 0, 0, 0 }, "Job 9 arrived with priority 2." },
        { LOG_START,   { 8, 4096, 8, 28672 }, "Job 9 started: needs 8 cores and 4096 MB; 8 cores and 28672 MB free." },
        { LOG_START,   { 1, 1, 1, 1 }, "Job 9 started: needs 1 core and 1 MB; 1 core and 1 MB free." },
        { LOG_FINISH,  { 25, 8, 4096, 0 }, "Job 9 finished after 25 ticks; freed 8 cores and 4096 MB." },
        { LOG_FINISH,  { 1, 1, 1, 0 }, "Job 9 finished after 1 tick; freed 1 core and 1 MB." },
        { LOG_RESERVE, { 55, 0, 0, 0 }, "Job 9 reserved: start guaranteed at t=55." },
        { LOG_BACKFILL, { 50, 55, 0, 0 }, "Job 9 backfilled: finishes at t=50, before the reservation at t=55." },
        { LOG_BACKFILL, { 55, 55, 0, 0 }, "Job 9 backfilled: finishes at t=55, before the reservation at t=55." },
        { LOG_BACKFILL, { 70, 55, 0, 0 }, "Job 9 backfilled: finishes at t=70, after the reservation at t=55, but fits the spare room." },
        { LOG_BATCH_SELECT, { 3, 0, 0, 0 }, "Job 9 chosen for the best batch of 3 jobs." },
        { LOG_BATCH_SELECT, { 1, 0, 0, 0 }, "Job 9 chosen for the best batch of 1 job." },
        { LOG_REJECT,  { 0, 0, 0, 0 }, "Job 9 rejected (reserved kind, never emitted; see the error message)." },
        { LOG_PROMOTE_INFO, { 0, 0, 0, 0 }, "Job 9 promotion note (reserved kind, never emitted)." },
    };
    size_t i;
    char buf[LOG_MSG_MAX], small[12];
    LogEntry e;
    for (i = 0; i < sizeof c / sizeof c[0]; i++) {
        memset(&e, 0, sizeof e);
        e.kind = c[i].k; e.job = 9;
        memcpy(e.a, c[i].a, sizeof e.a);
        CHECK(eventlog_format(&e, buf, sizeof buf) == strlen(c[i].want));
        if (strcmp(buf, c[i].want) != 0) printf("got \"%s\"\nwant \"%s\"\n", buf, c[i].want);
        CHECK(strcmp(buf, c[i].want) == 0);
    }
    /* Zeros, and plural of 0. */
    memset(&e, 0, sizeof e);
    e.kind = LOG_FINISH; e.job = 0;
    eventlog_format(&e, buf, sizeof buf);
    CHECK(strcmp(buf, "Job 0 finished after 0 ticks; freed 0 cores and 0 MB.") == 0);
    /* Truncation: never overruns, always NUL-terminated, length reported is
     * what was stored. */
    memset(&e, 0, sizeof e);
    e.kind = LOG_FINISH; e.job = INT32_MAX;
    e.a[0] = INT64_MAX; e.a[1] = INT64_MAX; e.a[2] = INT64_MAX;
    memset(small, 'x', sizeof small);
    CHECK(eventlog_format(&e, small, sizeof small) == sizeof small - 1);
    CHECK(small[sizeof small - 1] == '\0');
    CHECK(strncmp(small, "Job 21474836", 11) == 0);
    CHECK(eventlog_format(&e, small, 1) == 0 && small[0] == '\0');
    CHECK(eventlog_format(&e, small, 0) == 0);
    CHECK(eventlog_format(&e, buf, sizeof buf) < sizeof buf);  /* worst-case numbers fit LOG_MSG_MAX */
    CHECK(strlen(buf) > 100);
    e.kind = (LogKind)99;  /* unknown kind */
    eventlog_format(&e, buf, sizeof buf);
    CHECK(strstr(buf, "unknown") != NULL);
    CHECK(strcmp(eventlog_kind_name((LogKind)99), "?") == 0);
}

static void test_log_growth(void)
{
    /* (a) the array itself: 100,000 pushes, seq 1..100000, nothing lost. */
    EventLog l;
    size_t i;
    eventlog_init(&l);
    for (i = 0; i < 100000; i++) {
        CHECK(eventlog_reserve(&l, 1) == APRM_OK);
        CHECK(eventlog_push(&l, (int64_t)i, LOG_ARRIVE, (int32_t)i, 1, 0, 0, 0) == APRM_OK);
    }
    CHECK(l.len == 100000);
    for (i = 0; i < l.len; i++)
        if (l.e[i].seq != (int64_t)i + 1 || l.e[i].job != (int32_t)i) { CHECK(0); break; }
    CHECK(l.cap >= l.len && l.cap < 4 * l.len);  /* geometric growth, no huge slack */
    eventlog_clear(&l);
    CHECK(l.len == 0 && l.cap > 0);
    CHECK(eventlog_reserve(&l, 1) == APRM_OK && eventlog_push(&l, 0, LOG_ARRIVE, 0, 0, 0, 0, 0) == APRM_OK);
    CHECK(l.e[0].seq == 1);
    eventlog_free(&l);

    /* (b) regression for the SKIP flood: a hog holds all memory while 2,000
     * big-memory jobs queue behind it. Every job is skipped for memory, but
     * only once (D60), not once per event. */
    {
        Sim *s = make(16, 1000);
        JsonBuf j;
        int64_t n = 2000, id;
        size_t k;
        add(s, 0, 0, 100, 1, 1000, 0);                       /* the hog */
        for (id = 1; id <= n; id++) add(s, (int32_t)id, 1, 1, 1, 600, 0);
        run_all(s);
        CHECK(count_kind(s, LOG_START) == n + 1 && count_kind(s, LOG_FINISH) == n + 1);
        CHECK(count_kind(s, LOG_SKIP) <= 3 * (n + 1));
        /* The hog leaves no free memory at t=1, so nobody is examined then; after
         * it finishes, job 1 starts and the other n-1 are skipped once each. */
        CHECK(count_kind(s, LOG_SKIP) == n - 1);
        CHECK(s->log.len == (size_t)(4 * n + 2));
        printf("flood run: %lld queued jobs -> %zu log entries\n", (long long)n, s->log.len);
        for (k = 0; k < s->log.len; k++)
            if (s->log.e[k].seq != (int64_t)k + 1) { CHECK(0); break; }
        json_init(&j);
        CHECK(sim_log_json(s, (int64_t)s->log.len - 2, &j) == APRM_OK);  /* last two only */
        CHECK(json_ok(json_cstr(&j)));
        json_free(&j);
        sim_destroy(s);
    }
}

/* SKIP is logged again only when the set of short resources changes (D60).
 * Machine 4 cores, 1000 MB. Hand-derived:
 *  t=0  job 1 (dur 10, 1c 800MB) arrives, starts (4c 1000MB free)
 *  t=1  job 2 (dur 5, 2c 300MB) arrives; free 3c 200MB: memory short -> SKIP
 *  t=2  job 3 (dur 20, 3c 50MB) arrives; job 2 examined, still memory only ->
 *       no SKIP; job 3 starts (3c 200MB free before)
 *  t=10 job 1 finishes; free 1c 950MB: job 2 now CPU short only -> SKIP (new)
 *  t=22 job 3 finishes; job 2 starts; t=27 job 2 finishes. */
static void test_log_skip_on_change(void)
{
    static const char *const want[] = {
        "Job 1 arrived with priority 0.",
        "Job 1 started: needs 1 core and 800 MB; 4 cores and 1000 MB free.",
        "Job 2 arrived with priority 0.",
        "Job 2 skipped: needs 300 MB, only 200 MB free.",
        "Job 3 arrived with priority 0.",
        "Job 3 started: needs 3 cores and 50 MB; 3 cores and 200 MB free.",
        "Job 1 finished after 10 ticks; freed 1 core and 800 MB.",
        "Job 2 skipped: needs 2 cores, only 1 core free.",
        "Job 3 finished after 20 ticks; freed 3 cores and 50 MB.",
        "Job 2 started: needs 2 cores and 300 MB; 4 cores and 1000 MB free.",
        "Job 2 finished after 5 ticks; freed 2 cores and 300 MB.",
    };
    size_t i, n = sizeof want / sizeof want[0];
    Sim *s = make(4, 1000);
    add(s, 1, 0, 10, 1, 800, 0);
    add(s, 2, 1, 5, 2, 300, 0);
    add(s, 3, 2, 20, 3, 50, 0);
    run_all(s);
    CHECK(s->log.len == n);
    for (i = 0; i < n && i < s->log.len; i++) {
        if (strcmp(msg_of(s, i), want[i]) != 0) printf("entry %zu: got \"%s\"\n", i, msg_of(s, i));
        CHECK(strcmp(msg_of(s, i), want[i]) == 0);
    }
    sim_destroy(s);
}

/* Within one step, FINISH entries come before ARRIVE entries (D9). */
static void test_log_finish_before_arrive(void)
{
    Sim *s = make(4, 1000);
    add(s, 1, 0, 5, 1, 100, 0);
    add(s, 2, 5, 5, 1, 100, 0);   /* arrives exactly when job 1 finishes */
    run_all(s);
    CHECK(strcmp(msg_of(s, 2), "Job 1 finished after 5 ticks; freed 1 core and 100 MB.") == 0);
    CHECK(strcmp(msg_of(s, 3), "Job 2 arrived with priority 0.") == 0);
    CHECK(s->log.e[2].t == 5 && s->log.e[3].t == 5);
    sim_destroy(s);
}

/* eventlog_push never allocates: with no reserved room it fails and changes nothing. */
static void test_log_push_full(void)
{
    EventLog l;
    eventlog_init(&l);
    CHECK(eventlog_push(&l, 0, LOG_ARRIVE, 1, 0, 0, 0, 0) == APRM_OUT_OF_MEMORY);
    CHECK(l.len == 0 && l.e == NULL);
    CHECK(eventlog_reserve(&l, 64) == APRM_OK);
    while (l.len < l.cap) CHECK(eventlog_push(&l, 0, LOG_ARRIVE, 1, 0, 0, 0, 0) == APRM_OK);
    {
        size_t len0 = l.len;
        CHECK(eventlog_push(&l, 9, LOG_START, 2, 0, 0, 0, 0) == APRM_OUT_OF_MEMORY);
        CHECK(l.len == len0 && l.e[len0 - 1].seq == (int64_t)len0 && l.e[len0 - 1].kind == LOG_ARRIVE);
    }
    eventlog_free(&l);
}

static void test_log_json_valid(void)
{
    /* All nine kinds through the JSON writer, plus the extremes. */
    Sim *s = make(16, 32768);
    JsonBuf j;
    int kind;
    json_init(&j);
    CHECK(eventlog_reserve(&s->log, 20) == APRM_OK);
    for (kind = 0; kind < LOG_KIND_COUNT; kind++)
        CHECK(eventlog_push(&s->log, INT64_MAX, (LogKind)kind, INT32_MAX, INT64_MAX, INT64_MIN, 7, 8) == APRM_OK);
    CHECK(sim_log_json(s, 0, &j) == APRM_OK);
    CHECK(json_ok(json_cstr(&j)));
    CHECK(strstr(json_cstr(&j), "\"kind\":\"BATCH_SELECT\"") != NULL);
    CHECK(strstr(json_cstr(&j), "\"kind\":\"PROMOTE_INFO\"") != NULL);
    CHECK(strstr(json_cstr(&j), "\"kind\":\"REJECT\"") != NULL);
    CHECK(json_len(&j) == strlen(json_cstr(&j)));
    json_free(&j);

    /* A JsonBuf that cannot grow reports the error. */
    json_init(&j);
    json_set_limit(&j, 40);
    CHECK(sim_log_json(s, 0, &j) == APRM_OUT_OF_MEMORY);
    json_free(&j);
    sim_destroy(s);
}

static void test_log_reset(void)
{
    Sim *s = make(16, 32768);
    JsonBuf j;
    size_t cap;
    add(s, 1, 0, 10, 4, 100, 2);
    run_all(s);
    CHECK(s->log.len == 3);
    cap = s->log.cap;
    CHECK(sim_reset(s) == APRM_OK);
    CHECK(s->log.len == 0);
    CHECK(s->log.cap == cap);  /* buffer kept: reset cannot fail */
    json_init(&j);
    CHECK(sim_log_json(s, 0, &j) == APRM_OK);
    CHECK(strcmp(json_cstr(&j), "{\"ok\":true,\"data\":[]}") == 0);
    json_free(&j);
    add(s, 5, 3, 2, 1, 1, 9);
    run_all(s);
    CHECK(s->log.len == 3);
    CHECK(s->log.e[0].seq == 1 && s->log.e[0].t == 3 && s->log.e[0].job == 5);  /* seq restarted */
    sim_destroy(s);
}

/* A step whose log room cannot be reserved fails with OUT_OF_MEMORY and
 * leaves the Sim, including the log, exactly as it was (all-or-nothing). */
static void test_log_step_all_or_nothing(void)
{
    Sim *s = make(16, 32768);
    int64_t now0;
    size_t pend, len0;
    add(s, 1, 0, 10, 4, 100, 2);
    add(s, 2, 0, 10, 4, 100, 2);
    s->log.max_cap = 1;  /* a first step needs room for 4 entries: arrive x2, start x2 */
    now0 = s->now; pend = heap_size(&s->pending); len0 = s->log.len;
    CHECK(sim_step(s) == APRM_OUT_OF_MEMORY);
    CHECK(s->now == now0 && heap_size(&s->pending) == pend && heap_size(&s->waiting) == 0);
    CHECK(heap_size(&s->running) == 0 && s->free_cpu == 16 && s->free_mem == 32768);
    CHECK(s->log.len == len0 && s->fin_len == 0 && s->n_finished == 0);
    CHECK(sim_last_error(s)->code == APRM_OUT_OF_MEMORY);
    s->log.max_cap = 0;  /* memory comes back: the same step now works */
    CHECK(sim_step(s) == 1);
    CHECK(s->log.len == 4);
    sim_destroy(s);
}

/* sim_log_count / sim_log_message: the accessors the console --log uses. */
static void test_log_accessors(void)
{
    Sim *s = make(16, 32768);
    char buf[LOG_MSG_MAX], small[8];
    int64_t i;
    CHECK(sim_log_count(NULL) == 0);
    CHECK(sim_log_count(s) == 0);
    add(s, 1, 0, 10, 4, 24000, 2);
    run_all(s);
    CHECK(sim_log_count(s) == (int64_t)s->log.len && sim_log_count(s) >= 3);
    CHECK(sim_log_message(s, 0, buf, sizeof buf) == strlen("Job 1 arrived with priority 2."));
    CHECK(strcmp(buf, "Job 1 arrived with priority 2.") == 0);
    for (i = 0; i < sim_log_count(s); i++) {
        CHECK(sim_log_message(s, i, buf, sizeof buf) > 0);
        CHECK(strchr(buf, '\n') == NULL);
    }
    CHECK(sim_log_message(s, sim_log_count(s), buf, sizeof buf) == 0);
    CHECK(sim_log_message(s, -1, buf, sizeof buf) == 0);
    CHECK(sim_log_message(s, 0, NULL, 10) == 0 && sim_log_message(s, 0, buf, 0) == 0);
    CHECK(sim_log_message(NULL, 0, buf, sizeof buf) == 0);
    CHECK(sim_log_message(s, 0, small, sizeof small) == 7 && small[7] == '\0');
    sim_destroy(s);
}

int main(void)
{
    test_log_accessors();
    test_log_golden();
    test_log_since();
    test_log_one_per_decision();
    test_log_skip_resource();
    test_log_formatters();
    test_log_growth();
    test_log_skip_on_change();
    test_log_finish_before_arrive();
    test_log_push_full();
    test_log_json_valid();
    test_log_reset();
    test_log_step_all_or_nothing();
    return TEST_REPORT();
}
