# Machine connection and runner lifecycle

Status: accepted repository scope from Daniel's November 22, 2026 PT continuation.
Extends docs/intent/calendar-runners.md, ADR 002 and specs/runner-controller/spec.md.
Task scope: admin lifecycle controls and audited safe transitions. Actual native
installation and automated credential provisioning remain separate live gates.

## Decision

Use an outbound HTTPS controller per machine through Cloudflare Access. No Tunnel
required for this control channel; optional Tunnel use for private services is separate.
Keep machine enrollment/connection distinct from runner desired and observed modes.
Never display a request as confirmed execution. A paused runner retains its controller.
Full disconnection revokes Homer enrollment; local re-enrollment is required to return.
Do not imply revoking Homer stops the independently connected GitHub runner.

## Workflows

1. Add machine configuration, then review an already provisioned controller principal
   digest and nonsecret enrollment evidence. UI explains local service installation,
   dedicated Access identity and secrets outside job accounts. No generated command,
   credential, pairing code or automatic installer is claimed in this slice.
2. Resume requests enabled mode only for an enabled binding. Drain requests maintenance
   while retaining the binding. Host evidence determines actual status.
3. Disconnect first requests maintenance. Show disconnect pending while busy, stale,
   unreported or unreachable. When a fresh current-binding report confirms stopped,
   idle and admission closed for current maintenance intent, operator clicks Finish
   disconnect. Server checks again atomically before revoking the binding. Keep history.
4. Revoke now immediately disables the binding, with explicit warning that GitHub jobs
   and listener may still run. Show access revoked, runner stop unconfirmed.
5. Reconnect uses reviewed enrollment, not the previous secret copied back into UI.
   Existing binding endpoint remains the explicit enrollment mechanism. UI reads the
   binding revision first, reviews identity/evidence and uses compare-and-swap.
6. All uncertain mutations require readback before manual retry. Never automatically
   replay a mutation. Stale form revisions cause conflict and discard the stale review.

## HTTP and persistence contract

New admin-only GET/POST /v1/admin/runners/lifecycle?machineId=ID. Same-origin and
bounded strict JSON, no redirects or workload/read-audience access. POST exact body:
{action:resume|drain|disconnect|revoke,configRevision,bindingRevision,operationRevision}.
All revisions nonnegative safe integers. POST compares all three atomically and
returns 409 for stale revision, missing enrollment, or unsafe prerequisites. Missing
machine 404. A monitored machine, which runs no runner (fleet monitoring spec,
Machine list), is 404 `not_a_runner` on GET and POST; enrolling one is 409. No If-Match needed: all three body revisions are required preconditions.
GET and successful POST return:
{machineId,configRevision,bindingRevision,operationRevision,connectionState,
 desiredState,disconnectPending,observation,binding,history,historyTruncated}.
connectionState: unenrolled|revoked|connected|stale|unknown.
Only fresh evidence from current enabled binding means connected; no physical
network reachability inferred. observation is the existing host-reported projection.
binding is existing reviewed metadata, never secret. history latest 20 operations,
with operationRevision,action,operatorDigest,requestedAt,outcome (requested|pending|revoked),
configRevision,bindingRevision. Full immutable operation history remains stored.

DisconnectPending derives from latest operation action=disconnect/outcome=pending;
resume/drain can supersede that intent explicitly. First disconnect may record
maintenance with a new config revision; if already maintenance do not advance it.
Finish disconnect only with fresh current-revision stopped/idle/not-accepting report,
current binding, and existing pending disconnect. Otherwise remain pending and keep
binding enabled. A resume/drain never enables a revoked binding. Every successful
request appends an operation record and preserves operator provenance.

Use one synchronous Durable Object transaction for preconditions, config changes,
binding changes and operation append. No async gap between check and mutation.
No new Event Ledger events are invented; these are operational audit records.

## UI contract

Per-machine controls: Enroll/Reconnect, Resume, Drain, Disconnect, Finish disconnect,
Revoke access now. Review panel names machine, repository, action and its consequence.
Disable impossible actions, not merely hide errors. Show machine connection and
runner mode separately, latest host listener/job/admission, heartbeat timestamps,
last operator digest (Unattributed until bound), operation time and pending state.
Observation expiration must remove connected/complete assertions. A read failure
shows unknown and disables mutations until a successful readback. Fetches for removed
DOM cards cannot change the current view. Host execution remains gated on native
adapter qualification; no claim that this UI installs or starts an actual host.
Enrollment form accepts only principal SHA256 and nonsecret evidence reference.
Do not accept secret material in any field. No arbitrary script execution controls.

## Acceptance

Server: admin-only/same-origin, strict schemas, CAS for every revision, resume refusal
without enrollment, busy/stale/unknown disconnect pending, stopped-but-old revision
cannot revoke, fresh current stopped finalization, immediate revocation warning state,
immutable audit across restart, no duplicate history on failed/conflicting requests.
UI: explicit review and cancellation, enrollment readback, distinct state labels,
conflict/lost response readback without replay, pending disconnect and finalization,
keyboard and mobile layout. All evidence synthetic in isolated local fixtures.
