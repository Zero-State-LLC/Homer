# Scoped runner controller protocol

Status: repository implementation authorized by Daniel's continuation on November
22, 2026 PT, extending ADR 002. ZER-34 remains open until actual host enrollment
and live drain/resume evidence are verified. No credentials or policy changes.
Amended by ADR 013 (accepted by Danny on 2026-11-24): `homer-intake` serves poll
and report, and `homer-catalog` serves enrollment and the lifecycle controls.

## Decision and boundaries

Homer supplies desired state and records authenticated host reports. GitHub remains
Authority for job assignment. Host reports are labelled host-reported, never
independent proof of GitHub state. The first implementation is the protocol plus
a portable reconciliation core; native service adapters require verified machine
OS and a method that actually closes job admission without interrupting active work.
No arbitrary command, shell, SSH, registration token or reboot API.

## Server contract

- Poll and report are `homer-intake` routes, and the admin routes below are
  `homer-catalog` routes, behind its admin audience (ADR 013). Both Workers use
  the same Access issuer and `CATALOG_NAME`, so an enrolled digest is the one
  intake verifies.
- Separate optional RUNNER_CONTROLLER_AUD, held by `homer-intake` only; it must
  differ from read/admin audience. Intake holds neither of those, so the
  deployment gives the controller paths their own Access application.
  Only workload identities with an explicit reviewed machine binding may poll/report.
  Accept the exact workload audience as a string or a singleton array. Empty,
  mixed and repeated audience arrays are refused. Human subjects are refused.
  Admin audience is not a controller capability. Missing config denies access.
- Admin enrolls a machine-to-principal digest and nonsecret evidence reference using
  a revision precondition. Never infer bindings from machine alias or source login.
  Bindings may be disabled and replaced; changes are audited. No credentials created.
- Poll returns only that machine's desired metadata, current revision and stable
  operation id. No fleet enumeration or other machine information.
- Reports carry exact operation id/revision, stable report id, observed UTC time,
  listener running/stopped/unknown, job busy/idle/unknown and acceptingJobs boolean
  or null. Strict bounded schemas refuse unknown fields. No free-form host logs.
- Durable report idempotency returns the original receipt for identical retries;
  changed content with the same id conflicts. Duplicate retries do not freshen the
  heartbeat. Reject new reports for superseded intent or revoked binding atomically.
  An already accepted identical report may return its original receipt after an
  intent change only while its machine binding remains authorized. A newly rejected
  pending report stays in the outbox with an explicit recovery blocker; never
  silently discard evidence or replay the old host action.
- Store authenticated principal digest and server receipt time. Freshness budget
  must be explicitly configured. Missing/expired/future observations stay unknown
  or stale; offline is never inferred idle. Preserve report history.
- Admin reads per-machine host evidence, timestamps and operation state separately
  from desired configuration. Enabled completion requires running/accepting reports;
  maintenance completion requires stopped, idle, not accepting. Anything else is
  pending/blocked. These are host reports, not confirmed provider-side outcomes.

## Workflows

1. Enrollment: operator reviews the machine principal and evidence, reads binding
   revision, then submits a compare-and-swap binding update.
2. Drain: controller persists intent, closes admission, observes job state and waits
   until idle before stopping. It records observations in a durable report outbox.
3. Resume: controller observes, starts the listener if needed, verifies it runs,
   then opens admission and reports the actual outcome.
4. Lost acknowledgement: restart reads the outbox and resends the same report;
   the server returns its original receipt before any newer host action runs.
5. Rejected outbox: preserve the pending report and return a recovery blocker for
   operator review. Never discard the report or replay its host action.
6. Evidence expiry: server returns remaining validity; the page expires fresh
   assertions to stale/unknown at that limit, including time spent fetching.

## Portable controller core

Use explicit interfaces for transport, trusted local adapter and durable journal.
Only poll, observe, closeAdmission, stop, start and openAdmission capabilities.
Before any mutation, validate bounded command shape and exact local machine identity.
Reject stale commands after a newer one has been accepted. Serialize local cycles.
For maintenance: close admission, observe again, wait if busy or unknown, stop only
when admission is closed and job idle, then observe. Never force stop or infer idle.
For enable: start, observe, open admission only after listener running; report what
is observed, not what was requested. No mutation retries on uncertain outcome;
next cycle reconciles observation first. Durable report outbox preserves report id
and content across restart/lost response, before accepting newer work. Acknowledged
reports clear the outbox only after exact matching receipt readback.
Transport/adapter errors yield sanitized typed failures, never raw exception text.
No production-ready native adapter is implied by passing synthetic tests.

## Acceptance

HTTP tests: exact workload audience and machine scope, no human/admin access,
missing bindings, revoked/replaced binding, CAS enrollment, duplicate receipt
preservation, changed duplicate, stale intent, invalid timestamps, unknown/stale
freshness and original receipt times across restart.
Controller public-interface tests: busy drain waits, unknown job never stops,
closed admission precedes stop, failed closure refuses stop, interrupted mutation
observes before retry, serialized cycles, stable report outbox across restart,
malformed commands, cross-machine commands and sanitized errors.

## Live enrollment gate

Confirm PC OS, Mac architecture, service ownership, runner IDs and allowed trusted
workflows. Qualify native adapters on a disposable runner before installing on the
personal machines. Never execute untrusted fork code. Existing CI routing and
production remain unchanged. Real evidence must include busy drain, idle resume,
lost acknowledgement and failed heartbeat; a fixture is not a live receipt.
