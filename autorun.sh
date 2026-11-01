#!/usr/bin/env bash
# Runs Claude Code repeatedly until the backlog is done.
# Each session follows docs/RUN_INSTRUCTIONS.md ("Continuous mode").
# Stops when .autorun/DONE or .autorun/STOP exists. Create .autorun/STOP to stop it by hand.
# Flags used (-p, --permission-mode) were checked against `claude --help`.
cd "$(dirname "$0")" || exit 1
mkdir -p .autorun
PROMPT='Continuous mode. Read docs/RUN_INSTRUCTIONS.md (section "Continuous mode") and docs/PROGRESS.md, finish any half-done work, then keep working through every open issue. Do not stop until a stop condition in that section is true.'
while [ ! -e .autorun/DONE ] && [ ! -e .autorun/STOP ]; do
  echo "=== session start $(date) ===" >> .autorun/log.txt
  claude -p "$PROMPT" --permission-mode acceptEdits >> .autorun/log.txt 2>&1
  echo "=== session end $(date) ===" >> .autorun/log.txt
  if [ -e .autorun/DONE ] || [ -e .autorun/STOP ]; then break; fi
  sleep 900   # 15 minutes
done
echo "autorun finished: $(ls .autorun | tr '\n' ' ')" >> .autorun/log.txt
