#!/bin/sh
# run_cli_tests.sh: console program tests (K-12): every exit code, the one-line
# stderr messages, --log, --metrics, --help, and "no output file on failure".
# Run from the repository root. The binary is $APRM_BIN, default build/aprm.

BIN=${APRM_BIN:-build/aprm}
CASES=tests/cases
[ -x "$BIN" ] || { echo "run_cli_tests.sh: $BIN not found (run make first)" >&2; exit 2; }

T=$(mktemp -d "${TMPDIR:-/tmp}/aprm_cli.XXXXXX") || exit 2
trap 'rm -rf "$T"' EXIT INT TERM

pass=0
fail=0
ok()  { pass=$((pass + 1)); }
bad() { fail=$((fail + 1)); echo "FAIL  $1"; }

# expect NAME EXIT STDERR_SUBSTRING -- args...
# Runs the program, checks the exit code, that stderr is exactly one line
# containing the substring, and that no file named $T/out.csv (or .tmp) exists.
expect() {
    name=$1; want=$2; sub=$3; shift 4
    rm -f "$T/out.csv" "$T/out.csv.tmp"
    "$BIN" "$@" >"$T/stdout" 2>"$T/stderr"
    got=$?
    lines=$(wc -l <"$T/stderr" | tr -d ' ')
    if [ "$got" != "$want" ]; then bad "$name: exit $got, want $want ($(cat "$T/stderr"))"; return; fi
    if [ "$lines" != "1" ]; then bad "$name: stderr has $lines lines, want 1"; return; fi
    if ! grep -qF -- "$sub" "$T/stderr"; then bad "$name: stderr '$(cat "$T/stderr")' lacks '$sub'"; return; fi
    if [ -e "$T/out.csv" ] || [ -e "$T/out.csv.tmp" ]; then bad "$name: an output file exists"; return; fi
    echo "ok    $name"
    ok
}

GOOD=$CASES/fcfs_basic.csv
OUT=$T/out.csv

# ---- exit 1: bad arguments ----
expect "exit-1 no arguments"        1 "missing --in"        -- 
expect "exit-1 missing --out"       1 "missing --out"       -- --in $GOOD
expect "exit-1 missing --in"        1 "missing --in"        -- --out $OUT
expect "exit-1 unknown flag"        1 "unknown argument"    -- --in $GOOD --out $OUT --bogus
expect "exit-1 positional"          1 "unknown argument"    -- --in $GOOD --out $OUT extra
expect "exit-1 flag=value form"     1 "unknown argument"    -- --in=$GOOD --out $OUT
expect "exit-1 missing value"       1 "needs a value"       -- --in $GOOD --out
expect "exit-1 unknown policy"      1 "unknown policy"      -- --in $GOOD --out $OUT --policy foo
expect "exit-1 --alpha-milli 1.5"   1 "whole number"        -- --in $GOOD --out $OUT --alpha-milli 1.5
expect "exit-1 empty number"        1 "whole number"        -- --in $GOOD --out $OUT --cpu ""
expect "exit-1 trailing junk"       1 "whole number"        -- --in $GOOD --out $OUT --cpu 8x
expect "exit-1 plus sign"           1 "whole number"        -- --in $GOOD --out $OUT --cpu +8
expect "exit-1 space"               1 "whole number"        -- --in $GOOD --out $OUT --cpu " 8"
expect "exit-1 overflow"            1 "whole number"        -- --in $GOOD --out $OUT --mem 99999999999999999999
expect "exit-1 cpu 0"               1 "INVALID_FIELD"       -- --in $GOOD --out $OUT --cpu 0
expect "exit-1 cpu too big"         1 "INVALID_FIELD"       -- --in $GOOD --out $OUT --cpu 1000001
expect "exit-1 mem 0"               1 "INVALID_FIELD"       -- --in $GOOD --out $OUT --mem 0
expect "exit-1 alpha 10001"         1 "INVALID_FIELD"       -- --in $GOOD --out $OUT --alpha-milli 10001
expect "exit-1 alpha -1"            1 "INVALID_FIELD"       -- --in $GOOD --out $OUT --alpha-milli -1
expect "exit-1 threshold 1000001"   1 "INVALID_FIELD"       -- --in $GOOD --out $OUT --threshold 1000001
expect "exit-1 eps 2"               1 "INVALID_FIELD"       -- --in $GOOD --out $OUT --eps 2
expect "exit-1 eps 0.001"           1 "INVALID_FIELD"       -- --in $GOOD --out $OUT --eps 0.001
expect "exit-1 eps 1e-1"            1 "decimal number"      -- --in $GOOD --out $OUT --eps 1e-1
expect "exit-1 eps .5"              1 "decimal number"      -- --in $GOOD --out $OUT --eps .5
expect "exit-1 eps empty"           1 "decimal number"      -- --in $GOOD --out $OUT --eps ""
expect "exit-1 --exact"             1 "exact solver not built yet" -- --in $GOOD --out $OUT --exact
expect "exit-1 same in/out"         1 "different files"     -- --in $GOOD --out $GOOD
expect "exit-1 same out/log"        1 "different files"     -- --in $GOOD --out $OUT --log $OUT

