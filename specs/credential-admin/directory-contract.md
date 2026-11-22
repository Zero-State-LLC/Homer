# Credential Directory v1

Implements the accepted [intent](../../docs/intent/credential-administration.md),
[read-only directory boundary](spec.md#read-only-directory-boundary-for-zer-26)
and [delivery Task 2](delivery-contract.md#2-inspect-scoped-credentials-and-developer-setup).
Glossary: Credential, Credential Directory, Identity Binding, Actor, Accountable
Human, Project and Scope in `CONTEXT.md`. No real enrollment is included.

## Trusted deployment boundary

The optional `CREDENTIAL_DIRECTORY` Worker service binding accepts a fixed GET
`https://credential-directory/v1/directory` with no caller-controlled URL, identity,
query or request body. The snapshot is fetched afresh on every API read, with a
3-second deadline, 1 MiB body limit, status 200 and JSON required. Redirects,
malformed JSON/UTF-8/schema and source failures become a generic 503. Production
wrangler configuration deliberately leaves the binding unset. Deployment tooling
must enroll a reviewed metadata service separately; no maintenance endpoint or
secret backend binding exists in this Worker.

The executable strict schema is `packages/catalog-worker/src/credential-directory.ts`.
The entire snapshot is validated before authorization. Unknown keys are rejected
at every level, including Credentials and consumers. No backend locators, paths,
URLs, key values, fragments or hashes belong in this contract. Labels are bounded
human text excluding slash/backslash; evidence/version references are opaque IDs.
Do not use a provider key identifier as a version reference. These restrictions
are schema defenses, not a claim that arbitrary trusted text can be classified
as non-secret. Directory maintainers must emit only approved metadata.

| Object | Required fields |
| --- | --- |
| Snapshot | `version: 1`, nonnegative safe integer `policyRevision`, `metadataRevision`, UTC `observedAt`, `bindings`, `grants`, `credentials` |
| Identity Binding | 64 lowercase hex `principalDigest`, `principalKind: human or workload`, opaque `actorId`, `actorKind: human or agent`, opaque `evidenceRef` |
| Agent binding only | `accountableHumanId`, resolving to a Human binding in the same snapshot |
| Grant | `principalDigest`, `capability: metadata-read`, `ownerActorId`, `ownershipClass`, `projectId`, `environment` |
| Credential | `credentialId`, `revision`, `provider`, `purpose`, `ownershipClass`, `ownerActorId`, `projectId`, `environment`, `consumers`, `consumerDiscovery`, `health`, `healthEvidence`, `expiresAt`, `activeVersion`, `rotationState` |
| Consumer | opaque `consumerId`, human `label` |
| Non-null health evidence | opaque `evidenceRef`, UTC `checkedAt`, UTC `freshUntil` |

Arrays are bounded at 2,000 entries and consumers at 100 per Credential. IDs are
bounded at 96 characters and labels at 200. Project IDs match `project:<slug>`.
Principal bindings and Credential IDs must be unique; repeated Actor bindings
must agree on kind and Accountable Human. All owners and grant principals must
resolve. Real calendar UTC timestamps are required. Observation and health checks
cannot be in the future; fresh-until cannot precede the check.

Ownership classes are exactly `shared-service`, `developer-owned`, `local-only`.
Provider-managed and emergency credentials are unsupported by this version.
Consumers are `configured-only` or `unknown`; neither claims complete discovery.
Health is `unverified`, `healthy`, `degraded`, `stale` or `unknown`. Healthy,
degraded and stale require evidence. Expired healthy/degraded evidence projects
as stale. Expiry and active version are nullable, meaning unknown. Rotation is
`none`, `pending`, `partial`, `failed`, `complete` or `unknown`, a metadata statement
only; this service cannot perform or independently qualify a rotation.

`principalDigest` is the existing SHA-256 of Access issuer, newline and exact
`user:<sub>` or `service:<common_name>` identity. Here `principalKind: human`
means the Access subject namespace, not proof that a subject is a Human. The
reviewed binding supplies Actor classification. A workload must bind explicitly
to an Agent with an Accountable Human. A Human cannot inherit workload identity.
Display names, email similarity and catalog privileges are never evidence.

## Authorization and HTTP

Every directory read authenticates the existing read or admin Access audience.
Catalog write routes continue to require the separate admin audience. Grants
match owner, class, Project and environment exactly, without null/wildcard roles.
Personal/local-only visibility additionally requires the caller's bound Actor
to equal the owner, even when a mismatched grant exists. Shared service access
requires its own exact grant and does not imply personal access.

| Route | Result |
| --- | --- |
| GET `/v1/credentials` | Authorized metadata inventory, revision and observation time |
| GET `/v1/credentials/:credentialId` | Authorized Credential detail; inaccessible and absent are identical 404 |
| GET `/v1/my-setup` | Bound Actor, authorized scopes, owned integrations and separately named shared access; connection missing/unverified, instrumentation/Work Session unknown |
| GET `/v1/workspace/credentials` | Read audience HTML interface |
| GET `/v1/workspace/my-setup` | Read audience setup interface |
| GET `/v1/workspace/directory.js` and `.css` | Read audience assets, no admin CSS dependency |

List filters: exact `ownerActorId`, `ownershipClass`, `projectId`, `environment`;
`q` is bounded text search over permitted provider, purpose, owner, Project and
environment only. Scope precedes search and detail selection. Explicit scope
combinations with no applicable grant return generic 403. Unknown/duplicate query
keys return 400. No server pagination or total count is advertised in v1; the
bounded snapshot returns the complete permitted matching set. My setup derives
its Actor from authentication, never a query-selected Actor. Scope describes
access, not Project assignment. Integration metadata does not prove connection.

The Credentials interface offers exact Project, environment and owner filters from
My setup's already-authorized scope subset, with search applied through the same
inventory API. Options do not contain principal digests or raw policy. Cards show
configured consumer counts and discovery limits; zero configured consumers is not
proof of zero impact. Inventory and fresh detail each display their own metadata
revision and observation time, so a newer detail cannot inherit an older inventory
observation. Detail URLs use the non-sensitive opaque `credential` query parameter
on the workspace page. Search and filters also survive reload and browser history;
closing detail retains them. Every detail read still authenticates and authorizes
at the existing API, including bookmarks to inaccessible Credentials.

Responses are no-store. Missing binding is 503 `credential_directory_not_configured`;
failed or invalid source is 503 `credential_directory_unavailable`; missing Identity
Binding is 403 `identity_binding_required`; missing permitted grant is 403
`credential_access_denied`. Only a successful authorized source read can yield an
empty inventory. Policy arrays, principal digests and binding evidence never appear
in API output. Mutation methods return 405; secret/value subroutes are absent.

## Qualification and activation

The local browser harness uses a separate synthetic directory Worker, synthetic
Access keys and fixtures under `scripts/catalog-browser/`. Neither fixture data
nor its controls are imported by runtime source. `npm run smoke:admin` drives the
actual Worker routes, including a read audience with no catalog admin rights.
Optional `ADMIN_SCREENSHOT_DIR` writes fixture-only PNG screenshots; it emits no
browser traces, HAR or storage export. HTTP tests also exercise fail-closed source,
identity, exact grants, local-only and accountable Agent boundaries.

Live operator roster, maintained directory implementation, provider selection,
consumer discovery and staging credentials remain unenrolled. Before activation,
review the service implementation, its authority for reviewed bindings/grants,
metadata-only output and separate maintenance access. No catalog API may edit
that authority. Live Access policy, backend/provider connectivity and actual
consumer evidence require separate qualification; local fixture success is not
production evidence.
