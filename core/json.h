/*
 * json.h: growable, escaping JSON writer (K-04, decision D53 / old O-11).
 *
 * Ownership: a JsonBuf owns its text buffer. json_cstr() returns a pointer
 * into it that stays valid until the next write, json_reset() or json_free().
 * Callers who need the text longer must copy it. All functions are
 * pure C11, no globals; every JsonBuf is independent.
 *
 * Errors are sticky: the first error is stored in `err`; after that every
 * write is a no-op until json_reset(). Each token (comma + text) is written
 * atomically, so the buffer always holds the text of the last complete token
 * and is always NUL-terminated (or is empty with json_cstr() == "").
 */
#ifndef APRM_JSON_H
#define APRM_JSON_H

#include <stddef.h>
#include <stdint.h>

#define JSON_MAX_DEPTH 32   /* maximum nesting of objects/arrays */

typedef struct {
    char  *buf;        /* NUL-terminated text, owned; NULL until first write */
    size_t len;        /* bytes used, excluding the NUL */
    size_t cap;        /* bytes allocated (including room for the NUL) */
    size_t max_cap;    /* 0 = no limit; else growth beyond it is OUT_OF_MEMORY */
    int    err;        /* first error (APRM_OUT_OF_MEMORY or APRM_INVALID_ARGUMENT),
                          sticky; APRM_OK (0) if fine */
    int    depth;      /* open objects/arrays */
    int    after_key;  /* 1 if a key was written and its value is awaited */
    char   kind[JSON_MAX_DEPTH];   /* 'o' or 'a' per open level */
    char   has[JSON_MAX_DEPTH];    /* level already holds a member? (comma needed) */
} JsonBuf;

void json_init(JsonBuf *j);          /* O(1); no allocation until first write */
void json_free(JsonBuf *j);          /* frees the buffer; j may be re-initialised */
void json_reset(JsonBuf *j);         /* len = 0, error cleared, keeps capacity */
void json_set_limit(JsonBuf *j, size_t max_cap); /* cap total bytes (0 = none); also the test hook for OOM */

void json_obj_begin(JsonBuf *j);
void json_obj_end(JsonBuf *j);
void json_arr_begin(JsonBuf *j);
void json_arr_end(JsonBuf *j);
void json_key(JsonBuf *j, const char *k);   /* only inside an object */
void json_str(JsonBuf *j, const char *s);   /* escapes " \ and bytes < 0x20; NULL prints null */
void json_i64(JsonBuf *j, int64_t v);
void json_bool(JsonBuf *j, int b);
void json_null(JsonBuf *j);
void json_milli(JsonBuf *j, int64_t milli); /* 6200 -> 6.200, -500 -> -0.500, 0 -> 0.000 */

/* Envelope helpers (PRD section 5). Compact output, no spaces.
 * json_ok_begin writes {"ok":true,"data": and the caller then writes exactly
 * one value; json_ok_end closes the envelope.
 * json_error writes a whole error envelope; `field` may be NULL (omitted).
 * `code` is the negative APRM_* status as an integer. */
void json_ok_begin(JsonBuf *j);
void json_ok_end(JsonBuf *j);
void json_error(JsonBuf *j, int code, const char *message, const char *field);

int         json_status(const JsonBuf *j);  /* APRM_OK or the sticky error */
const char *json_cstr(const JsonBuf *j);    /* the text; "" if nothing written */
size_t      json_len(const JsonBuf *j);

#endif /* APRM_JSON_H */
