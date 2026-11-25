# Cloudflare catalog deployment and rollback

`homer-catalog` is the Worker for people and agents
([ADR 013](../../specs/adr/013-catalog-worker-boundary.md)): the catalog, admin
pages and editor, the credential directory views, the Activity Calendar, the
fleet status view, runner fleet pages and enrollment, and `GET /v1/version`. Every route goes through
Access with the read or admin audience, and any other path answers `404`. The
GitHub webhook, the runner controller protocol and fleet reports are in
`homer-intake`; its Fleet Collector binding, `/v1/admin/fleet/collector`, is an
admin route here. See
[`intake.md`](intake.md).

Hosting decision: Daniel selected Cloudflare for all Homer hosting on 2026-11-20.
Workers serves the gateway, SQLite Durable Objects stores catalog revisions, and
Access governs caller access. The Event Ledger already uses Durable Objects.
No additional hosting provider is required. Existing Control Room D1 remains
unchanged; this is not a state migration or production cutover.

## Required environment configuration

Supply these values through Cloudflare's deployment configuration, not committed
source or chat logs:

| Binding | Purpose |
| --- | --- |
| `ACCESS_ISSUER` | Exact HTTPS team issuer ending in `.cloudflareaccess.com`, no trailing slash |
| `ACCESS_READ_AUD` | Audience for the catalog reader Access application |
| `ACCESS_ADMIN_AUD` | Distinct audience for the catalog administrator application |
| `CATALOG_NAME` | Stable Durable Object name for this environment |
| `MAPPING_CATALOG` | Durable Object namespace bound to MappingCatalogObject |
| `RUNNER_FLEET` | Durable Object namespace bound to RunnerFleetObject; `homer-intake` binds it too |
| `EVENT_LEDGER` | Cross-Worker binding to the existing EventLedgerObject namespace, required for the Activity Calendar |
| `CF_VERSION_METADATA` | Cloudflare's version metadata binding, committed in `wrangler.jsonc`; `GET /v1/version` reads it |
| `SPARKDASH_ORIGIN` | Optional. The front door's bare `https://` origin for the sparkDash page, the same as the Fleet Collector's `frontDoorOrigin`. The fleet status view links to it; without it, or if it is not a bare origin with a host name, the view shows no link |

`homer-catalog` holds no webhook secret and no workload audience. Its
`MAPPING_CATALOG` and `RUNNER_FLEET` namespaces are bound by `homer-intake`
through `script_name`, so deploy the catalog first, and keep `CATALOG_NAME` the
same in both Workers.

Create a read Access application for the selected host's `/v1/catalog` and
`/v1/version` paths, and for the fleet status view, `/v1/fleet` and
`/v1/workspace/fleet` (Danny and Boof, per the fleet monitoring intent), and an admin application for `/v1/admin/catalog`. Use least-privilege policies and
separate permitted service tokens. A read application must not issue the admin
audience. Restrict admin access to approved operators and agents. Do not use
Bypass policies. The Worker requires application tokens, not global session
tokens. Service-token JWTs use the signed common_name when sub is empty.

Choose finite Access session lifetimes appropriate to the environment. An issued
JWT remains usable until expiry unless additional revocation controls are used;
editing an Access policy alone is not evidence that every old token stopped working.
Test policy removal, signing-key rotation and service-token rotation in staging.

## Editing runtime mappings

Open `/v1/admin/catalog/editor` on the gateway hostname and sign in through the
existing admin Access application. Ensure that application covers the child paths
`editor`, `editor.js`, `editor.css` and `snapshot`, just as it covers `archive`.
No additional Access application, service token or policy is required. Verify
anonymous and reader access is denied before permitting operators to use it.

The editor reads the current catalog and revision at runtime. Edit the Repository
array, select Review changes, compare the current and proposed lists, then save.
Use verified numeric GitHub repository IDs and full repository names. Omit
projectId until the Project mapping is verified. Admission does not register a
GitHub webhook, import historical events or create an Identity Binding.

