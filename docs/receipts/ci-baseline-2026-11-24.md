# CI baseline: where the `check` job spends its time

Date: 2026-11-24 Pacific Time. Author: Claude (Claude Code), for the
[CI feedback intent](../intent/ci-feedback.md). Every number here was read from
the GitHub Actions API; none is estimated.

## Method

1. `gh run list -R Zero-State-LLC/Homer -L 100 --json databaseId,workflowName,event,conclusion,headBranch,createdAt`
   on 2026-11-24.
2. `gh run view <id> -R Zero-State-LLC/Homer --json jobs` for each green run.
3. A duration is `completedAt` minus `startedAt` for a job or a step, in the whole
   seconds GitHub reports. Queue time before a job starts is not included.

Sample: all 27 green CI runs among those 100, from 2026-11-23 16:30 to 19:33 UTC.
Eighteen are pull request runs and nine are pushes to `main`. The four failed
pull request runs (median 33 seconds) are left out, because they stopped early.

## The `check` job

Job total: median 76 seconds, minimum 58, maximum 93.

| Step | Median (s) | Min | Max |
| --- | --- | --- | --- |
| Set up job | 1 | 0 | 3 |
| `actions/checkout` | 1 | 1 | 5 |
| `actions/setup-node` | 3 | 0 | 14 |
| `npm ci --no-audit --no-fund` | 7 | 4 | 10 |
| Build workspace dependencies (`npm run build`) | 8 | 6 | 12 |
| Format | 2 | 1 | 3 |
| Lint | 5 | 4 | 8 |
| Typecheck (`npm run typecheck`) | 11 | 8 | 15 |
| Test (`npm test`) | 21 | 16 | 27 |
| Build (`npm run build`) | 8 | 6 | 12 |
| Plain Workers runtime smoke | 3 | 2 | 4 |

`package.json` gives `typecheck` and `test` a `pre` script that runs
`npm run build`. So the Typecheck step is a full build plus about 3 seconds of
`tsc --noEmit`, and the Test step is a full build plus about 13 seconds of
`vitest run`. One run builds the workspace four times: about 24 seconds of each
76-second run repeats a build that already passed. Each build runs eight
workspace builds in sequence and then `node --test scripts/*runtime.test.mjs`.
`npm run check` builds three times, for the same reason.

## The other jobs

The 8 most recent green runs of each, and the 6 most recent for `audit`. All of
them run in parallel with `check` and finish well before it.

| Workflow | Job | Median (s) | Max (s) |
| --- | --- | --- | --- |
| CI | `audit` | 7 | 17 |
| Docs | `markdownlint` | 6 | 13 |
| Docs | `links` (lychee step 3 s median, 4 s max) | 8 | 13 |
| Docs | `context-pin` | 7 | 13 |
| Secret scan | `gitleaks` | 5 | 7 |

## Docs-only pull requests

Pull requests #57, #58, #59, #60 and #61 change only Markdown files and nothing
under `.github/`, which is what `AGENTS.md` calls docs-only. They account for 12
of the 18 green pull request runs. Their `check` runs have the same 76-second
median as the rest, though nothing in them can change what the job checks: no
build, lint, type check or test reads a Markdown file in the repository
[verified: a search of `packages/`, `scripts/` and the Vitest configs for `.md`
reads and for npm or npx spawns], and `.prettierignore` excludes `*.md`.

## The `main` ruleset

`gh api repos/Zero-State-LLC/Homer/rulesets/27592526` on 2026-11-24: the required
status checks are `markdownlint`, `links`, `context-pin` and `gitleaks`, with
`strict_required_status_checks_policy: false`. The CI workflow's `check` and
`audit` are not required checks. "CI green" for them is enforced by the merge
contract in `AGENTS.md`, not by GitHub, and a pull request does not have to be up
to date with `main` before it merges.

## What this does not show

- Runner queue time and the wait between a push and the first job.
- More than one afternoon. Durations on a busy day or with a cold npm cache may
  differ; the 14-second `setup-node` maximum is one such run.
- Whether TypeScript 7 would be faster here. It was not run, because
  `typescript-eslint` 8.73 needs TypeScript below 6.1 (`eslint.config.js`).

## Reproduce

```sh
gh run list -R Zero-State-LLC/Homer --workflow CI --status success -L 30 --json databaseId
gh run view <id> -R Zero-State-LLC/Homer --json jobs \
  --jq '.jobs[] | select(.name == "check") | .steps[] | [.name, .startedAt, .completedAt] | @tsv'
```
