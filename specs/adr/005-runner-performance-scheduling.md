# ADR 005: measured runner performance and advisory scheduling

Status: proposed, NOT accepted for implementation. Date: 2026-11-22 PT.
Intent: [runner performance and scheduling](../../docs/intent/runner-performance-scheduling.md) (draft).
Dependencies: [ADR 002](002-pc-mac-runners.md), [ADR 003](003-runner-operations-telemetry.md), [scoped controller](../runner-controller/spec.md), [lifecycle](../runner-lifecycle/spec.md). The underlying PRs #35, #38 and #39 are stacked and unmerged as of this drafting.

## Context and proposed decision

Treat CI performance as a measured, source-linked operational property, not an advertised runner capability. Add an advisory candidate-selection Projection to Homer. Do not create another CI execution engine: GitHub Actions remains Authority for job assignment, matching, registration and workflow job events. Homer holds reviewed fleet configuration, its own operation records, and read-only Observations and Projections.

Phase one recommends destinations and identifies bottlenecks; it does not dispatch, requeue, provision, buy, change `runs-on`, or automatically approve new repositories. A later accepted contract may change prequeue workflow selection through GitHub-supported mechanisms with explicit owner approval. GitHub's already queued work is not silently moved between runners.

## Trust and eligibility before optimization

For each job attempt, form an eligible candidate set only when all required facts are verified:

1. The Source System and workflow are reviewed and permitted for that runner group. Use effective GitHub runner-group/repository/workflow policy; labels provide capability hints, not authorization.
2. The requested OS, architecture, toolchain/Xcode version, resources, GPU and other hard requirements match recorded capabilities; missing required facts exclude the candidate.
3. The trust class is allowed: untrusted fork code cannot reach persistent personal PC/Mac environments, privileged credentials or writable shared caches. Prefer isolated disposable environments. A provider's isolation guarantee requires evidence.
4. Machine registration and current controller binding are valid. Controller desired mode, host-reported listener/admission and independently sourced GitHub runner/job status remain distinct.
5. Required health evidence is fresh, admission is open, and a capacity/concurrency lease can be acquired under the approved quota. Stale or Unknown is never assumed idle.
6. The routing configuration is the latest reviewed revision. A policy mismatch, Source Freshness failure, competing edit or incomplete evidence fails closed.

Only after eligibility may a deterministic scorer compare estimated queue-plus-execution time and approved cost. Use reproducible weights and a stable tie-breaker, keep an exclusion explanation for every candidate, and abstain when comparable evidence is insufficient. Clef may suggest investigations but never establish eligibility or authorize action.

## Observation contract to specify

Do not treat this draft table as a released schema. The eventual typed contract needs an explicit version and fixtures.

| Evidence family | Required facts / Source |
| --- | --- |
| GitHub job attempt | Repository numeric ID, workflow ID, run ID, job ID, attempt, commit SHA, status, requested/queued/started/completed UTC times, original actor and rerun initiator when provided, runner ID, workflow URL, collection timestamp and Provenance |
| Reviewed runner capability | Stable machine identity, reviewed OS and architecture, executor class, supported toolchain, resources, safe concurrency, permitted scopes and policies, revision, configuration provenance |
| Host observation | Controller binding revision, operation revision/receipt, observed UTC time, server receipt time, freshness budget, listener state, admission state and job state, clearly labelled host-reported |
| Phase timings | Cache restore, dependency install, build, tests, artifact upload and other measured stages only when a workflow reports them; missing metrics remain Unknown |
| Benchmark sample | Workflow family, exact commit/workflow revision, machine/image/toolchain version, cache mode, sample UTC time, duration, queue wait, outcome and evidence URL; exclude failed or cancelled runs from successful-duration estimates but report them separately |
| Cost evidence | Provider pricing source, effective date, applicable billing unit, spend cap and observed billable usage; never infer hourly cost from a vendor sticker price alone |

Represent GitHub `run_attempt` as a distinct attempt; reruns do not overwrite prior evidence. Preserve late/out-of-order deliveries via immutable Event Keys and Corrections, as specified by ADR 003 and the Event Ledger. Concurrent jobs remain separate. Do not promote host assertions into GitHub Authority. No new unbounded high-frequency telemetry goes into the Event Ledger without a retention/capacity design and approval.

## Measures and decision quality

- Report queue wait from GitHub's job timestamps, execution time, and end-to-end time separately. A fast executor can still lose on queue delay.
- Split cold-cache from warm-cache samples, and distinguish cache restoration time, dependency download, compilation and test time where instrumentation actually exists.
- Compare matched workflow families at pinned commits, equivalent image/toolchain revisions and compatible resource classes. Note incomparable OS-specific jobs rather than scoring one against another.
- Show sample count, time window, median (p50), p95 and uncertainty. A p95 from too few runs must be marked insufficient, not extrapolated. Track error, cancellation, retry and flaky-test rates.
- Record both free/allocated hardware capacity and marginal/billed spend, with prices verified at evaluation time. Quoted vendor speed claims are not benchmark evidence.
- Monitor changing distributions and cache hit rates; expire old estimates and warn before using them to recommend a routing change.
- Optimization order: policy and security eligibility, correctness, freshness, then end-to-end latency, then approved operating cost. Never trade away trust gates for speed.

