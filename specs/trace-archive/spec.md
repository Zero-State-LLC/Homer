# Homer developer traces and Cloudflare archive

Version: 0.1 proposed specification | Date: November 21, 2026 PT
Owner: Daniel, approval owner; implementation and operations owners to be assigned.
Scope: Zero-State-LLC/Homer. This document authorizes no deployment, credentials, retention changes, or production changes. Resource names below are proposals, not provisioned resources.

## 1. Intent and evidence

Daniel requested Langfuse integration, reusable developer traces, and secure Cloudflare archival before source expiration. This specification develops that accepted direction into a reviewable implementation contract. It is not evidence that any infrastructure exists.

Baseline reviewed: Homer main b6849a9c44d85bd2c31349d2bf69fd358c4214c1. Runtime source and package manifests inspected in the preceding review have no Langfuse collector or OpenTelemetry instrumentation. The Activity Event v1 contract has four source systems and no trace lifecycle kinds. Work Sessions, Identity Bindings, evidence links and append-only Event Ledger receipts are existing domain concepts. Trail-code is navigation tooling, not a trace archive.

Repository authority: AGENTS.md, CONTEXT.md, specs/integration-contracts/activity-event.v1.schema.json, docs/intent/agent-workflow.md. Pinned agent-context HANDOFF.md, STATUS.md and DECISIONS.md were read at 7d4c26c2f9ddf15daf5890de9674e5ba00ac9d9b; they do not establish a Langfuse architecture. The intent template at that pin informs this section. No active Langfuse decision was found in the queried One Mind Memory or Decisions. Actual Langfuse account, plan, region, project retention and Cloudflare resources remain unverified.

Observable outcome: an authorized developer's real agent session is linked to its Task, repository and Work Session; sanitized execution evidence can be opened in Langfuse, exported to private R2, verified and restored after the Langfuse copy expires; Homer preserves its original Event Ledger receipts.

Non-goals: employee surveillance, recording unrelated desktop activity, hidden chain-of-thought, automatic model training, copying One Mind into Homer, changing existing repository mappings, or replacing Linear/GitHub/Control Room/software-factory ownership.

## 2. Invariants

1. Homer observes and projects. Control Room owns Work Sessions; Linear owns Tasks; GitHub owns Repository Events; software-factory owns Work Packets and Verdicts.
2. Agent and accountable human are distinct. Attribute only through reviewed Identity Bindings. Otherwise retain Unattributed.
3. Never place prompts, tool output, credentials, signed download URLs, or One Mind content in the Event Ledger or public Projections.
4. Redact before transmitting off the developer machine. Apply a second schema/privacy check before long-term archive promotion.
5. A successful upload, manifest appearance, or HTTP 200 is not a verified archive. Verification requires content readback, inventory reconciliation and a durable receipt.
6. Source deletion must not be enabled or shortened by this system until existing accessible history is reconciled and recovery tests pass. Already-active upstream deletion cannot be assumed to stop for Homer.
7. Append new receipts and Corrections. Never overwrite ledger history. Preserve original Event Key, sequence and entryDigest on duplicate delivery.
8. Stage and production use separate resources, secrets and authorization. No public R2 access.

## 3. Capture depth and domain model

Capture all instrumented session boundaries and structured spans during the pilot; disclose gaps and truncation. One trace per agent turn or bounded job; multiple traces share the canonical Work Session ID as sessionId. Unbound sessions retain their source session ID until an explicit binding exists. Do not invent a Control Room Work Session.

| Entity | Required data |
|---|---|
| Session binding | source session ID, canonical Work Session when known, actor binding revision, accountable human when bound, environment, project and repository identity |
| Trace | source project/trace ID, Task/Work Packet references when known, agent/harness version, branch and commit observed at execution, start/end/outcome |
| Observation | stable observation/span and parent IDs, type, timestamp, latency, status, retry relationship, model/provider when observed, measured usage and cost basis |
| Context provenance | observable prompt/skill/configuration versions and digests; mark unavailable context explicitly |
| Content | sanitized prompts/responses and bounded tool arguments/results for approved workspaces only; redaction policy, truncation count and original size metadata |
| Outcome evidence | test/CI/review/PR/Verdict references, not fabricated success assertions |
| Archive batch | source manifest identity/digest, export window, files and checksums, schema version, row counts, policy revision, verification time and coverage |

