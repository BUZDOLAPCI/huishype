#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <prompt-file>"
  exit 1
fi

PROMPT_FILE="$1"
if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "Prompt file not found: $PROMPT_FILE"
  exit 1
fi

PROMPT_CONTENT="$(cat "$PROMPT_FILE")"

echo "Starting Claude Code sprint in $(pwd) using prompt: $PROMPT_FILE"
claude "$PROMPT_CONTENT"
