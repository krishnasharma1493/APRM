/* test_json.c: escaping, comma handling, milli format, limits, growth, OOM, envelope. */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "../../core/job.h"
#include "../../core/json.h"
#include "test_main.h"

/* Write one milli value and compare with the expected text. */
static int milli_is(int64_t v, const char *want)
{
    JsonBuf j;
    int ok;
    json_init(&j);
    json_milli(&j, v);
    ok = json_status(&j) == APRM_OK && strcmp(json_cstr(&j), want) == 0;
    json_free(&j);
    return ok;
}

static void test_json_escape(void)
{
    JsonBuf j;
    json_init(&j);
    json_str(&j, "a\"b\\c\nd\te\x01" "f\r\b\f\x1f");
    CHECK(strcmp(json_cstr(&j), "\"a\\\"b\\\\c\\nd\\te\\u0001f\\r\\b\\f\\u001f\"") == 0);
    json_free(&j);

    json_init(&j);   /* keys are escaped too; UTF-8 bytes pass through */
    json_obj_begin(&j); json_key(&j, "k\"\n"); json_str(&j, "\xc3\xa9"); json_obj_end(&j);
    CHECK(strcmp(json_cstr(&j), "{\"k\\\"\\n\":\"\xc3\xa9\"}") == 0);
    json_free(&j);

    json_init(&j);
    json_str(&j, "");
    CHECK(strcmp(json_cstr(&j), "\"\"") == 0);
    json_reset(&j);
    json_str(&j, NULL);
    CHECK(strcmp(json_cstr(&j), "null") == 0);
    json_free(&j);
}

static void test_json_nested(void)
{
    JsonBuf j;
    json_init(&j);
    json_obj_begin(&j);
    json_key(&j, "jobs");
    json_arr_begin(&j);
    json_obj_begin(&j); json_key(&j, "id"); json_i64(&j, 1); json_key(&j, "ok"); json_bool(&j, 1); json_obj_end(&j);
    json_obj_begin(&j); json_key(&j, "id"); json_i64(&j, 2); json_key(&j, "x"); json_null(&j); json_obj_end(&j);
    json_arr_begin(&j); json_arr_end(&j);
    json_arr_end(&j);
    json_key(&j, "empty"); json_obj_begin(&j); json_obj_end(&j);
    json_key(&j, "s"); json_milli(&j, 6200);
    json_obj_end(&j);
    CHECK(json_status(&j) == APRM_OK);
    CHECK(strcmp(json_cstr(&j),
        "{\"jobs\":[{\"id\":1,\"ok\":true},{\"id\":2,\"x\":null},[]],\"empty\":{},\"s\":6.200}") == 0);
    CHECK(json_len(&j) == strlen(json_cstr(&j)));
    json_free(&j);

    json_init(&j);   /* top-level array of scalars */
    json_arr_begin(&j); json_i64(&j, 1); json_i64(&j, 2); json_str(&j, "x"); json_arr_end(&j);
    CHECK(strcmp(json_cstr(&j), "[1,2,\"x\"]") == 0);
    json_free(&j);
}

static void test_json_milli(void)
{
    CHECK(milli_is(6200, "6.200"));
    CHECK(milli_is(0, "0.000"));
    CHECK(milli_is(-1500, "-1.500"));
    CHECK(milli_is(999, "0.999"));
    CHECK(milli_is(1000000123, "1000000.123"));
    /* negatives between -999 and -1: sign once, never 0.-500 */
    CHECK(milli_is(-500, "-0.500"));
    CHECK(milli_is(-1, "-0.001"));
    CHECK(milli_is(-999, "-0.999"));
    CHECK(milli_is(-1000, "-1.000"));
    CHECK(milli_is(1, "0.001"));
    CHECK(milli_is(INT64_MAX, "9223372036854775.807"));
    CHECK(milli_is(INT64_MIN, "-9223372036854775.808"));
}

static void test_json_i64_limits(void)
{
    JsonBuf j;
    json_init(&j);
    json_arr_begin(&j); json_i64(&j, INT64_MIN); json_i64(&j, INT64_MAX); json_i64(&j, 0); json_i64(&j, -1); json_arr_end(&j);
    CHECK(strcmp(json_cstr(&j), "[-9223372036854775808,9223372036854775807,0,-1]") == 0);
    json_free(&j);
}

static void test_json_growth(void)
{
    JsonBuf j;
    size_t i, expect = 2;   /* [ ] */
    char chunk[1001];
    memset(chunk, 'x', 1000); chunk[1000] = '\0';
    json_init(&j);
    CHECK(json_len(&j) == 0 && strcmp(json_cstr(&j), "") == 0 && j.buf == NULL);
    json_arr_begin(&j);
    for (i = 0; i < 1024; i++) {   /* about 1 MB */
        json_str(&j, chunk);
        expect += 1002 + (i > 0 ? 1 : 0);
    }
    json_arr_end(&j);
    CHECK(json_status(&j) == APRM_OK);
    CHECK(json_len(&j) == expect);
    CHECK(j.buf[json_len(&j)] == '\0' && strlen(j.buf) == expect);
    CHECK(j.buf[0] == '[' && j.buf[1] == '"' && j.buf[1001] == 'x' && j.buf[1002] == '"' && j.buf[1003] == ',');
    CHECK(j.buf[expect - 1] == ']' && j.buf[expect - 2] == '"');
    /* reset keeps capacity */
    {
        size_t cap = j.cap;
        json_reset(&j);
        CHECK(j.cap == cap && json_len(&j) == 0 && json_cstr(&j)[0] == '\0');
        json_str(&j, "ok");
        CHECK(strcmp(json_cstr(&j), "\"ok\"") == 0);
    }
    json_free(&j);
}

