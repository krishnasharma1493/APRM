/* test_heap.c: binary heap (K-03). Min and max compares, ties, build, errors. */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "../../core/heap.h"
#include "../../core/job.h"
#include "test_main.h"

#define N 10000

typedef struct { int64_t key; int32_t id; } Item;

/* Deterministic LCG so the tests are reproducible (no srand/rand state). */
static uint64_t rng_state = 12345;
static int64_t rng_next(void)
{
    rng_state = rng_state * 6364136223846793005ULL + 1442695040888963407ULL;
    return (int64_t)(rng_state >> 33) % 1000;  /* small range forces many ties */
}

static int cmp_min(const void *a, const void *b, void *ctx)
{
    const int64_t *x = a, *y = b;
    (void)ctx;
    return (*x > *y) - (*x < *y);
}
static int cmp_max(const void *a, const void *b, void *ctx) { return cmp_min(b, a, ctx); }

/* Key ascending, then id ascending. ctx counts calls when non-NULL. */
static int cmp_item(const void *a, const void *b, void *ctx)
{
    const Item *x = a, *y = b;
    if (ctx) (*(long *)ctx)++;
    if (x->key != y->key) return x->key < y->key ? -1 : 1;
    return (x->id > y->id) - (x->id < y->id);
}

static void test_heap_empty(void)
{
    Heap h;
    int64_t v = 7;
    CHECK(heap_init(&h, sizeof v, cmp_min, NULL) == APRM_OK);
    CHECK(heap_size(&h) == 0);
    CHECK(heap_pop(&h, &v) == APRM_INVALID_ARGUMENT);
    CHECK(heap_peek(&h, &v) == APRM_INVALID_ARGUMENT);
    CHECK(v == 7);
    CHECK(heap_pop(&h, NULL) == APRM_INVALID_ARGUMENT);
    CHECK(heap_push(&h, NULL) == APRM_INVALID_ARGUMENT);
    CHECK(heap_pop(NULL, &v) == APRM_INVALID_ARGUMENT);
    CHECK(heap_peek(NULL, &v) == APRM_INVALID_ARGUMENT);
    CHECK(heap_push(NULL, &v) == APRM_INVALID_ARGUMENT);
    CHECK(heap_size(NULL) == 0);
    heap_free(&h);
    heap_free(&h);  /* double free is safe */
    heap_free(NULL);
    CHECK(heap_pop(&h, &v) == APRM_INVALID_ARGUMENT);  /* freed heap */
    CHECK(heap_push(&h, &v) == APRM_INVALID_ARGUMENT);
    CHECK(heap_init(NULL, 8, cmp_min, NULL) == APRM_INVALID_ARGUMENT);
    CHECK(heap_init(&h, 0, cmp_min, NULL) == APRM_INVALID_ARGUMENT);
    CHECK(heap_init(&h, 8, NULL, NULL) == APRM_INVALID_ARGUMENT);
    /* reusable after free */
    CHECK(heap_init(&h, sizeof v, cmp_min, NULL) == APRM_OK);
    v = 3;
    CHECK(heap_push(&h, &v) == APRM_OK);
    CHECK(heap_size(&h) == 1);
    heap_free(&h);
}

static void test_heap_single(void)
{
    Heap h;
    int64_t v = 42, out = 0;
    CHECK(heap_init(&h, sizeof v, cmp_min, NULL) == APRM_OK);
    CHECK(heap_push(&h, &v) == APRM_OK);
    CHECK(heap_size(&h) == 1);
    CHECK(heap_peek(&h, &out) == APRM_OK && out == 42);
    CHECK(heap_size(&h) == 1);
    out = 0;
    CHECK(heap_pop(&h, &out) == APRM_OK && out == 42);
    CHECK(heap_size(&h) == 0);
    CHECK(heap_pop(&h, &out) == APRM_INVALID_ARGUMENT);
    heap_free(&h);
}

/* Push N random values, check peek always equals the next pop, check order. */
static void random_order(HeapCmp cmp, int want_min)
{
    Heap h;
    int64_t i, prev = 0, v, top;
    int ok = 1;
    CHECK(heap_init(&h, sizeof(int64_t), cmp, NULL) == APRM_OK);
    for (i = 0; i < N; i++) {
        v = rng_next();
        CHECK(heap_push(&h, &v) == APRM_OK);
    }
    CHECK(heap_size(&h) == N);
    for (i = 0; i < N; i++) {
        if (heap_peek(&h, &top) != APRM_OK || heap_pop(&h, &v) != APRM_OK || top != v) ok = 0;
        if (i > 0 && (want_min ? v < prev : v > prev)) ok = 0;
        prev = v;
    }
    CHECK(ok);
    CHECK(heap_size(&h) == 0);
    heap_free(&h);
}
static void test_heap_random_min(void) { random_order(cmp_min, 1); }
static void test_heap_random_max(void) { random_order(cmp_max, 0); }

