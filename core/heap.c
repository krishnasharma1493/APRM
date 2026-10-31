/*
 * heap.c: array-based binary heap (see heap.h for the contract).
 * No globals, no static mutable state, no I/O.
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "heap.h"
#include "job.h"

#define HEAP_INITIAL_CAP 16

/* Pointer to slot i. O(1). */
static unsigned char *slot(const Heap *h, size_t i)
{
    return h->data + i * h->elem_size;
}

/* True when h looks initialised (has an element size and a compare). O(1). */
static int usable(const Heap *h)
{
    return h != NULL && h->elem_size != 0 && h->cmp != NULL && h->data != NULL;
}

/*
 * Swap slots i and j in place, through a small stack buffer in chunks, so no
 * allocation can fail and the regions never overlap (i != j).
 * O(elem_size) time, O(1) space.
 */
static void swap_slots(Heap *h, size_t i, size_t j)
{
    unsigned char tmp[64];
    unsigned char *a = slot(h, i), *b = slot(h, j);
    size_t left = h->elem_size, n;
    while (left > 0) {
        n = left < sizeof tmp ? left : sizeof tmp;
        memcpy(tmp, a, n);
        memcpy(a, b, n);
        memcpy(b, tmp, n);
        a += n;
        b += n;
        left -= n;
    }
}

/* Move the element at i up until its parent no longer compares after it.
 * O(log n) compares, O(1) space. */
static void sift_up(Heap *h, size_t i)
{
    size_t parent;
    while (i > 0) {
        parent = (i - 1) / 2;
        if (h->cmp(slot(h, i), slot(h, parent), h->ctx) >= 0) break;
        swap_slots(h, i, parent);
        i = parent;
    }
}

/* Move the element at i down until neither child compares before it.
 * Children of i are 2i+1 and 2i+2. Since i < len, 2i+2 <= 2*len, which fits in
 * size_t when elem_size >= 2 (the buffer holds len*elem_size bytes, so
 * len <= SIZE_MAX/2). For elem_size == 1 it would need a heap of more than
 * SIZE_MAX/2 bytes, which no real address space has. O(log n) compares, O(1) space. */
static void sift_down(Heap *h, size_t i)
{
    size_t left, right, best;
    for (;;) {
        left = 2 * i + 1;
        right = left + 1;
        best = i;
        if (left < h->len && h->cmp(slot(h, left), slot(h, best), h->ctx) < 0) best = left;
        if (right < h->len && h->cmp(slot(h, right), slot(h, best), h->ctx) < 0) best = right;
        if (best == i) break;
        swap_slots(h, i, best);
        i = best;
    }
}

/* See heap.h. O(1). */
int heap_init(Heap *h, size_t elem_size, HeapCmp cmp, void *ctx)
{
    if (h == NULL) return APRM_INVALID_ARGUMENT;
    memset(h, 0, sizeof *h);
    if (elem_size == 0 || cmp == NULL) return APRM_INVALID_ARGUMENT;
    if (elem_size > SIZE_MAX / HEAP_INITIAL_CAP) return APRM_OUT_OF_MEMORY;
    h->data = malloc(elem_size * HEAP_INITIAL_CAP);
    if (h->data == NULL) return APRM_OUT_OF_MEMORY;
    h->elem_size = elem_size;
    h->cap = HEAP_INITIAL_CAP;
    h->cmp = cmp;
    h->ctx = ctx;
    return APRM_OK;
}

/* See heap.h. O(1). Frees h->data; the caller owns the Heap struct itself. */
void heap_free(Heap *h)
{
    if (h == NULL) return;
    free(h->data);
    memset(h, 0, sizeof *h);
}

/* See heap.h. O(log n) amortised; growth doubles capacity with the size
 * product overflow-checked, and a failed realloc leaves the old buffer. */
int heap_push(Heap *h, const void *elem)
{
    size_t new_cap;
    unsigned char *grown;

    if (!usable(h) || elem == NULL) return APRM_INVALID_ARGUMENT;
    if (h->len == h->cap) {
        if (h->cap > SIZE_MAX / 2) return APRM_OUT_OF_MEMORY;
        new_cap = h->cap * 2;
        if (new_cap > SIZE_MAX / h->elem_size) return APRM_OUT_OF_MEMORY;
        grown = realloc(h->data, new_cap * h->elem_size);
        if (grown == NULL) return APRM_OUT_OF_MEMORY;  /* old buffer still valid */
        h->data = grown;
        h->cap = new_cap;
    }
    memcpy(slot(h, h->len), elem, h->elem_size);
    h->len++;
    sift_up(h, h->len - 1);
    return APRM_OK;
}

/* See heap.h. A failed realloc leaves the old buffer; sizes are overflow-checked. */
int heap_reserve(Heap *h, size_t n)
{
    size_t new_cap;
    unsigned char *grown;

    if (!usable(h)) return APRM_INVALID_ARGUMENT;
    if (n <= h->cap) return APRM_OK;
    new_cap = h->cap;
    if (new_cap <= SIZE_MAX / 2 && new_cap * 2 > n) new_cap *= 2;
    else new_cap = n;
    if (new_cap > SIZE_MAX / h->elem_size) return APRM_OUT_OF_MEMORY;
    grown = realloc(h->data, new_cap * h->elem_size);
    if (grown == NULL) return APRM_OUT_OF_MEMORY;
    h->data = grown;
    h->cap = new_cap;
    return APRM_OK;
}

/* See heap.h. O(log n). out is caller-owned and written only on success. */
int heap_pop(Heap *h, void *out)
{
    if (!usable(h) || out == NULL || h->len == 0) return APRM_INVALID_ARGUMENT;
    memcpy(out, slot(h, 0), h->elem_size);
    h->len--;
    if (h->len > 0) {
        memcpy(slot(h, 0), slot(h, h->len), h->elem_size);
        sift_down(h, 0);
    }
    return APRM_OK;
}

/* See heap.h. O(1). out is caller-owned and written only on success. */
int heap_peek(const Heap *h, void *out)
{
    if (!usable(h) || out == NULL || h->len == 0) return APRM_INVALID_ARGUMENT;
    memcpy(out, slot(h, 0), h->elem_size);
    return APRM_OK;
}

/*
 * See heap.h. Copies n elements, then sifts down every internal node from the
 * last parent (n/2 - 1) to the root. A node at height k costs O(k) and at most
 * n/2^(k+1) nodes have height k, so the total is O(n), not O(n log n).
 * If the current buffer is too small a new one is allocated first and swapped
 * in only after the allocation succeeded, so failure changes nothing.
 */
int heap_build(Heap *h, const void *elems, size_t n)
{
    unsigned char *fresh = NULL;
    size_t i;

    if (!usable(h) || (elems == NULL && n > 0)) return APRM_INVALID_ARGUMENT;
    if (n > h->cap) {
        if (n > SIZE_MAX / h->elem_size) return APRM_OUT_OF_MEMORY;
        fresh = malloc(n * h->elem_size);
        if (fresh == NULL) return APRM_OUT_OF_MEMORY;
        memcpy(fresh, elems, n * h->elem_size);
        free(h->data);
        h->data = fresh;
        h->cap = n;
    } else if (n > 0) {
        memmove(h->data, elems, n * h->elem_size);
    }
    h->len = n;
    for (i = n / 2; i > 0; i--) sift_down(h, i - 1);
    return APRM_OK;
}

/* See heap.h. O(1). */
size_t heap_size(const Heap *h)
{
    return h == NULL ? 0 : h->len;
}
