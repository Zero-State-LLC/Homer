# GitHub merge webhook Collector

Status: implementation slice of the accepted foundation intent, runtime catalog
and migration plan steps 2 and 3. Deployment and source registration remain pending.
The route is served by `homer-intake`, the Worker for machines (ADR 013).

## Contract and state transitions

POST `/v1/hooks/github` authenticates GitHub with HMAC-SHA256 over the exact body
bytes before parsing JSON. `GITHUB_WEBHOOK_SECRET` is a runtime secret, never
committed. Missing configuration returns 503; missing, malformed or incorrect
signatures return 401. Actual streamed bodies are capped at 1 MiB, including when
Content-Length is absent or false. Oversized deliveries return 413 and require
operator investigation. Only application/json without Content-Encoding is accepted.

This endpoint uses GitHub authentication, separate from the existing Access read
and admin applications. No catalog or ledger read is exposed by the webhook. It
accepts signed ping deliveries and ignores other event types/actions explicitly.
Malformed pull_request envelopes return 400; closed deliveries must agree on the
outer number/repository and the PR's base repository. The existing merged-PR
mapper validates merge evidence and produces only allowlisted Activity Event data.
The raw payload, PR title/body and sender identity never enter the Event Ledger.

Each closed delivery reads a fresh, validated catalog snapshot. Empty, disabled or
unknown repository inventory admits nothing. No discovery creates permission and
no stale fallback is used. A mapping revision is reported with the result. The
snapshot read is the authorization point: an already admitted in-flight delivery
may finish after a later disable. Sequential deliveries observe the new revision.

The Worker awaits append through the trusted Event Ledger binding before replying.
Appended returns 201 and a receipt; Duplicate returns 200 with the original receipt;
Conflict returns 409; invalid merge evidence or a refused append returns 422;
catalog/ledger failures return 503 without leaking exception details. Unknown or
disabled repositories and unrelated deliveries return 200 with an explicit ignored
reason. Unmerged closed PRs return 200 skipped. No collection cursor or global
Source Freshness claim is advanced by a single webhook.

Event Keys use repository id, PR id and merge SHA, never delivery id or collection
time. Concurrent/repeated deliveries must produce one stored Activity Event.
Changed mapping or source metadata for the same Event Key remains a Conflict and
requires a reviewed Correction. The Collector never overwrites prior history.

## Workflows and acceptance

1. Deploy the existing Event Ledger separately. Configure a cross-Worker binding
   to its existing namespace; do not create or rename ledger storage in this Worker.
2. Configure the catalog object name and webhook secret for the isolated environment.
3. Register a pull_request webhook only after live deployment authorization and
   prove a signed ping, merge, redelivery, disabled repository and failed append.
4. Test GitHub's published HMAC vector, Unicode, tampering, bad/missing signatures,
   actual byte bounds, malformed envelopes, absent settings and secret rotation.
5. Use real local workerd catalog and Event Ledger bindings to prove append,
   concurrent Duplicate, restart persistence, immediate remap/disable and Conflict.
6. Run the full workspace checks and dry-run the production Worker bundle.

GitHub does not automatically redeliver failed deliveries. Operators must inspect
non-2xx deliveries and redeliver after fixing the cause. Scheduled recovery,
historical backfill, delivery-gap detection, installation discovery and Identity
Bindings remain separate work. A successful webhook test does not prove completeness.

Intent: docs/intent/home-foundation.md. Terms: CONTEXT.md Collector, Event Key,
Duplicate, Conflict, Correction, Attribution and Source Freshness. Team context
HANDOFF.md and STATUS.md at the Context Pin were read; their dated project status
is not current Homer evidence. DECISIONS.md supplies the stage-0 workflow and named
admin bypass, not deployment authorization.

Primary references:

- <https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries>
- <https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request>
- <https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries>
- <https://developers.cloudflare.com/workers/runtime-apis/web-crypto/>
