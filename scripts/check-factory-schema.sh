#!/usr/bin/env bash
# Drift check for the pinned software-factory Work Packet schema snapshot.
# Compares the snapshot's sha256 with PIN.json, then (when gh can read the
# private upstream repo) with the upstream file at the pinned commit and at
# upstream main. Run locally; CI cannot read the private upstream repo.
# Exit 0: snapshot matches pin and pinned upstream. Exit 1: mismatch.
# Exit 2: upstream not readable (unchecked - this is not a pass).
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dir="$root/specs/integration-contracts/upstream/software-factory"
read_pin() { python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$dir/PIN.json" "$1"; }
repo="$(read_pin repository)"; commit="$(read_pin commit)"; path="$(read_pin path)"; want="$(read_pin sha256)"
have="$(sha256sum "$dir/work_packet.schema.json" | cut -d' ' -f1)"
[[ "$have" == "$want" ]] || { echo "error: snapshot sha256 $have does not match PIN.json $want" >&2; exit 1; }
echo "ok: snapshot matches PIN.json"
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
# Writes the raw upstream file at ref $1 to $tmp, byte for byte.
fetch() { gh api "repos/$repo/contents/$path?ref=$1" -H "Accept: application/vnd.github.raw" > "$tmp" 2>/dev/null; }
if ! fetch "$commit"; then
  echo "UNCHECKED: cannot read $repo with the current gh login" >&2; exit 2
fi
[[ "$(sha256sum "$tmp" | cut -d' ' -f1)" == "$want" ]] || { echo "error: upstream at pinned commit differs from snapshot" >&2; exit 1; }
echo "ok: upstream at $commit matches snapshot"
if fetch main; then
  if [[ "$(sha256sum "$tmp" | cut -d' ' -f1)" == "$want" ]]; then
    echo "ok: upstream main unchanged since the pin"
  else
    echo "DRIFT: upstream main changed the schema; review and re-pin in a PR" >&2; exit 1
  fi
fi
