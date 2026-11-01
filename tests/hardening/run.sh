#!/bin/sh
# K-30 hardening checks (docs/HARDENING.md). Builds core/ with AddressSanitizer
# and UndefinedBehaviorSanitizer into build/hardening and runs:
#   fuzz.c        random and mutated CSV through csv_read_jobs and the engine,
#                 random call sequences through the JSON writer
#   oom_inject.c  fails the Nth allocation for every N (malloc/realloc/calloc/free
#                 are renamed to fi_* with -D, so core/ itself is not edited) and
#                 checks: only OUT_OF_MEMORY, state unchanged, nothing leaked
#   stress.c      random workloads: no log entry dropped, invariants hold (debug
#                 build), same output for the same input and for any job order
# Usage: sh tests/hardening/run.sh [cases]      (default 300000 fuzz cases)
set -eu
cd "$(dirname "$0")/../.."
CC=${CC:-cc}
N=${1:-300000}
B=build/hardening
H=tests/hardening
SAN="-fsanitize=address,undefined -fno-sanitize-recover=undefined -fno-omit-frame-pointer"
FLAGS="-std=c11 -Wall -Wextra -Werror -g -O1 -DAPRM_DEBUG $SAN -Icore"
rm -rf "$B"; mkdir -p "$B/core" "$B/oom" "$B/chk"


# 1. fuzz
$CC $FLAGS "$H/fuzz.c" core/*.c -o "$B/fuzz"
"$B/fuzz" "$N"

# 2. allocation failure injection
RENAME="-Dmalloc=fi_malloc -Drealloc=fi_realloc -Dcalloc=fi_calloc -Dfree=fi_free"
for f in core/*.c; do
  $CC $FLAGS $RENAME -c "$f" -o "$B/oom/$(basename "$f" .c).o"
done
$CC $FLAGS $RENAME -c "$H/oom_inject.c" -o "$B/oom/oom_inject.o"
$CC -std=c11 -g $SAN -c "$H/fi_alloc.c" -o "$B/oom/fi_alloc.o"
$CC $SAN "$B"/oom/*.o -o "$B/oom_inject"
# Output goes to a file first: a pipe into tail would hide a crash (no pipefail in sh).
if ! "$B/oom_inject" > "$B/oom_inject.log" 2>&1; then
  tail -30 "$B/oom_inject.log"; echo "hardening: oom_inject FAILED"; exit 1
fi
tail -3 "$B/oom_inject.log"

# 3. stress: every eventlog_push inside core/ must succeed (checked by a wrapper)
for f in core/*.c; do
  b=$(basename "$f" .c)
  X=""; [ "$b" != eventlog ] && X="-Deventlog_push=eventlog_push_chk"
  $CC $FLAGS $X -c "$f" -o "$B/chk/$b.o"
done
$CC -std=c11 -g $SAN -Icore -c "$H/stress.c" -o "$B/chk/stress.o"
$CC $SAN "$B"/chk/*.o -o "$B/stress"
"$B/stress" 3000

# 4. core/ has no writable static data (needs the plain core objects)
for f in core/*.c; do
  $CC -std=c11 -O1 -Icore -c "$f" -o "$B/core/$(basename "$f" .c).o"
done
sh "$H/grep_unsafe.sh"
echo "hardening: all checks passed"
