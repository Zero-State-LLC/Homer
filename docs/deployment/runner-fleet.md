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

## Operator workflow

1. Open CI runners with authenticated admin access.
2. Read current fleet revision, then add or edit the PC and Mac records.
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
or read audience. It remains disabled until RUNNER_CONTROLLER_AUD is configured.
An operator must verify the workload identity and its machine before enrolling its
principal digest. Digest format is SHA256 of issuer, newline, and the verified
service identity in the existing Access contract; aliases are not identity proof.
No service token is created by these APIs.

Admin endpoints are `/v1/admin/runners/binding?machineId=...` (GET/PUT, binding
revision via If-Match) and `/v1/admin/runners/observation?machineId=...` (GET).
Controller endpoints are `/v1/runner-controller/poll?machineId=...` (GET) and
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
