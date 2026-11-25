# Fleet Collector

The Fleet Collector reads sparkDash on its own host and the SSH banner of every
other machine, and posts a Fleet Report to `homer-intake` every poll
([fleet monitoring spec](../../specs/fleet-monitoring/spec.md)). Nothing in it can
change a machine.

The pure core (packet 2, ZER-78) has no network, no files and no clock of its
own. The runtime (packet 3, ZER-79, `src/runtime/` and `src/cli.ts`) supplies
them: the `GET`-only sparkDash client, the Reachability Check, the state file
with the queue, and delivery.

```sh
fleet-collector --config /etc/fleet-collector/fleet-collector.json \
  --state /var/lib/fleet-collector/state.json [--once]
```

`npm run fleet-collector -- ...` runs it from a checkout after `npm run build`.
Credentials, each by 1Password reference (`<NAME>_REF=op://...`) or in the
environment, never in the configuration file: `FLEET_COLLECTOR_CLIENT_ID` and
`FLEET_COLLECTOR_CLIENT_SECRET`, the Collector's Access service token. A missing
one stops the Collector with a non-zero exit that names it. No log line carries
a credential, an address or a response body.

| Function | What it does |
| --- | --- |
| `parseCollectorConfig` | Checks `fleet-collector.json`: sparkDash on loopback only, an `https://` intake, a front door on a host name, each `machineId` mapped once to a sparkDash unit or an SSH target. Errors name fields, never values |
| `parseHealth`, `parseMetrics`, `parseAlerts` | Keep only the fields the spec lists. `label`, `summary`, `unitName`, `ruleName`, `peakSeverity` and every other family and label are dropped on read. A response that does not match is `shape_changed` |
| `continuity` | The four rules on sparkDash's history `id`: no new entries, contiguous, gap and restart |
| `poll` | One poll: the next state, the snapshot of every configured Machine, and the new `machine.alert_fired` and `machine.alert_cleared` events, oldest first |
| `buildFleetReport` | The report to deliver: the snapshot, the oldest 100 waiting events, the held and present diagnostics. It refuses a report that does not validate, an IP address anywhere included |
| `acknowledgeReport` | After a `2xx`, drops the held diagnostics that report carried |

The runtime:

| Part | What it does |
| --- | --- |
| `sparkdashClient` | Sends only `GET`, only to `/api/health`, `/metrics` and `/api/alerts`, only to the configured `127.0.0.1` or `[::1]` origin. Anything else is refused before sending. It follows no redirect, sends no credential, and reads at most 4 MiB |
| `checkSshBanner`, `applyCheck` | The Reachability Check: a TCP connection, at most 255 bytes of banner within 5 seconds, nothing sent. Two failures in a row fire `reachability`; the first success clears it |
| `fileStore` | One state file, so the queue and the cursor move together: events are on disk before the cursor that counts them. Written atomically, readable by its owner only. A file it cannot read stops the Collector instead of starting afresh |
| `FleetCollector` | Polls every 30 seconds, checks every 60. Each report carries the latest snapshot and the oldest 100 events; a `2xx` removes exactly those and the held diagnostics carried, and the next 100 go at once. A failure keeps everything and retries with backoff, at most once a poll. The queue holds at most 10,000 events. A Reachability Check transition that finds it full waits in the state file with its own time, up to 100 per machine, and is queued once there is room |
| `reportIdFor` | A report's id from its content, so an identical retry keeps its `reportId` and changed content never reuses one |

Untrusted text never reaches a report. A Machine's name is cleaned, and a name
with an address in it is replaced by the `machineId`. Subjects come from Homer's
rule catalogue in `@zs-home/shared-contracts`.

Known limits:

- sparkDash must run without `SPARKDASH_TOKEN`: the Collector sends no
  credential to it, so a token-protected sparkDash answers `401`, which reads
  as `shape_changed`. It is bound to loopback, so only its own host reaches it.

- Until sparkDash has described a unit, its kind reads `host`.
- On its first poll the Collector has no cursor, so it turns everything
  sparkDash holds into events, with no diagnostic. Event Keys make any already
  delivered event a Duplicate.
- While sparkDash's alerts are off, sparkDash forgets its active alerts by
  design. `alerts_off` reports that, and no `collector_gap` is added for them.