# ---- exit 2: input file errors ----
expect "exit-2 missing input file"  2 "cannot open input file" -- --in $T/nope.csv --out $OUT
expect "exit-2 input is a directory" 2 "cannot read input file" -- --in $T --out $OUT
printf 'id,arrival,duration,cpu,mem\n1,0,5,1,1\n' >"$T/badheader.csv"
expect "exit-2 bad header"          2 "PARSE_ERROR: Line 1: header must be id,arrival,duration,cpu,mem,priority." -- --in $T/badheader.csv --out $OUT
printf 'id,arrival,duration,cpu,mem,priority\n1,0,5,1,1,0\n2,0,5,x,1,0\n' >"$T/badnum.csv"
expect "exit-2 not a number"        2 "PARSE_ERROR: Line 3, column cpu: not a number." -- --in $T/badnum.csv --out $OUT
: >"$T/empty.csv"
expect "exit-2 empty file"          2 "PARSE_ERROR: Line 1: missing header" -- --in $T/empty.csv --out $OUT

# ---- exit 3: invalid job (all-or-nothing, D54) ----
expect "exit-3 capacity (default machine)" 3 \
    "CAPACITY_EXCEEDED: Job 3 needs 40960 MB; machine has 32768 MB. (line 4)" -- --in $CASES/capacity_reject.csv --out $OUT
printf 'id,arrival,duration,cpu,mem,priority\n1,0,5,1,1,0\n2,0,5,1,1,0\n1,3,5,1,1,0\n' >"$T/dup.csv"
expect "exit-3 duplicate id"        3 "DUPLICATE_ID: Job id 1 already exists. (line 4)" -- --in $T/dup.csv --out $OUT
printf 'id,arrival,duration,cpu,mem,priority\n1,0,5,1,1,10\n' >"$T/prio.csv"
expect "exit-3 priority out of range" 3 "INVALID_FIELD: Line 2, column priority: must be 0 to 9." -- --in $T/prio.csv --out $OUT
printf 'id,arrival,duration,cpu,mem,priority\r\n1,0,5,1,1,0\r\n2,0,5,99,1,0\r\n' >"$T/crlf.csv"
expect "exit-3 line number with CRLF" 3 "(line 3)" -- --in $T/crlf.csv --out $OUT

# An existing output file survives a failed run untouched.
echo "old" >"$T/keep.csv"
"$BIN" --in $CASES/capacity_reject.csv --out "$T/keep.csv" 2>/dev/null
if [ $? = 3 ] && [ "$(cat "$T/keep.csv")" = "old" ] && [ ! -e "$T/keep.csv.tmp" ]; then echo "ok    exit-3 leaves an existing output file alone"; ok; else bad "exit-3 changed an existing output file"; fi

# No --log / --metrics file after a failure either.
rm -f "$T/l.txt" "$T/m.json"
"$BIN" --in $CASES/capacity_reject.csv --out $OUT --log "$T/l.txt" --metrics "$T/m.json" 2>/dev/null
if [ $? = 3 ] && [ ! -e "$T/l.txt" ] && [ ! -e "$T/m.json" ] && [ ! -e $OUT ]; then echo "ok    exit-3 writes no log or metrics file"; ok; else bad "exit-3 left a file behind"; fi

