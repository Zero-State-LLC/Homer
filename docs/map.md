# Homer map

This is the front door for Homer (`Zero-State-LLC/Homer`). Keep it small. Follow the links for the contract, the glossary, and team context.

## What we do

Homer is the Zero State engineering headquarters. It observes work in GitHub, Linear, the Control Room, and software-factory, records that work in one Event Ledger, and projects it into an Activity Calendar and a Project Timeline. Homer is the Authority only for Observations and Projections. It never becomes the Authority for a fact another Source System owns.

## What matters now

The latest handoff is [`docs/receipts/implementation-2026-11-25.md`](receipts/implementation-2026-11-25.md): where each stream stands, what waits on Danny, and the next Tasks. Linear (team ZER, project Homer) holds each Task's state.

Accepted specs, one Linear Task per work packet:

- The Event Ledger and Projections, under the foundation intent: [`specs/event-ledger/spec.md`](../specs/event-ledger/spec.md), [`specs/projections/spec.md`](../specs/projections/spec.md), [`specs/github-collector/spec.md`](../specs/github-collector/spec.md), [`specs/github-webhook/spec.md`](../specs/github-webhook/spec.md) and the runtime catalog, [`specs/catalog-worker/spec.md`](../specs/catalog-worker/spec.md).
- The runner stream (work calendar, PC and Mac runners, controllers, lifecycle, scheduling and job evidence): [`specs/runner-controller/spec.md`](../specs/runner-controller/spec.md), [`specs/runner-lifecycle/spec.md`](../specs/runner-lifecycle/spec.md), [`specs/runner-scheduling/spec.md`](../specs/runner-scheduling/spec.md), [`specs/runner-work-evidence/spec.md`](../specs/runner-work-evidence/spec.md), and ADRs 001 to 005.
- Buzz as a Source System and alert channel: [`specs/buzz/spec.md`](../specs/buzz/spec.md), with [ADR 014](../specs/adr/014-homer-buzz-worker.md).
- The knowledge loop (Knowledge Flags, the Curator, Curator Profiles): [`specs/knowledge-loop/spec.md`](../specs/knowledge-loop/spec.md).
- CI feedback time: [`specs/ci-feedback/spec.md`](../specs/ci-feedback/spec.md), ADRs 008 to 010.
- Work Request emission (ZER-62): [`specs/work-requests/spec.md`](../specs/work-requests/spec.md), ADR 006.
- Fleet monitoring through sparkDash (ZER-76): [`specs/fleet-monitoring/spec.md`](../specs/fleet-monitoring/spec.md), ADR 011. Its intake is in `homer-intake`, the Worker for machines ([ADR 013](../specs/adr/013-catalog-worker-boundary.md); deployment in [`docs/deployment/intake.md`](deployment/intake.md)).
- Versioning and releases (ZER-90): [`specs/versioning/spec.md`](../specs/versioning/spec.md), [ADR 012](../specs/adr/012-one-product-version.md). Runbook: [`docs/deployment/releases.md`](deployment/releases.md).

Accepted without a spec yet: the Work Assignment Router, [`docs/intent/work-assignment-router.md`](intent/work-assignment-router.md) and [ADR 007](../specs/adr/007-work-assignment-router-trust.md). Still a draft: credential administration, [`specs/credential-admin/spec.md`](../specs/credential-admin/spec.md), whose first slice is built (ZER-86).

Hosting (Danny, 2026-11-23): runners are local, and Cloudflare handles everything else. The merge contract needs a Verdict, and the judge grades a Work Packet built from a Work Request; docs-only pull requests merge on Danny's acceptance. On 2026-11-24 Danny granted an admin bypass. The pull requests merged under it, among them the runner stack (#31 to #46) after a rebase onto `main` and the versioning stream (#76 to #82), are listed in its receipt. The code among them owes after-the-fact Verdicts (ZER-63); see [`docs/receipts/bypass-merges-2026-11-24.md`](receipts/bypass-merges-2026-11-24.md) and, for the merges after midnight UTC, [`docs/receipts/bypass-merges-2026-11-25.md`](receipts/bypass-merges-2026-11-25.md). The foundation intent, [`docs/intent/home-foundation.md`](intent/home-foundation.md), still governs the Event Ledger and Projections (ZER-9). Do not invent a Milestone date; an Unknown Date is a valid answer.

## Authority / source order

Use this order, from [`CONTEXT.md`](../CONTEXT.md). It is Authority, not recency:

- Linear is the Authority for Task ownership, priority, and status.
- GitHub is the Authority for Repository Events.
- The Control Room is the Authority for Work Sessions and Handoffs.
- software-factory is the Authority for Work Packet stage and Verdicts.
- Homer is the Authority only for Observations and Projections.

If you cannot find a fact, say so. Never invent Attribution or a Milestone date, and never turn a guess into an Activity Event, a glossary term, or an accepted intent. Unattributed and Unknown Date are valid answers. Collectors map, they never invent.

## Start here

- [`AGENTS.md`](../AGENTS.md) — the agent contract
- [`CONTEXT.md`](../CONTEXT.md) — the ubiquitous language
- [`docs/intent/`](intent/) — accepted intents (read the active one before you edit)
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — the order of work, and how to land a fix
- [`docs/agents/`](agents/) — where Pocock's engineering skills put Tasks, specs, terms, and decisions, and how agents use Buzz
- [`agent-context.pin.json`](../agent-context.pin.json) — the Context Pin
- Team context lives in [`Zero-State-LLC/agent-context`](https://github.com/Zero-State-LLC/agent-context): read `HANDOFF.md`, then `STATUS.md`, then `DECISIONS.md` only if a prior choice affects this Task. Clone it as `AGENTS.md` describes. Do not copy it into Homer.

## Where it lands

Route work into the right path, not into a chat.

| Incoming | Lands in |
| --- | --- |
| A new or changed term | `CONTEXT.md` |
| Stage-zero intent | `docs/intent/` |
| Evidence, discovery, or implementation receipt | `docs/receipts/`, named `<topic>-<YYYY-MM-DD>.md` (a release's by its version) |
| A release or a Worker deploy | the runbook, [`docs/deployment/releases.md`](deployment/releases.md); each deploy leaves a Deploy Receipt in `docs/receipts/` |
| A Verdict for a pull request | the runbook, [`docs/deployment/work-requests.md`](deployment/work-requests.md), on the judge's machine |
| Integration contract | `specs/integration-contracts/` (named in `CONTRIBUTING.md`; the folder arrives with the contracts work) |
| Activity Event from a Source System | the Event Ledger, via a Collector |
| Team HANDOFF, STATUS, DECISIONS, or skills | `Zero-State-LLC/agent-context`, consumed through the Context Pin |

Do not add a second skills library to Homer. Name only skills that already exist.