Proposed limits: 64 KiB per text field, 1 MiB per observation, 10 MiB per local batch. Oversized content is truncated with explicit markers or split into approved attachments. These are configurable design defaults, not provider limits. Disable media capture in phase 1; if references appear, mark mediaExcluded and do not claim complete media preservation.

Never infer full agent context from hooks. Coverage has separate dimensions: instrumentation coverage, content coverage, source export coverage and archive integrity. A complete export can still represent a partially instrumented session.

## 4. Architecture and Cloudflare resources

Phase 1 uses supported local adapters to Langfuse plus scheduled exports and reconciliation. Phase 2 adds an archive-first intake for adapters whose endpoint/authentication/protocol can be verified. No assumption that every native adapter can use an arbitrary OTLP gateway.

| Proposed resource per environment | Responsibility |
|---|---|
| homer-traces-landing-staging / -production, R2 | Langfuse export destination. Private, mutable, no bucket lock. Dedicated bucket per external export trust boundary. |
| homer-traces-archive-staging / -production, R2 | Verified content-addressed bundles and manifests. Langfuse receives no credentials for this bucket. |
| homer-trace-archive-staging / -production, Worker | Manifest discovery, authorization, verification dispatch, reconciliation and read API |
| homer-trace-archive-jobs plus dead-letter queue | At-least-once work dispatch, bounded retries and failure retention |
| homer-trace-archive-index, D1 | Mutable job state, cursors, unique batch identities, authorization references and receipt pointers. Rebuildable from archive manifests. |
| Cron schedules | Five-minute manifest discovery and health check; nightly inventory reconciliation |
| Existing Event Ledger integration | Append compact verified archive and failure/Correction evidence through versioned contracts |

Use R2 bindings inside Workers. The Langfuse exporter uses a dedicated S3 credential scoped to its landing bucket. Do not claim a key prefix is an IAM boundary: bucket scoping is the documented baseline. Separate buckets where principals must not see each other's exports.

Private access: r2.dev disabled, no public custom domain, no public ACL equivalent. Retrieval goes through an authenticated Worker, existing Access mechanisms and project authorization. Validate identity and authorization on every object request; deny listing arbitrary keys. Stream authorized data, record an access audit event, and send Cache-Control: private, no-store. Stable evidence URLs point to this service, not public objects or expiring bearer links.

Use TLS and R2 managed encryption at rest. Application-layer encryption is optional future scope if the trust model requires separation from Cloudflare administrators; it needs key rotation/recovery design before adoption. Credentials stay in managed secrets, never in repo/chat/logs. Separate provisioner, exporter, verifier, reader and retention-manager privileges. R2 binding access is broad within its bucket, so split Workers and buckets to reduce blast radius; code-only write restrictions are not IAM enforcement.

## Workflows

Implementation follows docs/intent/trace-archive.md. Existing CI checks remain unchanged.

### 5. Export and verification workflow

Configure a supported Langfuse blob export to R2's S3-compatible endpoint. Proposed schedule: every 20 minutes. Choose full accessible history initially. Confirm plan entitlement and R2 compatibility before rollout. If native export is unavailable, use a separately tested paginated API Collector with explicit rate limits, fields, cursors and late-update reconciliation; do not call an incomplete fallback equivalent.

Langfuse documents manifests written after export files finish. Failed runs can overwrite the same landing keys. Therefore never lock the landing bucket, and never promote files from directory listing alone.

