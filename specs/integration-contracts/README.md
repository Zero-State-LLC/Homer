# Integration contracts

Versioned, language-neutral contracts between HOME and the Source Systems it observes.
JSON Schema draft 2020-12 is the artifact. `@zs-home/shared-contracts` loads these files; it does not copy them.

## Contracts

- Activity Event (`activity-event.v1.schema.json`): a Collector produces one and the Event Ledger consumes it. Provenance is required. The Event Key prefix before the first `:` must equal `provenance.sourceSystem` (enforced in TypeScript; JSON Schema cannot say that). `actorKind` is present only when `actorId` is present. Both come from an Identity Binding. Unattributed is valid: the raw source account is kept and no Actor is guessed.
- Work Request (`work-request.v1.schema.json`): HOME produces one. software-factory consumes it to start a Work Packet at intake. HOME never advances a packet past intake.
- Factory Event (`factory-event.v1.schema.json`): software-factory produces one when a Work Packet stage changes or a Verdict is recorded. HOME consumes it.

## Upstream Work Packet

`upstream/software-factory/work_packet.schema.json` is a pinned snapshot of software-factory's Work Packet schema, not code. `upstream/software-factory/PIN.json` stores its sha256. Do not edit the snapshot here. Refresh it with `scripts/check-factory-schema.sh` in a reviewed pull request.

## Versioning

An additive optional field is a minor change: update the current major file and its fixtures.
Anything else is a new major file `*.v2.schema.json`: removing or renaming a field, changing what is required, tightening a constraint, or changing the meaning of a value.
Old versions stay, so an Activity Event or Work Request already accepted still validates.
