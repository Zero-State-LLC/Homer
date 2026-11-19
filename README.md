# Zero State HOME

[![CI](https://github.com/Zero-State-LLC/home/actions/workflows/ci.yml/badge.svg)](https://github.com/Zero-State-LLC/home/actions/workflows/ci.yml)
[![Docs](https://github.com/Zero-State-LLC/home/actions/workflows/docs.yml/badge.svg)](https://github.com/Zero-State-LLC/home/actions/workflows/docs.yml)
[![Secret scan](https://github.com/Zero-State-LLC/home/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/Zero-State-LLC/home/actions/workflows/secret-scan.yml)

Engineering headquarters for Zero State LLC. HOME records source-linked work and
turns verified history into Activity Calendar and Project Timeline data.

**Current delivery:** internal packages, synthetic acceptance tests and a verified
source migration plan. The live Control Room has not been cut over to HOME.

| Component | Responsibility |
| --- | --- |
| [shared-contracts](packages/shared-contracts/) | Versioned Activity Event, Work Request and Factory Event validation; generated Workers-safe Activity Event validator |
| [event-ledger](packages/event-ledger/) | Durable Object storage, atomic append, Duplicate/Conflict detection, Corrections, digest verification and replay |
| [projections](packages/projections/) | Day/week/month calendar, Actor/Project filters, Milestones, evidence-linked Actual Dates, Blockers and Source Freshness |
| [agent-context](https://github.com/Zero-State-LLC/agent-context) | Shared instructions consumed through a verified Context Pin |
| [software-factory](https://github.com/Zero-State-LLC/software-factory) | Work Packets and independent Verdicts, integrated through contracts |
| [Control Room](https://zero-state-control.sleek-park-3366.chatgpt.site) | Existing live coordination surface and Work Session Authority |

## Start here

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
and Verdicts. HOME observes these systems and builds Projections.

- Every Activity Event retains Provenance. A wrong event gets a Correction.
- Source accounts stay Unattributed without reviewed Identity Bindings.
- Unknown Milestone dates remain unknown; completion requires verified evidence.
- No One Mind content or credentials may enter HOME.
- The Event Ledger has no public HTTP route. Its binding is for trusted consumers.

## Delivery and migration

See the [Control Room migration and rollback plan](docs/migration/control-room.md)
for the verified current source, preservation map, acceptance gates and remaining
live integration work. [Release evidence](docs/receipts/implementation-2026-11-18.md)
records exactly what was checked.

Merging follows the repository's independent Verdict and reproduce requirements.
Production cutover and deployment remain separate owner-controlled actions.
