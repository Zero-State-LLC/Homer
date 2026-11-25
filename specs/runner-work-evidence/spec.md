# Runner Work evidence mapping (v0.1.0)

Status: partial repository implementation, not activated. Task: [ZER-36](https://linear.app/zer0state/issue/ZER-36).
Intent: [calendar runners](../../docs/intent/calendar-runners.md) (accepted).
Design: [ADR 003](../adr/003-runner-operations-telemetry.md).
Related: [runner scheduling spec](../runner-scheduling/spec.md), [PR #44](https://github.com/Zero-State-LLC/Homer/pull/44).

## Scope

The first deliverable is a pure, effect-free mapping layer for GitHub `workflow_job` webhook records and optional read-only `workflow_run` plus job API enrichment. It returns a bounded GitHub Job Observation with source identity, timestamps, runner IDs and unbound provider actor identity. It neither writes an Activity Event nor claims durable collection. No GitHub API request, workflow dispatch, machine action, secret, public route or database migration is included in this slice.

GitHub is Authority for Repository Events and job execution facts. Homer is Authority only for Observations and Projections; provider actors are not attributed to a Homer Actor without an explicit Identity Binding. A workflow trigger does not establish who performed the engineering work.

## Source and trust contract

1. The caller must verify the raw GitHub `X-Hub-Signature-256` against the configured webhook secret before decoding or invoking the mapper. Reuse the existing bounded webhook verification path, but do not enable `workflow_job` delivery until durable admission is designed and approved.
2. Obtain the reviewed numeric repository ID and repository name from Homer's runtime mapping catalog. Reject repository mismatches. Never infer identity or entitlement from a runner label, alias or repository name alone.
3. Preserve the original verified delivery identity, fixed job identity and exact GitHub evidence URL. Ignore arbitrary webhook sender names, job steps, command arguments, environment variables and free-form private content.
4. Accept `queued`, `in_progress` and `completed` as distinct states, not as interchangeable updates. A completed job requires completed-at evidence; no timestamp is invented.
5. The webhook may not supply an authoritative `run_attempt`; leave it null until matching read-only run enrichment confirms it. Keep original and triggering provider actors as null until read-only GitHub data supplies their numeric IDs. Never infer they are the code author or operator.
6. Read-only enrichment must match numeric repository ID, repository full name, workflow run ID, job ID and run attempt, plus original SHA and runner identity where already reported. Any conflicting source evidence is refused and sent to operator reconciliation rather than silently overwritten. A rerun keeps its run ID and SHA, so when neither the webhook nor the job record names the attempt, enrichment is refused as `enrichment_attempt_unproven` rather than attaching the run's current attempt and triggering actor. GitHub's `0` for a runner or runner group not yet assigned is Unknown, in the webhook and in the job record; a negative ID is refused.
7. Preserve the original source timestamps and raw observation as a separate evidence object. Enrichment can add verified run/actor information but must not overwrite an existing admitted Activity Event, revision or other Source System fact.

## Workflows

1. **Signed input**: verify the existing GitHub webhook transport first; use a reviewed repository mapping to construct the context.
2. **Pure mapping**: validate the job envelope; return `mapped`, `ignored`, or `refused` with a bounded reason code.
3. **Optional enrichment**: read a matching GitHub workflow run and job with Actions read permission through a separately authenticated adapter, then call `enrichWorkflowJob`. Refuse identity and attempt disagreement. This pure module never contacts GitHub.
4. **Durable admission, future**: decide Event Kind/schema/version and secure receipt storage for queued/in-progress/completed transitions, with Event Key idempotency and Corrections. This is not implemented in v0.1.0. Avoid forcing the current `ci.completed` Event Kind to represent a queued or running job.
5. **Backfill, future**: bound pagination, webhook reconciliation, API rates, original receipts, 429 handling, Source Freshness and out-of-order delivery. Retain source evidence and leave gaps Unknown.
6. **Projection and UI, future**: join numeric GitHub runner registration to the reviewed machine binding, then display current GitHub job state beside separate host-reported and desired states. Maintain separate original workflow actor, triggering actor, controller principal and operator requester.

## Acceptance for this slice

- Repository substitutions, incorrect job URL, unsafe IDs, malformed dates, invalid phase/conclusion, unauthorized context and contradictory job states refuse.
- Original actor and rerun triggering actor remain distinct; a sender login or matching display name never creates an Identity Binding.
- Missing run attempt and runner ID remain Unknown, and so does GitHub's `0` runner ID; mismatched run attempt and API runner identity refuse, and so does enrichment with no attempt evidence.
- No secrets or raw job-step input are carried into output, no caller-owned webhook is mutated.
- Pure tests exercise all three transitions, reruns, cross-repository/job mismatch, invalid source claims and late enrichment without timestamp overwrite.
- No claims of live webhook subscription, API enrichment, durable deduplication, runner assignment, machine activation or production readiness.

## Following work

ZER-36 still requires signed delivery integration, durable admission/reconciliation, source identity enrichment and work/operations detail views. ZER-41 requires the resulting source-linked Job Attempt facts to feed the read-only performance Projection. Complete these in separate reviewable slices with exact-head CI, independent Verdict/reproduce and separate merge approval. Do not create a public endpoint, change `runs-on`, enroll machines or create credentials as a shortcut.
