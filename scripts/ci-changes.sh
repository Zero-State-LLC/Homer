#!/usr/bin/env bash
# Decide whether a CI check run needs the TypeScript workspace steps (ADR 009,
# specs/ci-feedback/spec.md, Classification rules). Prints workspace=true or
# workspace=false, and appends the same line to $GITHUB_OUTPUT when it is set.
#
# Docs-only means what AGENTS.md (Merge and deploy) says: only Markdown files,
# and nothing under .github/. Change one definition only with the other.
# Every doubt prints workspace=true: an event other than pull_request, a HEAD
# that is not a two-parent merge commit, a failed diff, an empty diff, or an
# unusual path name.
#
# Needs: bash, git. Reads EVENT_NAME (github.event_name). Run it at the root of
# a checkout of the pull request merge commit, fetched with depth 2 or more.
set -euo pipefail
export LC_ALL=C

# emit <true|false> <reason> [path...]: report the decision and stop.
emit() {
  local workspace="$1" reason="$2"
  shift 2
  printf 'workspace=%s\n' "$workspace"
  printf '%s\n' "$reason" >&2
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf 'workspace=%s\n' "$workspace" >>"$GITHUB_OUTPUT"
  fi
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    {
      if [[ "$workspace" == false ]]; then
        printf '### check: workspace steps skipped\n\n'
      else
        printf '### check: workspace steps run\n\n'
      fi
      printf '%s\n' "$reason"
      if (($# > 0)); then
        # An indented code block: a file name is shown, never rendered.
        printf '\n'
        printf '    %s\n' "${@:1:50}"
        if (($# > 50)); then
          printf '    ... and %d more\n' $(($# - 50))
        fi
      fi
    } >>"$GITHUB_STEP_SUMMARY"
  fi
  exit 0
}

event="${EVENT_NAME:-}"
if [[ "$event" != pull_request ]]; then
  emit true "Event \`${event:-unset}\` is not a pull request. Every other event runs everything."
fi

if ! parents="$(git rev-list --parents -n 1 HEAD 2>/dev/null)"; then
  emit true "HEAD cannot be read, so the change cannot be listed."
fi
read -r -a ids <<<"$parents"
if ((${#ids[@]} != 3)); then
  emit true "HEAD is not a merge commit with two parents, so the change cannot be listed."
fi

list="$(mktemp)"
trap 'rm -f "$list"' EXIT
# The first parent is the base branch, so this lists what the merge changes.
# --no-renames lists a renamed file under its old and its new path.
if ! git diff --name-only --no-renames -z "${ids[1]}" "${ids[0]}" >"$list" 2>/dev/null; then
  emit true "git diff failed, so the change cannot be listed."
fi

paths=()
while IFS= read -r -d '' path; do
  paths+=("$path")
done <"$list"

if ((${#paths[@]} == 0)); then
  emit true "The merge changes no path, so nothing shows it is docs-only."
fi

for path in "${paths[@]}"; do
  if [[ "$path" == *[![:print:]]* ]]; then
    emit true "A changed path has a character outside printable ASCII."
  fi
  if [[ "$path" == .github/* ]]; then
    emit true "A changed path is under \`.github/\`, so the change is not docs-only:" "$path"
  fi
  if [[ "$path" != *.md ]]; then
    emit true "A changed path is not Markdown, so the change is not docs-only:" "$path"
  fi
done

emit false "Docs-only pull request: every changed path is Markdown and none is under \`.github/\` (AGENTS.md, Merge and deploy). Changed paths:" "${paths[@]}"
