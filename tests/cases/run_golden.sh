#!/bin/sh
# run_golden.sh: runs every golden case through the console program (K-12).
#
# Run from the repository root (make does). The binary is $APRM_BIN, default
# build/aprm.
#  - For every tests/cases/<case>.<policy>.expected.csv it runs
#      $APRM_BIN --policy <policy> --in <case>.csv --out <tmp> $(cat <case>.args)
#    and compares the output with the expected file byte for byte.
#  - For every tests/cases/<case>.expected.exit (console-level case, D54) it
#    checks the exit code, that stderr is exactly the one line in
#    <case>.expected.stderr, and that no output file was created.
#  - Cases are never edited here; a mismatch is a failure.

# Policies whose engine code does not exist yet. Their cases are SKIPPED, not
# failed. Each issue removes its policy from this list when it lands:
#   (none now: reserve landed in K-26, knapsack in K-34)
SKIP_POLICIES=""

BIN=${APRM_BIN:-build/aprm}
DIR=tests/cases

[ -x "$BIN" ] || { echo "run_golden.sh: $BIN not found (run make first)" >&2; exit 2; }
[ -d "$DIR" ] || { echo "run_golden.sh: run from the repository root" >&2; exit 2; }

TMP=$(mktemp -d "${TMPDIR:-/tmp}/aprm_golden.XXXXXX") || exit 2
trap 'rm -rf "$TMP"' EXIT INT TERM

pass=0
fail=0
skip=0
skipped_list=""

# Safety: a skipped policy must really be unimplemented. Probe the CLI once per
# skipped policy; if it succeeds, the policy exists and its cases must run.
probe_failed=0
for p in $SKIP_POLICIES; do
    "$BIN" --policy "$p" --in "$DIR/fcfs_basic.csv" --out "$TMP/probe.csv" >/dev/null 2>"$TMP/probe.err"
    if [ $? -ne 4 ] || ! grep -q "not implemented yet" "$TMP/probe.err"; then
        echo "NOTE: policy '$p' is implemented now; remove $p from SKIP_POLICIES in tests/cases/run_golden.sh" >&2
        probe_failed=1
    fi
done

[ -n "$SKIP_POLICIES" ] && echo "golden: policies not implemented yet, their cases are skipped: $SKIP_POLICIES"

# --- schedule cases ---
for exp in "$DIR"/*.expected.csv; do
    [ -f "$exp" ] || continue
    base=${exp##*/}
    case_name=${base%%.*}
    rest=${base#*.}
    policy=${rest%.expected.csv}
    label="$case_name [$policy]"
    if [ -f "$DIR/$case_name.expected.exit" ]; then
        continue
    fi
    skipit=0
    for p in $SKIP_POLICIES; do
        [ "$p" = "$policy" ] && skipit=1
    done
    if [ $skipit -eq 1 ]; then
        skip=$((skip + 1))
        skipped_list="$skipped_list $case_name.$policy"
        continue
    fi
    args=""
    [ -f "$DIR/$case_name.args" ] && args=$(cat "$DIR/$case_name.args")
    out="$TMP/$case_name.$policy.csv"
    # $args is deliberately unquoted: it holds several flags.
    # shellcheck disable=SC2086
    if "$BIN" --policy "$policy" --in "$DIR/$case_name.csv" --out "$out" $args 2>"$TMP/stderr"; then
        if cmp -s "$out" "$exp"; then
            echo "ok    $label"
            pass=$((pass + 1))
        else
            echo "FAIL  $label: output differs from $exp"
            diff "$exp" "$out" | head -10
            fail=$((fail + 1))
        fi
    else
        echo "FAIL  $label: exit code $? (stderr: $(cat "$TMP/stderr"))"
        fail=$((fail + 1))
    fi
done

# --- console-level cases (expected exit code and stderr, no output file) ---
for ex in "$DIR"/*.expected.exit; do
    [ -f "$ex" ] || continue
    base=${ex##*/}
    case_name=${base%.expected.exit}
    label="$case_name [exit]"
    args=""
    [ -f "$DIR/$case_name.args" ] && args=$(cat "$DIR/$case_name.args")
    out="$TMP/$case_name.exit.csv"
    rm -f "$out"
    # shellcheck disable=SC2086
    "$BIN" --policy fcfs --in "$DIR/$case_name.csv" --out "$out" $args 2>"$TMP/stderr" >"$TMP/stdout"
    got_exit=$?
    want_exit=$(cat "$ex")
    want_err=$(cat "$DIR/$case_name.expected.stderr")
    got_err=$(cat "$TMP/stderr")
    lines=$(wc -l <"$TMP/stderr" | tr -d ' ')
    bad=""
    [ "$got_exit" = "$want_exit" ] || bad="$bad exit $got_exit (want $want_exit);"
    [ "$got_err" = "$want_err" ] || bad="$bad stderr '$got_err' (want '$want_err');"
    [ "$lines" = "1" ] || bad="$bad stderr has $lines lines (want 1);"
    [ ! -e "$out" ] && [ ! -e "$out.tmp" ] || bad="$bad an output file was created;"
    if [ -z "$bad" ]; then
        echo "ok    $label"
        pass=$((pass + 1))
    else
        echo "FAIL  $label:$bad"
        fail=$((fail + 1))
    fi
done

if [ $skip -gt 0 ]; then
    echo "SKIPPED $skip case(s) (policy not implemented yet):$skipped_list"
fi
echo "golden: $pass passed, $fail failed, $skip skipped"
[ $fail -eq 0 ] && [ $probe_failed -eq 0 ]
