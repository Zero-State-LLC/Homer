# Fleet monitoring through sparkDash

Version: 0.1.0
Status: accepted by Danny on 2026-11-24 (#71), with three rulings: fleet
monitoring waits for the runner stream's machine list (#35) and controller
protocol (#38); SSH monitoring is read-only on every machine, except for agentic
interaction; and sparkDash's deployment follows the research he asked for (see
[Read-only machines](#read-only-machines)).
Intent: [Remote fleet monitoring through sparkDash](../../docs/intent/fleet-monitoring.md)
(accepted by Danny on 2026-11-24, #69)
Decision: [ADR 011](../adr/011-fleet-monitoring-read-only-outbound.md)

Homer shows every machine the team can reach over SSH as up, down or stale,
with its firing alerts, and sends alert changes to the Buzz `homer` channel.
sparkDash reads each machine whose kind it supports. A Reachability Check covers
every other machine. A local Fleet Collector reads both and pushes one Fleet
Report to Homer outbound, through Cloudflare Access. Homer never reaches into
the fleet's network, and nothing in fleet monitoring can change a machine:
every machine is read through an unprivileged monitoring account.

## Deployment facts

| Fact | Value |
| --- | --- |
| sparkDash release this spec targets | v2.91.0, commit `86f972e` (2026-11-22), Apache-2.0 [verified] |
| sparkDash host | Delphi (intent decision). Whether sparkDash runs anywhere today is unknown |
| sparkDash's published container | `privileged: true`, `network_mode: host`, `pid: host`, read-only `/proc` and `/sys` mounts [verified: `docker-compose.image.yml` at `86f972e`]. Not used as published: see [Read-only machines](#read-only-machines) |
| Front door to the sparkDash page | Cloudflare Tunnel with Access by default; Tailscale Serve allowed; never Tailscale Funnel (Danny, 2026-11-24) |
| Homer's intake | Not built. It extends the runner controller protocol from PR #38 (ZER-34), which is not on `main` |
| Machine list | The runner fleet configuration from PR #35 (ZER-33), which is not on `main`. Both PRs were cut before `main` restarted and share no history with it, so they need a rebase before they can land |
| Machines | The intent's [named machines](../../docs/intent/fleet-monitoring.md#the-named-machines). No inventory exists |

## Contract

### Read-only machines

Danny's rule (2026-11-24): SSH monitoring is read-only on every machine. The one
exception is agentic interaction. SSH that an Agent uses to do work, such as a
runner or the curator host, is governed by the runner specs (#38, #39) and uses
its own accounts and keys. Monitoring never uses those, and they never use the
monitoring account.

Read-only is enforced on each machine, not only in Homer. sparkDash can shut
machines down, cap their clocks and power, and run launcher scripts, and its
API is open on its host. So every machine, sparkDash's own host included, is
read over SSH through a **monitoring account** that cannot do any of that:

| Machine | Monitoring account |
| --- | --- |
| Linux, including DGX Sparks | A dedicated user with no `sudo` entry, in no `sudo`, `wheel`, `docker`, `lxd` or `adm` group, and in `systemd-journal` only, so sparkDash can read kernel Xid and out-of-memory lines with `journalctl -k`. Key-only login |
| macOS | A standard, non-admin user with Remote Login. Key-only login. No `sudo`, so `powermetrics` GPU power is not read |
| Windows | A standard user with the OpenSSH server, never an Administrator. If a GPU counter needs a group, `Performance Monitor Users` only. Packet 7 checks which counters a standard user can read |

Each machine's `authorized_keys` entry for the monitoring key is
`restrict,port-forwarding,permitopen="127.0.0.1:<port>"`, with one `permitopen`
per LLM port. That allows only the SSH tunnel sparkDash's LLM probe falls back to
when a model server listens on loopback. The key lives in 1Password and is
mounted read-only on sparkDash's host. It is used for nothing else.

[verified at `86f972e`: remote collection runs `nvidia-smi`, `/proc`, `/sys`,
`df` and `journalctl -k`, none of which needs root; `sudo -n` is used only for the
optional Intel VRAM and Mac `powermetrics` reads; GPU clock and power caps need
a `sudoers` entry, and shutdown needs root; `server/collectors/LlmProbe.js` opens
an SSH tunnel after two direct failures]

**sparkDash runs unprivileged** (recommended by Claude Code at Danny's request,
2026-11-24, because it follows his read-only rule):

- On Delphi, in its container **without** `privileged`, `pid: host`, or the
  host `/proc`, `/sys` and NVIDIA library mounts. Host networking stays, so
  sparkDash can bind loopback and open its LLM tunnels. Host networking adds no
  root. If the image does not run this way, packet 7 runs sparkDash as a plain
  Node service (`npm start`) under its own unprivileged system user.
- No machine is added as **This host**. Delphi is read over SSH like every other
  machine.

What this gives up, by design: sparkDash's controls (shutdown, clock and power
caps, launchers, and model discovery, which is local-only) fail on every
machine. GPU power on Macs, Intel VRAM, and engine detection that needs the
`docker` group are not read. Wake-on-LAN still works from the sparkDash page,
because it is a packet from the host and not an SSH command. It stays a human
action behind the front door.

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
| `machineId` | The machine's id in the runner fleet configuration from #35, which holds aliases, operating systems and architectures but no addresses. A machine not in that configuration is not reported. The Collector's configuration maps each `machineId` to a sparkDash unit id or an SSH target |
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
| `eventKey` | `<source>:machine.alert_fired:<machine part>:<rule>:<startsAt in ms>`, and the same with `alert_cleared`. The machine part is the `machineId`. `startsAt` is when the condition began, so one occurrence has one pair of keys |
| `occurredAt` | sparkDash's history `at` for the transition, or the Check's own time |
| `actor` | `{ "sourceAccount": "sparkdash:alerts" }` or `{ "sourceAccount": "homer:fleet-collector" }`. Never an Actor: no Identity Binding applies |
| `subject` | A fixed template: `<rule name> on <machine name>` or `<rule name> cleared on <machine name>`. The rule name comes from Homer's own catalogue below, never from sparkDash's text |
| `data` | `machineId`, `rule`, `severity` (`warning` or `critical`), `startsAt`, `sparkdashVersion` |
| `provenance.sourceUrl` | The front door's `https://` origin for the sparkDash page |
| `provenance.sourceObjectId` | `<machineId>:<rule>@<startsAt in ms>` |

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

- Configuration, `fleet-collector.json`: the sparkDash URL (loopback only); for
  each `machineId`, its sparkDash unit id or its SSH target (`host`, `port`,
  default 22); the Homer intake URL (`https://`); and the front door's origin
  for `provenance.sourceUrl`.
- Credentials: the Collector's workload credential under the #38 protocol (an
  Access service token), by 1Password reference (`<NAME>_REF=op://...`) or in
  the environment, the way the Work Request emitter reads its secrets. Never in
  the configuration file. The monitoring key belongs to sparkDash, not the
  Collector.
- State: the cursor (the newest history `id` turned into events, and that
  entry's `key`, `status` and `at`), the alerts active at the last poll, the
  Reachability Check counters, the queue of events not yet delivered, and the
  held diagnostics.

## Workflows

### Set up (operator, once)

The runbook in packet 7 covers each step. Nothing here is Homer code.

1. On every machine sparkDash reads, create the monitoring account described in
   [Read-only machines](#read-only-machines), and prove it read-only: `sudo -n
   true` fails, `id` lists none of the excluded groups, and the
   `authorized_keys` entry carries `restrict`.
2. On Delphi, run sparkDash at the pinned release, unprivileged and bound to
   loopback. Add every machine whose kind it reads (DGX Spark, Apple Silicon
   Mac, Linux host with an NVIDIA GPU, or Windows PC) as a remote unit through
   its monitoring account, Delphi included. Mount the monitoring key read-only.
3. Turn on sparkDash's Prometheus metrics and alert notifications. Alerts need
   no channel: Homer is the channel.
4. Publish the sparkDash page through Cloudflare Tunnel with an Access policy for
   Danny and Boof, listing the hostname in `SPARKDASH_ALLOWED_HOSTS`. Or use
   Tailscale Serve inside the tailnet. Never Tailscale Funnel, and never
   `BIND_HOST=0.0.0.0`.
5. Enroll the Collector under the #38 protocol: create its Access service token,
   store it in 1Password, and have an admin bind its principal digest to the
   `machineId`s it may report on.
6. Install the Fleet Collector as a service on Delphi under its own
   unprivileged user, and map each `machineId` to a sparkDash unit or an SSH
   target in its configuration.

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
2. `POST` it to the fleet report route of the #38 protocol, with the Collector's
   workload credential.
3. On a `2xx`, remove exactly the events that report carried from the queue, and
   clear the held diagnostics it carried. The next report carries the next 100,
   without waiting for the next poll, until the queue is empty.
4. On a failure, keep the queue and the held diagnostics, and try again with
   backoff, at most every poll. An identical retry of a report keeps its
   `reportId`, so the intake answers with the original receipt, as #38 does for
   runner reports. Only the latest snapshot is sent, but it always
   carries every held diagnostic. Event Keys make a resent event a Duplicate,
   never a second event.
5. The queue holds at most 10,000 events. When it is full, the Collector stops
   moving the cursor and adds `queue_full`. sparkDash's own history then holds
   the newest transitions, and the continuity rules report any it loses.
6. Read the response only for its status. A response never makes the Collector
   do anything else.

### Intake (Homer Worker)

The intake is a second report type on the runner controller protocol from #38,
not a new mechanism. It reuses that protocol's rules and adds one principal kind:

1. A **fleet collector** principal, with its own audience, `FLEET_COLLECTOR_AUD`,
   which differs from the runner controller, read and admin audiences. Human
   subjects are refused.
2. An admin binds the principal's digest to the `machineId`s it may report on,
   with a revision precondition and an audit record, as #38 enrolls a machine.
   A report that names any other machine is refused.
3. The body must validate as `home.fleet-report/v1`, with each event under
   Activity Event version 3. A bad report gets `400`, and nothing is recorded.
4. Idempotency follows #38: an identical retry of a `reportId` returns the
   original receipt, and changed content under the same `reportId` is a
   conflict.
5. Each event is appended through the Event Ledger binding. A Duplicate counts
   as success.
6. The report becomes the fleet's latest snapshot, unless the stored one has a
   later `collectedAt`.
7. At most 6 reports a minute. Past that, `429`.

The runner principals from #38 keep their one-machine scope. A fleet collector reports
observations only, and the intake returns no desired state to it.

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

- **sparkDash's API is open on loopback and has controls.** Anything on its
  host can call shutdown, clock caps or launchers. Through the monitoring
  accounts those calls fail on every machine, because no account can do them.
  The Collector's client is `GET`-only on three paths and takes no instructions
  from Homer. Wake-on-LAN still works; it is a packet from the host, and only
  humans behind the front door can send it.
- **sparkDash is third-party code.** It runs unprivileged, without host PID or
  host mounts. The worst it can do with a monitoring key is read what that
  account reads, and open tunnels to the listed LLM ports.
- **A stolen monitoring key** gives the same read-only access, from wherever it
  is used. It lives in 1Password and on the sparkDash host only, and rotation is
  in the runbook.
- **A stolen Collector credential can forge reports**, only for its bound
  machines. It can show them up or down, and raise or clear Alerts. It cannot
  change a machine, because nothing in Homer acts on a report. Mitigations: the
  credential is in 1Password, it has its own audience and binding, intake is
  rate limited, and an admin can revoke the binding as #38 allows.
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
| Intake gets a report naming a machine outside the Collector's binding | refused; nothing appended or stored |
| Intake gets an identical retry of a `reportId` | the original receipt |
| Intake gets changed content under a `reportId` it has seen | a conflict |
| A runner controller credential, or a human, posts a Fleet Report | refused: wrong audience or a human subject |
| On a monitoring account: `sudo -n true`, a sparkDash shutdown, a clock cap | each fails on the machine, and nothing changes (runbook proof, packet 7) |
| A tunnel through the monitoring key to a port not in `permitopen` | refused by the machine's SSH server (runbook proof, packet 7) |
| Intake gets the same report twice | the events are Duplicates; the snapshot is unchanged |
| Intake gets an older report after a newer one | the snapshot stays the newer one |
| No report for 2 minutes | every machine stale; `fleet:collector:stale` |
| Fresh reports, but one machine's `lastSeenAt` is 3 minutes before `collectedAt` | that machine stale and `fleet:<machineId>:stale`; the others as reported |
| A machine with `lastSeenAt: null` | unknown, never up |
| Intake post fails for 10 minutes | the queued events are delivered in order once it answers; only the latest snapshot is sent |
| Credential missing | the Collector exits non-zero, naming the variable, never a value |

## Acceptance and implementation plan

One Linear Task per packet in the Homer project. By Danny's ruling, fleet
monitoring waits for #35 and #38 to land on `main`, so every packet is blocked
by ZER-33 and ZER-34. Both PRs first need a rebase onto `main`.

1. **Contracts.** `activity-event.v3.schema.json` and
   `fleet-report.v1.schema.json`, with validators and fixtures, and the
   README entries.
2. **Collector core**, pure: parse `/api/health`, `/metrics` and `/api/alerts`;
   build machines, transitions and the report; clean names; the rule
   catalogue; the address check.
3. **Collector runtime**: the `GET`-only client, the Reachability Check, state,
   the poll loop, and delivery with retries. Credentials by 1Password
   reference.
4. **Intake** on the #38 protocol: the fleet collector principal, its audience
   and binding, the report route, validation, ledger append, the snapshot store,
   and the rate limit. The amendment to `specs/runner-controller/spec.md` lands
   in the same pull request.
5. **Fleet status Projection and view**, with stale and unknown states.
6. **Fleet Alerts to Buzz**, after ZER-55.
7. **Runbook and live receipt** (needs a human): the monitoring account on every
   machine, proved read-only; sparkDash unprivileged on Delphi; the front door;
   the Collector's enrollment and credential; the Collector service; and the
   first report from every machine.

Done for the stream: every machine reachable over SSH shows in the status view
with a state, and one real alert has gone from sparkDash to the Buzz `homer`
channel.

## Decisions

| Choice | Decision |
| --- | --- |
| How sparkDash runs | Unprivileged on Delphi, every machine read over SSH through a monitoring account ([Read-only machines](#read-only-machines)). Recommended at Danny's request; it follows his read-only rule |
| How reports reach Homer | A second report type on the #38 runner controller protocol (Danny, 2026-11-24) |
| One machine list | The runner fleet configuration from #35 (Danny, 2026-11-24) |

## Open choices with defaults

| Choice | Default | Alternative |
| --- | --- | --- |
| Reachability Check | Read the SSH banner, no login | Log in with a key whose `authorized_keys` entry forces a no-op command. That proves logins work, but it puts a key on every machine |
| `provenance.sourceUrl` | The front door's origin for the sparkDash page | Homer's own fleet view, which also works for reachability-only machines |
| Release pin | The exact release, and the image digest in the runbook | Follow `latest` and rely on the schema check alone |
| Poll intervals | 30 seconds for sparkDash, 60 seconds for Reachability Checks, a 2-minute freshness budget | Any other set |

## Terms

New terms for `CONTEXT.md` when built: Machine, Reachability Check, Fleet
Collector, Fleet Report.
