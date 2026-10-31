/*
 * heap.h: hand-written array-based binary heap (BLUEPRINT 3.1, issue K-03).
 *
 * One implementation serves the waiting queue (ordered by policy key) and the
 * running set (ordered by finish time): the caller supplies a compare
 * function and a context pointer. Elements are stored by value, elem_size
 * bytes each; to store pointers use elem_size == sizeof(void *).
 *
 * The tree is a complete binary tree in an array: parent of i is (i-1)/2,
 * children are 2i+1 and 2i+2. Invariant: for every i > 0, the element at
 * parent(i) does not compare after the element at i, so index 0 is the best.
 *
 * No global or static mutable state; everything lives in the Heap struct.
 * Return codes are the APRM_* codes of job.h (PRD 5).
 */
#ifndef APRM_HEAP_H
#define APRM_HEAP_H

#include <stddef.h>

/* Returns <0 if a should come out before b, >0 if after. It should return 0
 * only for equal elements: end every compare with the arrival-then-id
 * tie-break so the pop order is deterministic. */
typedef int (*HeapCmp)(const void *a, const void *b, void *ctx);

typedef struct {
    unsigned char *data;  /* elem_size * cap bytes, owned by the heap */
    size_t elem_size, len, cap;
    HeapCmp cmp;
    void *ctx;
} Heap;

/* Initialise an empty heap with a small initial capacity.
 * Returns APRM_OK, APRM_INVALID_ARGUMENT (NULL h or cmp, elem_size == 0) or
 * APRM_OUT_OF_MEMORY (on failure *h is a valid empty heap with no storage).
 * Do not call it on a live heap: that would leak its buffer (call heap_free
 * first). O(1) time, O(1) space. The heap owns its buffer; release it with heap_free. */
int heap_init(Heap *h, size_t elem_size, HeapCmp cmp, void *ctx);

/* Free the buffer and reset *h to an empty, storage-less state; call
 * heap_init again to reuse it. Safe on NULL and on an already freed heap.
 * O(1) time. */
void heap_free(Heap *h);

/* Copy *elem into the heap (sift-up). Returns APRM_OK, APRM_INVALID_ARGUMENT
 * (NULL pointer or uninitialised heap) or APRM_OUT_OF_MEMORY (growth failed;
 * the heap is unchanged and still valid). O(log n) worst case, amortised
 * because the buffer doubles; O(n) extra space only while growing. The caller
 * keeps ownership of *elem. */
int heap_push(Heap *h, const void *elem);

/* Remove the best element and copy it to *out (sift-down). Returns APRM_OK or
 * APRM_INVALID_ARGUMENT (NULL pointer, uninitialised heap, or empty heap).
 * O(log n) time, O(1) extra space. *out is caller-owned. */
int heap_pop(Heap *h, void *out);

/* Copy the best element to *out without removing it. Returns APRM_OK or
 * APRM_INVALID_ARGUMENT (NULL pointer, uninitialised heap, or empty heap).
 * O(1) time and space. *out is caller-owned. */
int heap_peek(const Heap *h, void *out);

/* Replace the contents with the n elements in elems (copied), then heapify
 * bottom-up. Returns APRM_OK, APRM_INVALID_ARGUMENT (NULL h, or NULL elems
 * with n > 0) or APRM_OUT_OF_MEMORY (the heap keeps its old contents).
 * O(n) time (most nodes are near the leaves), O(n) space for the copy.
 * elems stays caller-owned; the heap never keeps a pointer to it. */
int heap_build(Heap *h, const void *elems, size_t n);

/* Make sure the heap can hold at least n elements without growing again, so
 * a later heap_push cannot fail for lack of memory. Never shrinks. Returns
 * APRM_OK, APRM_INVALID_ARGUMENT (NULL or uninitialised heap) or
 * APRM_OUT_OF_MEMORY (heap unchanged and valid). Growth is at least doubling,
 * so repeated calls with a slowly rising n cost O(1) amortised per element;
 * O(n) when it grows, O(1) when it does not. The heap owns the buffer. */
int heap_reserve(Heap *h, size_t n);

/* Number of elements stored; 0 for NULL. O(1). */
size_t heap_size(const Heap *h);

#endif /* APRM_HEAP_H */
