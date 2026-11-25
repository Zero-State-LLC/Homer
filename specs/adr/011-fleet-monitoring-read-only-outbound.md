# ADR 011: fleet monitoring reads sparkDash read-only and pushes outbound

Status: proposed, for Danny's acceptance with the spec.
Intent: [Remote fleet monitoring through sparkDash](../../docs/intent/fleet-monitoring.md)
(accepted by Danny on 2026-11-24, #69).
Spec: [Fleet monitoring through sparkDash](../fleet-monitoring/spec.md).

## Context

Danny wants every machine the team can reach over SSH watched from Homer, and
the DGX Sparks first among them. sparkDash already reads DGX Sparks, Apple
Silicon Macs, Linux hosts with an NVIDIA GPU and Windows PCs from one host, and
evaluates health alerts for them. It cannot read every machine: it does not
mention the Jetson, and the Bosgame's and Galadriel's hardware is unknown.

Three facts about sparkDash shape the design [verified: sparkDash v2.91.0,
commit `86f972e`]:

- Its API is open on loopback, and it can shut machines down, wake them, cap
  their GPU clocks and power, and run launcher scripts.
- Its read endpoints carry text from elsewhere: SSH errors, kernel lines and
  operator-written names.
- `/api/sparks` returns each machine's address and SSH user. `/metrics` names
  machines by id, name and kind only.

Homer's side runs on Cloudflare and its runners are local (Danny, 2026-11-23).
The Event Ledger is binding-only, with no public endpoint.

## Decision

1. **Read-only.** A Fleet Collector on the sparkDash host reads three endpoints,
   `GET /api/health`, `GET /metrics` and `GET /api/alerts`, over loopback. Its
   client refuses any other method, path or host, and it takes no instructions
   from Homer.
2. **Outbound only.** The Collector posts one Fleet Report per poll to a Homer
   intake route behind Cloudflare Access, with a service token. The intake
   validates it, appends its Activity Events through the ledger binding, and
   stores the latest snapshot. Homer never opens a connection into the fleet's
   network.
3. **Text and addresses stay on the host.** Machines are named by id, a cleaned
   name and a kind. sparkDash's `label` and `summary` never leave the host, and
   subjects use fixed templates. A report that carries an IP address is refused
   before it is sent.
4. **Every SSH machine is covered.** A machine sparkDash cannot read gets a
   Reachability Check: a TCP connection that reads the SSH banner, with no
   login and no command.
5. **Transitions, not samples.** Only alert fire and clear transitions become
   Activity Events (contract version 3: Source System `sparkdash`, Kinds
   `machine.alert_fired` and `machine.alert_cleared`). States and last-seen
   times live in the snapshot. Metric history stays in sparkDash.
6. **Unknown is never fine.** A missing metrics endpoint, alerts turned off, a
   changed response shape, or a quiet Collector shows as unknown or stale, and
   raises an Alert.

## Consequences

- Homer adds no new way to change a machine. Whoever controls sparkDash's host
  could already do everything sparkDash can.
- A stolen intake token can forge the fleet's status and its Alerts, but it
  cannot act on a machine. The token's Access application admits it on one path
  only, and intake is rate limited.
- A Reachability Check shows that a machine runs an SSH server, not that a login
  works.
- The Collector targets one sparkDash release. A sparkDash upgrade that changes
  a response shape stops the mapping until the Collector is updated. That is
  deliberate: a guess at a new shape could hide a problem.
- sparkDash's published container is privileged on its host. Running it is a
  choice the spec puts to Danny, not a consequence of this ADR.

## Alternatives considered

- **Homer collects over SSH itself.** It would duplicate sparkDash, put keys and
  addresses into Homer, and give Homer's side a path into the fleet. Rejected.
- **sparkDash's webhook channel posts to Homer.** sparkDash sends each message
  once with no retry, so a missed send is lost. A channel is only a URL and
  cannot carry an Access token, so Homer would need an open endpoint or a
  relay. Polling sparkDash's alert state avoids both, and the spec's continuity
  rules report any transition a poll misses. Rejected.
- **Prometheus scrapes sparkDash, and Homer reads Prometheus.** That adds a stack
  the intent excludes. `/metrics` keeps it possible later.
- **DCGM.** NVIDIA's forum answers say it is not supported on the GB10. The
  intent records this under its NVIDIA-first rule.
