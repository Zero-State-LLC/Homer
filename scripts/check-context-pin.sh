#!/usr/bin/env bash
# Check the agent-context Context Pin. Fetch each pinned file at the pinned
# commit, compare its sha256 with the pin, then lint AGENTS.md with the pinned
# check-agents-md.sh. Any mismatch or fetch error fails closed.
# Needs: bash, curl, python3, sha256sum. agent-context is public; no credentials.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pin="${CONTEXT_PIN_FILE:-$root/agent-context.pin.json}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

repo="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["repository"])' "$pin")"
commit="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["commit"])' "$pin")"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo "error: pin commit is not a full SHA" >&2; exit 1; }

python3 -c 'import json,sys
for path, digest in json.load(open(sys.argv[1]))["files"].items():
    print(path, digest)' "$pin" | while read -r path digest; do
  dest="$work/$path"
  mkdir -p "$(dirname "$dest")"
  curl -sSfL "https://raw.githubusercontent.com/$repo/$commit/$path" -o "$dest"
  actual="$(sha256sum "$dest" | cut -d' ' -f1)"
  if [[ "$actual" != "$digest" ]]; then
    echo "error: $path sha256 $actual does not match pin $digest" >&2
    exit 1
  fi
  echo "ok: $path matches pin"
done

bash "$work/scripts/check-agents-md.sh" "$root/AGENTS.md"
