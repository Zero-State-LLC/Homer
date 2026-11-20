# Cloudflare catalog deployment and rollback

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
| `EVENT_LEDGER` | Cross-Worker binding to the existing EventLedgerObject namespace, required for webhooks |
| `GITHUB_WEBHOOK_SECRET` | High-entropy webhook secret installed as a Workers secret, required for webhooks |

Create a read Access application for the selected host's `/v1/catalog` path and
an admin application for `/v1/admin/catalog`. Use least-privilege policies and
separate permitted service tokens. A read application must not issue the admin
audience. Restrict admin access to approved operators and agents. Do not use
Bypass policies. The Worker requires application tokens, not global session
tokens. Service-token JWTs use the signed common_name when sub is empty.

Choose finite Access session lifetimes appropriate to the environment. An issued
JWT remains usable until expiry unless additional revocation controls are used;
editing an Access policy alone is not evidence that every old token stopped working.
Test policy removal, signing-key rotation and service-token rotation in staging.

## GitHub webhook route and ledger binding

POST `/v1/hooks/github` authenticates with GitHub's HMAC-SHA256 signature rather
than an Access JWT. Keep it outside the catalog Access applications, ideally on
a dedicated webhook hostname. Do not add an Access Bypass policy over the catalog
or admin routes. Both catalog routes continue to require verified application JWTs
inside the Worker, including when reached through another hostname.

Provision the Event Ledger with its existing deployment configuration first. In
the environment-specific catalog Wrangler configuration, add an EVENT_LEDGER
Durable Object binding with class_name `EventLedgerObject` and script_name set to
that environment's deployed ledger Worker. Do not add this class to the catalog's
migrations or export it from the catalog production entry point. The established
ledger object name `event-ledger` is a storage identity, not repository inventory;
changing it would silently select empty storage. Confirm the expected ledger head
through an authorized internal binding before enabling collection.

The committed catalog configuration intentionally leaves this environment-specific
binding unset. Until it and the secret are supplied, webhooks fail with 503. The
test-only configuration exports both classes into isolated local namespaces; it
must never be deployed. No ledger migration is needed for this integration.

Configure a GitHub repository or organization webhook with application/json,
the exact route, the same secret, SSL verification enabled and pull_request
events only. Register it only for the intended source scope. The runtime catalog
is a second admission boundary: unknown and disabled repositories are ignored.
No delivery id, sender header or login grants repository access.

Test a signed ping, merged PR and repeated delivery. Acknowledgement follows the
durable append, with a 201 appended or 200 Duplicate receipt. Check non-2xx results
and deliveries exceeding GitHub's response timeout. GitHub does not automatically
redeliver failures. Redeliver after resolving the cause; reconcile 409 Conflicts
with reviewed Corrections. Bodies over 1 MiB require investigation or later REST
backfill. Ignored deliveries are acknowledged and will require explicit backfill
if the repository is enabled later. Do not claim complete historical coverage.

Rotate the Workers secret and GitHub webhook secret in a coordinated maintenance
window, then redeliver failures from the transition. No overlap key is retained by
this implementation. Do not print secret values, raw payloads or JWTs in evidence.

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
settings and optional webhook credentials remain explicit runtime configuration.
Logs are enabled and traces sample 1% of requests; set an appropriate retention
policy and verify that no request bodies, tokens or secrets appear in live output.

## Live acceptance before production

After deployment authorization and selection of account/domain, deploy the exact
reviewed commit with environment-specific bindings. Keep workers.dev and preview
URLs disabled. Verify the configured route is covered by the intended Access
application. Record Worker version, source SHA and binding/migration version.

- No token, forged token, expired token, wrong issuer and wrong audience fail.
- A reader can list mappings but cannot replace them.
- An authorized admin can add, remap, disable and remove a synthetic entry.
- Two updates at one revision produce one success and one 409, without lost data.
- Updated listings appear on the next read, without code changes.
- Restart leaves the catalog revision and contents intact.
- Responses contain no tokens, emails or raw source payloads.
- Catalog and webhook routes retain their separate authentication boundaries.
- Concurrent merge deliveries produce one entry and the same receipt.
- Disable takes effect on the next delivery; an already admitted request may finish.
- A failed append returns 503 and a later redelivery produces at most one entry.
- Export catalog history to approved private storage; record hashes and row counts.
  Restore into an isolated namespace and reconcile every revision before declaring
  recovery ready. Local restart tests are not a platform backup/restore drill.

## Rollback

Pause GitHub webhook deliveries, stop admin writes and preserve the current
revision, ledger head and private export. Roll back
the Worker deployment to the last verified version using the same namespace and
catalog name. Read and verify the catalog before reopening writes. Revert mapping
content by submitting a new revision with If-Match, preserving history. Do not
delete Durable Object storage or remove migrations to undo an application bug.
The initial schema is additive; any future incompatible schema change needs its
own migration, restore and rollback plan.

Resume deliveries only after checking authentication, bindings and the ledger
head. Inspect and redeliver failures from the pause. Removing the webhook handler
does not remove existing Activity Events. Preserve Event Ledger storage throughout.