If another operator saves first, the server refuses the stale replacement.
The editor keeps the draft: copy it before reloading, reconcile against the new
catalog, and review again. An expired session or uncertain save also requires
reload and reconciliation. The editor never automatically retries a write.
Disable a Repository by setting enabled to false; historical Activity Events and
catalog revisions remain intact. Do not use raw SQL to bypass these operations.

## Ledger binding

Provision the Event Ledger with its existing deployment configuration first. In
the environment-specific catalog Wrangler configuration, add an EVENT_LEDGER
Durable Object binding with class_name `EventLedgerObject` and script_name set to
that environment's deployed ledger Worker (`homer-event-ledger` in the committed
configuration). Do not add this class to the catalog's
migrations or export it from the catalog production entry point. The established
ledger object name `event-ledger` is a storage identity, not repository inventory;
changing it would silently select empty storage.

The committed catalog configuration intentionally leaves this environment-specific
binding unset. Until it is supplied, the Activity Calendar answers 503. The
test-only configuration exports the classes into isolated local namespaces; it
must never be deployed. No ledger migration is needed for this integration.

The GitHub webhook, its secret and its ledger appends moved to `homer-intake`
with ADR 013; configure them as [`intake.md`](intake.md) describes. Keep the
catalog and admin routes behind Access on their own hostname, and add no Bypass
policy over them.

## Build and isolated qualification

From repository root:

```sh
npm ci --no-audit --no-fund
node scripts/catalog-bindings.mjs
npm run check
npx wrangler deploy --dry-run --config packages/catalog-worker/wrangler.jsonc
```

The dry run bundles only. It creates no hosted resources. Use separate Worker
names and Durable Object namespaces for staging and production. Keep the catalog
name stable within each environment. Do not point staging at the production
namespace. Do not reuse the local synthetic Access issuer or test keys.

Regenerate binding declarations after editing Wrangler configuration. The script
adapts Wrangler's generated import to the repository's NodeNext module resolution.
The build copies these declarations beside the compiled Worker types. Deployment
settings remain explicit runtime configuration.
Logs are enabled and traces sample 1% of requests; set an appropriate retention
policy and verify that no request bodies, tokens or secrets appear in live output.

## Live acceptance before production

After deployment authorization and selection of account/domain, deploy the exact
reviewed commit with environment-specific bindings. Keep workers.dev and preview
URLs disabled. Verify the configured route is covered by the intended Access
application. Record Worker version, source SHA and binding/migration version.
Read `GET /v1/version` with a read token: its `buildVersion` names the deployed
commit and its `workerVersionId` the deployed Worker version. Record that answer
in the deploy receipt (versioning spec, "The deploy receipt").

- No token, forged token, expired token, wrong issuer and wrong audience fail.
- `GET /v1/version` answers only its four fields, and only with a read or admin
  token.
- A reader can list mappings but cannot replace them.
- An authorized admin can add, remap, disable and remove a synthetic entry.
- Two updates at one revision produce one success and one 409, without lost data.
- Updated listings appear on the next read, without code changes.
- Restart leaves the catalog revision and contents intact.
- Responses contain no tokens, emails or raw source payloads.
- `/v1/hooks/github` and the runner controller paths answer `404` here; they
  are `homer-intake`'s (ADR 013).
- Export catalog history to approved private storage; record hashes and row counts.
  Restore into an isolated namespace and reconcile every revision before declaring
  recovery ready. Local restart tests are not a platform backup/restore drill.

## Rollback

Pause GitHub webhook deliveries to `homer-intake`, stop admin writes and
preserve the current revision, ledger head and private export. Roll back
the Worker deployment to the last verified version using the same namespace and
catalog name. Read and verify the catalog before reopening writes. Revert mapping
content by submitting a new revision with If-Match, preserving history. Do not
delete Durable Object storage or remove migrations to undo an application bug.
The initial schema is additive; any future incompatible schema change needs its
own migration, restore and rollback plan.

