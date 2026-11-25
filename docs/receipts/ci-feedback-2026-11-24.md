# CI feedback: packet 1 measured

Date: 2026-11-24 Pacific Time. Author: Claude (Claude Code). Spec:
[CI feedback time](../../specs/ci-feedback/spec.md), R7 and packet 1. Before:
the [CI baseline receipt](ci-baseline-2026-11-24.md).

## Method

The same commands as the baseline receipt, on three CI runs started on
2026-11-24; their jobs ran between 15:15 and 15:23 UTC. Each run was re-run twice
(`gh run rerun <id>`), so each has three attempts on fresh runners. Attempts 2
and 3 exist only for this measurement.

| Group | Pull request | Run |
| --- | --- | --- |
| Before: `main`'s `ci.yml` | #62 (docs only, so its CI is `main`'s) | 45423408356 |
| Packet 1 | #63 | 45423500063 |
| Packets 1 and 2 | #64 | 45423502407 |

## The `check` job

| Group | Attempts (s) | Median (s) |
| --- | --- | --- |
| Before | 91, 90, 88 | 90 |
| Packet 1 | 50, 46, 56 | 50 |
| Packets 1 and 2 | 63, 62, 57 | 62 |

All six runs after the change: median 56.5 seconds. That is 19.5 seconds below
the 76-second baseline and 33.5 below the same-day before. Packet 1's acceptance
asks for at least 15 seconds below 76: met.

## Where the time went

Seconds per attempt.

| Step | Before | Packet 1 | Packets 1 and 2 |
| --- | --- | --- | --- |
| First Build | 11, 12, 11 | 8, 8, 11 | 12, 12, 12 |
| Typecheck | 15, 15, 15 | 3, 2, 4 | 4, 4, 4 |
| Test | 25, 25, 25 | 13, 13, 14 | 15, 14, 14 |
| Trailing Build | 11, 11, 11 | gone | gone |
| Classifier test and classification | none | none | 1 or less |

Runner speed varies from run to run: one build took 11 to 12 seconds on the
before run and on #64, and 8 on #63 and in the baseline median. The step pattern
holds on every runner. Typecheck and Test no longer contain a build, and the
trailing Build is gone, so each run saves three builds, whatever one build
costs on that runner.

## Packet 2 on a code pull request

On #64, the classifier logged "A changed path is under `.github/`, so the change
is not docs-only" and `workspace=true`, and every workspace step ran. The
classifier's test took 1 second or less. The docs-only half of packet 2's
acceptance waits for the first docs-only pull request after #64 merges.

## Not measured

- `npm run check` on a developer machine. This session could not install
  packages. The same commands ran in CI.
- Queue time before a job starts.
