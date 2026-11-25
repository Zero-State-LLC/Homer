# Intake Worker

`homer-intake` takes every route a machine pushes to
([ADR 013](../../specs/adr/013-catalog-worker-boundary.md)). It holds no read or
admin audience and serves no page.

| Operation | Route | Proof |
| --- | --- | --- |
| Collect a merged pull request or a workflow job | `POST /v1/hooks/github` | GitHub HMAC-SHA256, no Access |
| A controller reads its machine's desired state | `GET /v1/runner-controller/poll` | Access, `RUNNER_CONTROLLER_AUD`, workload only |
| A controller reports what its host observed | `POST /v1/runner-controller/report` | Access, `RUNNER_CONTROLLER_AUD`, workload only |

`intakeRoutes` in `src/index.ts` is the caller table; a path not in it answers
`404`. Job evidence (`WorkflowJobEvidenceObject`) is defined here. The
repository catalog and the runner fleet are `homer-catalog`'s namespaces, bound
by `script_name`, so the catalog deploys first.

The webhook reads the current catalog per delivery and awaits a durable ledger
receipt; see the [webhook spec](../../specs/github-webhook/spec.md) and
[runner work evidence](../../specs/runner-work-evidence/spec.md). The controller
protocol is in the [runner controller spec](../../specs/runner-controller/spec.md).
Deployment, Access and rollback: [`docs/deployment/intake.md`](../../docs/deployment/intake.md).
