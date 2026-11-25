# Fleet monitoring through sparkDash

Version: 0.1.0
Status: draft, for Danny's acceptance
Intent: [Remote fleet monitoring through sparkDash](../../docs/intent/fleet-monitoring.md)
(accepted by Danny on 2026-11-24, #69)
Decision: [ADR 011](../adr/011-fleet-monitoring-read-only-outbound.md)

Homer shows every machine the team can reach over SSH as up, down or stale,
with its firing alerts, and sends alert changes to the Buzz `homer` channel.
sparkDash reads each machine whose kind it supports. A Reachability Check covers
every other machine. A local Fleet Collector reads both and pushes one Fleet
Report to Homer outbound, through Cloudflare Access. Homer never reaches into
the fleet's network and never changes a machine.

## Deployment facts

| Fact | Value |
| --- | --- |
| sparkDash release this spec targets | v2.91.0, commit `86f972e` (2026-11-22), Apache-2.0 [verified] |
| sparkDash host | Delphi (intent decision). Whether sparkDash runs anywhere today is unknown |
| sparkDash's published container | `privileged: true`, `network_mode: host`, `pid: host`, read-only `/proc` and `/sys` mounts [verified: `docker-compose.image.yml` at `86f972e`]. See Open choices |
| Front door to the sparkDash page | Cloudflare Tunnel with Access by default; Tailscale Serve allowed; never Tailscale Funnel (Danny, 2026-11-24) |
| Homer's intake hostname and Access application | Not created yet. Danny creates both (packet 7) |
| Machines | The intent's [named machines](../../docs/intent/fleet-monitoring.md#the-named-machines). No inventory exists |

## Contract

### What the Collector reads from sparkDash

The Collector's HTTP client sends only `GET`, only to these three paths, and only
to a loopback address (`127.0.0.1` or `[::1]`). It refuses every other method,
path or host before sending. A test proves each refusal.

| Endpoint | Used for | Kept | Dropped on read |
| --- | --- | --- | --- |
| `GET /api/health` | The release pin | `version` | Everything else |
| `GET /metrics` | The machines, up or down, collector freshness | `sparkdash_up` and `sparkdash_collector_last_success_timestamp_seconds`, with their `unit`, `unit_name`, `kind` and `collector` labels | Every other family and label |
| `GET /api/alerts` | Alert state and transitions | `enabled`; from `active` and `recent`: `id`, `key`, `ruleId`, `unitId`, `severity`, `status`, `startsAt`, `endsAt`, `at` | `label`, `summary`, `unitName`, `ruleName`, `peakSeverity` |

The Collector never reads `/api/sparks`, which returns addresses and SSH users.
`label` and `summary` carry text from elsewhere, such as SSH errors and kernel
lines, and never enter Homer.

`/metrics` answers `404` while sparkDash's Prometheus setting is off. While its
alert notifications are off, `/api/alerts` reports `enabled: false` and sparkDash
evaluates nothing. Either state is reported (`metrics_off`, `alerts_off`) and
raises an Alert. Neither is ever read as "no problems".

sparkDash keeps its alert history (`recent`) in memory only: the newest 200
transitions, each numbered by a sequence `id` that goes up by one with every
transition and starts again from 1 when sparkDash restarts. Its firing set is
saved across restarts [verified: `server/alerts/engine.js` and `store.js` at
`86f972e`]. The continuity rules in [Each poll](#each-poll) rely on both
facts.

### Machine

| Field | Rule |
| --- | --- |
| `machineId` | `sparkdash:<unit id>` for a machine sparkDash reads, where the unit id matches sparkDash's own rule, `[A-Za-z0-9._-]{1,64}`. `ssh:<name>` for a reachability-only machine, `[a-z0-9-]{1,40}` |
| `name` | Display text. Letters, digits, space, `.`, `_` and `-`, at most 40 characters. Anything else is replaced by the `machineId` |
| `kind` | `spark`, `mac` or `host` from sparkDash's `kind` label; `ssh` for a reachability-only machine |
| `source` | `sparkdash` or `reachability` |
| `state` | `up`, `down` or `unknown` |

A machine's address, SSH user, port and key stay on the Collector's host. No
Fleet Report, Activity Event, Projection or Alert carries one. A test rejects
any report that contains an IPv4 or IPv6 address.

### Fleet Report, contract `home.fleet-report/v1`

A new file, `specs/integration-contracts/fleet-report.v1.schema.json`. The
Collector posts one Fleet Report per poll:

```json
{
  "contract": "home.fleet-report/v1",
  "reportId": "uuid",
  "collector": { "name": "fleet-collector", "version": "0.1.0" },
  "collectedAt": "2026-11-24T18:00:00Z",
  "sparkdash": { "state": "ok", "version": "2.91.0", "pinnedVersion": "2.91.0" },
  "machines": [
    {
      "machineId": "sparkdash:delphi",
      "name": "Delphi",
      "kind": "spark",
      "source": "sparkdash",
      "state": "up",
      "lastSeenAt": "2026-11-24T18:00:00Z",
      "firing": [{ "rule": "thermal", "severity": "warning", "since": "2026-11-24T17:58:00Z" }]
    }
  ],
  "diagnostics": [],
  "events": []
}
```

- `sparkdash.state` is `ok`, `unreachable`, `metrics_off`, `alerts_off` or
  `shape_changed`.
- `diagnostics` lists the Collector's own conditions, each
  `{ "code", "since" }`, from a fixed set: `collector_gap` (transitions were
  lost), `sparkdash_restarted` (sparkDash restarted, so transitions just before
  the restart may be missing), `version_changed` (`version` differs from
  `pinnedVersion`), `events_backlog` (more events are waiting than this report
  carries), and `queue_full` (see [Deliver a report](#deliver-a-report)).
  Nothing else goes in a diagnostic.
- `collector_gap` and `sparkdash_restarted` record something that already
  happened, so they are **held**. The Collector writes each one to its state
  when it detects it, keeps its `since`, and puts it in every report until a
  `2xx` answers a report that carried it. The other three describe the present
  and are worked out again for each report.
- `machines` holds at most 64 entries, and `events` at most 100 Activity Events
  under contract version 3, the oldest waiting ones, in order. The body is at
  most 256 KiB.
- `lastSeenAt` is the last time the machine answered: sparkDash's newest
  `sparkdash_collector_last_success_timestamp_seconds` for it, or the last
  successful Reachability Check. Unknown is `null`.

### Activity Event contract version 3

A new file, `activity-event.v3.schema.json`: version 2 plus the `sparkdash`
Source System and two Kinds. Version 2 stays, as the versioning rule in
`specs/integration-contracts/README.md` says.

| Field | `machine.alert_fired` or `machine.alert_cleared` |
| --- | --- |
| Source System | `sparkdash` for sparkDash's alerts. `homer` for a Reachability Check, rule `reachability` |
| `eventKey` | `<source>:machine.alert_fired:<machine part>:<rule>:<startsAt in ms>`, and the same with `alert_cleared`. The machine part is the sparkDash unit id or the `ssh:` id. `startsAt` is when the condition began, so one occurrence has one pair of keys |
| `occurredAt` | sparkDash's history `at` for the transition, or the Check's own time |
| `actor` | `{ "sourceAccount": "sparkdash:alerts" }` or `{ "sourceAccount": "homer:fleet-collector" }`. Never an Actor: no Identity Binding applies |
| `subject` | A fixed template: `<rule name> on <machine name>` or `<rule name> cleared on <machine name>`. The rule name comes from Homer's own catalogue below, never from sparkDash's text |
| `data` | `machineId`, `rule`, `severity` (`warning` or `critical`), `startsAt`, `sparkdashVersion` |
| `provenance.sourceUrl` | The front door's `https://` origin for the sparkDash page |
| `provenance.sourceObjectId` | `<unit id>:<rule>@<startsAt in ms>` |

Homer's rule catalogue maps sparkDash's rule ids to names: `offline` Unit
offline, `throttle` GPU throttling, `disk` Storage, `llm` LLM unavailable,
`tailnet` Tailnet unavailable, `thermal` GPU temperature, `memory` Unified memory
low, `low-power` GPU stuck in low power, `xid` NVIDIA Xid error, `oom`
Out-of-memory kill, `roce-link` RoCE link down, `roce-loss` RoCE packet loss,
`link-speed` Slow network link, `concurrency` Several models loaded, and Homer's
own `reachability` SSH unreachable [verified: sparkDash
`server/alerts/conditions.js`]. An unknown rule id that matches
`[a-z0-9-]{1,40}` is named `sparkDash rule <id>`. One that does not match is
refused as `shape_changed`.

The schema admits these Kinds only from `sparkdash` and `homer`, the way version
2 limits the Buzz and curator Kinds.

### Collector configuration and state

Both live on the Collector's host, never in the repository.

- Configuration, `fleet-collector.json`: the sparkDash URL (loopback only), the
  reachability-only machines (`id`, `name`, `host`, `port`, default 22), the
  Homer intake URL (`https://`), and the front door's origin for
  `provenance.sourceUrl`.
- Credentials: the Access service token's client id and secret, each by
  1Password reference (`<NAME>_REF=op://...`) or in the environment, the way the
  Work Request emitter reads its secrets. Never in the configuration file.
- State: the cursor (the newest history `id` turned into events, and that
  entry's `key`, `status` and `at`), the alerts active at the last poll, the
  Reachability Check counters, the queue of events not yet delivered, and the
  held diagnostics.

## Workflows

### Set up (operator, once)

The runbook in packet 7 covers each step. Nothing here is Homer code.

1. On the sparkDash host, run sparkDash at the pinned release, bound to loopback.
   Add every machine whose kind it reads: DGX Spark, Apple Silicon Mac, Linux
   host with an NVIDIA GPU, or Windows PC. Remote machines use an SSH key mounted
   read-only into the container.
2. Turn on sparkDash's Prometheus metrics and alert notifications. Alerts need
   no channel: Homer is the channel.
3. Publish the sparkDash page through Cloudflare Tunnel with an Access policy for
   Danny and Boof, listing the hostname in `SPARKDASH_ALLOWED_HOSTS`. Or use
   Tailscale Serve inside the tailnet. Never Tailscale Funnel, and never
   `BIND_HOST=0.0.0.0`.
4. In Cloudflare, create Homer's fleet intake Access application and a service
   token for it. Store the token in 1Password.
5. Install the Fleet Collector as a service on the sparkDash host, and list the
   machines sparkDash cannot read in its configuration.

### Each poll

Every 30 seconds:

1. Read `/api/health`. A release other than the pinned one adds the
   `version_changed` diagnostic, and collection goes on only while every response
   still matches the Collector's own schema.
2. Read `/metrics` and `/api/alerts`, and validate both against the Collector's
   schema. A response that does not match sets `shape_changed`. The Collector
   then maps nothing: every sparkDash machine is `unknown`, and no event is
   built.
3. Build each sparkDash machine from `sparkdash_up`: `1` is up and `0` is down.
   Attach its firing alerts from `active`.
4. Check continuity against the cursor, the stored `id`:
   - **No new entries**: the newest `id` equals the cursor and its entry still
     matches the stored `key`, `status` and `at`.
   - **Contiguous**: the newest `id` is above the cursor and `recent` still holds
     the entry at `cursor + 1`. Nothing was evicted between polls.
   - **Gap**: the newest `id` is above the cursor but the oldest entry held is
     above `cursor + 1`. More than 200 transitions happened between polls. Add
     `collector_gap` and turn what is held into events.
   - **Restart**: the newest `id` is below the cursor, or the entry at the
     cursor no longer matches. sparkDash restarted. Add `sparkdash_restarted`,
     and treat every entry held as new. If the oldest entry held is not `id` 1,
     add `collector_gap` too.
5. For each new entry, oldest first, build a `machine.alert_fired`
   (`status: "firing"`) or `machine.alert_cleared` (`status: "resolved"`)
   event. Write the events to the queue on disk, and only then move the cursor.
   An event is never dropped to make room.
6. If an alert that was active at the last poll is neither active now nor
   resolved in `recent`, add `collector_gap`. The Collector never invents a
   clear.
7. Add the Reachability Check results (below), and deliver the Fleet Report.

If sparkDash does not answer, the report says `unreachable`, every sparkDash
machine is `unknown`, and the Reachability Checks still run.

### Reachability Check

For each machine in the configuration, every 60 seconds:

1. Open a TCP connection to its SSH port, with a 5-second timeout.
2. Read at most 255 bytes, or up to the first line, within 5 seconds.
3. It is up when the line starts with `SSH-2.0-`. Anything else, including a
   timeout, is a failure.
4. Close the connection. Nothing is sent: no key, no login, no command.
5. Two failures in a row make the machine `down` and build `machine.alert_fired`
   with rule `reachability`, severity `critical`. The first success afterwards
   builds `machine.alert_cleared`.

A passing Check shows that the machine accepts connections and runs an SSH
server. It does not show that a login works, and the status view says so.

### Deliver a report

1. Build the report from the current snapshot and the oldest 100 events in the
   queue. If more are waiting, add `events_backlog`.
2. `POST <intake>/v1/fleet/report` with the Access service token headers.
3. On a `2xx`, remove exactly the events that report carried from the queue, and
   clear the held diagnostics it carried. The next report carries the next 100,
   without waiting for the next poll, until the queue is empty.
4. On a failure, keep the queue and the held diagnostics, and try again with
   backoff, at most every poll. Only the latest snapshot is sent, but it always
   carries every held diagnostic. Event Keys make a resent event a Duplicate,
   never a second event.
5. The queue holds at most 10,000 events. When it is full, the Collector stops
   moving the cursor and adds `queue_full`. sparkDash's own history then holds
   the newest transitions, and the continuity rules report any it loses.
6. Read the response only for its status. A response never makes the Collector
   do anything else.

### Intake (Homer Worker)

1. Behind Access, which allows only the service token for this path.
2. Validate the body as `home.fleet-report/v1`, with each event under Activity
   Event version 3. Refuse a bad report with `400` and record nothing.
3. Append each event through the Event Ledger binding. A Duplicate is success.
4. Store the report as the fleet's latest snapshot, unless the stored one has a
   later `collectedAt`.
5. At most 6 reports a minute. Past that, `429`.

### Status view

A fleet status Projection over the latest snapshot and the machine events:

- Each machine shows its state, last-seen time, firing alerts and, for a sparkDash
  machine, a link to the sparkDash page through the front door.
- A reachability-only machine shows its telemetry as unknown.
- **Per machine:** a machine whose `lastSeenAt` is more than 2 minutes before the
  report's `collectedAt` shows as stale, even when reports are fresh and
  `sparkdash_up` says `1`. A machine with `lastSeenAt: null` shows as unknown.
- **Fleet-wide:** with no snapshot newer than 2 minutes, every machine shows as
  stale, and the view says when the last report came.
- A machine that turns stale raises `fleet:<machineId>:stale`, and it clears
  when a fresh read arrives.
- The view lives in the operator UI behind the existing Access policy.

### Alerts to Buzz

The fleet uses the Buzz spec's [Alerts to Buzz](../buzz/spec.md#alerts-to-buzz)
unchanged: change-only, fixed templates, ids only, at most 30 an hour. It needs
that work (ZER-55) first.

| Alert Key | When | Template |
| --- | --- | --- |
| `fleet:<machineId>:<rule>` | A `machine.alert_fired` or `machine.alert_cleared` event. Critical and warning alerts are sent; `concurrency` is not | `<rule name> on <machine name>` / `... cleared` |
| `fleet:collector:stale` | No report for 2 minutes | `Fleet monitoring has not reported since <time>` |
| `fleet:<machineId>:stale` | A machine's own last read is more than 2 minutes old | `No fresh reading from <machine name> since <time>` / `... fresh again` |
| `fleet:collector:<state>` | `unreachable`, `metrics_off`, `alerts_off` or `shape_changed` | One fixed sentence per state |
| `fleet:collector:<code>` | A diagnostic in the latest report: `version_changed`, `events_backlog` (only after 10 minutes) or `queue_full`. It clears when a report no longer carries it | One fixed sentence per code. `version_changed` names the pinned and the seen release |
| `fleet:collector:<code>:<since>` | A held diagnostic, `collector_gap` or `sparkdash_restarted`, the first time a report carries it. One Alert per occurrence; it does not clear | One fixed sentence per code, with the `since` time |

### Threat model

- **sparkDash can change machines, and its API is open on loopback.** Anything
  on its host can shut down or wake machines, cap clocks and run launchers. The
  Collector's client is `GET`-only on three paths, and the Collector takes no
  instructions from Homer, so Homer adds no new way in. Anyone with a shell on
  the host already had that power.
- **sparkDash's container is effectively root on its host** (privileged, host
  network, host PID). It is third-party code. See Open choices.
- **A stolen intake token can forge reports.** It shows machines as up or down
  and raises or clears Alerts. It cannot change a machine, because nothing in
  Homer acts on a report. Mitigations: the token sits in 1Password, the Access
  application admits only it and only on one path, intake is rate limited, and
  rotation is in the runbook.
- **Untrusted text.** Machine names are operator text, so they are cleaned.
  sparkDash's `label` and `summary` never leave the host, and subjects and
  Alerts use fixed templates.
- **Addresses.** They stay on the host. A test rejects any report that carries
  one.
- **Front door.** Access or the tailnet authenticates every path, `/ws`
  included. No Funnel, and no LAN bind without a token.

### Skills

None new. The runbook is `docs/deployment/fleet-monitoring.md` (packet 7).

### GitHub Actions

No new workflow. CI's `check` job runs the Collector's and the intake's tests,
and the new contracts' fixtures, like any other package.

## Test matrix

| Case | Expected |
| --- | --- |
| A `POST`, a path outside the three, or a non-loopback host | refused before sending |
| `/metrics` answers `404` | `metrics_off`, every sparkDash machine `unknown`, an Alert |
| `/api/alerts` has `enabled: false` | `alerts_off`, an Alert; never "no problems" |
| A response with a missing or renamed field | `shape_changed`; no events; machines `unknown` |
| A `recent` entry with `status: "firing"`, then one with `"resolved"` | one `machine.alert_fired` and one `machine.alert_cleared`, with keys from the same `startsAt` |
| The same `recent` entries on the next poll | no new events |
| An active alert missing from both `active` and `recent` | `collector_gap`; no invented clear |
| `recent` holds `id` 101 to 300 and the cursor is 90 | `collector_gap`; ids 101 to 300 become events |
| `recent` holds `id` 91 to 290 and the cursor is 90 | contiguous; ids 91 to 290 become events; no diagnostic |
| The newest `id` is 4 and the cursor is 250 | `sparkdash_restarted`; ids 1 to 4 become events |
| 150 transitions between two polls | two reports, 100 events then 50, none lost; `events_backlog` on the first |
| The Collector stops after queueing events, before delivering them | the events are delivered after it starts again; the cursor did not skip them |
| The queue holds 10,000 events | the cursor stops; `queue_full` |
| A gap is detected and that poll's post fails; the next poll is contiguous | the next delivered report still carries `collector_gap` with the first `since`; one Alert |
| A report carrying `sparkdash_restarted` gets a `2xx` | later reports no longer carry it |
| `label` or `summary` with an address, an error line or markup | absent from the report and the event |
| A machine name with control characters or more than 40 characters | replaced by the `machineId` |
| A report that contains an IPv4 or IPv6 address anywhere | refused by the Collector's own check |
| SSH banner `SSH-2.0-OpenSSH_9.6` | up |
| Connection refused, a timeout, or a banner of `HTTP/1.1` | a failure; two in a row make it down |
| A Check fails, then fails again, then passes | `alert_fired` after the second failure, `alert_cleared` on the pass |
| An unknown rule id, `new-rule` | named `sparkDash rule new-rule` |
| An unknown rule id with other characters | `shape_changed` |
| Intake gets a report with an invalid event | `400`; nothing appended or stored |
| Intake gets the same report twice | the events are Duplicates; the snapshot is unchanged |
| Intake gets an older report after a newer one | the snapshot stays the newer one |
| No report for 2 minutes | every machine stale; `fleet:collector:stale` |
| Fresh reports, but one machine's `lastSeenAt` is 3 minutes before `collectedAt` | that machine stale and `fleet:<machineId>:stale`; the others as reported |
| A machine with `lastSeenAt: null` | unknown, never up |
| Intake post fails for 10 minutes | the queued events are delivered in order once it answers; only the latest snapshot is sent |
| Credential missing | the Collector exits non-zero, naming the variable, never a value |

## Acceptance and implementation plan

One Linear Task per packet in the Homer project:

1. **Contracts.** `activity-event.v3.schema.json` and
   `fleet-report.v1.schema.json`, with validators and fixtures, and the
   README entries.
2. **Collector core**, pure: parse `/api/health`, `/metrics` and `/api/alerts`;
   build machines, transitions and the report; clean names; the rule
   catalogue; the address check.
3. **Collector runtime**: the `GET`-only client, the Reachability Check, state,
   the poll loop, and delivery with retries. Credentials by 1Password
   reference.
4. **Intake**: the Worker route, validation, ledger append, the snapshot store,
   and the rate limit.
5. **Fleet status Projection and view**, with stale and unknown states.
6. **Fleet Alerts to Buzz**, after ZER-55.
7. **Runbook and live receipt** (needs a human): sparkDash on its host, the
   front door, the intake Access application and token, the Collector service,
   and the first report from every machine.

Done for the stream: every machine reachable over SSH shows in the status view
with a state, and one real alert has gone from sparkDash to the Buzz `homer`
channel.

## Open choices with defaults

| Choice | Default | Alternative |
| --- | --- | --- |
| How sparkDash runs | sparkDash's published container on Delphi, accepting that it is privileged on that host. It is sparkDash's documented deployment, and Delphi's own metrics come from local collectors | Run sparkDash unprivileged, as a plain Node service (`npm start`) on a non-Spark host, with every machine read over SSH. That costs the local collectors, and sparkDash calls this path untested on x86 |
| How reports reach Homer | A fleet intake route behind Access with a service token | The runner-controller protocol in PR #38, once it lands. The sparkDash host would enroll as a machine and report through it |
| One machine list | The Collector's configuration plus sparkDash's own | The PC and Mac runner configuration in PR #35, once it lands, so one list serves the runners and the fleet |
| Reachability Check | Read the SSH banner, no login | Log in with a key whose `authorized_keys` entry forces a no-op command. That proves logins work, but it puts a key on every machine |
| `provenance.sourceUrl` | The front door's origin for the sparkDash page | Homer's own fleet view, which also works for reachability-only machines |
| Release pin | The exact release, and the image digest in the runbook | Follow `latest` and rely on the schema check alone |
| Poll intervals | 30 seconds for sparkDash, 60 seconds for Reachability Checks, a 2-minute freshness budget | Any other set |

## Terms

New terms for `CONTEXT.md` when built: Machine, Reachability Check, Fleet
Collector, Fleet Report.
