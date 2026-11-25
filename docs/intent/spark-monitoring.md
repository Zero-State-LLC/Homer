# Intent — Remote Spark monitoring through sparkDash

Author: Claude Code for Danny (scrimshawlife-ctrl)
Date: 2026-11-24
Status: draft
Product: Homer (`Zero-State-LLC/Homer`)

This file is a proto-spec. It comes **before** specify.
Next stage is `spec.md` (spec-kit specify). Do not skip to code.

One committed intent per change stream. Live under `docs/intent/`.

This intent is **proposed, not accepted, and not built**. Nothing in it
authorizes code, a contract change, a deploy, a new Cloudflare Access
application, or a change on any machine.

## Problem / why now

Danny asked on 2026-11-24 to integrate Mia's AI Lab's sparkDash into Homer,
so the team can monitor its DGX Sparks remotely through Homer.

Homer sees no machines today. To know whether a Spark is down, running hot,
out of disk, or no longer serving its model, someone has to reach that
machine and look. The Galadriel intent lists both Sparks (Delphi and
Morpheus) and "GPU and fleet load, temperature, and disk" as targets, but it
is a draft, names no tool, and covers far more than the Sparks.

sparkDash already does the machine side. It is an open-source dashboard for
one or more DGX Sparks: from one host it reads each Spark over SSH and
`nvidia-smi`, shows GPU, CPU, unified memory, storage, network and local LLM
metrics, and evaluates health alerts such as a unit going offline, a thermal
throttle, storage at 90 %, or an LLM server going away. It exposes that state
read-only as Prometheus metrics (`GET /metrics`) and as alert state
(`GET /api/alerts`). Homer can watch the Sparks by reading sparkDash, instead
of building its own collectors and SSH paths.

[verified: sparkDash README and `docs/REMOTE-ACCESS.md` at v2.91.0, commit
`86f972e`, 2026-11-22] [assumed: "our Sparks" means Delphi and Morpheus, as
the Galadriel intent names them; whether sparkDash already runs anywhere is
unknown]

## Proposed outcome

Observable done, once a later accepted spec is built. These are targets,
not current features.

- sparkDash runs on one host on the Sparks' network, bound to loopback, its
  own default, with Delphi and Morpheus added as units. Its Prometheus metrics
  and its alert notifications are turned on; both are off by default, and
  sparkDash evaluates no alerts while notifications are off. Installing and
  configuring it is an operator step on our machine that a Homer runbook
  describes. It is not Homer code.
- A local Homer runner, the sparkDash Collector, reads sparkDash only through
  a fixed list of read-only `GET` endpoints. It pushes to Homer outbound,
  through Cloudflare Access:
  - Source Freshness for `sparkdash`, and each unit's up or down state from
    `sparkdash_up`;
  - one Activity Event when a sparkDash alert fires and one when it clears,
    with an Event Key from the alert's rule, unit id and start time. Metric
    samples are not Activity Events.
- A Homer status Projection shows each Spark as up, down or stale, with its
  last-seen time, its firing alerts, and a link to the sparkDash page. When
  the Collector goes quiet, the Projection shows the Sparks as stale, never as
  up.
- Firing and cleared alerts reach the Buzz `homer` channel as change-only
  Alerts under the Buzz spec, with Alert Keys derived from sparkDash's rule
  and unit, inside that spec's 30-per-hour cap.
- Away from the Sparks' network, Danny can open Homer's status view and, from
  it, the full sparkDash page through an authenticated front door. No port is
  open to the internet.
- Time series stay in sparkDash. Homer stores states and alert transitions,
  never metric history.

## Affected users / systems

- Users: Danny; humans and Agents who read the `homer` Buzz channel or the
  status view.
- Systems: sparkDash, as a new Source System and the Authority for machine
  telemetry and its alert state; the DGX Sparks Delphi and Morpheus; the host
  that runs sparkDash; the local runner that runs the Collector; Cloudflare
  Access; the Event Ledger; Projections; Buzz; 1Password.

## Constraints

Product-true locks (do not reopen in implement):

- **Read-only.** Homer and the Collector call only `GET` endpoints on a fixed
  allowlist. sparkDash also shuts Sparks down, wakes them, caps GPU clocks and
  power, runs model launcher scripts, restarts itself and changes settings.
  Homer never calls, links to or proxies any of those. Every change to a
  Spark stays a human action, taken in sparkDash itself.
- **No public port.** sparkDash stays bound to loopback. Remote access goes
  through a front door that authenticates every path, `/ws` included. TLS
  alone is not enough. sparkDash's own remote-access document asks for the
  same.
- **Outbound only.** Runners are local and everything else is on Cloudflare
  (Danny, 2026-11-23). The Collector pushes to Homer; Homer never dials into
  the Sparks' network.
- **sparkDash is the Authority** for machine telemetry and alert state.
  Collectors map, they never invent: a metric sparkDash leaves out is unknown,
  never zero. That is sparkDash's own rule for its metrics.
- **No infrastructure detail in Homer.** Events, Projections and Alerts carry
  a unit's id and name, never its address, SSH user or ports.
