#!/usr/bin/env bash
# Negative tests for check-context-pin.sh: a tampered digest and a short
# commit must both fail. A pass here means the pin check can fail.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

python3 - "$root/agent-context.pin.json" "$tmp" <<'PY'
import json, sys
pin = json.load(open(sys.argv[1]))
bad = dict(pin, files=dict(pin["files"]))
first = next(iter(bad["files"]))
bad["files"][first] = "0" * 64
json.dump(bad, open(sys.argv[2] + "/bad-digest.json", "w"))
short = dict(pin, commit=pin["commit"][:7])
json.dump(short, open(sys.argv[2] + "/short-commit.json", "w"))
PY

for case in bad-digest short-commit; do
  if CONTEXT_PIN_FILE="$tmp/$case.json" bash "$root/scripts/check-context-pin.sh" >/dev/null 2>&1; then
    echo "FAIL: $case was accepted" >&2
    exit 1
  fi
  echo "ok: $case refused"
done
