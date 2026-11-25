# ADR 009: a docs-only pull request skips the workspace steps, decided inside `check`

Status: accepted by Danny on 2026-11-24 (#62).
Intent: [CI feedback time](../../docs/intent/ci-feedback.md) (accepted).
Spec: [CI feedback time](../ci-feedback/spec.md), requirements R2 to R6 and
packet 2.
Evidence: [CI baseline receipt](../../docs/receipts/ci-baseline-2026-11-24.md).

## Context

The `check` job installs, builds, lints, type checks and tests the whole
workspace for every pull request. On 2026-11-23, 12 of the 18 green pull request
runs came from pull requests that changed only Markdown files, and each still
took the full 76 seconds (median).

`AGENTS.md` already defines a docs-only pull request for the merge contract: one
that changes only Markdown files and nothing under `.github/`. Nothing the
workspace steps run reads a Markdown file from the repository: Prettier ignores
`*.md`, ESLint and `tsc` read TypeScript, and no test reads repository Markdown
[verified: search of `packages/`, `scripts/` and the Vitest configs].

How GitHub reports skipped work matters, because Homer's record has several
checks that went green while verifying nothing (agent-context `HANDOFF.md`):

- A workflow skipped by a `paths` filter never reports, so a required check from
  it stays pending and blocks the merge.
- A job skipped by `if:` reports success, even when it is required.
- When a job fails, a job that depends on it is skipped and may not block the
  merge.

Source: GitHub's
[troubleshooting required status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).
The `main` ruleset requires `markdownlint`, `links`, `context-pin` and
`gitleaks`. It does not require `check` or `audit` today.

## Decision

The `check` job keeps starting on every pull request and decides for itself:

1. Its first steps run `scripts/test-ci-changes.sh`, then
   `scripts/ci-changes.sh`, which outputs `workspace=true` or `workspace=false`.
2. Every workspace step carries `if: steps.changes.outputs.workspace != 'false'`.
   Only an explicit `false` skips; a missing output runs the step. A failed
   classifier step fails the job, because each condition keeps the implicit
   `success()`.
3. `workspace` is `false` only for a `pull_request` event whose merge commit
   diff lists at least one path, every path ends in `.md`, and none is under
   `.github/`. Every other case, including any failure to list the change, is
   `true`. The spec's rules table is the full list.
4. The classifier writes the deciding rule to the step summary and, when it skips,
   the changed files.
5. The classifier's own test runs first in every `check` run.

`AGENTS.md` and the classifier share one definition of docs-only. Changing one
without the other is a defect.

## Consequences

- A docs-only pull request gets a green `check` in seconds instead of about 76.
  `audit`, Docs and Secret scan run exactly as before.
- No ruleset edit and no job rename. A docs-only pull request still reports a
  green `check`, so `check` can be a required check without blocking docs-only
  pull requests, which a `paths` filter would have prevented. Danny decided on
  2026-11-24 to require `check` and `audit` once packet 2 lands.
- The runner still starts for a docs-only pull request, about 5 seconds.
- Docs-only is now written in two places, `AGENTS.md` for the merge contract and
  `scripts/ci-changes.sh` for CI. The script cites `AGENTS.md`, and the spec
  makes a drift a defect.
- A pull request can edit the classifier, as it can edit `ci.yml` today. Such a
  pull request is not docs-only, so it runs every step and needs a Verdict.
- A future job that needs the workspace, such as `admin-browser` in #32, takes
  the same classifier step and conditions.

## Alternatives considered

- **Workflow-level `paths-ignore: ['**.md']`.** One line. Rejected: if `check`
  ever becomes required, a docs-only pull request waits forever on a check that
  never reports; until then, "CI green" would mean a check that never ran.
- **A separate classifier job, job-level `if:`, and an aggregate gate job**, as
  OpenClaw's `preflight` and `ci-gate` do. Rejected for Homer: one workspace job
  needs no fan-out routing, the gate would need a ruleset edit, and a failed
  classifier job would make the workspace job skip and report success unless the
  gate is required.
- **`dorny/paths-filter` or a similar action.** Rejected: a new third-party
  action in the supply chain, for what a short script does.
- **Run only the tests of the changed packages (`vitest --changed`).** Rejected
  in [ADR 010](010-measured-ci-changes-only.md): it reduces what a code change
  checks.
- **Change nothing.** Rejected: on the measured day, two thirds of pull request
  runs spent about 70 seconds proving that Markdown does not change TypeScript.