- **Secrets by reference.** A sparkDash token, if the host sets one, and any
  Access service token come from 1Password by reference. They never appear in
  the repository, a log, an Activity Event or an Alert.
- **Pinned shape.** The Collector targets a named sparkDash release. When the
  alert or metric shape it reads changes, the Collector raises an Alert and
  stops mapping. It never guesses at a new shape.
- **No fork.** Homer talks to sparkDash over HTTP and vendors none of its
  code. sparkDash is Apache-2.0 from v2.0.0, so vendoring would carry its
  NOTICE terms.
- **NVIDIA-first, with the reason recorded.** DCGM, the NVIDIA telemetry path
  the Galadriel intent says to consider first, is not supported on the GB10
  according to NVIDIA's own forum answers. NVIDIA's DGX Dashboard serves one
  machine locally on port 11000, behind an SSH tunnel or NVIDIA Sync, and has
  no fleet view or alert interface. sparkDash reads the Sparks with NVIDIA's
  own `nvidia-smi`. If NVIDIA ships DCGM for the GB10, the spec revisits this
  choice.

Non-goals:

- A Homer metrics collector, SSH from Homer to any machine, or a store of time
  series.
- A copy of the sparkDash interface inside Homer.
- Controlling a Spark from Homer in any way.
- A Prometheus or Grafana stack. sparkDash's `/metrics` allows one later; it
  is not part of this intent.
- The Galadriel ops brain as a whole. This intent is one slice of it and does
  not accept that intent.
- Machines other than the two Sparks, until an open question below says
  otherwise.

## Open questions

Each question has a proposed default, which applies if Danny accepts the intent
without answering that question.

| Question | Proposed default |
| --- | --- |
| Which host runs sparkDash, and does it run anywhere already? | Delphi, with sparkDash's published Docker image; Delphi is a local unit and Morpheus is read over SSH with a key |
| Which front door reaches the sparkDash page from outside: Cloudflare Tunnel with Access, or Tailscale Serve (sparkDash's documented path)? | Cloudflare Access, because the Galadriel draft says to reach outside only through Access. Is Tailscale in use at all? |
| Where does the Collector run? | On the sparkDash host, reading loopback, so sparkDash needs no token and no extra exposure |
| Which sparkDash alerts go to Buzz? | Its critical and warning alerts (unit offline, thermal or hardware throttle, storage at 90 %, LLM unavailable, Xid or out-of-memory), and their clears |
| What freshness budget makes the Sparks stale? | Two minutes without a successful read |
| Only Delphi and Morpheus, or also the Bosgame, the Mac Ultra, the Jetson and Galadriel, which sparkDash can read as hosts or Macs? | The two Sparks first; the others in a later change |
| Where does the status view live? Homer has an Activity Calendar and a Project Timeline, but no status Projection yet | A new fleet status Projection, defined in the spec |
| Who besides Danny may see the status view and the sparkDash page? | Danny and Boof, through the same Access policy |

Consequences for the spec, not questions:

- `sparkdash` becomes a Source System. That bumps the Activity Event contract
  version, as Buzz did with version 2.
- New `CONTEXT.md` terms, once built: Spark (a DGX Spark machine Homer
  watches) and sparkDash Collector.

## Claims

| Claim | Label |
| --- | --- |
| Danny asked to integrate sparkDash so the team can monitor its Sparks remotely through Homer | `[verified: Danny's message on 2026-11-24]` |
| The Sparks are Delphi and Morpheus | `[assumed: named in the Galadriel intent; not an inventoried asset list]` |
| sparkDash is at v2.91.0 (2026-11-22) and Apache-2.0 from v2.0.0; versions up to 1.9.0 were MIT | `[verified: README badge, CHANGELOG and NOTICE at commit 86f972e]` |
| sparkDash reads remote units over SSH inside its container, and local units through `/proc`, `/sys` and `nvidia-smi` | `[verified: README, Architecture and Quick start]` |
| sparkDash binds to loopback by default, and its own document asks for an authenticated front door for remote use | `[verified: docs/REMOTE-ACCESS.md at 86f972e]` |
| `GET /metrics` is opt-in, reads the snapshot sparkDash already holds, and adds no SSH or `nvidia-smi` calls | `[verified: README, Prometheus]` |
| `GET /api/alerts` returns firing, pending and recent alerts, and alert notifications are opt-in | `[verified: README, REST API and Alert notifications]` |
| sparkDash's API also shuts units down, wakes them, caps GPU clocks and power, and runs launcher scripts | `[verified: README, REST API]` |
| DCGM is not supported on the GB10 | `[verified: NVIDIA developer forum answers, threads 363037 and 363137; no NVIDIA documentation page found that says so]` |
| NVIDIA's DGX Dashboard is per machine, local on port 11000, and reached through an SSH tunnel or NVIDIA Sync | `[verified: docs.nvidia.com DGX Spark DGX Dashboard page and the build.nvidia.com playbook]` |
| sparkDash runs anywhere in the fleet today | `[unknown: not checked in this stream]` |

## Next

A human accepts this file (`Status: accepted`). Then specify
(`specs/spark-monitoring/spec.md` with `## Workflows`), with an ADR for the
read-only allowlist and the outbound push. Do not implement from this file
alone.
