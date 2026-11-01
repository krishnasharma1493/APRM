#!/bin/sh
# Build web/vendor/aprm.js: core/ + wasm/api.c compiled with Emscripten into ONE
# classic script (the WebAssembly is embedded), usable from a plain <script> tag
# on file://. Run from anywhere: `make wasm` or `sh wasm/build.sh`.
#
# Flag spellings were checked against the installed Emscripten 6.0.13
# (~/emsdk/upstream/emscripten/src/settings.js, the source of the settings
# reference) on 2026-11-01; see the K-13 PR. What each does:
#   -sMODULARIZE=1              wrap everything in a factory function (no globals leak)
#   -sEXPORT_NAME=createAprm    the factory's global name: window.createAprm(...)
#                               returns a Promise of the module
#   -sSINGLE_FILE=1             embed the .wasm in the .js (no second file, no fetch)
#   -sSINGLE_FILE_BINARY_ENCODE=0  embed as base64 instead of a UTF-8 trick, so the
#                               file works whatever charset file:// or a server assumes
#   -sALLOW_MEMORY_GROWTH=1     the heap may grow (5,000 jobs plus their JSON)
#   -sEXPORTED_FUNCTIONS=...    only the step API (underscore = C name)
#   -sEXPORTED_RUNTIME_METHODS=UTF8ToString  to copy a returned JSON string out
#   -sENVIRONMENT=web,worker,node  no shell/other code paths; node is for CI and tests
#   -sFILESYSTEM=0              we do no file I/O, so leave the virtual file system out
#   -sEXPORT_ES6 is NOT set and the output is not .mjs: classic script, no import/export.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

if ! command -v emcc >/dev/null 2>&1; then
  if [ -f "$HOME/emsdk/emsdk_env.sh" ]; then
    # shellcheck disable=SC1091
    . "$HOME/emsdk/emsdk_env.sh" >/dev/null 2>&1
  fi
fi
if ! command -v emcc >/dev/null 2>&1; then
  echo "wasm/build.sh: emcc not found. Install the emsdk version in docs/TOOLCHAIN.md and run 'source emsdk_env.sh'." >&2
  exit 1
fi

EXPORTS='_aprm_create,_aprm_add_job,_aprm_step,_aprm_run_until,_aprm_state,_aprm_log,_aprm_results,_aprm_metrics,_aprm_last_error,_aprm_exact,_aprm_reset,_aprm_destroy'

mkdir -p web/vendor
OUT=web/vendor/aprm.js
rm -f "$OUT" web/vendor/aprm.wasm

# Same warning policy as the other C code (CLAUDE.md rule 6).
emcc -std=c11 -Wall -Wextra -Werror -O2 -Icore \
  core/*.c wasm/api.c \
  -o "$OUT" \
  -sMODULARIZE=1 \
  -sEXPORT_NAME=createAprm \
  -sSINGLE_FILE=1 \
  -sSINGLE_FILE_BINARY_ENCODE=0 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_FUNCTIONS="$EXPORTS" \
  -sEXPORTED_RUNTIME_METHODS=UTF8ToString \
  -sENVIRONMENT=web,worker,node \
  -sFILESYSTEM=0

# The result must be one classic script: no second file, no ES-module syntax.
if [ -e web/vendor/aprm.wasm ]; then
  echo "wasm/build.sh: unexpected separate .wasm file" >&2; exit 1
fi
if grep -q 'import\.meta' "$OUT"; then
  echo "wasm/build.sh: $OUT contains import.meta (not a classic script)" >&2; exit 1
fi
if grep -Eq '^[[:space:]]*export[[:space:]]+(default|\{|const|function|class|let|var)' "$OUT"; then
  echo "wasm/build.sh: $OUT contains an ES module export" >&2; exit 1
fi
echo "built $OUT ($(wc -c < "$OUT") bytes)"
