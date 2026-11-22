# Homer credentials administration

Status: draft specification. Requested by Daniel on November 21, 2026 PT.
No live credentials, permissions or provider settings are changed by this proposal.

## Intent

Provide Admin > Credentials for shared stack credentials and developer-owned
integration credentials. Homer manages inventory, authorized submission,
consumer bindings and rotation evidence. Secret values belong in a managed
secret backend. The existing admin UI only edits repository mappings; its
catalog-admin scope must not automatically grant credential administration.

This is a separate change stream from trace archive PR #30. The archive will
consume references from this system after authorization and acceptance.

## Domain and storage

The [operator and developer experience](operator-experience.md) defines the shared
admin navigation, resource views, recovery flows and usability acceptance plan.
The [offline prototype](../../docs/design/admin-prototype.html) illustrates these
flows with synthetic fixtures and no live operations.

A Credential has an opaque ID, provider, purpose, ownership class, owner Actor
binding, Project, environment, permitted consumers, backend reference, revision,
provider expiry when known, rotation policy, and last verified health.
Unknown expiry and unknown last use remain unknown. Do not infer usage from
the last validation call.

Credential Version identifies a stored candidate separately from the active
version. Rotation Operation records transitions, preconditions, consumer
acknowledgements, validation evidence and provider revocation evidence.

Cloudflare Secrets Store is the preferred backend for compatible Workers.
Per-Worker secrets remain an adapter option when required. Check actual account
limits before selecting the backend. Use independent secret names for candidate
and active versions; do not overwrite the active secret during validation.
A shared secret name is not an environment or owner authorization boundary.

Keep values out of D1, KV, R2 archives, catalogs, Git, browser persistence,
One Mind, Event Ledger payloads, analytics and traces. Store metadata and opaque
backend/version references only. Avoid key fragments and value hashes in
inventory; use provider-issued identifiers where available.

The secret broker has narrowly scoped backend management access. The ordinary
catalog Worker has no such access. Broker credentials are bootstrapped outside
Homer and never managed through an endpoint that lets a caller replace its own
authorization authority. Explicitly document administrators who can bind
secrets to new workloads, since a non-readable management API does not prevent
an authorized runtime from reading bound values.

## Ownership and permissions

| Class | Access rule |
| --- | --- |
| Shared service credential | Credential operators manage scoped Project/environment bindings |
| Developer-owned integration | Owner submits and rotates; other developers cannot read or use it |
| Provider-managed/OAuth | Prefer provider authorization and revocation flows; store only required refresh material securely |
| Local-only personal credential | Inventory reference and health only; value stays in the developer's local secret store |
| Emergency administration credential | Separate restricted workflow and out-of-band recovery |

Developers' personal account passwords, recovery codes and unrelated personal
keys are outside scope. Do not silently turn a personal integration into a
shared credential. Granting a consumer access requires an explicit binding
operation and ownership policy. Global account administration may have broader
technical access; the UI must not promise isolation from all infrastructure admins.

Add explicit credential capabilities such as metadata-read, submit-own,
rotate-own, manage-shared, bind-consumer, activate-production and revoke.
Verify them server-side for every object operation. Existing Identity Bindings
determine ownership. No attribution by display name. Human operators use the
existing authenticated Access route with fresh authentication for consequential
actions. Automation uses separately scoped workload identity, not a human session.

## Admin UI

Admin navigation adds Credentials beside Repository mappings and Trace archives.
The credentials page has Service credentials, Developer integrations, Rotations
and Audit tabs. Hide entries the caller cannot inspect.

Inventory columns: provider, purpose, owner, Project, environment, consumers,
health, expiry, active version and rotation state. Filter by those metadata fields.
Show configured, validated, active, failed, expiring, revoked and unknown distinctly.

The Add flow selects provider, ownership, Project, environment and consumers,
then offers provider connect, write-only secret entry or external reference.
Only adapters with an explicit capability contract offer an action.
Unsupported provider operations show an external action with verification steps.

After submission, discard the field and show a receipt, never the saved value.
No reveal/download endpoint for stored values. Do not save secrets in localStorage,
sessionStorage, IndexedDB, URLs, drafts, error reports or browser telemetry.
Disable session replay and all body capture for the entire credential surface.
Use strict CSP, same-origin requests, no-store responses, CSRF protection and
origin checks. Password-style input reduces casual exposure but is not encryption.
Do not claim JavaScript can guarantee erasure from browser memory.

The rotation view shows affected consumers and environments, candidate validation,
cutover progress, overlap deadline, old-key revocation and required operator steps.
An uncertain save produces a reconciling state. Never blindly retry a write.

## Workflows

### Add and validate

1. Authenticate and authorize the ownership and scope.
2. Validate provider adapter, consumer allowlist and expected metadata revision.
3. Accept a bounded secret body over TLS into the dedicated broker. No request logs.
4. Create a uniquely named candidate in the managed backend.
5. Persist the operation and backend reference. Reconcile ambiguous provider writes
   by operation identity before retrying; safely track orphan candidates.