/* Many equal keys: pop order must be key then lower id, every time. */
static void test_heap_ties(void)
{
    Heap h;
    Item it, prev = {0, 0};
    int i, ok = 1;
    long calls = 0;
    CHECK(heap_init(&h, sizeof(Item), cmp_item, &calls) == APRM_OK);
    for (i = 0; i < 2000; i++) {
        it.key = rng_next() % 5;
        it.id = (int32_t)((i * 7919) % 2000);  /* distinct ids in scrambled order */
        CHECK(heap_push(&h, &it) == APRM_OK);
    }
    for (i = 0; i < 2000; i++) {
        CHECK(heap_pop(&h, &it) == APRM_OK);
        if (i > 0 && cmp_item(&prev, &it, NULL) >= 0) ok = 0;
        prev = it;
    }
    CHECK(ok);
    CHECK(calls > 0);  /* ctx is passed through to the compare */
    heap_free(&h);
}

static void test_heap_build(void)
{
    static int64_t src[N];
    Heap a, b;
    int64_t i, x, y;
    int same = 1, sorted = 1, prev = 0;
    for (i = 0; i < N; i++) src[i] = rng_next();
    CHECK(heap_init(&a, sizeof(int64_t), cmp_min, NULL) == APRM_OK);
    CHECK(heap_init(&b, sizeof(int64_t), cmp_min, NULL) == APRM_OK);
    CHECK(heap_build(&a, src, N) == APRM_OK);
    CHECK(heap_size(&a) == N);
    for (i = 0; i < N; i++) CHECK(heap_push(&b, &src[i]) == APRM_OK);
    for (i = 0; i < N; i++) {
        if (heap_pop(&a, &x) != APRM_OK || heap_pop(&b, &y) != APRM_OK) { same = 0; break; }
        if (x != y) same = 0;
        if (i > 0 && x < prev) sorted = 0;
        prev = (int)x;
    }
    CHECK(same && sorted);
    /* build replaces old contents, accepts n == 0, rejects bad arguments */
    CHECK(heap_push(&a, &src[0]) == APRM_OK);
    CHECK(heap_build(&a, src, 3) == APRM_OK && heap_size(&a) == 3);
    CHECK(heap_build(&a, NULL, 0) == APRM_OK && heap_size(&a) == 0);
    CHECK(heap_build(&a, NULL, 3) == APRM_INVALID_ARGUMENT);
    CHECK(heap_build(NULL, src, 3) == APRM_INVALID_ARGUMENT);
    heap_free(&a);
    heap_free(&b);
}

/*
 * Allocation failure without touching the real allocator: the sizes involved
 * overflow size_t (checked before multiplying), so no hook is needed. (Asking
 * malloc for an absurd size instead would abort under AddressSanitizer.)
 * In every case the heap must be unchanged and still usable.
 */
static void test_heap_oom(void)
{
    Heap h;
    int64_t v, out, i;
    int64_t src[3] = {5, 1, 3};
    size_t old_len, old_cap;
    unsigned char *old_data;

    /* init: 16 * elem_size overflows size_t */
    CHECK(heap_init(&h, SIZE_MAX / 4, cmp_min, NULL) == APRM_OUT_OF_MEMORY);
    CHECK(heap_size(&h) == 0);
    heap_free(&h);

    CHECK(heap_init(&h, sizeof(int64_t), cmp_min, NULL) == APRM_OK);
    for (i = 0; i < 4; i++) { v = 10 - i; CHECK(heap_push(&h, &v) == APRM_OK); }

    /* build: n * elem_size overflows size_t; contents untouched */
    CHECK(heap_build(&h, src, SIZE_MAX / 2) == APRM_OUT_OF_MEMORY);
    CHECK(heap_size(&h) == 4);
    /* push: pretend the buffer is full at a size where doubling overflows */
    old_len = h.len; old_cap = h.cap; old_data = h.data;
    h.len = h.cap = SIZE_MAX / sizeof(int64_t);
    v = 0;
    CHECK(heap_push(&h, &v) == APRM_OUT_OF_MEMORY);
    CHECK(h.len == SIZE_MAX / sizeof(int64_t) && h.data == old_data);
    h.len = old_len; h.cap = old_cap;

    /* still valid and in order */
    CHECK(heap_peek(&h, &out) == APRM_OK && out == 7);
    for (i = 7; i <= 10; i++) CHECK(heap_pop(&h, &out) == APRM_OK && out == i);
    CHECK(heap_size(&h) == 0);
    heap_free(&h);
}

/* Growth: several doublings, larger elements, interleaved push and pop. */
static void test_heap_growth_and_interleave(void)
{
    Heap h;
    Item it, out;
    int i, ok = 1;
    int64_t last = -1;
    CHECK(heap_init(&h, sizeof(Item), cmp_item, NULL) == APRM_OK);
    for (i = 0; i < 5000; i++) {
        it.key = rng_next();
        it.id = i;
        CHECK(heap_push(&h, &it) == APRM_OK);
        if (i % 3 == 2) {  /* interleave pops with pushes */
            CHECK(heap_pop(&h, &out) == APRM_OK);
        }
    }
    while (heap_pop(&h, &out) == APRM_OK) {
        if (out.key < last) ok = 0;
        last = out.key;
    }
    CHECK(ok);
    heap_free(&h);
}

int main(void)
{
    test_heap_empty();
    test_heap_single();
    test_heap_random_min();
    test_heap_random_max();
    test_heap_ties();
    test_heap_build();
    test_heap_oom();
    test_heap_growth_and_interleave();
    return TEST_REPORT();
}