1. Discover a manifest; deduplicate by environment + source project + manifest key + manifest SHA-256.
2. Snapshot the manifest. Fetch exactly the listed object keys with bounded streaming and decompression limits. Prevent traversal or access outside the registered landing bucket/prefix. Do not infer names from timestamps.
3. Validate schema, required columns, content type, compressed/uncompressed size, row counts and source identity. Calculate SHA-256 over exact stored bytes. Do not treat multipart ETags as content hashes. For Parquet, inspect metadata for row count. Keep parser compatible with additive manifest fields; quarantine unknown required structures.
4. Reject schema/privacy violations. Preserve only safe diagnostic metadata if a secret is detected; restrict and purge offending landing content through the incident procedure. Do not copy it into locked storage.
5. Copy verified files under archive/v1/<environment>/<opaque-source-project>/<batch-digest>/objects/<sha256>.<format>. Keys contain no developer names, prompt text or credentials. Archive manifest stores source window, schemas, identities, exclusions and all byte/row counts.
6. Read back every promoted object and verify its digest. If an identical immutable object already exists, verify and reuse it. If bytes differ, fail rather than overwrite.
7. Write a completed archive manifest last. Append the compact Activity Event with a deterministic Event Key and obtain its original ledger receipt. Crash after manifest write but before append is recoverable; crash after append but before D1 update reuses the original receipt.
8. Record verified state in D1. Only this state advances the contiguous export watermark. Empty windows require source evidence, not absence of files.
9. Reconcile the source inventory independently, including observation/score IDs, versions and count/digest summaries where available. Counts alone do not prove completeness. Preserve repeated IDs with changed content as separate revisions; deduplicate boundary overlap only when identity and revision/content match.

R2 object events may accelerate discovery but Cron reconciliation remains authoritative. Jobs retry with exponential backoff, jitter, bounded attempts and a dead-letter record. Monitor the dead-letter queue independently. Use small batches/streaming; benchmark Worker memory/CPU limits with realistic Parquet files. If decoding cannot fit, use JSONL or an authorized bounded batch runtime rather than silently skipping validation.

## 6. Expiration safety and retention

Proposed defaults, pending actual source configuration readback:

| Store | Proposed policy |
|---|---|
| Langfuse | 30-day operational window if supported and approved; keep existing policy unchanged until migration acceptance |
| Landing | Delete only verified exports after a 7-day recovery grace; no blind age-based lifecycle in phase 1 |
| Verified sanitized trace archive | 365 days from original event time; daily purge worker honors exceptions and audit receipts |
| Curated evaluation/training candidates | Separate approved dataset location and retention decision; never automatic promotion |
| Content-free archive and Event Ledger receipts | Durable according to existing ledger policy |

Do not confuse Langfuse access limits with deletion retention. Read the actual project setting and plan. Expiry is entity-specific: traces use timestamp, observations start_time, scores timestamp, media created_at. Delayed ingestion of an old event can have almost no remaining time. The archive deadline uses the earliest relevant entity expiry, not ingestion or export time.

Targets: normal verified export lag under 2 hours; recovery target under 24 hours; each known entity archived at least 7 days before source expiry where source age permits. Sweep nearing-expiry data hourly. Immediate rescue lane for late-arriving old entities. Nightly reconcile the full retained source window, not only the last 24 hours. Track late scores and revised observations independently of original trace timestamps.

Alerts: warning when lag exceeds 2 hours; incident when it exceeds 24 hours or any uncovered data has under 7 days remaining; urgent escalation below 72 hours. Report oldest uncovered entity, contiguous watermark, gap intervals, estimated expiry, last verified restore and exact blocker. Deliver through an explicitly configured operational channel; no outbound channel is assumed authorized by this spec.

Critical limitation: Homer cannot interlock Langfuse's independent deletion job merely by checking a receipt. On danger, attempt supported backfill/rescue, and request the authorized operator to extend or disable deletion if necessary. Do not silently change retention, and do not claim zero loss. If source data expires before capture, append a permanent loss record with the known gap. Where inventory is unavailable, label coverage UNKNOWN rather than VERIFIED.

For stronger guarantees, phase 2 durably writes a sanitized intake envelope to private R2 before acknowledging it, then asynchronously forwards it to Langfuse. Local encrypted bounded spooling handles offline machines; stable IDs make retry safe. This protects accepted intake from Langfuse expiry, but later scores/enrichments still need source export. State the guarantee precisely: accepted sanitized envelopes survive downstream outage; uninstrumented or never-uploaded work is not covered.

## 7. Immutability, deletion and recovery

