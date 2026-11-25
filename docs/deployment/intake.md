# Intake Worker deployment and rollback

`homer-intake` is the Worker for machines ([ADR 013](../../specs/adr/013-catalog-worker-boundary.md)).
It takes every route a machine pushes to: the GitHub webhook, with job evidence,
the runner controller protocol, and fleet reports. It
holds no read or admin audience, serves no page and has no `GET /v1/version`.
The routes people use are in [`cloudflare-catalog.md`](cloudflare-catalog.md).

| Route | Caller | Proof |
| --- | --- | --- |
| `POST /v1/hooks/github` | GitHub | HMAC-SHA256 over the body, no Access |
| `GET /v1/runner-controller/poll?machineId=...` | A machine's controller | Access, `RUNNER_CONTROLLER_AUD`, workload only |
| `POST /v1/runner-controller/report?machineId=...` | A machine's controller | Access, `RUNNER_CONTROLLER_AUD`, workload only |
| `POST /v1/fleet/report` | The Fleet Collector | Access, `FLEET_COLLECTOR_AUD`, workload only |

The router refuses any other path with `404` before a handler runs. Enrollment,
the fleet pages and the lifecycle controls stay in `homer-catalog`, behind its
admin audience.

## Required environment configuration

Supply these through Cloudflare's deployment configuration, never committed
source or chat logs:

| Binding | Purpose |
| --- | --- |
| `ACCESS_ISSUER` | The same team issuer as `homer-catalog`, so a machine's principal digest is the one an admin enrolled |
| `RUNNER_CONTROLLER_AUD` | The audience of intake's own Access application for the controller paths |
| `FLEET_COLLECTOR_AUD` | The audience of intake's own Access application for `/v1/fleet/report`; it must differ from `RUNNER_CONTROLLER_AUD` |
| `CATALOG_NAME` | The same value as `homer-catalog` in this environment; it names the objects both Workers share |
| `GITHUB_WEBHOOK_SECRET` | High-entropy webhook secret, installed as a Workers secret |
| `EVENT_LEDGER` | Cross-Worker binding to the ledger's `EventLedgerObject` namespace, added per environment |
| `MAPPING_CATALOG`, `RUNNER_FLEET` | `homer-catalog`'s namespaces, committed in `wrangler.jsonc` by `script_name` |
| `JOB_EVIDENCE` | Intake's own namespace, with the `job-evidence-v1` migration |
| `GITHUB_JOB_INGEST_ENABLED` | `true` only once job evidence's activation conditions are met; otherwise `workflow_job` deliveries are acknowledged and ignored |
| `CF_VERSION_METADATA` | Cloudflare's version metadata binding, committed in `wrangler.jsonc`; read from Wrangler's output, not served |

Bindings point one way. Intake binds the catalog's namespaces, and the catalog
binds nothing of intake's. A binding to another Worker's namespace must resolve
at upload, so deploy `homer-catalog` first. An environment whose catalog Worker
has another name sets `script_name` to that name in its own configuration.

Add `EVENT_LEDGER` in the environment's configuration, as the catalog guide
describes: class `EventLedgerObject`, `script_name` the environment's ledger
Worker, never a migration or export here. The ledger object name `event-ledger`
is a storage identity. Until the secret and this binding are supplied, the
webhook answers `503`. Until `RUNNER_CONTROLLER_AUD` is set, the controller
paths answer `503`.

## Access applications and hostname

Put intake on its own hostname. Cover the two controller paths with an Access
application of their own, with service-token policies only, and set its
audience as `RUNNER_CONTROLLER_AUD`. Its audience must differ from the catalog's
read and admin audiences; intake does not hold those, so it cannot check this
for you. Leave `/v1/hooks/github` outside Access, as GitHub cannot present an
Access token, and add no Bypass policy anywhere. Intake still verifies every
controller token itself: signature, issuer, the exact audience, and an empty
subject with a service `common_name`.

### The GitHub webhook

Configure a GitHub repository or organization webhook with application/json,
the exact route on intake's hostname, the same secret, SSL verification enabled
and `pull_request` events only. Subscribe `workflow_job` only under the
activation conditions in [runner work evidence](../../specs/runner-work-evidence/spec.md).
Register it only for the intended source scope. The runtime catalog is a second
admission boundary: unknown and disabled repositories are ignored. No delivery
id, sender header or login grants repository access.

