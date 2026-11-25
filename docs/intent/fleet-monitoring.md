# Intent — Remote fleet monitoring through sparkDash

Author: Claude Code for Danny (scrimshawlife-ctrl)
Date: 2026-11-24
Status: accepted by Danny on 2026-11-24 (#69).
Product: Homer (`Zero-State-LLC/Homer`)

This file is a proto-spec. It comes **before** specify.
Next stage is `spec.md` (spec-kit specify). Do not skip to code.

One committed intent per change stream. Live under `docs/intent/`.

Danny accepted this intent on 2026-11-24 (#69), with the proposed defaults
below, Cloudflare Access as the default front door, and Tailscale Serve as an
allowed one. It is not built. The next stage
is the spec in `specs/fleet-monitoring/`. Nothing here authorizes code, a
contract change, a deploy, a new Cloudflare Access application, or a change on
any machine before that spec is accepted.

## Problem / why now

Danny asked on 2026-11-24 to integrate Mia's AI Lab's sparkDash into Homer,
so the team can monitor its DGX Sparks remotely through Homer. The same day he
widened the scope: every machine reachable over SSH is to be monitored.

Homer sees no machines today. To know whether a machine is down, running hot,
out of disk, or no longer serving its model, someone has to reach that machine
and look. The Galadriel intent lists the named machines (both DGX Sparks,
Delphi and Morpheus, the Bosgame, the Mac Ultra, the Jetson and Galadriel), SSH
monitoring, and "GPU and fleet load, temperature, and disk" as targets. It is a
draft, names no tool, and covers far more than machine monitoring.

sparkDash already does most of the machine side. It is an open-source
dashboard that reads a set of machines from one host, over SSH, and shows GPU,
CPU, memory, storage, network and local LLM metrics. It also evaluates health
alerts, such as a machine going offline, a thermal throttle, storage at 90 %,
or an LLM server going away. It reads four kinds of machine: DGX Sparks, Apple
Silicon Macs, Linux hosts with an NVIDIA GPU, and Windows PCs with an NVIDIA
GPU or an AMD integrated GPU. It exposes that state read-only, as Prometheus
metrics (`GET /metrics`) and as alert state (`GET /api/alerts`). Homer can watch
the fleet by reading sparkDash, instead of building its own collectors.

[verified: sparkDash README and `docs/REMOTE-ACCESS.md` at v2.91.0, commit
`86f972e`, 2026-11-22; Danny's messages on 2026-11-24] [assumed: the machines
are the ones the Galadriel intent names; no inventory exists, and whether
sparkDash already runs anywhere is unknown]

## Proposed outcome

Observable done, once a later accepted spec is built. These are targets, not
current features.

- **Every machine reachable over SSH appears in Homer** (Danny, 2026-11-24).
  Each one shows as up, down or stale, with its last-seen time. A machine is
  never left off because sparkDash cannot read its kind.
- **sparkDash reads every machine whose kind it supports.** It runs on one
  host on the fleet's network, bound to loopback, which is its own default.
  Its Prometheus metrics and its alert notifications are turned on. Both are
  off by default, and sparkDash evaluates no alerts while notifications are
  off. Installing and configuring it is an operator step on our machine that a
  Homer runbook describes. It is not Homer code.
- **A machine sparkDash cannot read still gets a reachability check.** The
  spec decides the check (see Decisions). Its state is reachable or
  unreachable, with no telemetry. The status view says the telemetry is
  unknown, never that it is fine.
- **A local Homer runner, the Fleet Collector**, reads sparkDash only through a
  fixed list of read-only `GET` endpoints. It runs the reachability checks and
  pushes to Homer outbound, through Cloudflare Access:
  - Source Freshness for `sparkdash`, and each machine's up or down state;
  - one Activity Event when an alert fires and one when it clears, with an
    Event Key from the alert's rule, machine id and start time. Metric samples
    are not Activity Events.
- **A Homer status Projection** shows every machine with its state, last-seen
  time, firing alerts and, where sparkDash reads it, a link to its sparkDash
  page. When the Collector goes quiet, every machine shows as stale, never as
  up.
- **Firing and cleared alerts reach the Buzz `homer` channel** as change-only
  Alerts under the Buzz spec. Alert Keys are derived from the rule and the
  machine, inside that spec's 30-per-hour cap.
- **Away from the fleet's network**, Danny can open Homer's status view and,
  from it, the full sparkDash page through an authenticated front door. No port
  is open to the internet.
- **Time series stay in sparkDash.** Homer stores states and alert transitions,
  never metric history.

## Affected users / systems

- Users: Danny; humans and Agents who read the `homer` Buzz channel or the
  status view.
- Systems: sparkDash, as a new Source System and the Authority for machine
  telemetry and its alert state; every machine reachable over SSH; the host
  that runs sparkDash; the local runner that runs the Fleet Collector;
  Cloudflare Access; the Event Ledger; Projections; Buzz; 1Password.

## Constraints

Product-true locks (do not reopen in implement):

- **Read-only.** Homer and the Collector call only `GET` endpoints on a fixed
  allowlist. sparkDash can also shut machines down, wake them, cap GPU clocks
  and power, run model launcher scripts, restart itself and change settings.
  Homer never calls, links to or proxies any of those. Every change to a
  machine stays a human action, taken in sparkDash or on the machine.
- **No command on a machine from Homer.** The only SSH logins are sparkDash's
  own, from its host, to read metrics. A reachability check runs no command on
  the machine it checks. Homer's Cloudflare side never opens SSH at all.
- **No public port.** sparkDash stays bound to loopback. Remote access goes
  through a front door that authenticates every path, `/ws` included:
  Cloudflare Access, or Tailscale Serve inside the tailnet. TLS alone is not
  enough, and Tailscale Funnel, which is public, is never used. sparkDash's own
  remote-access document asks for the same.
- **Outbound only.** Runners are local and everything else is on Cloudflare
  (Danny, 2026-11-23). The Collector pushes to Homer; Homer never dials into the
  fleet's network.
- **sparkDash is the Authority** for machine telemetry and alert state.
  Collectors map, they never invent: a metric sparkDash leaves out is unknown,
  never zero. That is sparkDash's own rule for its metrics.
- **No infrastructure detail in Homer.** Events, Projections and Alerts carry
  a machine's id and name, never its address, SSH user, port or key. The list
  of addresses lives on the local host, in sparkDash's configuration and the
  Collector's, never in the Homer repository.
- **Secrets by reference.** A sparkDash token, if the host sets one, an Access
  service token, and any SSH key come from 1Password by reference. They never
  appear in the repository, a log, an Activity Event or an Alert.
- **Pinned shape.** The Collector targets a named sparkDash release. When the
  alert or metric shape it reads changes, the Collector raises an Alert and
  stops mapping. It never guesses at a new shape.
- **No fork.** Homer talks to sparkDash over HTTP and vendors none of its code.
  sparkDash is Apache-2.0 from v2.0.0, so vendoring would carry its NOTICE
  terms.
- **NVIDIA-first, with the reason recorded.** DCGM, the NVIDIA telemetry path
  the Galadriel intent says to consider first, is not supported on the GB10
  according to NVIDIA's own forum answers. NVIDIA's DGX Dashboard serves one
  machine locally on port 11000, behind an SSH tunnel or NVIDIA Sync, and has
  no fleet view or alert interface. sparkDash reads NVIDIA machines with
  NVIDIA's own `nvidia-smi`. If NVIDIA ships DCGM for the GB10, the spec
  revisits this choice.

Non-goals:

- A Homer metrics collector, or a store of time series.
- A copy of the sparkDash interface inside Homer.
- Controlling any machine from Homer.
- A Prometheus or Grafana stack. sparkDash's `/metrics` allows one later; it is
  not part of this intent.
- The Galadriel ops brain as a whole. This intent is one slice of it and does
  not accept that intent.
- Inventing machine specifications. Where a machine's hardware or operating
  system is unknown, the spec says unknown and the machine gets the
  reachability check until someone inventories it.

## The named machines

This is the Galadriel intent's list, set against what sparkDash reads. It is
not an inventory.

| Machine | sparkDash kind that would read it | Known |
| --- | --- | --- |
| Delphi | DGX Spark | `[assumed: a DGX Spark, per the Galadriel intent]` |
| Morpheus | DGX Spark | `[assumed: a DGX Spark, per the Galadriel intent]` |
| Mac Ultra | Apple Silicon Mac | `[assumed: Apple Silicon; model and macOS version unknown]` |
| Bosgame | Windows PC (NVIDIA or AMD integrated GPU) or Linux host with an NVIDIA GPU, if it is one of those | `[unknown: hardware and operating system]` |
| Jetson | None named. sparkDash does not mention the Jetson, and whether its Linux NVIDIA path works there is untested | `[unknown: model and JetPack version]` |
| Galadriel | Depends on its hardware | `[unknown: not yet arrived]` |

## Decisions

Danny accepted these defaults on 2026-11-24 and chose the front door himself.

| Question | Decision |
| --- | --- |
| Which host runs sparkDash, and does it run anywhere already? | Delphi, with sparkDash's published Docker image. Delphi is read locally, and every other machine over SSH with a key |
| Which machines count as "reachable over SSH", and where is that list kept? | Every machine the team can log in to over SSH today. The list is kept on the sparkDash host, in sparkDash's configuration for the kinds it reads and in the Collector's configuration for the rest, never in the repository |
| How is a machine sparkDash cannot read checked? | A TCP connection to its SSH port that reads the SSH server's banner, with no login and no command. It shows the machine is up and listening, not that a login works |
| Which front door reaches the sparkDash page from outside: Cloudflare Tunnel with Access, or Tailscale Serve (sparkDash's documented path)? | Cloudflare Tunnel with Access by default (Danny's choice). Tailscale Serve is also allowed (Danny, 2026-11-24): tailnet only, never Tailscale Funnel. Homer's own status view stays behind Access |
| Where does the Collector run? | On the sparkDash host, reading loopback, so sparkDash needs no token and no extra exposure |
| Which sparkDash alerts go to Buzz? | Its critical and warning alerts (machine offline, thermal or hardware throttle, storage at 90 %, LLM unavailable, Xid or out-of-memory), their clears, and a reachability check that fails twice in a row |
| What freshness budget makes a machine stale? | Two minutes without a successful read |
| Where does the status view live? Homer has an Activity Calendar and a Project Timeline, but no status Projection yet | A new fleet status Projection, defined in the spec |
| Who besides Danny may see the status view and the sparkDash page? | Danny and Boof, through the same Access policy |

Consequences for the spec, not questions:

- `sparkdash` becomes a Source System, and the Collector's reachability checks
  report as Homer's own operations (`homer`). That bumps the Activity Event
  contract version, as Buzz did with version 2.
- New `CONTEXT.md` terms, once built: Machine (a computer Homer watches),
  Reachability Check, and Fleet Collector.

## Claims

| Claim | Label |
| --- | --- |
| Danny asked to integrate sparkDash so the team can monitor its Sparks remotely through Homer | `[verified: Danny's message on 2026-11-24]` |
| Every machine reachable over SSH is to be monitored | `[verified: Danny's message on 2026-11-24, "All machines with ssh need to be added for monitoring"]` |
| sparkDash is at v2.91.0 (2026-11-22) and Apache-2.0 from v2.0.0; versions up to 1.9.0 were MIT | `[verified: README badge, CHANGELOG and NOTICE at commit 86f972e]` |
| sparkDash's unit types are DGX Spark, Apple Silicon Mac, Linux host with an NVIDIA GPU, and Windows PC; a Windows PC with an AMD integrated GPU reads its GPU from Windows' counters | `[verified: README, Adding a unit and Windows PCs]` |
| sparkDash reads remote machines over SSH inside its container, and local ones through `/proc`, `/sys` and `nvidia-smi` | `[verified: README, Architecture and Quick start]` |
| sparkDash binds to loopback by default, and its own document asks for an authenticated front door for remote use | `[verified: docs/REMOTE-ACCESS.md at 86f972e]` |
| `GET /metrics` is opt-in, reads the snapshot sparkDash already holds, and adds no SSH or `nvidia-smi` calls | `[verified: README, Prometheus]` |
| `GET /api/alerts` returns firing, pending and recent alerts; alert notifications are opt-in, and nothing is evaluated while they are off | `[verified: README, REST API and Alert notifications]` |
| sparkDash's API also shuts machines down, wakes them, caps GPU clocks and power, and runs launcher scripts | `[verified: README, REST API]` |
| DCGM is not supported on the GB10 | `[verified: NVIDIA developer forum answers, threads 363037 and 363137; no NVIDIA documentation page found that says so]` |
| NVIDIA's DGX Dashboard is per machine, local on port 11000, and reached through an SSH tunnel or NVIDIA Sync | `[verified: docs.nvidia.com DGX Spark DGX Dashboard page and the build.nvidia.com playbook]` |
| sparkDash runs anywhere in the fleet today | `[unknown: not checked in this stream]` |

## Next

Specify `specs/fleet-monitoring/spec.md` with `## Workflows`, with an ADR for
the read-only allowlist, the reachability check and the outbound push. Do not
implement from this file alone.
