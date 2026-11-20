# Cloudflare catalog Worker

The catalog API runs on Workers. SQLite Durable Objects hold versioned mappings
and immutable revision history. Cloudflare Access supplies user and service
application JWTs; the Worker verifies their signature, issuer, audience and time
claims. It does not trust identity headers alone.

| Operation | Route | Access application |
| --- | --- | --- |
| Read mappings/listings | `GET /v1/catalog` | Read or admin audience |
| Export complete catalog history | `GET /v1/admin/catalog/archive` | Admin audience only |
| Replace mappings | `PUT /v1/admin/catalog` | Admin audience only |
| Collect merged PR | `POST /v1/hooks/github` | GitHub HMAC-SHA256, separate from Access |

Reads return an ETag containing the current revision. Writes require the same
quoted revision in If-Match and the full next MappingSnapshot at revision +1.
A stale write returns 409. After a lost response, reread the current snapshot and
compare it with the intended change before retrying. Restore prior mappings by
creating a new revision; never edit history.

The committed Wrangler configuration has no public route, deployment account,
Access audience or live catalog name. Missing configuration returns 503.
No catalog inventory or principal list is compiled into the Worker.

The webhook reads the current catalog per delivery and awaits a durable ledger
receipt. Repeated deliveries produce one Activity Event. Unknown/disabled
repositories are ignored; changed content at an existing Event Key is a Conflict.
Configure the webhook secret and a binding to the existing Event Ledger before
enabling this route. See the [webhook spec](../../specs/github-webhook/spec.md).
Historical backfill and automatic delivery recovery are not implemented.

Catalog archives preserve revision audit fields and include a SHA-256 digest.
The trusted-binding restore operation accepts only an empty target and imports
atomically. There is no HTTP restore route. Archives are limited to 768 KiB and
1,000 revisions; larger histories fail explicitly without returning partial data.

See the [Cloudflare runbook](../../docs/deployment/cloudflare-catalog.md) and
[specification](../../specs/catalog-worker/spec.md). Local tests and a bundle dry
run do not constitute a Cloudflare production deployment or restore drill.