A rollback that crosses a catalog migration also pins `homer-intake`, which
binds the catalog's namespaces. Resume deliveries only after checking
authentication, bindings and the ledger head. Inspect and redeliver failures
from the pause. Preserve Event Ledger storage throughout.

## Catalog archive and isolated restore

An authorized admin can GET `/v1/admin/catalog/archive` after the recovery release
is deployed. Ensure the admin Access application covers this child path as well
as `/v1/admin/catalog`; verify a reader is denied at both the edge and Worker.
Save the response to approved private storage with restrictive file permissions.
Do not paste archives into PRs or logs: they include historical repository mappings
and pseudonymous principal digests. Retain `digest`, `headRevision`, export time
and the deployed source/version in separate trusted recovery evidence.

Archives include all persisted revisions and original audit fields. The initial
empty revision 0 has no stored row. The limit is 768 KiB of complete JSON and 1,000
revisions. A 413 response is an unsuccessful backup, not a usable partial archive.
Monitor archive size and revision count; implement paginated recovery before
outgrowing the atomic format. The SHA-256 digest detects accidental corruption;
it does not authenticate an archive whose digest was replaced by an attacker.

Restoration is available only through a trusted maintenance Durable Object binding:

```ts
const archive = await source.exportArchive();
// expectedDigest comes from independently retained, trusted recovery evidence.
await target.restoreArchive(archive, expectedDigest);
const recovered = await target.exportArchive();
if (JSON.stringify(recovered) !== JSON.stringify(archive)) {
  throw new Error("catalog_reconciliation_failed");
}
```

Before executing, select a separate recovery namespace and fresh object identity.
Record those identities privately; never repoint CATALOG_NAME or MAPPING_CATALOG
on the live gateway to run a drill. The target must have no history, including
history whose latest inventory is empty. Restore validates the whole archive
before one atomic transaction. It preserves audit times and principal digests;
it does not recast history as the maintenance operator's new edits. A failed
transaction leaves no partially imported revisions. Re-export after a restart
and compare every revision and audit field, then record the matching digest and
row count. Keep any Collector disabled against the recovery namespace.

No public restore endpoint exists. The gateway cannot select a target object from
request input. Grant maintenance bindings only to a reviewed, authorized operator
Worker, and remove temporary capabilities after the drill. This operation does
not restore the Event Ledger and does not authorize a production cutover. Keep
hosted catalog and Event Ledger recovery gates open until separately demonstrated.

### Management API recovery Workflow

The separate `wrangler.recovery.jsonc` entrypoint supplies
`CatalogRecoveryWorkflow`. It defaults to disabled and returns 404 for all HTTP
requests. Deployment must supply SOURCE_CATALOG bound to the staging gateway's
namespace, SOURCE_CATALOG_NAME, RECOVERY_CATALOG bound to a separate namespace
owned by this maintenance Worker, and ARCHIVE_BUCKET bound to a private R2 bucket.
Verify the namespace IDs differ. Do not attach a public route, preview URL,
public bucket domain, recurring schedule or Access policy.

Obtain and independently retain the expected archive digest before invocation.
An authenticated Cloudflare administrator creates an instance with parameters
`{drillId, expectedDigest, mode: "restore"}`. The runner exports through the source
RPC, validates the expected digest, saves with an R2 create-only condition, reads
the backup back, and restores the separate target. It compares the entire recovered
archive and checks that the source stayed unchanged. A repeated invocation with
the same drillId can acknowledge an exactly matching target but cannot overwrite
other history. A second instance with mode `verify` performs only reads and must
find both the backup and the restored target already present.

The expected digest must come from separate trusted evidence, not an unverified
archive supplied by a caller. Workflow outputs contain only a compact receipt.
Do not return archives from Workflow steps or print their content in logs.
After the drill, set RECOVERY_ENABLED to false and remove SOURCE_CATALOG and
SOURCE_CATALOG_NAME from the maintenance Worker. Preserve the private backup,
recovered namespace and receipts. The primary catalog and Event Ledger Worker
configurations remain unchanged. This Workflow is an operator-run drill, not a
scheduled backup policy or production recovery claim.
