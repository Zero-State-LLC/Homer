# Intent — CI feedback time

Author: Claude (Claude Code) for Danny (scrimshawlife-ctrl)
Date: 2026-11-24
Status: draft
Product: Homer (`Zero-State-LLC/Homer`)

This file is a proto-spec. It comes **before** specify.
Next stage is `spec.md` (spec-kit specify). Do not skip to code.

One committed intent per change stream. Live under `docs/intent/`.

## Problem / why now

Every pull request waits on the CI `check` job, and the job repeats work it has
already done. On 2026-11-23 it took a median of 76 seconds across 27 green runs.
About 24 of those seconds rebuild the workspace a second, third and fourth time:
the `pretypecheck` and `pretest` scripts each run `npm run build`, and the job
then runs `npm run build` again at the end.

Docs-only pull requests pay the whole job. Twelve of the 18 green pull request
runs that day came from Markdown-only pull requests (#57 to #61). Nothing in
those changes can alter what the job checks.

Danny asked on 2026-11-24 for the lessons in Vincent Koc's write-up on OpenClaw's
CI, as StarSling's OpenClaw CI playbook collects them (46 techniques), to be
specified for Homer with ADRs and integrated.

[verified: [CI baseline receipt](../receipts/ci-baseline-2026-11-24.md)]

## Proposed outcome

Observable done (a stranger can check this without reading the chat):

- A green `check` run on a code pull request builds the workspace once. Its log
  shows one `npm run build`. The median of at least five green runs is at least
  15 seconds below the 76-second baseline, recorded in a receipt.
- `npm run check` builds the workspace once.
- A docs-only pull request, as `AGENTS.md` defines it, gets a green `check` in
  seconds. The run's summary names the changed files and says why the workspace
  steps did not run.
- Every other pull request, every push to `main`, and any change CI cannot
  classify runs every workspace step.
- Every check that runs today still runs on every change that can affect it. None
  is removed, loosened or made optional.

## Affected users / systems

- Users: Danny and every agent that opens a pull request. Docs-only pull requests
  (intents, specs, receipts, Curator Runs) get their result sooner.
- Systems: `.github/workflows/ci.yml`, the root `package.json` scripts, a new
  classifier script and its test under `scripts/`, and the GitHub Actions table
  in the Buzz spec.

## Constraints

Product-true locks (do not reopen in implement):

- Never weaken the `main` ruleset or a CI check. A faster workflow runs the same
  checks on every change that can affect them.
- Fail toward running. An unknown event, a change CI cannot list, or any doubt
  runs everything.
- A skipped step says why in the run's summary. No green-but-inert check.
- Docs-only has one meaning, the one in `AGENTS.md`: only Markdown files, and
  nothing under `.github/`. The merge contract and CI use the same definition.
- No ruleset edit is needed, and no job is renamed.
- No new third-party action, no paid runner, and no new bot or agent fleet.
- Measure before and after. A change without a measured gain does not land.

Non-goals:

- Fewer Actions minutes. Homer is public, so standard GitHub-hosted runners are
  free. The cost Homer pays is waiting time on the `check` job.
- Test selection, test sharding, or moving `main`'s full run to a schedule.
- TypeScript 7 while `typescript-eslint` needs TypeScript below 6.1.
- The Docs and Secret scan workflows. Their jobs take 5 to 8 seconds.

## Open questions

- Should `check` and `audit` become required status checks in the `main`
  ruleset? Today they are not; only the four Docs and Secret scan jobs are. This
  stream makes it possible without blocking docs-only pull requests, but the
  ruleset is Danny's to change. Default: propose it; do not change it here.

## Claims

| Claim | Label |
|---|---|
| The `check` job median is 76 seconds over 27 green runs on 2026-11-23 | `[verified: docs/receipts/ci-baseline-2026-11-24.md]` |
| A `check` run builds the workspace four times, `npm run check` three | `[verified: package.json pretypecheck and pretest; ci.yml steps]` |
| One build takes about 8 seconds (median) | `[verified: baseline receipt, Build steps]` |
| 12 of 18 green pull request runs came from Markdown-only pull requests | `[verified: gh api pulls/57 to 61 files; baseline receipt]` |
| No build, lint, type check or test reads repository Markdown | `[verified: search of packages/, scripts/ and the Vitest configs]` |
| `check` and `audit` are not required checks on `main` | `[verified: gh api rulesets/27592526, 2026-11-24]` |
| Standard GitHub-hosted runners are free for public repositories | `[verified: docs.github.com, About billing for GitHub Actions]` |
| `typescript-eslint` 8.73 supports TypeScript below 6.1 | `[verified: eslint.config.js comment; Dependabot's 7.0.2 bump #14 closed 2026-11-20]` |

## Next

A human accepts this file (`Status: accepted`). Then the spec in
`specs/ci-feedback/spec.md` with its `## Workflows` section, and ADRs 008 to
010. Do not implement from this file alone.