# ---- exit 4: internal error (unimplemented policy) ----
for p in priority sjf aging reserve knapsack; do
    expect "exit-4 policy $p not implemented" 4 "INVALID_ARGUMENT: policy $p is not implemented yet." -- --policy $p --in $GOOD --out $OUT
done
# An output that cannot be written is an internal error and leaves nothing.
expect "exit-4 unwritable output"   4 "cannot write" -- --in $GOOD --out $T/no_such_dir/out.csv

# ---- success: results, --log, --metrics ----
rm -f "$OUT" "$T/l.txt" "$T/m.json"
"$BIN" --policy fcfs --in $CASES/fcfs_skip.csv --out "$OUT" --log "$T/l.txt" --metrics "$T/m.json" >"$T/stdout" 2>"$T/stderr"
rc=$?
if [ $rc = 0 ] && [ ! -s "$T/stderr" ] && cmp -s "$OUT" $CASES/fcfs_skip.fcfs.expected.csv; then echo "ok    success: results match"; ok; else bad "success run (rc $rc)"; fi
if [ ! -e "$OUT.tmp" ] && [ ! -e "$T/l.txt.tmp" ] && [ ! -e "$T/m.json.tmp" ]; then echo "ok    success: no temp files left"; ok; else bad "temp files left behind"; fi
if [ "$(wc -l <"$T/l.txt" | tr -d ' ')" = "10" ] &&
   [ "$(sed -n 1p "$T/l.txt")" = "Job 1 arrived with priority 2." ] &&
   [ "$(sed -n 4p "$T/l.txt")" = "Job 2 skipped: needs 16000 MB, only 8768 MB free." ] &&
   [ "$(sed -n 10p "$T/l.txt")" = "Job 2 finished after 6 ticks; freed 4 cores and 16000 MB." ]; then
    echo "ok    --log: one sentence per line"; ok
else bad "--log content"; fi
want='{"ok":true,"data":{"avg_wait":3.000000000,"max_wait":9,"avg_turnaround":9.333333333,"weighted_completion":136,"makespan":16,"util_cpu":0.273437500,"util_mem":0.663757324,"avg_wait_by_priority":[null,0.000000000,0.000000000,null,null,9.000000000,null,null,null,null]}}'
if [ "$(cat "$T/m.json")" = "$want" ]; then echo "ok    --metrics: PRD shape and values"; ok; else bad "--metrics content: $(cat "$T/m.json")"; fi

# Existing files are replaced on success.
echo old >"$OUT"
"$BIN" --in $GOOD --out "$OUT" 2>/dev/null
if [ $? = 0 ] && cmp -s "$OUT" $CASES/fcfs_basic.fcfs.expected.csv; then echo "ok    success replaces an existing output"; ok; else bad "replace existing output"; fi

# Header-only input: no jobs, header-only results.
printf 'id,arrival,duration,cpu,mem,priority\n' >"$T/none.csv"
"$BIN" --in "$T/none.csv" --out "$T/none.out" 2>/dev/null
if [ $? = 0 ] && [ "$(cat "$T/none.out")" = "id,arrival,start,finish,wait,turnaround,priority,cpu,mem" ]; then echo "ok    header-only input"; ok; else bad "header-only input"; fi

# Machine flags are honoured: 1 core makes job 1 of fcfs_basic (16 cores) invalid.
expect "exit-3 --cpu 1 too small"   3 "CAPACITY_EXCEEDED: Job 1 needs 16 cores; machine has 1 cores. (line 2)" -- --in $GOOD --out $OUT --cpu 1

# ---- --help ----
"$BIN" --help >"$T/stdout" 2>"$T/stderr"
if [ $? = 0 ] && [ ! -s "$T/stderr" ] && grep -q "^usage: aprm --in" "$T/stdout" && grep -q "exit codes" "$T/stdout"; then echo "ok    --help"; ok; else bad "--help"; fi

echo "cli: $pass passed, $fail failed"
[ $fail -eq 0 ]