Archive object names are immutable by application convention and conditional writes. Optional R2 bucket locks apply only after privacy checks and an explicit retention decision. Do not lock all content indefinitely. Default proposal: content remains deletable for incident response; lock only content-free verification manifests if approved. R2 administrators can alter lock configuration, so this is not an absolute guarantee against a privileged account compromise.

R2 locks take precedence over lifecycle deletion and prevent overwrites. If a content lock is later chosen, reconcile it with erasure policy before activation. Retention purge jobs remove expired content, derivatives and indexes, append tombstone evidence, and preserve non-sensitive ledger receipts. Backfills do not reset content age. Approved holds require owner, reason, scope and review date.

Restore: authorized operator selects project/time/session; service verifies archive digests, reconstructs traces with parent relationships, and exports a portable sanitized bundle. Reimport to Langfuse is optional and requires an independently validated importer; do not assume native round-trip support. Demonstrate a standalone viewer/query path after source deletion. Test weekly sample restores and a quarterly broader inventory restore. Rebuild D1 from completed manifests in a staging exercise.

## 8. Contracts and state transitions

Proposed contracts: trace-envelope.v1, archive-manifest.v1, trace-summary.v1 and a versioned Activity Event extension. Select the collector source namespace explicitly in the implementation intent; do not disguise trace archive events as GitHub merges. Retain v1 validation/replay support and add new schema fixtures. Proposed kinds: trace.archive_verified, trace.archive_gap, trace.summary_revised. Names are proposals pending contract review.

Archive receipt data: schemaVersion, sourceProjectRef, batchDigest, sourceManifestDigest, exportWindow, sourceRevision, objectCount, rowCounts, contentCoverage, verificationPolicyVersion, verifiedAt and stable authorized evidence URL. R2 physical keys live in the restricted index/manifest. Event Key derives from registered source namespace + batch identity + revision, never collection time.

Batch states: DISCOVERED -> VERIFYING -> VERIFIED_OBJECTS -> RECEIPTED. Failure branches: RETRYABLE, QUARANTINED, EXPIRED_WITH_GAP. Receipt append is retried independently from object verification. A separate coverage state is UNKNOWN, PARTIAL, RECONCILED or GAP; batch integrity does not imply complete source coverage.

Proposed authenticated read operations: list session trace summaries; inspect archive health by project; fetch an authorized archive bundle; inspect a gap and remediation status. No unauthenticated content endpoint, arbitrary R2 key proxy, or direct browser-held storage credentials.

## 9. User journeys and operator surface

Developer: opt into approved repository instrumentation, see capture policy and exclusions, work normally, and see session coverage plus links from Task/PR context. A disabled adapter is visible as uninstrumented, never interpreted as no work.

Reviewer: open a Work Session, see outcome/test/PR evidence, cost basis and trace coverage, then open permitted detailed execution. Distinguish reported success from independently verified Verdicts.

Operator: view last export, last verified batch, source expiration policy, archive lag, missing windows, queue failures and next action. A green card requires reconciliation and restore health, not just recent HTTP success.

Researcher: request a scoped sanitized bundle; inspect provenance, limitations and outcomes; nominate specific trajectories for dataset review. Never expose One Mind content, auto-label scientific claims as facts, or feed all traces into training.

## 10. Acceptance tests

| Test | Required evidence |
|---|---|
| Real agent task | Actual session with model call, tool call, failure/retry and real outcome; correct identity and project links |
| Secret canaries | Synthetic credentials and private context markers blocked/redacted before export; no leak in logs, ledger or archive |
| Export interruption | Missing manifest yields no promotion; source retry can overwrite landing files without lock conflict |
| Partial/corrupt export | Missing file, wrong digest, invalid row count and malformed schema fail verification |
| Duplicate and crash recovery | Replay at every transition produces one logical ledger append and identical original receipt |
| Window coverage | Empty window, inclusive overlap, pagination, late observation and revised score reconciled correctly |
| Expiry boundary | Backdated events rescued or explicitly marked at risk; source expiry without capture produces a gap |
| Authorization | Cross-project and cross-environment reads denied; exporter cannot access archive bucket; public URLs fail |
| Archive-only restore | Source test copy removed under approved staging test; restore remains usable without Langfuse |
| Retention | Old backfill not granted a fresh year; holds honored; content purge preserves receipts |
| Capacity/outage | Representative large batch stays within runtime budget; outages retry and surface coverage loss |
| Baseline regression | Existing webhook receipts, catalog mappings, Access rules and ledger replay unchanged |

