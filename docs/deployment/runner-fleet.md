# PC and Mac runner enrollment and recovery

Implementation boundary: Homer records desired configuration. Saving enabled or
maintenance does not install, start, stop, drain or register a GitHub runner.
Observed state remains Unknown until an authenticated controller is implemented
and enrolled. Existing GitHub-hosted CI stays unchanged.

## Before enrollment

Record each machine's alias, owner, actual operating system and architecture,
GitHub runner id after registration, authorized Repository and routing labels.
A PC is not automatically Windows; confirm Linux versus Windows. Confirm Intel
versus Apple silicon on the Mac. Do not infer these from device marketing names.
Use a dedicated low-privilege account and approved trusted workflows only.

Keep provider and Access credentials out of Homer metadata. Use the provider's
secure registration procedure on the machine. No tokens through chat or Git.
Restrict runner groups to approved repositories/workflows and verify effective
policy; labels route jobs but do not establish authorization. Avoid giving these
machines production deploy credentials or running untrusted PR code.

## Machines and runners

The same configuration lists every machine fleet monitoring watches, and the
runners among them. Two admin pages edit it (ZER-114):

- **Machine fleet setup** (`/v1/admin/machines`) adds and describes every
  machine: its id, alias, kind, operating system and architecture. A new
  machine is monitored only. A `spark` or `jetson` is Linux on arm64; a Linux or
  Windows GPU host is a `pc`. Record what the machine is, never a guess.
  Editing a runner machine's details keeps its runner settings.
- **Runner fleet** (`/v1/admin/runners`) lists CI runners only. A runner is
  added to a configured machine that has none: its repository, labels, GitHub
  runner id and desired mode. Lifecycle controls and host evidence are here.

A monitored machine has no desired mode, no lifecycle controls and no
controller enrollment. It can later get a runner; a runner cannot go back. The
read-only **Machine fleet** page (`/v1/workspace/fleet`) shows every machine's
state. See the fleet monitoring spec's
[Machine list](../../specs/fleet-monitoring/spec.md#machine-list).

## Operator workflow

1. Open Machine fleet setup with authenticated admin access, and add the
   machine if it is not listed.
2. Open Runner fleet, read the current revision, then add the runner to its
   machine or edit it.
3. Review the exact changes. A maintenance request records intent only.
4. Save with the observed revision and verify fresh readback.
5. For conflict or uncertain save, read back before manual reconciliation. Do not
   repeat the write automatically.
6. Until host control is enrolled, stop/start the runner through its local service
   under the machine owner's control and verify GitHub status separately.

For maintenance, first prevent new trusted jobs from being routed to the machine,
wait for any active job to finish, then stop the runner application. Offline does
not prove a clean drain, and removing a registration is not a pause operation.
Never kill a busy runner merely because its heartbeat is late.

## Release and recovery

The separate RunnerFleetObject requires its additive Durable Object migration.
Deploy configuration and binding together only after review; preserve existing
MappingCatalogObject and Event Ledger bindings. Rollback code must retain the
new class export while stored objects exist. Do not delete fleet history.

Before activation, qualify host controller authentication, exact per-machine
scope, duplicate requests, interrupted polls, lost acknowledgements, busy drain,
stale heartbeat and local emergency stop. The controller must never accept
arbitrary commands or trust a browser-supplied observed status.

Actual PC/Mac host installation, live runner observation and completed maintenance
are outstanding. Fixture tests prove application behavior, not machine readiness.

## Controller protocol preparation

The controller protocol uses a separate Access audience, never the existing admin
or read audience. Its poll and report routes are served by `homer-intake`, the
Worker for machines, and enrollment by `homer-catalog`, behind the admin
audience ([ADR 013](../../specs/adr/013-catalog-worker-boundary.md),
[`intake.md`](intake.md)). It remains disabled until `homer-intake` has
RUNNER_CONTROLLER_AUD configured.
An operator must verify the workload identity and its machine before enrolling its
principal digest. Digest format is SHA256 of issuer, newline, and the verified
service identity in the existing Access contract; aliases are not identity proof.
No service token is created by these APIs.

Admin endpoints are `/v1/admin/runners/binding?machineId=...` (GET/PUT, binding
revision via If-Match) and `/v1/admin/runners/observation?machineId=...` (GET).
Controller endpoints, on `homer-intake`'s hostname, are
`/v1/runner-controller/poll?machineId=...` (GET) and
`/v1/runner-controller/report?machineId=...` (POST). The controller may access only
its bound machine. Configure RUNNER_HEARTBEAT_BUDGET_SECONDS explicitly before
interpreting freshness; absence yields Unknown.

Admin observations are host-reported evidence. They do not establish GitHub job
status independently. An identical accepted report retry returns its original
receipt and does not refresh observed time. Disabled or replaced bindings deny
old controllers immediately, including receipt retries. New stale-intent reports
are refused. A rejected outbox requires explicit operator reconciliation; never
discard it just to clear the interface or replay the old host action.

The portable reconciliation core has no shell, service installation or provider
credentials. Its trusted host adapter must prove admission closure before stopping
an idle runner. Until a native adapter is qualified, this remains a repository
component, not a remotely managed PC/Mac service.

## Connect and disconnect operations

Use a machine-local controller making outbound HTTPS requests through the dedicated
Cloudflare Access workload audience. The PC/Mac does not need a public address,
inbound listener or Cloudflare Tunnel for this control channel. GitHub runner job
communication remains independent. Tunnel is optional for separately approved private
services, never proof of runner identity or safe job termination.

The lifecycle admin surface provides reviewed enrollment for an already provisioned
principal, plus Resume, Drain, Disconnect and Revoke access now. Enrollment requires
an exact principal digest and nonsecret evidence reference, not a secret pasted into
the UI. The UI does not provision Cloudflare credentials or install local services.
Use distinct per-machine Access identities stored outside job accounts. The local
controller needs a durable journal, service ownership and tested native adapter.
These deployment prerequisites remain outstanding until verified on the real hosts.

Drain retains the controller binding and requests maintenance. Disconnect records a
pending drain; after fresh stopped/idle/admission-closed evidence, Finish disconnect
atomically checks current configuration and binding revisions before disabling the
Homer binding. If the host is unreachable, disconnection remains pending. Revoking
Homer access cannot independently stop a GitHub runner or revoke its GitHub registration.
It also does not revoke the Cloudflare service credential itself: credential lifecycle
is a separately authenticated operation. Keep those statuses distinct in operator work.

A fully revoked machine needs reviewed re-enrollment. A drained machine remains
reachable and can receive Resume. Existing operation history is retained in both
cases. Every lifecycle mutation carries config, binding and operation revisions;
read back uncertain results before a manual retry. Never auto-replay a write.

See [machine lifecycle contract](../../specs/runner-lifecycle/spec.md).
