# Cloudflare runtime catalog

Status: implementation under Daniel's 2026-11-20 Cloudflare hosting direction,
the accepted foundation intent and the migration plan's authenticated adapter step.

## Architecture and contracts

Cloudflare Workers serves the catalog API. A SQLite-backed Durable Object stores
versioned mappings and an append-only revision history. Cloudflare Access supplies
authenticated application tokens. No other hosting service is required.

Inventory and Project mappings remain runtime data. Access policies live in
Cloudflare Access. Deployment configuration supplies the Access issuer, distinct
read/admin application audiences and catalog object name. No account inventory,
principal allowlist, application id, credential or domain is seeded in code.

GET `/v1/catalog` requires a signed Access JWT for the read or admin application.
PUT `/v1/admin/catalog` requires the admin application audience. It accepts the complete
next MappingSnapshot with an `If-Match` header containing the quoted current
revision. Missing precondition returns 428, stale revision 409, invalid snapshot
400, oversized body 413, absent/invalid token 401. Missing deployment configuration
returns 503. Unknown routes return 404. Responses are JSON and `no-store`.

Tokens must use RS256 and have matching issuer/audience, expiry and issued-at
claims, application token type, and a nonempty subject or signed service-token
common_name. Signing keys are loaded from the configured
Access JWKS endpoint and refreshed by jose. A header's presence is not proof of
authentication. The read and admin audiences must differ. Email or display-name
headers cannot grant access. Application audience is the Scope boundary; Access
policies must limit the admin application to authorized administrators.

Cross-origin browser requests are refused; no permissive CORS is enabled.
Only application/json writes are accepted and actual streamed body bytes are
capped at 256 KiB. Bodies and tokens are never logged. The catalog is internal
configuration, not an Event Ledger API or a Work Session claim endpoint.

The Durable Object validates the complete snapshot again, checks that the next
revision is exactly expected+1, and inserts history in one synchronous transaction.
The current snapshot is the latest history row. Concurrent writers cannot both
win. History cannot be edited or deleted. Initial inventory is empty revision 0.
Each revision records server UTC time and a SHA-256 digest of issuer plus verified
user/service principal, not the token or email. Restoring an old mapping is a new revision, never
a history rewrite. RPC bindings are trusted capabilities and must not be granted
to untrusted Workers.

## Workflows and acceptance

1. Configure two Access applications and their read/admin policies.
2. Deploy to an isolated Cloudflare environment only after explicit deployment
   authorization. This change supplies no production route or live credentials.
3. Read current inventory and revision; authorized admins submit a full validated
   replacement with If-Match. Readers see the new inventory on the next request.
4. Verify denied unauthenticated/read-only writes, wrong issuer/audience/algorithm,
   forged/expired tokens, same-origin enforcement and malformed/oversized bodies.
5. Verify concurrent writes, restart persistence, stale revisions and immutable
   history under local workerd. Dry-run the actual Worker bundle.
6. Before production, prove Access policies, key rotation, private backup/restore,
   deployment bindings, and authorized read/write/rollback on Cloudflare itself.

References: docs/intent/home-foundation.md, specs/github-collector/spec.md,
docs/migration/control-room.md; CONTEXT.md Scope, Context Pin and Identity Binding.
The read agent-context HANDOFF/STATUS dates are not live Homer evidence.

Primary platform references:

- <https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/>
- <https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/>
- <https://github.com/panva/jose>

## Catalog recovery contract

GET `/v1/admin/catalog/archive` requires the admin application audience and
returns a version 1 archive with every persisted revision, its original principal
digest and recorded-at instant, the head revision and a SHA-256 content digest.
The initial empty revision 0 is implicit. Export captures history synchronously
before hashing so concurrent replacements cannot mix states in one archive.
Readers cannot export history. Missing/invalid authentication returns 401.

The archive is canonical JSON: `{version, headRevision, entries, digest}` with
entries `{snapshot, principalDigest, recordedAt}` in revision order. The digest
covers UTF-8 JSON of the first three fields in that order, using normalized
MappingSnapshots. Unknown fields are rejected, not silently removed. Revisions
must be contiguous from 1 through headRevision; digests and UTC timestamps must
be valid. The digest detects corruption, not an attacker who can replace both
archive and digest. Operators must retain the expected digest separately in
trusted private recovery evidence.

This first atomic recovery format is capped at 768 KiB of complete encoded JSON
and 1,000 revisions. Export refuses larger histories with 413, never truncates.
It does not claim a general paginated backup service. Capacity monitoring and a
paginated successor are required before these limits are approached.

`restoreArchive(archive, expectedDigest)` is an internal trusted-binding RPC,
never an HTTP endpoint. It validates the entire archive and the independently
supplied digest before one synchronous transaction. The target must contain no
history rows. All revisions and original audit fields are inserted atomically;
a failure leaves the target empty. Concurrent restore or normal writes cannot
overwrite the winner. Existing history is never replaced, even when its current
inventory is empty. The restored current snapshot and re-exported archive must
match the source exactly, including after object restart.

Recovery workflow: export through authenticated admin access to approved private
storage, retain digest and row count, restore through an authorized maintenance
binding into a separate namespace/object, then re-export and compare every
revision and audit field. Do not route callers or Collectors to the restored
object until reconciliation and human cutover approval. This catalog operation
neither exports nor restores the Event Ledger. Rollback of mapping content on a
live object still uses a new revision through the normal If-Match API.

Acceptance includes denied reader/anonymous exports, altered content/digest,
revision gaps, invalid audit fields, oversized archives, occupied targets,
concurrent restores, injected mid-import failure, and restart reconciliation.
