#!/bin/sh
# run_suite.sh: runs one website test file (K-50). Node 24.19's garbage collector can crash on the
# many virtual contexts these tests create (exit 139, inside V8; Node 26 does not). Only that crash is
# retried, and it is reported; a test failure has any other exit code and fails at once.
tries=0
while :; do
  node "$1"
  code=$?
  [ "$code" -ne 139 ] && exit "$code"
  tries=$((tries + 1))
  echo "note: node crashed in its garbage collector running $1 (a Node bug, exit 139); retry $tries of 3"
  [ "$tries" -ge 3 ] && exit 139
done
