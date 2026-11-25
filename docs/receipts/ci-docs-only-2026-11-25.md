# CI feedback: the first docs-only check runs

Date: 2026-11-25 Pacific Time. Author: Claude (Claude Code). Spec:
[CI feedback time](../../specs/ci-feedback/spec.md), packet 2 acceptance and
R7. Task: ZER-66. Before: the [packet 1 receipt](ci-feedback-2026-11-24.md).

ZER-65 merged as #64 at 2026-11-25 02:07:28 UTC (squash `3e2132d`). The first
docs-only pull request after it was #70, a bypass receipt. Its `check` ran in
[run 45531042629](https://github.com/Zero-State-LLC/Homer/actions/runs/45531042629/job/138926133123).

## The first run, point by point

| Done when | Result |
| --- | --- |
| The workspace steps show as skipped | Met. Steps 5 to 12 report `skipped`: setup-node, `npm ci`, Format, Build, Lint, Typecheck, Test and the Workers smoke. Checkout, the classifier test and the classifier ran and passed. |
| The step summary names the deciding rule and the changed files | The rule is met: the job log carries the line that `scripts/ci-changes.sh` writes to both the log and the summary, "Docs-only pull request: every changed path is Markdown and none is under `.github/` (AGENTS.md, Merge and deploy). Changed paths:". The paths go to the summary alone, which the REST API does not return, so they were not read here; see below. |
| `check` finished green in under 20 seconds | Met: started 02:10:35, finished 02:10:40 UTC, so 5 seconds. |
| A code pull request after the merge still ran every workspace step | Met. #32 (run 45538254249, 03:11 UTC) ran setup-node, `npm ci`, Format, Build, Lint, Typecheck, Test and the Workers smoke, all `success`, in 50 seconds. So did #100 (run 45615084482, 12:34 UTC), in 97 seconds. |

The REST API does not return a job's step summary. To see the changed paths,
open the run page linked above and the `check` job's summary; for #70 it should
list `docs/map.md` and `docs/receipts/bypass-merges-2026-11-24.md`.

## Docs-only runs since the merge

The spec's measure is a median over at least five green runs of one kind. These
are every green docs-only `check` from the merge to 12:50 UTC, one run per row.

| Pull request | Run | `check` (s) |
| --- | --- | --- |
| #70 | 45531042629 | 5 |
| #69 | 45531349250 | 5 |
| #69 | 45532731073 | 7 |
| #71 | 45533569570 | 5 |
| #71 | 45535706504 | 5 |
| #85 | 45558908337 | 6 |
| #90 | 45572353217 | 7 |
| #93 | 45581152507 | 6 |
| #96 | 45591299978 | 9 |
| #98 | 45595936540 | 11 |
| #101 | 45599605196 | 5 |
| #104 | 45617576421 | 11 |

Median 6 seconds over twelve runs, and none over 11. Packet 1's code runs had a
median of 56.5 seconds, and the baseline was 76.

## Commands

As in the spec's [Measuring a change](../../specs/ci-feedback/spec.md#measuring-a-change):

```sh
gh run list -R Zero-State-LLC/Homer --workflow CI -L 200 \
  --json databaseId,event,headBranch,createdAt,conclusion
gh run view <id> -R Zero-State-LLC/Homer --json jobs \
  --jq '.jobs[] | select(.name == "check") | [.startedAt, .completedAt] | @tsv'
```
