# ADR 004: Clef classification on Cloudflare

Status: proposed integration design, based on Daniel's November 22, 2026 PT request.
No model binding, paid inference, production deployment or automatic actuation enabled.

## Decision

Use Workers AI Clef through an isolated provider adapter for bounded classification
of admitted evidence. Clef does not host Homer or replace its controller state machine.
Cloudflare Worker APIs and durable storage coordinate; local PC/Mac adapters execute
host operations. Raw evidence remains authoritative and independently available.

Initial uses: classify failure category, suggest a work category, and rank operator
attention items. Suggested actions may select from a reviewed finite set of runbooks.
Never use inference to establish who did work, authorize a principal, resolve a
repository mapping, decide whether a job is idle, rotate keys, delete data, schedule
an archive deadline, or start/stop runners. Those remain deterministic contracts.

## Workflows

1. After an Activity Event is durably admitted, create an asynchronous classification
   request referring to its receipt. Evidence ingestion must succeed during AI outage.
2. Build bounded sanitized state with source references and a versioned typed question
   schema. Treat source text as data, never executable instructions. Exclude credentials,
   One Mind content, raw private logs, personal paths and unnecessary identity fields.
3. Call the Worker AI binding with the configured allowlisted model. Validate returned
   question IDs, options, finite probabilities and schema. Abstain on missing evidence,
   timeout, malformed output or failure to meet evaluation-derived thresholds.
4. Persist an immutable inference record, model ID, schema/policy version, input digest,
   original evidence receipts, probability vector, selected option/abstention, timestamps,
   latency and token usage. Keep attempts distinct; retries cannot replace prior claims.
5. UI shows Suggested classification with evidence links, model/version and operator
   accept/correct controls. Corrections append records; they never rewrite source history.
   Numeric model probabilities are not presented as calibrated certainty.

## Runtime boundary and evaluation

Keep adapter disabled by default. Use a bounded queue with retry budget and terminal
failure visibility when enabling asynchronous collection. Deduplicate by evidence
receipt digest plus model and question-schema/policy versions. Separate model failure
from source failure. Impose input, concurrency and cost budgets; never silently truncate
critical evidence. Downstream APIs continue to work without classification.

Start in shadow mode with operator-labelled cases and a held-out evaluation. Compare
Clef and Clef-flash on per-class precision/recall, abstention, calibration, latency and
cost. Include ambiguous failures, missing data, injected instructions and model outage.
Set class-specific gates from measured error costs before promoting any suggestions.
No automatic action is in the initial release. An independent deterministic authorization
and precondition gate is required for any separately approved future action policy.

## Trace linkage

Each inference has a trace ID and references its source receipts. Record sanitized
provider request metadata and output as an inference span when the approved Langfuse
pipeline is connected. Link to the existing private Cloudflare archive plan. Archival
and retention enforcement cannot depend on Clef availability or classifications.
Do not claim Langfuse or R2 integration is active from this ADR alone.

## Implementation sequence

1. Typed question/output contract, injectable provider adapter, deterministic parser,
   abstention behavior and local tests with fixtures.
2. Offline labelled evaluation and operator review of thresholds.
3. Staging-only binding and shadow collection with verified cost limits and sanitized
   telemetry. Requires actual configured binding and deploy evidence.
4. UI suggestions and appended operator corrections after evaluation passes.

Primary source reviewed November 22, 2026 PT:
<https://developers.cloudflare.com/workers-ai/models/clef/>
The documented model is @cf/cloudflare/clef, invoked through env.AI.run with model,
state and typed questions. Returns answers and usage. Question types include noul,
choice and score. Check the current provider contract before implementation.
