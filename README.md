<div align="center">

<img src="assets/homer-hero.jpg" alt="Cartoon technician at a crowded nuclear-plant safety console, giving a thumbs-up. A green display reads CORE STATUS: NOMINAL." width="100%">

# HOMER

**Zero State's safety console: every runner, machine, key and site, watched.**

</div>

[![CI](https://github.com/Zero-State-LLC/Homer/actions/workflows/ci.yml/badge.svg)](https://github.com/Zero-State-LLC/Homer/actions/workflows/ci.yml)
[![Docs](https://github.com/Zero-State-LLC/Homer/actions/workflows/docs.yml/badge.svg)](https://github.com/Zero-State-LLC/Homer/actions/workflows/docs.yml)
[![Secret scan](https://github.com/Zero-State-LLC/Homer/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/Zero-State-LLC/Homer/actions/workflows/secret-scan.yml)

Engineering headquarters for Zero State LLC. Homer records source-linked work and
turns verified history into Activity Calendar and Project Timeline data.

**Current delivery:** internal packages, synthetic acceptance tests and a verified
source migration plan. The live Control Room has not been cut over to Homer.

| Component | Responsibility |
| --- | --- |
| [catalog-worker](packages/catalog-worker/) | `homer-catalog`, for people: catalog API, durable mapping revisions, admin and fleet pages, enrollment; deployment configuration required |
| [intake-worker](packages/intake-worker/) | `homer-intake`, for machines: signed GitHub webhook, job evidence and the runner controller protocol; deployment configuration required |
| [buzz-collector](packages/buzz-collector/) | Pure mapping of signed Buzz channel messages and Knowledge Flags to Activity Events; signature verification is passed in, transport pending |
| [github-sync](packages/github-sync/) | Runtime repository catalog and safe merged-PR mapping; live deployment and recovery pending |
| [shared-contracts](packages/shared-contracts/) | Versioned Activity Event, Work Request and Factory Event validation; generated Workers-safe Activity Event validator |
| [event-ledger](packages/event-ledger/) | Durable Object storage, atomic append, Duplicate/Conflict detection, Corrections, digest verification and replay |
| [projections](packages/projections/) | Day/week/month calendar, Actor/Project filters, Milestones, evidence-linked Actual Dates, Blockers and Source Freshness |
| [curator-runner](packages/curator-runner/) | Host-agnostic knowledge-loop curator core: host compatibility, agent permissions, change checks, flag reports and run receipts |
| [curator-host-docker](packages/curator-host-docker/) | Docker host adapter for the curator, on Linux or WSL2: locked-down container, egress allowlist proxy, ACP client and change listing; not yet run on a host |
| [agent-context](https://github.com/Zero-State-LLC/agent-context) | Shared instructions consumed through a verified Context Pin |
| [software-factory](https://github.com/Zero-State-LLC/software-factory) | Work Packets and independent Verdicts, integrated through contracts |
| [Control Room](https://zero-state-control.sleek-park-3366.chatgpt.site) | Existing live coordination surface and Work Session Authority |

## Start here

See the [front-door map](docs/map.md) for repository and source authority.

Read [AGENTS.md](AGENTS.md), [CONTEXT.md](CONTEXT.md), the
[accepted foundation intent](docs/intent/home-foundation.md), and
[CONTRIBUTING.md](CONTRIBUTING.md).

```sh
npm ci --no-audit --no-fund
npm run check
```

Development needs Node 22.13+, Node 24, or Node 26+. Tests use local workerd and synthetic
fixtures. They need no Cloudflare account, deployed resources or paid model calls.
`npm run check` builds packages, checks formatting and types, runs Node and Workers
tests, and exercises plain local Wrangler to catch runtime incompatibilities.

## Data and access boundaries

Linear owns Task status and assignments. GitHub owns Repository Events. The
Control Room owns Work Sessions and Handoffs. software-factory owns Work Packets
and Verdicts. Homer observes these systems and builds Projections.

- Every Activity Event retains Provenance. A wrong event gets a Correction.
- Source accounts stay Unattributed without reviewed Identity Bindings.
- Unknown Milestone dates remain unknown; completion requires verified evidence.
- No One Mind content or credentials may enter Homer.
- The Event Ledger has no public HTTP route. Its binding is for trusted consumers.

## Delivery and migration

See the [Control Room migration and rollback plan](docs/migration/control-room.md)
for the verified current source, preservation map, acceptance gates and remaining
live integration work. [Release evidence](docs/receipts/implementation-2026-11-18.md)
records exactly what was checked.

Merging follows the repository's independent Verdict and reproduce requirements.
Production cutover and deployment remain separate owner-controlled actions.
