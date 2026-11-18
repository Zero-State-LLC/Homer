# @zs-home/shared-contracts

Types and validators for HOME integration contracts.

Run `npm run build` from the repository root before importing the package in Node.

Schemas are loaded from `specs/integration-contracts/` at runtime. They are not copied into this package.

- `validateActivityEvent`, `validateWorkRequest`, and `validateFactoryEvent` return `{ ok: true, value }` or `{ ok: false, errors }`.
- `toWorkPacket` maps a Work Request to a software-factory Work Packet at stage `intake`. It does not set `author_model` or `history`.
- `loadUpstreamWorkPacketSchema` reads the pinned Work Packet snapshot and throws if its sha256 does not match `PIN.json`.

See [Integration contracts](../../specs/integration-contracts/README.md).
