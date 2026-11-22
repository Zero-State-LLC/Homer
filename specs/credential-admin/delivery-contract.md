# Homer admin delivery contract

Status: Task breakdown and testing boundaries accepted by Daniel on November 21, 2026 PT.
Tasks published to Linear; implementation and release evidence remain separate.

## Scope and authority

Daniel requested end-to-end continuation of the admin design using the repository's
engineering workflow. The existing intent and specification define the product;
this document makes the delivery boundaries reviewable before writing tests.
FORGE remains the Authority for the plan. This is a proposed execution breakdown,
not a FORGE-produced plan or Verdict. No FORGE plan for this stream was found.

References:

- [Intent](../../docs/intent/credential-administration.md)
- [Credential specification and Workflows](spec.md)
- [Operator and developer experience](operator-experience.md)
- [Task workflow](../../docs/agents/issue-tracker.md)
- [Glossary](../../CONTEXT.md): Actor, Identity Binding, Project, Task,
  Source Freshness, Event Ledger and Release Gate

Repository baseline: main b6849a9; design branch d536231. The Context Pin remains
7d4c26c. Team HANDOFF and STATUS were read but contain no current Homer admin plan.
The current agent-context DECISIONS entry dated November 21 permits direct Linear
Task publication and parallel implementers for Homer; it does not waive merge gates.
The external engineering workflow was inspected at abeeaf95660ba9e8b7c753eb38f441ca707a8823.
No skill files are copied into Homer.

## Confirmed testing boundaries

Prefer the highest existing public interface. Avoid tests of private helper shape
and assertions that merely reproduce the implementation.

| Boundary | What it proves | What it does not prove |
| --- | --- | --- |
| Authenticated Worker HTTP requests and operation readback | Server authorization, scope, CAS, idempotency, persistence across restart, honest outcomes | Real identity-provider configuration or provider propagation |
| Browser journeys against a local Worker with synthetic identities | Forms, navigation, keyboard/focus, mobile layout, conflict recovery, secret-field disposal and browser persistence exclusions | Real Access policy, complete assistive-technology usability or production service health |
| Controlled staging journey through the broker, real backend and actual consumer | Candidate storage, propagation, consumer success, old credential rejection and recovery evidence | Every provider or production configuration |

The first boundary extends the existing catalog Worker request tests. The browser
boundary must exercise the real routes, not mocked HTML response snapshots. Durable
operation recovery is observed through API readback after restart, not private
database assertions. Provider failure injection belongs at the external adapter
boundary; successful fixture tests never stand in for live backend evidence.

Use bounded synthetic secret canaries to inspect observable responses, error output,
telemetry exports and browser persistence. Report unobservable channels as gaps.
Do not claim that a zero-match canary scan proves absence from every external log.

## Approved vertical Tasks

Each Task delivers a usable path through data, authorization, HTTP, UI and tests.
Tasks are published to team ZER, Project Homer, with native blocked-by relations.
No dates or assignees are inferred. Only sufficiently specified work receives
ready-for-agent; external-input Tasks use needs-info.

