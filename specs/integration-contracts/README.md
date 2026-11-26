# Integration contracts

Versioned, language-neutral contracts between Homer and the Source Systems it observes.
JSON Schema draft 2020-12 is the artifact. `@zs-home/shared-contracts` loads these files; it does not copy them.

## Contracts

- Activity Event (`activity-event.v1.schema.json`): a Collector produces one and the Event Ledger consumes it. Provenance is required. The Event Key prefix before the first `:` must equal `provenance.sourceSystem` (enforced in TypeScript; JSON Schema cannot say that). `actorKind` is present only when `actorId` is present. Both come from an Identity Binding. Unattributed is valid: the raw source account is kept and no Actor is guessed.
- Activity Event version 2 (`activity-event.v2.schema.json`): version 1 plus the `buzz` and `homer` Source Systems and four Kinds: `message.posted`, `knowledge.flagged`, `curator.run_completed`, and `curator.profile_switched`. Defined by the [Buzz spec](../buzz/spec.md) and the [knowledge-loop spec](../knowledge-loop/spec.md). The schema itself admits each new Kind only from its Source Systems: Buzz only posts messages and Knowledge Flags, `homer` only records curator runs and profile switches, and `knowledge.flagged` comes from Buzz, GitHub, or Linear. It fixes the subjects of Buzz events and of curator runs, so no relay or agent text becomes a subject. A `buzz://message` link is allowed only on a Buzz event; everything else stays `https://`. A curator run cites flags by Event Key, not link: `data.addressedFlags` (required) and `data.needsHuman` hold `knowledge.flagged` Event Keys from Buzz, GitHub, or Linear. Validators pick the schema the `contract` field names, version 1, 2 or 3, and check anything else as version 1.
- Activity Event version 3 (`activity-event.v3.schema.json`): version 2 plus the `sparkdash` Source System and two Kinds, `machine.alert_fired` and `machine.alert_cleared`, defined by the [fleet monitoring spec](../fleet-monitoring/spec.md). The schema admits the machine Kinds only from `sparkdash` and `homer`, and `sparkdash` only for them: sparkDash's alerts come from `sparkdash`, and a Reachability Check's from `homer`, whose only rule there is `reachability`, always `critical`. A machine alert carries ids and fixed text only. Its actor is its source's own account (`sparkdash:alerts` or `homer:fleet-collector`), never an Actor. Its `data` is exactly `machineId`, `rule`, `severity`, `startsAt` and `sparkdashVersion`, and it has no evidence, Project, Repository or Task. In TypeScript, its Event Key must be `<source>:<kind>:<machineId>:<rule>:<startsAt in ms>`, its `provenance.sourceObjectId` `<machineId>:<rule>@<startsAt in ms>`, and its subject `<rule name> on <machine name>` (or `... cleared on ...`) with the rule name from Homer's rule catalogue (`FLEET_RULE_NAMES`). No string in it may carry an IPv4 or IPv6 address. Version 3 states the `buzz://` rule for `sourceUrl` inside Provenance itself, so `validateProvenance` checks a Correction's Provenance, from any Source System, against the newest contract. Version 2 stays as it was.
- Activity Event version 4 (`activity-event.v4.schema.json`): version 3 plus the optional metadata of `ZER-35` on a Knowledge Flag, and `software-factory` as a Source System that can raise one. A flag may carry `data.gapKind` (`missing`, `wrong` or `stale`), `data.targetRef` (the repository path, skill slug or document URL that is missing, wrong or stale), `data.observationHash` (the sha256 of the normalized observation, so flags deduplicate without Homer keeping the text), `data.traceRef` (a Langfuse run trace: provider, id and an optional `https://` link, never the trace's payload) and `data.verdictEventKey` (the Event Key of the software-factory Verdict that raised the flag). Every one is optional, and each holds ids, hashes and links only: no flag text, no One Mind content. A `factory.verdict_recorded` event may carry the same `data.traceRef`, and a curator run may cite a `software-factory` flag in `data.addressedFlags` and `data.needsHuman`. Version 3 stays as it was. The same exact-match Identity Binding lookup the Node surface uses is exported as `resolveIdentityBinding` from `@zs-home/shared-contracts/workers`.
- Identity Bindings (`identity-bindings.v1.schema.json`, `home.identity-bindings/v1`): a reviewed snapshot mapping a source account (`github`, `linear` or `buzz`) to one Actor, with the review's evidence link. `homer-catalog` serves it and validates it fail-closed on every read, so a missing or invalid snapshot is a `503`. Lookup is exact-match only: an account with no binding is Unattributed, never guessed from a display name. The schema and its code refuse a repeated `(source, sourceAccount)` pair, a `sourceAccount` whose prefix is not its `source`, one `actorId` bound as two `actorKind`s, an `agent` binding whose `accountableHumanId` is not a `human` actor in the same snapshot, a `human` binding that names one at all, an `evidenceRef` that is not `https://`, and a 32-hex account id anywhere in a link.
- Routing Policy (`routing-policy.v1.schema.json`, `home.routing-policy/v1`): the versioned, read-only model and budget policy the Work Assignment Router reads. `providers` holds each provider's non-secret endpoint host, its per-call and per-Pacific-Time-day budgets, its minimum credit floor and the environment variable *name* its credential is read from; `routes` holds each task class's `ModelRouteRule`s. An endpoint host is a DNS hostname or null, so an IP literal is refused, and no field is a secret, a token or an account id. The code refuses a repeated provider id, a repeated `routeId`, a repeated `(taskClass, priority)` pair and a route whose provider is not declared.
- Fleet Report (`fleet-report.v1.schema.json`): the Fleet Collector produces one per poll and `homer-intake` consumes it. It holds the `sparkdash` state (`ok`, `unreachable`, `metrics_off`, `alerts_off` or `shape_changed`), at most 64 Machines, the Collector's diagnostics from a fixed set of five codes, and at most 100 machine alert events under Activity Event version 3. A Machine's `machineId` follows the runner fleet configuration's id rule, its name is at most 40 letters, digits, spaces, `.`, `_` and `-`, and a reachability-only Machine is kind `ssh`, and only it. In TypeScript, the body is at most 256 KiB of JSON, `machineId`s and diagnostic codes are unique, every sparkDash Machine is `unknown` while sparkDash is `unreachable`, `metrics_off` or `shape_changed`, each event passes its own rules, and no string anywhere carries an IP address: a Machine's address, SSH user, port and key stay on the Collector's host.
- Work Request (`work-request.v1.schema.json`): Homer produces one. software-factory consumes it to start a Work Packet at intake. Homer never advances a packet past intake.
- Factory Event (`factory-event.v1.schema.json`): software-factory produces one when a Work Packet stage changes or a Verdict is recorded. Homer consumes it.

## Contracts by release

Each contract, its schema file, and the product version that first shipped it. A
new contract is listed as `Unreleased` until the release pull request names its
version. A contract id already in the Event Ledger never changes, the `home.*`
ids included. `scripts/check-versions.mjs` fails when a schema file here has no
row.

| Contract id | Schema file | First shipped |
| --- | --- | --- |
| `home.activity-event/v1` | `activity-event.v1.schema.json` | v0.1.0 |
| `home.activity-event/v2` | `activity-event.v2.schema.json` | v0.1.0 |
| `home.activity-event/v3` | `activity-event.v3.schema.json` | Unreleased |
| `home.activity-event/v4` | `activity-event.v4.schema.json` | Unreleased |
| `home.identity-bindings/v1` | `identity-bindings.v1.schema.json` | Unreleased |
| `home.routing-policy/v1` | `routing-policy.v1.schema.json` | Unreleased |
| `home.fleet-report/v1` | `fleet-report.v1.schema.json` | Unreleased |
| `home.work-request/v1` | `work-request.v1.schema.json` | v0.1.0 |
| `home.factory-event/v1` | `factory-event.v1.schema.json` | v0.1.0 |

The Event Ledger's Correction, `home.correction/v1`, has no schema file here: the
ledger defines and validates it (`packages/event-ledger/src/types.ts` and
`validation.ts`). It also first shipped in v0.1.0.

## Upstream Work Packet

`upstream/software-factory/work_packet.schema.json` is a pinned snapshot of software-factory's Work Packet schema, not code. `upstream/software-factory/PIN.json` stores its sha256. Do not edit the snapshot here. Refresh it with `scripts/check-factory-schema.sh` in a reviewed pull request.

## Versioning

An additive optional field is a minor change: update the current major file and its fixtures.
Anything else is a new major file `*.v2.schema.json`: removing or renaming a field, changing what is required, tightening a constraint, or changing the meaning of a value.
Old versions stay, so an Activity Event or Work Request already accepted still validates.
