#!/usr/bin/env bash
# Tests for ci-changes.sh (ADR 009). Builds throwaway repositories with real
# merge commits. Only a pull request whose merge changes Markdown outside
# .github/ may skip the workspace steps; every other case, every failure
# included, must run them. A pass here means the classifier can say both, and
# says "run" when in doubt.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
classifier="$root/scripts/ci-changes.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Ignore the runner's and the developer's git configuration.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.invalid

failures=0

# pr <name> <command...>: a repository whose HEAD merges a branch into main.
# The command runs inside the repository and makes the branch's change.
pr() {
  local dir="$tmp/$1"
  shift
  git init -q -b main "$dir"
  (
    cd "$dir"
    mkdir -p src docs .github
    echo base >README.md
    echo base >docs/guide.md
    echo 'export {};' >src/a.ts
    echo 'x: 1' >.github/x.yml
    git add -A
    git commit -q -m base
    git checkout -q -b change
    "$@"
    git add -A
    git commit -q --allow-empty -m change
    git checkout -q main
    git merge -q --no-ff -m merge change
  )
}

# expect <name> <true|false> <directory> [event]
expect() {
  local name="$1" want="$2" dir="$3" event="${4-pull_request}" got
  if got="$(cd "$dir" && EVENT_NAME="$event" GITHUB_OUTPUT='' GITHUB_STEP_SUMMARY='' \
    bash "$classifier" 2>/dev/null)"; then
    :
  else
    got="exit status $?"
  fi
  if [[ "$got" == "workspace=$want" ]]; then
    echo "ok: $name -> workspace=$want"
  else
    echo "FAIL: $name: want workspace=$want, got '$got'" >&2
    failures=$((failures + 1))
  fi
}

edit_md() { echo more >>README.md && echo new >docs/new.md; }
pr docs-only edit_md
expect "Markdown-only pull request" false "$tmp/docs-only"

space_md() { echo new >"docs/two words.md"; }
pr space-md space_md
expect "Markdown path with a space" false "$tmp/space-md"

delete_md() { git rm -q docs/guide.md; }
pr delete-md delete_md
expect "deleted Markdown file" false "$tmp/delete-md"

base_moved() { echo more >>README.md; }
pr base-moved base_moved
(
  cd "$tmp/base-moved"
  git reset -q --hard HEAD^1
  echo 'export const b = 1;' >src/b.ts
  git add -A
  git commit -q -m "main moves on"
  git merge -q --no-ff -m merge change
)
expect "base branch changed code, the pull request only Markdown" false "$tmp/base-moved"

github_md() { echo doc >.github/pull_request_template.md; }
pr github-md github_md
expect "Markdown under .github/" true "$tmp/github-md"

edit_ts() { echo 'export const a = 1;' >src/a.ts; }
pr code edit_ts
expect "TypeScript change" true "$tmp/code"

mixed() { echo more >>README.md && echo 'export const a = 1;' >src/a.ts; }
pr mixed mixed
expect "Markdown and TypeScript" true "$tmp/mixed"

image() { mkdir -p assets && printf 'png' >assets/x.png; }
pr image image
expect "non-Markdown asset" true "$tmp/image"

rename_ts() { git mv src/a.ts src/a.md; }
pr rename rename_ts
expect "TypeScript file renamed to .md" true "$tmp/rename"

upper() { echo new >NOTES.MD; }
pr upper upper
expect "upper-case .MD" true "$tmp/upper"

unicode() { echo new >"docs/caf$(printf '\xc3\xa9').md"; }
pr unicode unicode
expect "non-ASCII Markdown name" true "$tmp/unicode"

nothing() { :; }
pr empty nothing
expect "merge that changes nothing" true "$tmp/empty"

expect "push event" true "$tmp/docs-only" push
expect "manual run" true "$tmp/docs-only" workflow_dispatch
expect "unset event" true "$tmp/docs-only" ""

git -C "$tmp/docs-only" checkout -q -b single HEAD^2
expect "HEAD with one parent" true "$tmp/docs-only"
git -C "$tmp/docs-only" checkout -q main

git clone -q --depth 1 "file://$tmp/docs-only" "$tmp/shallow-1"
expect "depth-1 clone hides the parents" true "$tmp/shallow-1"
git clone -q --depth 2 "file://$tmp/docs-only" "$tmp/shallow-2"
expect "depth-2 clone, as CI fetches" false "$tmp/shallow-2"

mkdir "$tmp/no-repo"
expect "not a git repository" true "$tmp/no-repo"

# The step output and summary, as GitHub Actions reads them.
out="$tmp/output" summary="$tmp/summary"
(cd "$tmp/docs-only" && EVENT_NAME=pull_request GITHUB_OUTPUT="$out" \
  GITHUB_STEP_SUMMARY="$summary" bash "$classifier" >/dev/null 2>&1)
if [[ "$(cat "$out")" == "workspace=false" ]] && grep -qx '    docs/new.md' "$summary" &&
  grep -q 'workspace steps skipped' "$summary"; then
  echo "ok: step output and summary"
else
  echo "FAIL: step output or summary" >&2
  failures=$((failures + 1))
fi

if ((failures > 0)); then
  echo "$failures case(s) failed" >&2
  exit 1
fi
