/* json.c: growable, escaping JSON writer. See json.h for the contract. */
#include "json.h"
#include "job.h"

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define JSON_FIRST_CAP 256

/* Set the sticky error if none is set yet. O(1). */
static void fail(JsonBuf *j, int code)
{
    if (j->err == APRM_OK) j->err = code;
}

/* Make room for n more bytes plus the NUL. Doubles capacity, with overflow
 * checks and the optional max_cap. On failure sets the sticky error and
 * leaves the buffer untouched. Amortised O(1) per byte. Returns 1 on success. */
static int ensure(JsonBuf *j, size_t n)
{
    size_t need, newcap;
    char *p;
    if (n > SIZE_MAX - j->len - 1) { fail(j, APRM_OUT_OF_MEMORY); return 0; }
    need = j->len + n + 1;
    if (need <= j->cap) return 1;
    if (j->max_cap != 0 && need > j->max_cap) { fail(j, APRM_OUT_OF_MEMORY); return 0; }
    newcap = j->cap ? j->cap : JSON_FIRST_CAP;
    while (newcap < need) {
        if (newcap > SIZE_MAX / 2) { newcap = need; break; }
        newcap *= 2;
    }
    if (j->max_cap != 0 && newcap > j->max_cap) newcap = j->max_cap;
    p = (char *)realloc(j->buf, newcap);
    if (p == NULL) { fail(j, APRM_OUT_OF_MEMORY); return 0; }
    j->buf = p;
    j->cap = newcap;
    return 1;
}

/* Reserve n bytes for one token (plus a comma if the container already has a
 * member) and check key/value placement. `is_key`: 1 for object keys, 0 for
 * values and openers. Returns where the n token bytes go,
 * or NULL if an error is set. The caller must write exactly n bytes and then
 * call done(). The buffer is not changed until reservation succeeded. */
static char *start(JsonBuf *j, size_t n, int is_key)
{
    int comma = 0;
    char *p;
    if (j->err != APRM_OK) return NULL;
    if (j->depth > 0) {
        char k = j->kind[j->depth - 1];
        if (is_key) {
            if (k != 'o' || j->after_key) { fail(j, APRM_INVALID_ARGUMENT); return NULL; }
        } else if (k == 'o' && !j->after_key) {
            fail(j, APRM_INVALID_ARGUMENT); return NULL;   /* value without key */
        }
        comma = j->has[j->depth - 1] && !j->after_key;
    } else if (is_key || j->len > 0) {
        /* a key outside an object, or a second top-level value */
        fail(j, APRM_INVALID_ARGUMENT); return NULL;
    }
    if (n > SIZE_MAX - 1) { fail(j, APRM_OUT_OF_MEMORY); return NULL; }
    if (!ensure(j, n + (size_t)comma)) return NULL;
    p = j->buf + j->len;
    if (comma) *p++ = ',';
    if (j->depth > 0) j->has[j->depth - 1] = 1;
    j->after_key = 0;
    j->len += (size_t)comma + n;
    j->buf[j->len] = '\0';   /* terminator now; the caller fills the n bytes */
    return p;
}

/* Length (1..4) of the valid UTF-8 sequence (RFC 3629) starting at s, or 0 if
 * the byte at s cannot start one: stray continuation, overlong (C0, C1,
 * E0 80..9F, F0 80..8F), surrogate (ED A0..BF), above U+10FFFF (F4 90.., F5..FF)
 * or truncated. s is NUL-terminated, and NUL is never a continuation byte, so
 * the reads stay inside the string. O(1). */
static int utf8_len(const unsigned char *s)
{
    unsigned char c = s[0], lo = 0x80, hi = 0xBF;
    int n, i;
    if (c < 0x80) return 1;
    if (c >= 0xC2 && c <= 0xDF) n = 2;
    else if (c >= 0xE0 && c <= 0xEF) {
        n = 3;
        if (c == 0xE0) lo = 0xA0;
        if (c == 0xED) hi = 0x9F;
    } else if (c >= 0xF0 && c <= 0xF4) {
        n = 4;
        if (c == 0xF0) lo = 0x90;
        if (c == 0xF4) hi = 0x8F;
    } else return 0;
    if (s[1] < lo || s[1] > hi) return 0;
    for (i = 2; i < n; i++)
        if (s[i] < 0x80 || s[i] > 0xBF) return 0;
    return n;
}

