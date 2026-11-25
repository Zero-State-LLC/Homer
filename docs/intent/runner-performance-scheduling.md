# Intent: evidence-based CI runner performance and scheduling

Status: accepted for specification and offline, read-only measurement implementation by Daniel's "Continue" instruction on November 22, 2026 PT. Automated routing, host enrollment, paid services, merges, and deployment remain unapproved.
Product: Homer
Date: 2026-11-22 PT

## Problem and why

Agent-assisted development can generate more test jobs than a small PC/Mac runner fleet can complete promptly. Homer already has an accepted calendar/runner intent and scoped controller and lifecycle contracts on stacked PRs, but those contracts do not yet establish a performance-based routing policy. Speed, cache behavior, queue delay, trustworthy isolation and cost need to be measured independently before choosing hardware or a third-party runner.

This stream extends the accepted [calendar and runners intent](calendar-runners.md), [ADR 002](../../specs/adr/002-pc-mac-runners.md), [ADR 003](../../specs/adr/003-runner-operations-telemetry.md), [runner controller](../../specs/runner-controller/spec.md) and [runner lifecycle](../../specs/runner-lifecycle/spec.md). Those dependencies are currently under review in stacked PRs #35, #38 and #39. Do not treat their merge or live activation as completed.

## Observable outcomes

- An operator can compare measured CI queue delay, execution time and cache behavior by workflow/job attempt, repository and eligible runner class, with provenance, time window and sample counts.
- A fleet view shows measured capacity, relevant hardware capabilities and uncertainty. It distinguishes configured information, host-reported observations and independently sourced GitHub job state.
- An advisory routing view explains which machines satisfy hard policy gates and which would be faster or cheaper based on comparable evidence. Every exclusion has a reason.
- Routing changes cannot occur from advice alone. GitHub Actions retains assignment and registration authority; any future controlled `runs-on`, runner group or dispatcher change is a separately accepted and approved implementation.
- The controller can continue safe drain and resume without interruption of active jobs or automatic reassignment of jobs already queued in GitHub.
- Unknown machine capabilities, missing job observations, outdated benchmarks and external vendor claims never appear as verified performance.

## Constraints

- Cloudflare hosts Homer's control and observation services; local or approved external runners execute native build jobs. Workers must never be presented as Windows/macOS build hosts.
- Dynamic inventory from reviewed registration and source evidence. Do not hardcode machine aliases, OS assumptions, repository allowlists, runner IDs or a provider catalog.
- GitHub is Authority for Repository Events and job assignment. Homer is Authority only for its Observations and Projections. software-factory owns Work Packets and Verdicts; Linear owns Tasks.
- Preserve provenance, original and rerun Actor distinctions, explicit Identity Bindings, Event Keys, immutable Event Ledger and Correction semantics. An unavailable Identity Binding leaves an Actor Unattributed.
- Job isolation and trust eligibility take precedence over any performance or cost objective. A label alone cannot grant access; never run untrusted fork PR code on a persistent personal workstation.
- Never create a shell execution endpoint, silently reroute production workflows, create or rotate credentials, add paid providers, merge, or deploy without the separately required approvals and release evidence.
- Do not use Clef classifications as a job assignment authority, trust decision, identity inference, job idle assertion or safety precondition.
- No One Mind content, secrets, process command lines, personal file paths or raw private logs in Homer.

## Non-goals

- Replacing GitHub Actions, its runner matching semantics, or software-factory.
- Building a CI provider marketplace or copying external provider rankings.
- Live machine installation, changing branch protections, or introducing new paid subscriptions.
- Treating benchmark results from another organization or vendor as measurements from our fleet.

## Questions that require evidence before activation

- What are the actual PC operating system, Mac chip/architecture, CPU/RAM/storage, job concurrency, GitHub runner IDs and approved workload scopes?
- Which jobs dominate queue time and which stages dominate job duration? Which can safely run in parallel?
- Which workflow families are trusted and eligible for self-hosted execution? What clean environment is provisioned for each job?
- What is the approved benchmark measurement window, resource sample retention, and operating cost budget?
- Which supported GitHub Actions mechanism would make a routing change before jobs enter GitHub's queue, and who approves changes to workflow definitions?

## Workflows for this draft

1. Inventory verified machine capabilities and existing repository workflows without editing `runs-on` labels.
2. Observe GitHub workflow-job attempts and relevant source evidence through the authorized Collector; keep missing data Unknown.
3. Benchmark identical representative workflows with comparable cold-cache and warm-cache runs; preserve raw result links and environment details.
4. Produce deterministic, explainable advisory candidates after enforcing all trust, scope, freshness and capacity gates.
5. Specify the versioned measurement contract, FORGE plan and Linear Tasks. Implement source-linked, read-only measurement before an independently approved automated routing change; real-machine qualification remains a separate gate.

## Claims and references

- [OBSERVED] Morgan Linton's November 22, 2026 PT [post](https://x.com/morganlinton/status/2124594952579747957) describes CI speed as a bottleneck in agentic coding and links to [CIRunners.org](https://cirunners.org/).
- [OBSERVED] The November 22 [CIRunners methodology](https://cirunners.org/methodology/) explicitly states it has not independently benchmarked providers. It supplies a feature-compatibility matrix, not our workload performance measurements.
- [OBSERVED] Homer's existing [ADR 003](../../specs/adr/003-runner-operations-telemetry.md) calls for queue/job timestamps, host provenance, source-link attribution and separate concurrent jobs, but does not authorize performance-driven dispatch.
- [PROPOSED] A performance-and-policy recommendation layer may improve throughput after representative benchmarks. No speed-up or cost savings are claimed.
- [UNKNOWN] Live enrollment, host identities, native runner adapter qualification, baseline performance and measured cost remain unverified.

## Next

Specify `specs/runner-scheduling/spec.md` with a `## Workflows` section, bounded evidence schema, deterministic policy fixtures, threat model, test plan and a FORGE plan. The design is in [ADR 005](../../specs/adr/005-runner-performance-scheduling.md). Keep operational dispatch, live host control, paid provider use, merges and production deployment behind separate gates.
