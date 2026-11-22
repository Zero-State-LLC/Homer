# Runner measurements and advisory scheduling (v0.1.0)

Status: accepted specification direction, implementation and qualification incomplete.
Intent: [runner performance](../../docs/intent/runner-performance-scheduling.md) (accepted for offline/read-only work).
Decision: [ADR 005](../adr/005-runner-performance-scheduling.md); extends [ADR 002](../adr/002-pc-mac-runners.md), [ADR 003](../adr/003-runner-operations-telemetry.md), [controller](../runner-controller/spec.md) and [lifecycle](../runner-lifecycle/spec.md).
Version: 0.1.0, new proposed read-only measurement family. No published endpoint, deployed Collector or live workflow change is claimed.

## Scope and boundaries

Measure GitHub Actions job attempt timing and quality with source-linked observations. Project per-runner and per-workload performance without inventing missing data. Advisory runner selection is a **later** implementation slice; no request here may enqueue, retarget, cancel, rerun or dispatch a workflow, install a controller, manipulate a runner group, or alter a GitHub `runs-on` declaration. The Control Room retains Work Session Authority; GitHub retains Repository Event and job assignment Authority; Homer owns its Observations and Projections. A RunnerFleet desired state is not a GitHub status. Clef suggestions never establish policy eligibility.

Cloudflare supplies the service control plane. Native CI workloads execute on GitHub/approved PC/Mac/hosted runners, not inside Cloudflare Workers. No machine-specific inventory is compiled into the service.

## Domain vocabulary

The following are specification-local objects, not substitutes for `CONTEXT.md` terms:
- **Job Attempt**: one independently identifiable GitHub workflow job execution, scoped by repository numeric ID, workflow run ID, run attempt number and job ID. A rerun cannot replace another attempt.
- **Measurement Sample**: bounded, immutable parsed timing evidence plus `Provenance` from a verified GitHub Job Attempt. A computed duration is a `Projection`, not a new Source System fact.
- **Candidate**: a reviewed runner class or machine that is being considered, not a claim of eligible or available hardware.
- **Exclusion**: one explicit fail-closed policy reason, including unknown inputs. A Candidate must pass all hard gates before performance comparison.

## Evidence and contract v0.1.0

The Collector must validate each delivery's GitHub signature before mapping fields. Enrichment uses a read-only GitHub App Actions permission against a reviewed Repository mapping. Persist original receipt / delivery identity and API evidence link. Do not accept unsigned content or controller-supplied job identity as GitHub evidence. Limit webhook size, recursion/depth, page count, retries and concurrent requests; fail visibly on source exhaustion.

A Measurement Sample for later implementation has these exact conceptual fields:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `version` | literal `1` | yes | Measurement schema revision |
| `repositoryId`, `workflowRunId`, `jobId`, `runAttempt` | positive safe integers | yes | Stable scoped GitHub attempt identity |
| `workflowId` | positive safe integer or null | yes | Unknown remains null |
| `jobName` | bounded string | yes | Display only, never policy authorization |
| `headSha` | 40-hex SHA or null | yes | No fabricated revision |
| `runnerId`, `runnerGroupId` | positive safe integer or null | yes | Unknown assignment distinct from local alias |
| `status` | `queued`, `in_progress`, `completed`, `unknown` | yes | Validated GitHub source status |
| `conclusion` | allowlisted string or null | yes | Unknown and canceled are not successful samples |
| `createdAt`, `startedAt`, `completedAt` | UTC instant or null | yes | Provider timestamps, no synthetic fallback |
| `evidenceUrl` | allowlisted GitHub HTTPS URL | yes | Link to exact job or workflow attempt |
| `collectedAt` | UTC instant | yes | Collection time, not time of the job |
| `provenance` | trusted source id/version, delivery id, source URL | yes | `CONTEXT.md` Provenance; source object IDs preserved |

Authored source fields and `Provenance` need strict validation and bounded lengths. When GitHub omits a timestamp, store null and do not substitute receipt time. `createdAt` to `startedAt` represents **job creation-to-start elapsed time**, not a guaranteed time spent in the runnable queue. Label it `creation-to-start proxy` unless separately validated instrumentation proves queue admission. Never substitute `workflow_run.created_at` for job creation. Compute execution only from valid `startedAt` and `completedAt`; compute end-to-end only from valid job `createdAt` and `completedAt`. Negative, reversed, future-inconsistent or invalid instants produce null duration and a documented warning, not a clamped zero. Avoid double counting retry attempts.