6. Execute only a fixed, adapter-defined validation endpoint with minimal permissions.
   No user-supplied arbitrary URL, redirect following or credential-bearing diagnostics.
7. Show provider identity/scope evidence or an explicit unverified status.

### Rotate with overlap

States: proposed -> candidate-stored -> candidate-validated -> switching ->
consumer-verified -> retiring-old -> revoked -> complete.
Failure branches: validation-failed, switching-partial, reconciling and rollback-needed.

Create and validate the replacement before modifying consumers. Use revision
preconditions and a durable per-credential operation lease; do not race two rotations.
Switch allowlisted consumers, then run functional probes through each actual consumer.
Confirm deployment/version propagation and relevant cache expiry. Provider support
determines whether dual credentials are possible and how long overlap may last.

Retain the previous key until cutover succeeds, except emergency compromise response.
Then revoke it at the issuing provider and verify rejection or provider revocation
state. Deleting a stored copy is not revocation. Rotation is not complete until
all required consumer and revocation evidence exists. Report manual provider actions
as pending, not successful automation.

A signing-secret rotation may require accepting old and new signatures for a
bounded period; provider-specific adapters must define this. GitHub webhook
secrets are not interchangeable with ordinary API tokens.

### Providers without overlap and emergency revoke

Show expected downtime and the tested recovery path before switching a
single-active-key provider. Revoke-first emergency handling may intentionally
interrupt service. Do not claim rollback is possible after the provider has
invalidated the previous key. Preserve audit evidence and retain an out-of-band
operator path if Homer loses its own backend connectivity.

### Developer offboarding

Disable future use of that developer's integration, revoke provider access and
remove consumer bindings. Transfer only explicitly transferable service ownership;
never transfer personal credentials to another developer. Record unresolved
provider revocations and orphan bindings.

## API and state contracts

Proposed routes: metadata list/detail, candidate submission, validation,
activation, revocation and operation-status readback under a dedicated
credential-admin service. There is no GET-value operation.

Mutation requests carry an idempotency key and expected revision. Responses carry
operation ID and sanitized state only. Do not retain secret-bearing request bodies
for idempotency; persist the operation reference and use backend reconciliation.
Return generic errors with safe codes. Sanitize third-party errors before persistence.

Provider adapters declare support for issue, validate, overlap, activate, revoke,
expiry readback and usage readback. Stored-value replacement alone is not a provider
rotation adapter. Start with the concrete Homer/Langfuse/R2 credentials required by
the archive; inventory other stack providers without advertising unsupported rotation.

Append security audit evidence: authenticated principal reference, credential ID,
version reference, action, scope, consumer acknowledgements, timestamps and outcome.
Preserve evidence without secret material. Until a versioned ledger contract exists,
do not disguise credential changes as GitHub or catalog events.

## Trace exclusion

Credential entry, provider validation, token refresh, webhook signing configuration
and secret-store calls must bypass prompt/tool/body trace capture. Instrument only
allowlisted operation metadata. Canary tests must inspect traces, logs, errors,
archive exports and browser persistence, including failure paths.

The trace archive Collector consumes only its approved credential binding.
It cannot list, reveal, rotate or bind other developers' credentials.
Langfuse export credentials receive only the approved landing bucket access;
they never obtain archive-bucket or account-administration rights.

## Acceptance tests and rollout

- Existing catalog-admin access alone cannot submit or rotate credentials.
- Cross-owner, Project and environment access is denied server-side.
- Submitted canaries never appear in inventory, responses, logs, traces or archives.
- Malicious validation URLs/redirects cannot exfiltrate a key.
- Concurrent rotation and ambiguous saves preserve one operation and active version.
- Candidate validation failure leaves existing consumers working.
- Partial deployment retains explicit per-consumer status and does not revoke early.
- Provider revocation failure cannot be reported as completed rotation.
- Offboarding closes delegated consumer access and reports unsupported revocation.
- Restart/crash at each transition recovers from durable operation evidence.
- A synthetic staging end-to-end rotation proves old key rejection.
- Emergency recovery remains usable when Homer or the secret broker is unavailable.

Rollout: accepted intent and threat model; metadata inventory and role model;
write-only candidate storage with synthetic credentials; first provider adapter;
staging rotation drill; production release approval. No live credential migration
or new access grants are authorized by this draft.

## Sources and open decisions

Repository baseline: packages/catalog-worker/src/editor.ts, index.ts and access.ts.
Current UI is the authenticated repository mapping editor.

- [Cloudflare secret management](https://developers.cloudflare.com/secrets-store/manage-secrets/)
- [Cloudflare secret access control](https://developers.cloudflare.com/secrets-store/access-control/)
- [Worker bindings](https://developers.cloudflare.com/secrets-store/integrations/workers/)

Cloudflare management interfaces expose metadata rather than saved values; bound
services can consume them. Verify plan limits and binding permissions during
implementation. Current docs describe a beta account secret limit, so do not assume
unlimited versions across all developers.

Open decisions: initial provider list, credential-operator membership, production
activation authority, which developer integrations are centrally held, overlap
budgets and recovery owner. These must be explicit before enabling live key writes.
