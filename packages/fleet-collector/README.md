# Fleet Collector

The Fleet Collector reads sparkDash on its own host and the SSH banner of every
other machine, and posts a Fleet Report to `homer-intake` every poll
([fleet monitoring spec](../../specs/fleet-monitoring/spec.md)). Nothing in it can
change a machine.

This package is the pure core (packet 2, ZER-78): no network, no files and no
clock of its own. The runtime that supplies them, the `GET`-only client, the
Reachability Check, the on-disk queue and delivery, is packet 3 (ZER-79).

| Function | What it does |
| --- | --- |
| `parseCollectorConfig` | Checks `fleet-collector.json`: sparkDash on loopback only, an `https://` intake, a front door on a host name, each `machineId` mapped once to a sparkDash unit or an SSH target. Errors name fields, never values |
| `parseHealth`, `parseMetrics`, `parseAlerts` | Keep only the fields the spec lists. `label`, `summary`, `unitName`, `ruleName`, `peakSeverity` and every other family and label are dropped on read. A response that does not match is `shape_changed` |
| `continuity` | The four rules on sparkDash's history `id`: no new entries, contiguous, gap and restart |
| `poll` | One poll: the next state, the snapshot of every configured Machine, and the new `machine.alert_fired` and `machine.alert_cleared` events, oldest first |
| `buildFleetReport` | The report to deliver: the snapshot, the oldest 100 waiting events, the held and present diagnostics. It refuses a report that does not validate, an IP address anywhere included |
| `acknowledgeReport` | After a `2xx`, drops the held diagnostics that report carried |

Untrusted text never reaches a report. A Machine's name is cleaned, and a name
with an address in it is replaced by the `machineId`. Subjects come from Homer's
rule catalogue in `@zs-home/shared-contracts`.

Known limits:

- Until sparkDash has described a unit, its kind reads `host`.
- On its first poll the Collector has no cursor, so it turns everything
  sparkDash holds into events, with no diagnostic. Event Keys make any already
  delivered event a Duplicate.
- While sparkDash's alerts are off, sparkDash forgets its active alerts by
  design. `alerts_off` reports that, and no `collector_gap` is added for them.