Run repository-required context pin checks and npm run check for implementation, plus the archive integration tests. CI green alone does not establish live export or recovery evidence.

## 11. Implementation sequence and release gates

1. Commit accepted intent and this spec into docs/intent/ and specs/ using the repo workflow. Define schemas, privacy rules, mapping configuration and acceptance fixtures before runtime code.
2. Read actual Langfuse plan/retention/export capabilities and Cloudflare account resource inventory. Set region, operational owner and cost budget. No secret values in the report.
3. Provision staging-only landing/archive buckets, Worker, queues and D1 after deployment/credential authorization. Validate native export into landing and preserve all currently accessible history.
4. Implement verifier, independent reconciliation, immutable receipts, authorized reads, health metrics and restore tooling. Prove failure handling before enabling source expiration changes.
5. Pilot one developer and one supported agent, then Claude Code/Codex and the remaining developer harnesses individually. Keep existing Trail-code hooks intact. Unsupported web-only agents remain explicitly uncovered.
6. Implement archive-first intake only after adapter compatibility and local spool security tests. Expand to all authorized workspaces.
7. Production rollout requires human approval, independent software-factory Verdict, reproduce check, green CI and restore acceptance. Keep production bindings and catalog mappings unchanged until that rollout.

Rollback: disable new instrumentation or forwarding while preserving archive/index/receipts; revert code without deleting stored objects. Do not shorten source retention during rollback. Reconcile buffered work after recovery.

Cost model: monthly sanitized GiB = sessions/day x observations/session x average bytes/observation x days / GiB. Budget separately for landing overlap, annual archive, R2 operations, verification rereads, Worker/Queue/D1 and Langfuse plan. Measure pilot volume before setting a dollar forecast. Avoid early cold-tier transitions until minimum duration/access costs are understood.

Open deployment decisions: Langfuse account/plan/region, source retention readback, Cloudflare resource ownership/region, authorized credential setup, retention approval, lock policy, alert destination and named operator. These do not block review of this specification, but they block claims of a working archive.

## 12. Sources

Repository baseline:

- <https://github.com/Zero-State-LLC/Homer/blob/b6849a9c44d85bd2c31349d2bf69fd358c4214c1/AGENTS.md>
- <https://github.com/Zero-State-LLC/Homer/blob/b6849a9c44d85bd2c31349d2bf69fd358c4214c1/CONTEXT.md>
- <https://github.com/Zero-State-LLC/Homer/blob/b6849a9c44d85bd2c31349d2bf69fd358c4214c1/specs/integration-contracts/activity-event.v1.schema.json>
- <https://github.com/Zero-State-LLC/agent-context/blob/7d4c26c2f9ddf15daf5890de9674e5ba00ac9d9b/templates/intent.md.template>

Official documentation checked November 21, 2026 PT. Capabilities must be verified against the actual deployed version and plan:

- <https://langfuse.com/docs/api-and-data-platform/features/export-to-blob-storage>
- <https://langfuse.com/faq/all/blob-storage-export-timing-and-retries>
- <https://langfuse.com/docs/administration/data-retention>
- <https://langfuse.com/faq/all/data-access-vs-data-retention>
- <https://langfuse.com/resources/engineering/coding-agent-tracing>
- <https://langfuse.com/docs/observability/features/masking>
- <https://developers.cloudflare.com/r2/buckets/bucket-locks/>
- <https://developers.cloudflare.com/r2/reference/data-security/>
- <https://developers.cloudflare.com/r2/api/tokens/>

Evidence labels: repository facts and documented provider behavior are observed; resource names, interfaces, schedules, thresholds and retention periods are proposed design choices. No provisioning, credential creation, catalog update, deployment or archive verification was performed in preparing this document.