/* Number of bytes the escaped form of s needs (without quotes). Must agree
 * exactly with esc_write. O(len). */
static size_t esc_len(const char *s)
{
    size_t n = 0;
    const unsigned char *u = (const unsigned char *)s;
    while (*u) {
        unsigned char c = *u;
        int m = utf8_len(u);
        if (c >= 0x80) {
            if (m == 0) { n += 3; u += 1; }       /* U+FFFD, one per bad byte */
            else { n += (size_t)m; u += m; }
            continue;
        }
        if (c == '"' || c == '\\' || c == '\n' || c == '\t' || c == '\r' ||
            c == '\b' || c == '\f') n += 2;
        else if (c < 0x20) n += 6;
        else n += 1;
        u++;
    }
    return n;
}

/* Write the quoted, escaped form of s at p; returns the end pointer.
 * Invalid UTF-8 bytes each become the three bytes EF BF BD. O(len). */
static char *esc_write(char *p, const char *s)
{
    static const char hex[] = "0123456789abcdef";
    const unsigned char *u = (const unsigned char *)s;
    *p++ = '"';
    while (*u) {
        unsigned char c = *u;
        if (c >= 0x80) {
            int m = utf8_len(u), i;
            if (m == 0) {
                *p++ = (char)0xEF; *p++ = (char)0xBF; *p++ = (char)0xBD;
                u++;
            } else {
                for (i = 0; i < m; i++) *p++ = (char)u[i];
                u += m;
            }
            continue;
        }
        switch (c) {
        case '"':  *p++ = '\\'; *p++ = '"';  break;
        case '\\': *p++ = '\\'; *p++ = '\\'; break;
        case '\n': *p++ = '\\'; *p++ = 'n';  break;
        case '\t': *p++ = '\\'; *p++ = 't';  break;
        case '\r': *p++ = '\\'; *p++ = 'r';  break;
        case '\b': *p++ = '\\'; *p++ = 'b';  break;
        case '\f': *p++ = '\\'; *p++ = 'f';  break;
        default:
            if (c < 0x20) {
                *p++ = '\\'; *p++ = 'u'; *p++ = '0'; *p++ = '0';
                *p++ = hex[c >> 4]; *p++ = hex[c & 15];
            } else {
                *p++ = (char)c;
            }
        }
        u++;
    }
    *p++ = '"';
    return p;
}

/* Copy a short literal token. O(len). */
static void put(JsonBuf *j, const char *s, size_t n)
{
    char *p = start(j, n, 0);
    if (p) memcpy(p, s, n);
}

/* Initialise an empty writer; no allocation. O(1). */
void json_init(JsonBuf *j)
{
    memset(j, 0, sizeof *j);
}

/* Free the buffer and reset to the empty state. O(1). */
void json_free(JsonBuf *j)
{
    free(j->buf);
    json_init(j);
}

/* Forget content and error, keep the allocation. O(1). */
void json_reset(JsonBuf *j)
{
    j->len = 0;
    if (j->buf) j->buf[0] = '\0';
    j->err = APRM_OK;
    j->depth = 0;
    j->after_key = 0;
}

/* Limit total buffer bytes (including the NUL); 0 = unlimited. O(1). */
void json_set_limit(JsonBuf *j, size_t max_cap)
{
    j->max_cap = max_cap;
}

/* Open an object or array: writes the bracket and pushes a level. O(1). */
static void begin(JsonBuf *j, char open, char kind)
{
    char *p;
    if (j->err == APRM_OK && j->depth >= JSON_MAX_DEPTH) { fail(j, APRM_INVALID_ARGUMENT); return; }
    p = start(j, 1, 0);
    if (!p) return;
    *p = open;
    j->kind[j->depth] = kind;
    j->has[j->depth] = 0;
    j->depth++;
}

/* Close the current container; must match its kind and not follow a key. O(1). */
static void end(JsonBuf *j, char close, char kind)
{
    if (j->err != APRM_OK) return;
    if (j->depth == 0 || j->kind[j->depth - 1] != kind || j->after_key) {
        fail(j, APRM_INVALID_ARGUMENT); return;
    }
    if (!ensure(j, 1)) return;
    j->buf[j->len++] = close;
    j->buf[j->len] = '\0';
    j->depth--;
}