A source update with the same attempt identity and same content is Duplicate; changed evidence is not overwritten silently. Reconcile late and out-of-order workflow_job transitions with GitHub API reads, retain all original receipts, and append Corrections when appropriate. Do not regress completed -> queued because of delivery order. Failures in enrichment must not erase valid older evidence. Allow pagination and a bounded backfill cursor, with explicit source freshness/stale warnings.

## Measurement semantics

- `creationToStartMs`: `startedAt-createdAt` only when both are valid, nonnegative and from the same Job Attempt. This is a **proxy**, not proven queue delay.
- `executionMs`: `completedAt-startedAt`, when valid.
- `endToEndMs`: `completedAt-createdAt`, when valid.
- `stageTimingMs`: populated only from explicitly instrumented workflow steps with named phase identity, source URL and measurement time. Do not guess cache/build/test phases from free-form step names.
- `cacheMode`: `cold`, `warm`, or `unknown`, solely from a reviewed benchmark setup or specific cache instrumentation. Never infer cache hits from elapsed time.
- `outcome`: success/failure/cancelled/timed-out/neutral action based on GitHub conclusion. Failed and canceled attempts count toward reliability, not successful execution-time percentiles.

Statistics group by repository ID, reviewed workflow family, OS/architecture, runner ID or class, image/toolchain revision, and cache mode. Do not pool different workflow revisions, platform-specific build toolchains, or unknown cache modes into a claimed apples-to-apples comparison. A summary reports sample window, successful timing count, distinct attempts, failed/cancelled counts, missing measurement count, p50 and p95, source freshness, collection time and source links. Deterministic percentile algorithm: nearest-rank after sorting nonnegative finite durations, with rank `ceil(p*n)` and 1-indexed clamp. Define thresholds as reviewed policy parameters, not invisible constants. Initial reporting defaults are p50 with at least 20 comparable successful attempts and p95 with at least 100; otherwise output `insufficient_samples`. These are product reporting minimums, not confidence guarantees. Independently show raw counts even when an aggregate is suppressed. Never infer savings or causal impact from correlated before/after samples.

## Advisory Candidate evaluation

Advisory selection is **specified for later work**, not enabled by measurement collection. Candidate eligibility must require:
1. Valid, reviewed repository/workflow and GitHub runner-group authorization beyond labels.
2. Verified trust class, isolation guarantee and no untrusted PR execution on a persistent personal machine.
3. Compatible OS/architecture/toolchain/resources, with no required facts missing.
4. Current GitHub runner mapping plus controller binding, revision and Source Freshness; do not equate host-reported state with GitHub independent state.
5. Fresh listener/admission observations, safe concurrency/capacity and no drain/disconnect in progress.
6. Comparable benchmark samples meeting reviewed minimum counts and approved budget.

Every candidate gets `eligible`, `excluded` with reason codes, or `unknown`; only proven eligible candidates may be ordered by a deterministic documented objective. Unknown/expired data abstains. Stable tie-breakers may use reviewed numeric runner identity; never infer a winner from a display alias or vendor claim. No Candidate grants permission for an external paid service.

## Workflows

1. **Observe**: an approved GitHub webhook arrives, signature is checked, Repository mapping is validated, and a bounded Collector emits an Activity Event with required Provenance. Duplicates preserve original receipts, conflicting revisions do not silently overwrite.
2. **Enrich**: use Actions read-only API for job attempt and workflow actor/rerun identities. Preserve original event evidence if enrichment fails, mark it pending and retry within a bounded budget. Read job details for per-attempt timestamps, runner ID and status; leave absent fields Unknown.
3. **Project**: compute timings from valid source fields without mutation. Reconcile late arrivals, separate reruns and concurrently running jobs, and emit explicit warnings for invalid order or missing evidence.
4. **Compare**: group only comparable successful attempts, compute counts and eligible percentiles, separate cold/warm caches and failures. Show insufficient results instead of invented rankings.
5. **Inspect**: authenticated operator opens Performance details, selects repository, workflow, runner, attempt window and cache mode; sees source-linked durations, missing data, Source Freshness and reviewer-facing notes. No action in this view changes runner registration or workload assignment.
6. **Review Candidate** (future, not implemented): deterministic security and capacity gates produce eligibility/exclusion explanations; an operator may review but cannot dispatch from a recommendation.
7. **Recover**: GitHub API outages and stale deliveries leave existing receipts intact, show stale/unknown and allow bounded authorized reconciliation. Replaying a webhook must not duplicate a Measurement Sample.
8. **Qualify**: run identical pinned trusted workflow revisions with warm/cold cache on isolated approved systems, capture raw GitHub evidence and compare with no absolute performance claim.

