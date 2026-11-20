# Cloudflare catalog Worker

The catalog API runs on Workers. SQLite Durable Objects hold versioned mappings
and immutable revision history. Cloudflare Access supplies user and service
application JWTs; the Worker verifies their signature, issuer, audience and time
claims. It does not trust identity headers alone.

| Operation | Route | Access application |
| --- | --- | --- |
| Read mappings/listings | `GET /v1/catalog` | Read or admin audience |
| Replace mappings | `PUT /v1/admin/catalog` | Admin audience only |

Reads return an ETag containing the current revision. Writes require the same
quoted revision in If-Match and the full next MappingSnapshot at revision +1.
A stale write returns 409. After a lost response, reread the current snapshot and
compare it with the intended change before retrying. Restore prior mappings by
creating a new revision; never edit history.

The committed Wrangler configuration has no public route, deployment account,
Access audience or live catalog name. Missing configuration returns 503.
No catalog inventory or principal list is compiled into the Worker.

See the [Cloudflare runbook](../../docs/deployment/cloudflare-catalog.md) and
[specification](../../specs/catalog-worker/spec.md). Local tests and a bundle dry
run do not constitute a Cloudflare production deployment or restore drill.
