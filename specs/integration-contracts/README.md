# Integration contracts

Versioned, language-neutral contracts between Homer and the Source Systems it observes.
JSON Schema draft 2020-12 is the artifact. `@zs-home/shared-contracts` loads these files; it does not copy them.

## Contracts

- Activity Event (`activity-event.v1.schema.json`): a Collector produces one and the Event Ledger consumes it. Provenance is required. The Event Key prefix before the first `:` must equal `provenance.sourceSystem` (enforced in TypeScript; JSON Schema cannot say that). `actorKind` is present only when `actorId` is present. Both come from an Identity Binding. Unattributed is valid: the raw source account is kept and no Actor is guessed.
- Activity Event version 2 (`activity-event.v2.schema.json`): version 1 plus the `buzz` and `homer` Source Systems and four Kinds: `message.posted`, `knowledge.flagged`, `curator.run_completed`, and `curator.profile_switched`. Defined by the [Buzz spec](../buzz/spec.md) and the [knowledge-loop spec](../knowledge-loop/spec.md). The schema itself admits each new Kind only from its Source Systems: Buzz only posts messages and Knowledge Flags, `homer` only records curator runs and profile switches, and `knowledge.flagged` comes from Buzz, GitHub, or Linear. It fixes the subjects of Buzz events and of curator runs, so no relay or agent text becomes a subject. A `buzz://message` link is allowed only on a Buzz event; everything else stays `https://`. A curator run cites flags by Event Key, not link: `data.addressedFlags` (required) and `data.needsHuman` hold `knowledge.flagged` Event Keys from Buzz, GitHub, or Linear. Validators pick the schema the `contract` field names, and check anything else as version 1.
- Work Request (`work-request.v1.schema.json`): Homer produces one. software-factory consumes it to start a Work Packet at intake. Homer never advances a packet past intake.
- Factory Event (`factory-event.v1.schema.json`): software-factory produces one when a Work Packet stage changes or a Verdict is recorded. Homer consumes it.

## Upstream Work Packet

`upstream/software-factory/work_packet.schema.json` is a pinned snapshot of software-factory's Work Packet schema, not code. `upstream/software-factory/PIN.json` stores its sha256. Do not edit the snapshot here. Refresh it with `scripts/check-factory-schema.sh` in a reviewed pull request.

## Versioning

An additive optional field is a minor change: update the current major file and its fixtures.
Anything else is a new major file `*.v2.schema.json`: removing or renaming a field, changing what is required, tightening a constraint, or changing the meaning of a value.
Old versions stay, so an Activity Event or Work Request already accepted still validates.