Test a signed ping, merged PR and repeated delivery. Acknowledgement follows the
durable append, with a 201 appended or 200 Duplicate receipt. Check non-2xx results
and deliveries exceeding GitHub's response timeout. GitHub does not automatically
redeliver failures. Redeliver after resolving the cause; reconcile 409 Conflicts
with reviewed Corrections. Bodies over 1 MiB require investigation or later REST
backfill. Ignored deliveries are acknowledged and will require explicit backfill
if the repository is enabled later. Do not claim complete historical coverage.
Confirm the expected ledger head through an authorized internal binding before
enabling collection.

Rotate the Workers secret and GitHub webhook secret in a coordinated maintenance
window, then redeliver failures from the transition. No overlap key is retained by
this implementation. Do not print secret values, raw payloads or JWTs in evidence.

### Fleet reports

Cover `/v1/fleet/report` with an Access application of its own, with a
service-token policy for the Fleet Collector only, and set its audience as
`FLEET_COLLECTOR_AUD`. Until it is set, or while it equals
`RUNNER_CONTROLLER_AUD`, the route answers `503`. An admin then binds the
Collector's principal digest to the Machines it reports on with
`PUT /v1/admin/fleet/collector` on `homer-catalog` (If-Match the current
revision). Until that binding exists, every report is `403`. The Collector's
own setup is in the fleet monitoring runbook (ZER-83).

Each report's events are appended to the Event Ledger before its receipt is
stored, so `EVENT_LEDGER` is needed here too. At most 6 new reports a minute are
taken; the Collector backs off on `429`. Receipts are kept, report bodies are
not, and receipts are not yet pruned: about 2,880 a day.

### The runner controller

A controller is enrolled and qualified as in [`runner-fleet.md`](runner-fleet.md).

## Build and isolated qualification

From the repository root:

```sh
npm ci --no-audit --no-fund
npm run check
npx wrangler deploy --dry-run --config packages/intake-worker/wrangler.jsonc
```

The dry run bundles only and creates nothing hosted. Its test configuration,
`packages/intake-worker/test/wrangler.jsonc`, exports the catalog's and the
ledger's classes into local namespaces so the tests can run alone; it must never
be deployed.

## Deploy and receipt

Deploy in the order the [release runbook](releases.md#deploy-a-worker) gives:
the ledger, then `homer-catalog`, then `homer-intake`. The deploy receipt takes
the version from Wrangler's output and `wrangler versions view`, as for the
ledger. Its migration tags are `job-evidence-v1`.

## Live acceptance before production

- No token, a forged, expired or wrong-issuer token, the catalog's read or
  admin audience, a person with the controller audience, and a mixed or
  repeated audience all fail on the controller paths.
- A controller reaches only its bound machine; a disabled or replaced binding
  stops it at once.
- A runner controller's token, a person, an unbound workload and a report
  naming an unbound machine all fail on `/v1/fleet/report`, and nothing is
  recorded.
- Every catalog path, `/v1/version` included, answers `404` on intake's
  hostname.
- A signed ping, a merged pull request and a repeated delivery behave as the
  webhook spec says; a failed append answers `503`, and redelivery yields at
  most one entry.
- Responses and logs carry no tokens, secrets or raw payloads.

## Rollback

Pause GitHub deliveries, then roll intake back to its last verified version:
`npx wrangler rollback <version-id> --config <environment config>`. A rollback
cannot cross the `job-evidence-v1` migration; keep the `WorkflowJobEvidenceObject`
export while stored objects exist. Rolling intake back leaves `homer-catalog`,
enrollment and the catalog untouched. A `homer-catalog` rollback that crosses one
of its own migrations pins intake as well, because intake binds those
namespaces. Inspect and redeliver failures from the pause. Never delete
Durable Object storage or remove a migration to undo an application bug.

Job evidence has no archive or restore path yet. Its capacity ceiling stays
fail-closed pending a reviewed retention contract
([runner work evidence](../../specs/runner-work-evidence/spec.md)).
