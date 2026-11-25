# Intent — Homer ops brain on Galadriel

Author: Grok Bot for Danny (scrimshawlife-ctrl)
Date: 2026-11-20
Status: draft, written on 2026-11-20 and not accepted.
Product: Homer (`Zero-State-LLC/Homer`)

This file is a proto-spec. It comes **before** specify.
The next stage is `specs/` (spec-kit specify). Do not skip to code.

This intent is **proposed, not accepted, and not built**. Nothing in it
authorizes implementation, a deploy, or a hardware purchase.

## Problem / why now

Danny wants a Homer ops brain to eventually run on Galadriel, when Aaron
brings the machine. The brain would watch CI, GitHub, traces, stack and
site health, the fleet of machines, SSH paths, and secret expiry, and it
would alert on change rather than requiring a human to poll each system.

[assumed: goal and host name stated by Danny in chat on 2026-11-20.
Galadriel's arrival date, location, specifications, and current owner
access were not independently verified in this stream.]

## Proposed outcome

Observable done (a stranger can check this without reading the chat),
once a later accepted spec is implemented. These are targets, not
current features:

Danny's requested scope:

- Local and cloud CI runners are visible, including whether they are
  busy, idle, stale, or failed.
- GitHub is monitored live (repository and workflow activity for the
  org's repos, without inventing a repo list here).
- Company-wide traces are collected through Langfuse.
- SaaS and database degradation in the stack is detected and shown as
  stale or down, never silently.
- Status of our own websites is monitored. The exact site list is an
  open question.
- All named machines are monitored: both DGX Sparks (Delphi and
  Morpheus), the Bosgame, the new Mac Ultra, the Jetson, and Galadriel
  itself. Hardware specifications for each are unknown in this file.
- SSH connections to those machines are monitored.
- API key and secret health and expiry are monitored. Raw secrets are
  never printed, logged, or committed.

Boof's requested additions:

- A single status view, with change-only alerts that link to runbooks.
- Spend and usage per provider, including Langfuse per-bot cost.
- A deploy-and-merge watch. The developer decides deploy behavior per
  use case. Homer does not own deploy policy. It watches for and alerts
  on unapproved production deploys, and on the known auto-deploy
  repositories named in the earlier scope (Autogive, Impact-Relay,
  Portfolio-Signals, JChain, and zer0state). The watch observes and
  alerts; it does not merge or deploy without Danny's yes.
- A repository security watch: anomaly signals plus GHSA and Dependabot
  findings for what we actually run.
- Agent and routine health.
- GPU and fleet load, temperature, and disk.
- Backup restore drills (evidence that a restore was practiced, not
  only that a backup job ran).
- Brain upkeep: the Homer map, the `CONTEXT.md` glossary, Corrections,
  vault–Notion parity, and documentation drift.
- A NIM-first model fallback, served locally. If NIM is not used, the
  reason is recorded.

## Affected users / systems

- Users: Danny; Aaron (named as the person bringing Galadriel);
  other humans and authorized agents who will read status or alerts,
  once access is specified.
- Systems (proposed): Homer; GitHub; Langfuse; Cloudflare Access;
  local and cloud CI runners; the named machines; SSH; the Source
  Systems Homer already names (GitHub, Linear, the Control Room,
  software-factory) where they are relevant to status. Hosting,
  inventory, and current health of each are unknown unless a later
  receipt verifies them.

## Constraints

Product-true locks (do not reopen in implement):

- Observe and alert may run autonomously. Any mutation — including a
  deploy, a merge, a secret rotation, or adding a paid service — needs
  Danny's yes, once per occurrence.
- Reach outside only through Cloudflare Access. Do not open public
  ports. Do not bypass Access. Do not expose Galadriel, the box, or
  any other machine to the public internet.
- Never print, log, or commit secrets, tokens, account ids, or live
  credentials. Secret-health checks must report status and expiry,
  not values.
- NVIDIA-first: consider NIM, DCGM, and other NVIDIA options first for
  local model serving and GPU telemetry. If one is not used, record
  the reason. Do not switch a model provider silently.
- Homer remains the Authority only for Observations and Projections. It
  never becomes the Authority for a fact another Source System owns.
- A wrong Activity Event is fixed with a Correction, never an edit.
- Do not invent machine specifications, site lists, inventory, or
  Milestone dates. Unknown is a valid answer.

Non-goals:

- Implementing or deploying the ops brain from this intent alone.
- Accepting this intent without a human yes (`Status` stays `draft`
  until then).
- Replacing the software-factory pipeline or its judge.
- A second skills library or new agent bots in Homer.
- Changing branch protection, repository visibility, or Actions
  secrets.
- Homer itself merging or deploying, including a production cutover of
  zer0state.com, without Danny's yes. Deploy policy for each repository
  stays with the developer; Homer only watches and alerts.

## NVIDIA-first notes

These are evaluation rules for a later spec, not a claim that any
NVIDIA product is already running on Galadriel.

| Layer | NVIDIA option | Alternatives | Decision | Reason |
| --- | --- | --- | --- | --- |
| Local model fallback | NIM, served locally | Other hosted or local runtimes | NIM-FIRST | Boof's addition, under the org NVIDIA-first rule. If NIM is unavailable or unfit, record why before choosing an alternative. |
| GPU telemetry (load, temperature) | DCGM | Vendor-neutral exporters, unstated vendor tools | DCGM-FIRST to evaluate | Named fleet includes DGX Sparks and a Jetson; DCGM is the NVIDIA path to consider first once hardware is inventoried. |
| Coordination / status UI | none applicable yet | TypeScript or other Homer stack | NOT DECIDED | No GPU or model is required for a status Projection; stack choice waits on specify. |

No NVIDIA product is claimed as in use on Galadriel.

## Open questions

- When does Galadriel arrive, where will it live, and who has physical
  and SSH access?
- What are the hardware specifications (CPU, GPU, memory, disk,
  network) of Galadriel, both DGX Sparks (Delphi and Morpheus), the
  Bosgame, the new Mac Ultra, and the Jetson? All unknown here.
- How should Galadriel join the fleet (identity, Access application,
  SSH, and runner registration)? Do not invent a second Access
  application or a public endpoint.
- Is Langfuse already in use, and where is it hosted?
- Which websites count as "our own," and which SaaS and databases are
  in the degradation watch?
- Where do alerts go, and what is the freshness budget per Source
  System or machine?
- How does this ops brain relate to the Control Room, to existing
  agent routines, and to software-factory?
- Should `partner-agents` get access? (The org default permission is
  none.)

## Claims

| Claim | Label |
| --- | --- |
| Danny wants a Homer ops brain to eventually run on Galadriel, brought by Aaron | `[assumed: Danny's chat on 2026-11-20; not independently verified]` |
| Named machines are Delphi, Morpheus (DGX Sparks), the Bosgame, the new Mac Ultra, the Jetson, and Galadriel | `[assumed: named in that chat; not an inventoried asset list]` |
| Hardware specifications and current health of those machines | `[unknown: not verified in this stream]` |
| Langfuse will be the trace (and per-bot cost) system | `[assumed: named in that chat; current deployment unknown]` |
| The developer decides deploy behavior per use case; Homer watches and alerts on unapproved production deploys and the known auto-deploy repositories, and does not own deploy policy | `[verified: Danny's decision in chat on 2026-11-20]` |
| Known auto-deploy repositories named for the watch: Autogive, Impact-Relay, Portfolio-Signals, JChain, and zer0state | `[assumed: named in the earlier approved scope; exact slugs not re-verified here]` |

## Next

A human accepts this file (`Status: accepted`). Then specify
(`specs/` with a `## Workflows` section). Do not implement from this
file alone.