/* Open an object "{" (O(1)). */
void json_obj_begin(JsonBuf *j) { begin(j, '{', 'o'); }
/* Close the current object "}" (O(1)); error if the open level is not an object. */
void json_obj_end(JsonBuf *j)   { end(j, '}', 'o'); }
/* Open an array "[" (O(1)). */
void json_arr_begin(JsonBuf *j) { begin(j, '[', 'a'); }
/* Close the current array "]" (O(1)); error if the open level is not an array. */
void json_arr_end(JsonBuf *j)   { end(j, ']', 'a'); }

/* Write an object key and the colon. O(len k). */
void json_key(JsonBuf *j, const char *k)
{
    char *p;
    if (k == NULL) { fail(j, APRM_INVALID_ARGUMENT); return; }
    p = start(j, esc_len(k) + 2 + 1, 1);
    if (!p) return;
    p = esc_write(p, k);
    *p = ':';
    j->after_key = 1;
}

/* Write an escaped string value (NULL prints null). O(len s). */
void json_str(JsonBuf *j, const char *s)
{
    char *p;
    if (s == NULL) { json_null(j); return; }
    p = start(j, esc_len(s) + 2, 0);
    if (p) esc_write(p, s);
}

/* Write a 64-bit integer, INT64_MIN included. O(1). */
void json_i64(JsonBuf *j, int64_t v)
{
    char tmp[32];
    int n = snprintf(tmp, sizeof tmp, "%" PRId64, v);
    put(j, tmp, (size_t)n);
}

/* Write true or false. O(1). */
void json_bool(JsonBuf *j, int b)
{
    if (b) put(j, "true", 4); else put(j, "false", 5);
}

/* Write null. O(1). */
void json_null(JsonBuf *j)
{
    put(j, "null", 4);
}

/* Write milli/1000 with exactly three decimals using integers only. The sign
 * is printed once, in front, and the magnitude is taken as unsigned so
 * INT64_MIN works and -500 gives -0.500 (never 0.-500). O(1). */
void json_milli(JsonBuf *j, int64_t milli)
{
    char tmp[48];
    uint64_t mag = milli < 0 ? (uint64_t)0 - (uint64_t)milli : (uint64_t)milli;
    int n = snprintf(tmp, sizeof tmp, "%s%" PRIu64 ".%03" PRIu64,
                     milli < 0 ? "-" : "", mag / 1000, mag % 1000);
    put(j, tmp, (size_t)n);
}

/* Write whole.frac with exactly nine decimals, integers only (K-11, D61).
 * frac is the fractional part in billionths and must be below 10^9, else the
 * value is a misuse and the buffer gets APRM_INVALID_ARGUMENT. Non-negative
 * values only: metrics are never negative. O(1). */
void json_fixed9(JsonBuf *j, uint64_t whole, uint32_t frac)
{
    char tmp[48];
    int n;
    if (frac >= 1000000000u) { fail(j, APRM_INVALID_ARGUMENT); return; }
    n = snprintf(tmp, sizeof tmp, "%" PRIu64 ".%09" PRIu32, whole, frac);
    put(j, tmp, (size_t)n);
}

/* Start the success envelope: {"ok":true,"data": ; then one value, then
 * json_ok_end. O(1). */
void json_ok_begin(JsonBuf *j)
{
    json_obj_begin(j);
    json_key(j, "ok");
    json_bool(j, 1);
    json_key(j, "data");
}

/* Close the success envelope. O(1). */
void json_ok_end(JsonBuf *j)
{
    json_obj_end(j);
}

/* Write a whole error envelope. field may be NULL. O(len message). */
void json_error(JsonBuf *j, int code, const char *message, const char *field)
{
    json_obj_begin(j);
    json_key(j, "ok");
    json_bool(j, 0);
    json_key(j, "error");
    json_obj_begin(j);
    json_key(j, "code");
    json_i64(j, code);
    json_key(j, "message");
    json_str(j, message ? message : "");
    if (field != NULL) {
        json_key(j, "field");
        json_str(j, field);
    }
    json_obj_end(j);
    json_obj_end(j);
}

/* Sticky status: APRM_OK or the first error. O(1). */
int json_status(const JsonBuf *j)
{
    return j->err;
}

/* The text so far; owned by the JsonBuf, valid until the next write. O(1). */
const char *json_cstr(const JsonBuf *j)
{
    return j->buf ? j->buf : "";
}

/* Bytes written, excluding the NUL. O(1). */
size_t json_len(const JsonBuf *j)
{
    return j->len;
}