## Security and abuse cases

- A forged webhook must be refused before any trusted Measurement Sample exists.
- Mixed/replayed delivery IDs, stale API responses, out-of-order transitions and differing JSON payloads cannot erase earlier evidence.
- Untrusted workflow text, job labels and action steps are **data only**, never a shell command, identity assertion, authorization input or prompt instruction.
- No raw logs, secrets, API tokens, personal filesystem paths, process arguments or One Mind content in metrics.
- HTTPS allowlisted provider links only. Do not trust client-provided URLs for fetching internal network resources. Never include credentials in a URL.
- No unbounded log/trace collection. Specify retention, time-series storage cost, purge policy and approval before long-term resource telemetry.
- Read-only APIs require reviewed Scope; administrative revisions never mix stale and fresh snapshots.
- No automatic rerun, cancellation, GitHub workflow edit, runner registration, temporary public endpoint or outbound control beyond accepted controller protocol.

## Test and acceptance matrix

| Test family | Required cases |
| --- | --- |
| Input validation | Valid/null timestamps, impossible dates, unsafe integers, invalid SHA, unknown fields, wrong source URL, oversized fields and unexpected enum |
| Measurement | All three durations, missing timestamps, negative ordering, canceled or failed run, failed enrichment, duplicate and repeated attempt |
| Projection | Cold/warm separation, no cross-OS or workflow-version pooling, deterministic percentile with ties, n=0/19/20/99/100 thresholds, p95 suppression, no mutation of caller-owned samples |
| Collector | Verified GitHub signature, distinct run attempts, duplicate delivery receipts, late completed then queued, conflicting revision, read-only enrichment pagination and 429/outage recovery |
| Security | Untrusted fork exclusion; unauthorized runner-group scope; stale binding, busy/draining/unknown state, quota failure, revision mismatch, no arbitrary code execution |
| UI | Insufficient samples, Source Freshness warnings, stale data expiry, keyboard and screen reader labels, mobile layout, immutable evidence links and UTC/PT boundary |
| Real qualification | Testable cold/warm benchmark fixtures, pinned revisions and source URLs; no assertion of live PC/Mac control without host receipts |

Pure Projection measurement utilities may be added before a live Collector exists, with synthetic fixtures clearly identified and independently checked in CI. No fixture becomes a production performance sample.

## Execution plan and dependencies

- **Slice A, contract and tests**: typed v1 Measurement Sample contract, pure derivation and percentile Projection, deterministic fixtures, no network. Prerequisite: this spec.
- **Slice B, read-only Collector**: signed workflow_job ingress and read-only API enrichment through existing GitHub integrations, bounded retries and source freshness; depends on ZER-36 attribution work and accepted ledger event types.
- **Slice C, Performance UI**: read-only source-linked runner details, warning states and accessibility checks; depends on Slice B plus fleet cards in PRs #35/#38/#39.
- **Slice D, advisory Candidate policy**: deterministic gate fixtures and explainable matrix, **no actuation**; depends on audited isolation and verified machine/workflow scope.
- **Slice E, optional controlled scheduling**: separate future intent, explicit human approval, workflow-selection mechanism, security review, independent qualification and budget authorization. Not authorized by this spec.

The current stacked integration chain is #35 -> #38 -> #39 -> #44. Each step must preserve source Authority and independent Verdict/reproduce merge gates. Do not announce live runner readiness from synthetic acceptance.

## Primary references

- [GitHub workflow job webhook](https://docs.github.com/en/webhooks/webhook-events-and-payloads#workflow_job).
- [GitHub REST API workflow jobs](https://docs.github.com/en/rest/actions/workflow-jobs).
- [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use).
- [CIRunners.org methodology](https://cirunners.org/methodology/): capability finder; no independent performance benchmarks as of November 22, 2026.