## Control plane and workflow boundary

Cloudflare Workers serve authenticated APIs, and Durable Objects may coordinate small revised policy/configuration state. Use a bounded asynchronous Collector for GitHub evidence. Do not introduce a new unreviewed event store or duplicate GitHub's job-queue Authority. Any private time-series storage, R2 archival, sampling frequency and retention need separate reviewed data governance and cost gates.

GitHub Actions should retain explicit runner groups and capability labels. Evaluate the supported scheduling control point (for example a reviewed `runs-on` expression based on an approved workflow input, or distinct workflows for separate trusted runner pools) before authorizing automated dispatch. Do not assert the control plane can retarget an already queued workflow_job webhook delivery. A future controller may report a recommendation but must not mutate the workflow or registration on the strength of telemetry alone.

A drain closes admission, allows active jobs to finish, then stops under the accepted lifecycle preconditions. Disconnect or expired heartbeats never imply successful job completion. When a runner fails, show the pending GitHub job and the recovery action that GitHub supports; do not claim instant host migration. Any hosted overflow route is opt-in per approved workflow and billing policy, not an automatic paid fallback.

## Operator surface

Add a Performance tab after ADR 003's Work, Operations, Health and History surfaces. Show by machine, workflow family, repository and comparison window:

- Current eligible/busy/draining/unknown capacity with source and last receipt.
- Job queue wait, execution and end-to-end p50/p95, sample count, cache mode and outcome rate.
- A bottleneck breakdown with timings only where explicitly instrumented.
- Advisory candidate matrix: eligible/excluded/unknown, exact policy reason, measured basis and dated cost estimate.
- Read-only evidence links to GitHub runs, reviewable configuration and benchmark provenance.
- Explicit "No reliable recommendation" when sample size, cache parity or Source Freshness fail.

No fabricated graphs, guessed actors, automatic one-click approval, or misleading green health. Keyboard navigation, screen reader labels, mobile layout and a plain-English explanation of every exclusion are required.

## Validation and acceptance gates for a later implementation

1. Unit fixtures show hard exclusions for incompatible OS/architecture, missing required tools, untrusted fork, denied runner group, invalid binding, stale host evidence, unknown job state, exhausted quota and revision mismatch. The scorer must never override a hard exclusion.
2. Deterministic ordering and abstention tests cover ties, incomparable workloads, no benchmarks, inadequate samples, failed/cancelled attempts, clock skew and provider outage.
3. Collector tests preserve distinct run attempts, multiple concurrent jobs, late transitions, source timestamps, Provenance, original receipts and Unattributed Actors.
4. UI tests exercise read errors, stale evidence expiry, keyboard/mobile controls, evidence links, comparison filtering and the explicit advisory-only label.
5. Benchmark a small set of representative trusted workflows on approved machines, with cold/warm runs and repeatable environment metadata; publish p50/p95, counts, failures and raw source URLs. Fix a minimum sample requirement during the accepted specification, not by inventing a statistical guarantee now.
6. An independent security review verifies no shell, arbitrary job execution, untrusted PR dispatch, credential exposure, unauthorized workflow rewrite or cache trust-boundary crossing.
7. Only after owner approval, separately exercise a controlled routing mechanism in staging. Prove that rejected/unknown candidates fail closed and that drain does not interrupt active work. Preserve existing `runs-on` semantics and CI until a verified change is approved.

## Implementation sequence and unresolved decisions

1. Accept the stage-zero intent and this decision direction or revise them.
2. Specify versioned measurement and policy contracts, data lifecycle, exact workflow control points, Workflows and acceptance fixtures.
3. Use FORGE to plan and Linear Tasks for collection, Performance UI, advisory policy and real-runner qualification. Keep existing ZER-34/36 scope separate.
4. Implement source-linked metrics and comparison first, then deterministic advisory policy. Require independent Verdict/reproduce for merge as Homer's AGENTS.md specifies.
5. Consider controlled routing only after tested security isolation, runner enrollment, job admission semantics, actual capacity and approved cost policy exist.

Unknown: PC OS, Mac architecture, verified runner IDs, actual machine resource inventory, source retention and acceptable billing caps. Those are intentionally not invented.

## Evidence considered

- [CIRunners.org](https://cirunners.org/) and [methodology](https://cirunners.org/methodology/), checked November 22, 2026 PT. Feature-based compatibility reference only; site states it has not independently benchmarked providers.
- [Faster builds guide](https://cirunners.org/use-cases/faster-builds/), checked November 22, 2026 PT. Explains CPU versus queueing versus caching, not a Homer performance benchmark.
- [GitHub self-hosted runner documentation](https://docs.github.com/en/actions/reference/runners/self-hosted-runners).
- [GitHub secure use guidance](https://docs.github.com/en/actions/reference/security/secure-use).
- Current [ADR 003](003-runner-operations-telemetry.md) and [controller/lifecycle specifications](../runner-controller/spec.md), source of the actual boundaries above.