static void test_json_oom(void)
{
    JsonBuf j;
    int i;
    /* limit hit on the very first write: nothing allocated, "" returned */
    json_init(&j);
    json_set_limit(&j, 4);
    json_str(&j, "hello");
    CHECK(json_status(&j) == APRM_OUT_OF_MEMORY);
    CHECK(strcmp(json_cstr(&j), "") == 0);
    json_free(&j);

    /* limit hit mid-way: buffer keeps last complete token, NUL-terminated, sticky */
    json_init(&j);
    json_set_limit(&j, 16);
    json_arr_begin(&j);
    json_str(&j, "abc");        /* [ "abc" => 6 bytes */
    json_str(&j, "defghijkl");  /* would exceed 16 */
    CHECK(json_status(&j) == APRM_OUT_OF_MEMORY);
    CHECK(strcmp(json_cstr(&j), "[\"abc\"") == 0);
    CHECK(j.buf[j.len] == '\0');
    json_str(&j, "z"); json_arr_end(&j); json_i64(&j, 5);   /* all no-ops */
    CHECK(strcmp(json_cstr(&j), "[\"abc\"") == 0);
    CHECK(json_status(&j) == APRM_OUT_OF_MEMORY);
    json_reset(&j);
    CHECK(json_status(&j) == APRM_OK);
    json_str(&j, "q");
    CHECK(strcmp(json_cstr(&j), "\"q\"") == 0);
    json_free(&j);

    /* a loop that eventually hits a small limit never overruns */
    json_init(&j);
    json_set_limit(&j, 1000);
    for (i = 0; i < 1000; i++) json_i64(&j, 123456789);
    CHECK(json_status(&j) == APRM_OUT_OF_MEMORY);
    CHECK(j.len < 1000 && j.buf[j.len] == '\0');
    json_free(&j);
}

static void test_json_misuse(void)
{
    JsonBuf j;
    int i;
    json_init(&j); json_obj_begin(&j); json_i64(&j, 1);          /* value without key */
    CHECK(json_status(&j) == APRM_INVALID_ARGUMENT); json_free(&j);
    json_init(&j); json_arr_begin(&j); json_key(&j, "a");        /* key in array */
    CHECK(json_status(&j) == APRM_INVALID_ARGUMENT); json_free(&j);
    json_init(&j); json_arr_begin(&j); json_obj_end(&j);         /* wrong closer */
    CHECK(json_status(&j) == APRM_INVALID_ARGUMENT); json_free(&j);
    json_init(&j); json_arr_end(&j);                             /* nothing open */
    CHECK(json_status(&j) == APRM_INVALID_ARGUMENT); json_free(&j);
    json_init(&j); json_obj_begin(&j); json_key(&j, "a"); json_obj_end(&j);  /* dangling key */
    CHECK(json_status(&j) == APRM_INVALID_ARGUMENT); json_free(&j);
    json_init(&j);
    for (i = 0; i < JSON_MAX_DEPTH + 1; i++) json_arr_begin(&j);  /* too deep */
    CHECK(json_status(&j) == APRM_INVALID_ARGUMENT); json_free(&j);
}

static void test_json_envelope(void)
{
    JsonBuf j;
    json_init(&j);
    json_ok_begin(&j);
    json_obj_begin(&j); json_key(&j, "n"); json_i64(&j, 3); json_obj_end(&j);
    json_ok_end(&j);
    CHECK(strcmp(json_cstr(&j), "{\"ok\":true,\"data\":{\"n\":3}}") == 0);
    json_reset(&j);
    json_ok_begin(&j); json_arr_begin(&j); json_arr_end(&j); json_ok_end(&j);
    CHECK(strcmp(json_cstr(&j), "{\"ok\":true,\"data\":[]}") == 0);
    json_reset(&j);
    json_error(&j, APRM_INVALID_FIELD, "priority must be 0..9", "priority");
    CHECK(strcmp(json_cstr(&j),
        "{\"ok\":false,\"error\":{\"code\":-2,\"message\":\"priority must be 0..9\",\"field\":\"priority\"}}") == 0);
    json_reset(&j);
    json_error(&j, APRM_OUT_OF_MEMORY, "say \"no\"", NULL);
    CHECK(strcmp(json_cstr(&j),
        "{\"ok\":false,\"error\":{\"code\":-7,\"message\":\"say \\\"no\\\"\"}}") == 0);
    CHECK(json_status(&j) == APRM_OK);
    json_free(&j);
}

int main(void)
{
    test_json_escape();
    test_json_nested();
    test_json_milli();
    test_json_i64_limits();
    test_json_growth();
    test_json_oom();
    test_json_misuse();
    test_json_envelope();
    return TEST_REPORT();
}
