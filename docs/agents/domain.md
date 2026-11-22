# Domain docs

How Pocock's engineering skills (`mattpocock-skills`) read Homer's domain
documentation. Homer is single-context: one glossary for the whole
repository, including every package under `packages/`.

Accepted in [`docs/intent/agent-workflow.md`](../intent/agent-workflow.md).

## Before exploring, read these

- [`CONTEXT.md`](../../CONTEXT.md) at the repository root. It is Homer's
  glossary. Homer keeps the name `CONTEXT.md`; do not create or rename to
  `GLOSSARY.md`, and do not add a `GLOSSARY-MAP.md`.
- The active intent in [`docs/intent/`](../intent/) and the spec for the
  area in [`specs/`](../../specs/).
- Decisions:
  - Homer-only decisions and evidence: [`docs/receipts/`](../receipts/).
  - Team-wide decisions: `DECISIONS.md` in
    [`Zero-State-LLC/agent-context`](https://github.com/Zero-State-LLC/agent-context),
    loaded as [`AGENTS.md`](../../AGENTS.md) describes. Do not copy them
    into Homer.

Homer has no `docs/adr/` folder. When a skill wants to write an ADR,
write a receipt in `docs/receipts/` instead, named like the existing ones
(`<kind>-<YYYY-MM-DD>.md`). A team-wide decision goes to agent-context
`DECISIONS.md`.

## Use the glossary's vocabulary

When your output names a domain concept (in a Task title, a refactor
proposal, a hypothesis, a test name), use the term exactly as
`CONTEXT.md` defines it, and never a word listed under `_Avoid_`.
For example: Activity Event, not log entry; Task, not ticket; Collector,
not sync job.

If the concept you need is not in `CONTEXT.md`, either you are inventing
language Homer does not use, or there is a real gap. Land a resolved
term in `CONTEXT.md` in the same format (bold term, definition, `_Avoid_`
line), as [`CONTRIBUTING.md`](../../CONTRIBUTING.md) says. Never turn a
guess into a glossary term.

## Flag conflicts

If your output contradicts an accepted intent, a spec, a receipt, an
`AGENTS.md` invariant, or an agent-context decision, say so explicitly
instead of overriding it silently. For example:

> _Contradicts the Event Ledger spec (`specs/event-ledger/spec.md`), but
> worth raising because..._
