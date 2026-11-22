# Runner Work evidence mapping and gated admission (v0.2.0)

Status: partial repository implementation, not activated. Task: [ZER-36](https://linear.app/zer0state/issue/ZER-36).
Intent: [calendar runners](../../docs/intent/calendar-runners.md) (accepted).
Design: [ADR 003](../adr/003-runner-operations-telemetry.md).
Related: [runner scheduling spec](../runner-scheduling/spec.md), [PR #44](https://github.com/Zero-State-LLC/Homer/pull/44).

## Scope

The first deliverable is a pure, effect-free mapping layer for GitHub `workflow_job` webhook records and optional read-only `workflow_run` plus job API enrichment. Version 0.2.0 adds a signed, opt-in webhook admission path and a separate immutable, SQL-backed operational evidence store with original delivery receipts. It still does not create an Event Ledger Activity Event, call a GitHub API, enroll a machine, dispatch CI, or claim production activation. This requires a reviewed additive Durable Object migration before deployment.

GitHub is Authority for Repository Events and job execution facts. Homer is Authority only for Observations and Projections; provider actors are not attributed to a Homer Actor without an explicit Identity Binding. A workflow trigger does not establish who performed the engineering work.

## Source and trust contract

1. The caller must verify the raw GitHub `X-Hub-Signature-256` against the configured webhook secret before decoding or invoking the mapper. Reuse the existing bounded webhook verification path. `workflow_job` admission requires explicit `GITHUB_JOB_INGEST_ENABLED=true`, an enabled and exact numeric Repository mapping, an exact GitHub delivery UUID and the separate `JOB_EVIDENCE` Durable Object binding; otherwise it ignores or fails closed. The option defaults disabled.
2. Obtain the reviewed numeric repository ID and repository name from Homer's runtime mapping catalog. Reject repository mismatches. Never infer identity or entitlement from a runner label, alias or repository name alone.
3. Preserve the original verified delivery identity, fixed job identity and exact GitHub evidence URL. Ignore arbitrary webhook sender names, job steps, command arguments, environment variables and free-form private content.
4. Accept `queued`, `in_progress` and `completed` as distinct states, not as interchangeable updates. A completed job requires completed-at evidence; no timestamp is invented.
5. The webhook may not supply an authoritative `run_attempt`; leave it null until matching read-only run enrichment confirms it. Keep original and triggering provider actors as null until read-only GitHub data supplies their numeric IDs. Never infer they are the code author or operator.
6. Read-only enrichment must match numeric repository ID, repository full name, workflow run ID, job ID and run attempt, plus original SHA and runner identity where already reported. Any conflicting source evidence is refused and sent to operator reconciliation rather than silently overwritten.
7. Preserve the original source timestamps and raw observation as a separate evidence object. Enrichment can add verified run/actor information but must not overwrite an existing admitted Activity Event, revision or other Source System fact.

## Workflows

1. **Signed input**: verify the existing GitHub webhook transport first; use a reviewed repository mapping to construct the context.
2. **Pure mapping**: validate the job envelope; return `mapped`, `ignored`, or `refused` with a bounded reason code.
3. **Optional enrichment**: read a matching GitHub workflow run and job with Actions read permission through a separately authenticated adapter, then call `enrichWorkflowJob`. Refuse identity and attempt disagreement. This pure module never contacts GitHub.
4. **Durable admission, implemented behind an opt-in gate**: after HMAC and Repository mapping checks, hash the original request bytes and atomically append one bounded sanitized observation and immutable receipt for the GitHub delivery UUID. An exact duplicate returns its first receipt without refreshing timestamps; a changed body with the same UUID conflicts. An additive SQLite Durable Object migration isolates this operational history from the Event Ledger. Do not force existing `ci.completed` to represent a queued or running job.
5. **Partial out-of-order handling, implemented**: append late queued/in-progress observations without replacing completed evidence. The internal read projection preserves completed state, while contradictory terminal deliveries return Unknown with an explicit conflict. Records are capped at 10,000 per isolated store and per-job reads at 200; overflow refuses writes or hides misleading latest-state claims. Full backfill, API rate handling, reconciliation and Source Freshness remain future work.
6. **Projection and UI, future**: join numeric GitHub runner registration to the reviewed machine binding, then display current GitHub job state beside separate host-reported and desired states. Maintain separate original workflow actor, triggering actor, controller principal and operator requester.

## Acceptance for this slice

- Repository substitutions, incorrect job URL, unsafe IDs, malformed dates, invalid phase/conclusion, unauthorized context and contradictory job states refuse.
- Original actor and rerun triggering actor remain distinct; a sender login or matching display name never creates an Identity Binding.
- Missing run attempt and runner ID remain Unknown; mismatched run attempt and API runner identity refuse.
- No secrets or raw job-step input are carried into output, no caller-owned webhook is mutated.
- Pure tests exercise all three transitions, reruns, cross-repository/job mismatch, invalid source claims and late enrichment without timestamp overwrite.
- Signed webhook tests prove default-disabled admission, HMAC refusal, exact Repository mapping, immutable original receipts across restart, concurrent duplicates, conflicting IDs/bodies, stale queued events, conflicting terminal evidence, and preservation of private step data outside receipts.
- No claims of live webhook subscription, API enrichment, runner assignment, machine activation or production readiness.

## Following work

ZER-36 still requires controlled runtime rollout, read-only GitHub API enrichment and backfill, stable attempt reconciliation, Source Freshness and work/operations detail views. ZER-41 requires the resulting source-linked Job Attempt facts to feed the read-only performance Projection. Complete these in separate reviewable slices with exact-head CI, independent Verdict/reproduce and separate merge approval. Do not create a public endpoint, change `runs-on`, enroll machines or create credentials as a shortcut.

## Activation, migration and rollback constraints

The new `WorkflowJobEvidenceObject` uses a separate `JOB_EVIDENCE` binding and additive `job-evidence-v1` SQLite migration. Neither is deployed by merging this change. An operator must verify Cloudflare configuration, run staged migrations, set an explicit trusted workflow-job subscription and separately turn on `GITHUB_JOB_INGEST_ENABLED=true` before live collection. Missing flag defaults to ignored; missing binding fails 503 rather than acknowledging an accepted delivery. No secrets or credential values appear in Homer metadata. Do not enable on production while the data lifecycle and read-only GitHub API reconciliation remain unqualified.

Rollback must preserve the Durable Object class export and binding where persisted objects exist. Do not remove accepted receipts or claim that disabling the route deleted them. A 10,000-delivery capacity ceiling is deliberately fail-closed pending a reviewed archival and retention contract. The internal `readJob` RPC has no HTTP route. GitHub job state and host-reported runner state must remain separate.

GitHub documents the delivery UUID, HMAC verification and `workflow_job` event separately: <https://docs.github.com/en/webhooks/webhook-events-and-payloads>, <https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries>. Cloudflare's SQLite Durable Object API documents synchronous transactions: <https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/>.
