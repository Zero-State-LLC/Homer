# ADR 002: PC and Mac CI runner fleet

Status: accepted for implementation, November 21, 2026 PT.
Amended by the fleet monitoring spec (ZER-113, Danny, 2026-11-25): the same
configuration also lists monitored machines, which run no runner, and the
`spark` and `jetson` kinds. Runner machines are unchanged. See the spec's
[Machine list](../fleet-monitoring/spec.md#machine-list).

## Decision

Manage a dynamic fleet in Homer, initially one PC and one Mac. Machine aliases,
OS, architecture, GitHub runner id, repository scope and labels are operator
configuration, never hardcoded machine identities. PC may be Windows or Linux;
Mac is macOS. GitHub owns job assignment and runner registration. Homer stores
reviewed desired configuration and requests; observed state must come from an
authenticated host controller or GitHub. No arbitrary shell execution endpoint.

The first implementation provides an authenticated operator fleet UI, durable
revisioned configuration and maintenance requests with compare-and-swap. Operators
can add/update configured machines and request enabled or maintenance mode. These
are desired states only, never claims of completed start/stop/drain. Show observed
status unknown until a supported authenticated controller supplies evidence.
A busy runner must finish its current job before maintenance; the future controller
must reconcile stop/start and report durable evidence. Deletion, forced stop,
registration tokens, reboot and provider credentials are not exposed here.

## Boundaries and acceptance

Use a separate Durable Object from the repository catalog, admin authentication,
same-origin protection, bounded strict inputs and safe response fields. Preserve
operator digest, previous revision and request time on each config change. Reject
stale revisions; UI reads back uncertain saves before allowing manual retry.
No automatic mutation retry. Never silently enable self-hosted CI or change runs-on.
HTTP tests prove CAS, persistence/readback, forbidden requests and invalid records.
Browser tests prove add/edit and maintenance review against a real local Worker.
Host enrollment needs actual OS/architecture, runner ids, scoped access and selected
trusted workflows. No install or live machine control is claimed by these tests.

## Security and later controller

Use dedicated low-privilege host accounts and isolated job environments. Personal
PC/Mac runners must not execute untrusted fork PRs. Prefer ephemeral clean job
workers; retain diagnostic evidence outside disposable workers. Runner groups and
labels route approved repositories/workflows; labels alone are not access control.
Host controllers use outbound authenticated polling, scoped per machine, fixed
commands, idempotent operation ids and heartbeats. Job completion and idle checks
precede drain; offline and stale are not idle. Never install an SSH control plane.

## Research

- <https://docs.github.com/en/actions/reference/runners/self-hosted-runners>
- <https://docs.github.com/en/actions/reference/security/secure-use>
- <https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/remove-runners>
- <https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access>

GitHub documents no general pause API: stopping the runner application leaves it
offline; removing registration is a distinct action. This is why maintenance
requires a host controller and cannot be inferred from a GitHub metadata change.
