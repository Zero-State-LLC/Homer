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

## Build and isolated qualification

From repository root:

```sh
npm ci --no-audit --no-fund
npm run check
npx wrangler deploy --dry-run --config packages/catalog-worker/wrangler.jsonc
```

The dry run bundles only. It creates no hosted resources. Use separate Worker
names and Durable Object namespaces for staging and production. Keep the catalog
name stable within each environment. Do not point staging at the production
namespace. Do not reuse the local synthetic Access issuer or test keys.

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
- Export catalog history to approved private storage; record hashes and row counts.
  Restore into an isolated namespace and reconcile every revision before declaring
  recovery ready. Local restart tests are not a platform backup/restore drill.

## Rollback

Stop admin writes and preserve the current revision and private export. Roll back
the Worker deployment to the last verified version using the same namespace and
catalog name. Read and verify the catalog before reopening writes. Revert mapping
content by submitting a new revision with If-Match, preserving history. Do not
delete Durable Object storage or remove migrations to undo an application bug.
The initial schema is additive; any future incompatible schema change needs its
own migration, restore and rollback plan.