| Slice | Linear Task |
| --- | --- |
| 1 | [ZER-25](https://linear.app/zer0state/issue/ZER-25) |
| 2 | [ZER-26](https://linear.app/zer0state/issue/ZER-26) |
| 3 | [ZER-27](https://linear.app/zer0state/issue/ZER-27) |
| 4 | [ZER-28](https://linear.app/zer0state/issue/ZER-28) |
| 5 | [ZER-29](https://linear.app/zer0state/issue/ZER-29) |
| 6 | [ZER-30](https://linear.app/zer0state/issue/ZER-30) |
| 7 | [ZER-31](https://linear.app/zer0state/issue/ZER-31) |

### 1. Inspect and safely edit Repository admission

Blocked by: none.

Deliver authenticated admin navigation, real catalog-backed Overview and field-based
Repository mapping review and save. Preserve existing routes and CAS protections.

- An operator sees observed catalog revision, Project mapping and enabled state.
- Configuration is not presented as proof of collection health.
- Form changes produce an explicit added/changed/removed review.
- Conflict and uncertain response preserve the non-secret draft and require fresh
  readback before another mutation; no automatic overwrite or write retry.
- Unavailable modules state their capability honestly, with no fixture health.
- Browser and HTTP journeys exercise success, forbidden access and concurrency.

### 2. Inspect scoped Credentials and developer setup

Blocked by: 1.

Deliver metadata inventory, ownership-aware detail and My setup with server-enforced
capabilities. New credential permissions default to deny.

- Cross-owner, Project and environment enumeration is refused, including search.
- Identity Binding is required for ownership; display names grant no access.
- Local-only references cannot be used to fetch another developer's secret.
- A missing connection, denied inventory and unavailable source are distinct states.
- Consumers and unknown discovery scope are visible before proposed changes.

### 3. Add and validate a candidate with recoverable submission

Blocked by: 2 and an explicit supported backend/validation adapter contract.

Deliver write-only submission through the dedicated broker and durable operation
readback. Start against a controlled synthetic provider, then qualify the selected
real backend separately. The catalog Worker never gains secret-management access.

- A bounded candidate body reaches only the broker and approved secret backend.
- Submission returns a sanitized operation reference, never the stored value.
- Lost responses, restart and repeated idempotency keys reconcile one operation.
- Provider validation uses a fixed endpoint; redirects and arbitrary targets fail.
- Failed validation leaves the previous active version and consumers unchanged.
- No credential form replay, request-body capture or browser draft persistence.

### 4. Rotate a credential across actual consumers

Blocked by: 3 and the chosen provider's overlap, propagation and revocation contract.

Deliver review, candidate validation, per-consumer cutover, functional verification,
old-version revocation and a durable completion receipt.

- Concurrent rotations cannot both acquire the active operation lease.
- Partial cutover stays partial and never triggers premature revocation.
- A stale review cannot activate after the revision or scope changes.
- Reopening the operation shows durable progress without repeating completed writes.
- Revocation failure remains pending; deleting the backend copy is not revocation.
- A controlled staging run proves old-credential rejection by the actual provider.

### 5. Inspect trace coverage and prove restore evidence

Blocked by: 1 and the required archive contracts in PR #30.

Deliver archive health and restore-operation views backed by actual archive receipts.
This Task consumes archive behavior rather than duplicating it in the admin service.

- Integrity, Source Freshness, content coverage, source coverage and restore evidence
  appear separately; unknown source retention produces no invented countdown.
- Failed batches link to sanitized evidence and a bounded next action.
- Authorized restore drills have durable status and remain inspectable after reload.
- A source-disconnected restore verifies the archived content through the supported
  public recovery interface, without rewriting the Event Ledger.
- Expiry risk requires actual source policy and reconciliation evidence.

### 6. Offboard a developer and recover interrupted access changes

Blocked by: 4.

Deliver impact review, delegated-consumer removal and provider revocation tracking.

- Personal credentials are never transferred to another Actor.
- Shared responsibilities require explicit reassignment to an eligible owner.
- Unsupported or failed provider revocations remain visible and actionable.
- Emergency revoke explains service interruption and irreversible consequences.
- Recovery instructions remain usable if Homer itself is unavailable.

### 7. Qualify the integrated operator and developer journeys

Blocked by: 1 through 6 and required staging operator inputs below.

Deliver evidence for the integrated branch, separate Standards and Spec reviews,
security review, migration/recovery runbook and a review-ready pull request.

- Run the repository checks without weakened assertions or silent skips.
- Record red-before-green evidence at the confirmed boundaries for each Task.
- Exercise desktop/mobile, keyboard, stale data, denied access and interrupted writes.
- Demonstrate staging rotation and archive restore; list any incomplete live checks.
- Attach independent software-factory Verdict and reproduce result for the exact
  head when available. Author-side review is not a Verdict.
- Tasks close only after merge. Production activation remains a separate release.

## Execution order

After boundary and breakdown confirmation, publish the fully specified frontier
to Linear and record native blockers. Tasks 3, 4 and 7 must not be advertised as
ready while their external contract or operator inputs remain unresolved.

Use one integration branch, isolated implementer worktrees, and one vertical
red/green cycle at a time. Merge completed work into the integration branch, then
run independent Standards and Spec reviews. Keep PR #30 as a separate archive
stream. Do not close Tasks just because an implementation branch passes tests.

## Staging operator inputs, required before live writes

These do not block repository implementation of Tasks 1 and 2:

- Named credential operators and Identity Bindings for the first developer users.
- Chosen first provider and credential class, supported backend, exact consumer
  scope and least-privilege provider validation/revocation contract.
- Explicitly enrolled staging test credential and authenticated secure submission
  path. No secret values through chat, ordinary agent tool arguments or Git.
- Provider-specific overlap budget and recovery owner; unknown is not a default.
- Actual Langfuse Project access, retention and export entitlement for live archive
  qualification. Existing private buckets do not answer these questions.

No production credential migration, Access policy change or deployment is implied
by agreeing this Task breakdown. There is no claimed live completion yet.
