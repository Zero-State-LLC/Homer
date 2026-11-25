# ADR 013: split the catalog Worker by who calls it

Status: accepted by Danny on 2026-11-24 (#85), before fleet intake (ZER-80) starts.
Task: ZER-88. Audit: [`docs/receipts/main-audit-2026-11-24.md`](../../docs/receipts/main-audit-2026-11-24.md),
finding M4.

## Context

One Worker, `homer-catalog`, has become Homer's whole back end. It serves eight
concerns, and fleet intake would add a ninth [verified: route sets in
`packages/catalog-worker/src/*.ts` and `wrangler.jsonc` on `main`]:

| Concern | Who calls it | How the caller proves who it is | Storage it touches |
| --- | --- | --- | --- |
| Repository catalog | People and agents | Access, read or admin audience | `MAPPING_CATALOG` |
| Admin pages and the catalog editor | People | Access, admin audience | `MAPPING_CATALOG` |
| Credential directory views | People | Access, read audience | `CREDENTIAL_DIRECTORY` service |
| Activity Calendar | People | Access, read audience | `EVENT_LEDGER` (reads) |
| Runner fleet pages and enrollment | People | Access, admin audience | `RUNNER_FLEET` |
| GitHub webhook and job evidence | GitHub | HMAC signature, no Access | `MAPPING_CATALOG` (reads), `EVENT_LEDGER` (appends), `JOB_EVIDENCE` |
| Runner controller protocol | Machines | Access, `RUNNER_CONTROLLER_AUD`, workload only | `RUNNER_FLEET` |
| `GET /v1/version` | People and agents | Access, read audience | none |
| Fleet intake (ZER-80, not built) | The Fleet Collector | Access, `FLEET_COLLECTOR_AUD`, workload only | `RUNNER_FLEET`, `EVENT_LEDGER` (appends) |

All of it is one deploy, one set of Access applications, and one list of Durable
Object migrations. Three things follow from that:

- **Blast radius.** The route that anyone on the internet can reach, the GitHub
  webhook, runs in the same Worker as the admin pages. That Worker holds the
  admin audiences, the webhook secret and the Event Ledger binding, which can
  append. A bug in any one concern runs with all of it.
- **Deploys.** A change to a page redeploys the webhook and the controller
  protocol, and the reverse. A rollback cannot cross a Durable Object
  migration, so the first new class for any concern pins every other concern's
  rollback.
- **Access.** Human audiences and workload audiences share one hostname and one
  router. The deployment guide already asks for the webhook on a dedicated
  hostname, which one Worker cannot fully give.

No Worker is deployed yet (`SECURITY.md`). A split now costs only code. After
the first deploy it would also cost a Durable Object transfer and new Access
applications.

## Decision

Split by who calls it: one Worker for people, one for machines. The Event
Ledger Worker and the two recovery Workers stay as they are.

1. **`homer-catalog`, for people.** It keeps every route a person or agent
   reaches through Access with the read or admin audience:
   - the catalog, admin pages and editor;
   - the credential directory views and the Activity Calendar;
   - runner fleet pages and enrollment;
   - `GET /v1/version`.

   It holds the read and admin audiences only, and no workload audience or
   webhook secret.
2. **`homer-intake`, for machines.** A new Worker takes every route a machine
   pushes to:
   - the GitHub webhook and job evidence, by HMAC;
   - the runner controller protocol, with `RUNNER_CONTROLLER_AUD`;
   - fleet intake, with `FLEET_COLLECTOR_AUD`.

   It holds no human audience and serves no page. It runs on its own hostname.
   Its controller and fleet paths sit behind their own Access applications. The
   webhook path sits behind none, as today.
3. **Bindings point one way.** A Durable Object namespace exists once its
   defining Worker is deployed, and a binding to it must resolve at upload. So
   no two Workers may bind each other's namespaces, or the first deploy into an
   empty environment cannot succeed.
   - `homer-catalog` defines what people review and change: `MAPPING_CATALOG`
     and `RUNNER_FLEET`, which holds enrollment.
   - `homer-intake` defines only what nothing else reads: `JOB_EVIDENCE`. It
     binds `MAPPING_CATALOG`, to admit repositories, and `RUNNER_FLEET`, to
     record reports, by `script_name`.
   - Both bind the ledger's namespace, as the catalog does today.
   - Both use the same `CATALOG_NAME`, which names the objects they share.
   - A later class that `homer-catalog` must read is defined in `homer-catalog`.
     `homer-catalog` never binds a namespace that `homer-intake` defines.
4. **A route declares its caller.** Each Worker's router names, for every path,
   its principal kind and audience, and refuses a request a path does not
   expect. A new concern goes to the Worker of its caller. A new concern that
   is neither, or a third Worker, needs its own ADR.
5. **Versions.** `homer-intake` has no human audience, so it does not serve
   `GET /v1/version`. Like the Event Ledger Worker, its deploy receipt takes the
   version from Wrangler's output (versioning spec, "Worker version").

## Options considered

| Option | Blast radius | Deploys | Access | Cost |
| --- | --- | --- | --- | --- |
| **Keep one Worker**, and add fleet intake to it | Everything shares the webhook's exposure and the ledger binding | One deploy and one migration list for nine concerns | Human and workload audiences in one router, on one hostname | None now; a split after deploy costs a Durable Object transfer |
| **Split by caller (chosen)** | A page bug cannot reach the webhook secret or workload audiences; an intake bug cannot reach the admin audiences | Pages and intake deploy and roll back apart, except that a migration in `homer-catalog` pins both | Human and workload Access applications on separate hostnames | One more Worker, config, test config and deploy receipt; one-way cross-script bindings |
| **One Worker per concern** | Smallest | Nine deploys, nine receipts | Nine sets of Access applications | Too much to run for a team of two |

## Consequences

- One implementation Task, before ZER-80. It covers:
  - a new `packages/intake-worker` with the webhook, job evidence and
    controller routes moved from `packages/catalog-worker`;
  - its Wrangler, test and recovery configuration;
  - the router's caller table in both Workers;
  - the browser journey and runtime smoke updated;
  - `docs/deployment/cloudflare-catalog.md` split, with a new intake guide.

  The routes, contracts and stored formats do not change.
- Fleet intake (ZER-80) is built in `homer-intake`. The fleet monitoring spec's
  "Intake (Homer Worker)" means `homer-intake`. The runner controller spec is
  amended to name it.
- Both Workers still hold the Event Ledger binding, and a Durable Object binding
  cannot be limited to reads. A read-only ledger entrypoint for
  `homer-catalog`'s calendar is a separate choice, not part of this ADR.
- The release runbook deploys the ledger, then `homer-catalog`, then
  `homer-intake`, which binds the catalog's namespaces. The bindings point one
  way, so this order works from an empty environment. Each Worker gets a deploy
  receipt.
- If Danny keeps one Worker instead, rules 4 and 5 still apply to
  `homer-catalog`, and fleet intake is built there as the fleet spec says.

## References

- [Fleet monitoring spec](../fleet-monitoring/spec.md), "Intake (Homer Worker)"
  and ADR 011.
- [Runner controller protocol](../runner-controller/spec.md).
- [Cloudflare catalog deployment](../../docs/deployment/cloudflare-catalog.md):
  the webhook on a dedicated hostname, cross-Worker ledger binding.
- [Release runbook](../../docs/deployment/releases.md): deploy order and
  receipts.
