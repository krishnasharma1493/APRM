#!/bin/sh
# K-30 "grep-unsafe": no unbounded string function, no HTML injection, no code
# evaluation anywhere in the shipped sources. snprintf/vsnprintf are the only
# printf-family writers allowed. Run from anywhere: sh tests/hardening/grep_unsafe.sh
cd "$(dirname "$0")/../.." || exit 1
hits=$(grep -rnE 'sprintf\(|strcpy|strcat|gets\(|innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function' \
         core cli wasm web --exclude-dir=vendor | grep -vE '(^|[^a-z_])v?snprintf\(')
if [ -n "$hits" ]; then
  echo "grep-unsafe: FAIL"; echo "$hits"; exit 1
fi
# inline event-handler attributes in HTML or set from JavaScript
hits=$(grep -rnEi '[[:space:]]on[a-z]+[[:space:]]*=[[:space:]]*["'"'"']|setAttribute\([[:space:]]*["'"'"']on' web/index.html web/js)
if [ -n "$hits" ]; then
  echo "grep-unsafe: FAIL (inline handler)"; echo "$hits"; exit 1
fi
# core/ keeps no writable file-scope or static data: only const tables allowed
for o in build/hardening/core/*.o; do
  [ -e "$o" ] || continue
  if nm "$o" | grep -E ' [dDbB] ' | grep -v -E ' (___asan|_?__asan|_?__ubsan|l_|ltmp)' >/dev/null; then
    echo "grep-unsafe: FAIL writable data in $o"; nm "$o" | grep -E ' [dDbB] '; exit 1
  fi
done
echo "grep-unsafe: ok"
