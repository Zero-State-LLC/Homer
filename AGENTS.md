# Agent contract — Homer

You are working in **Homer** (`Zero-State-LLC/Homer`), the Zero State engineering headquarters.
This file is the canonical contract for Cursor, Claude, Codex, Grok, Hermes, and OpenClaw.
Harness adapters (`CLAUDE.md`) only point here.

## Intent

Read the active intent in `docs/intent/` before you edit. The next stage is the spec in `specs/`. Do not skip to code.

If the change is non-trivial and no intent exists, draft one from the agent-context template (`templates/intent.md.template` at the Context Pin) and wait for a human to accept it.

Cite the intent, the spec section, any `CONTEXT.md` term, and any pinned agent-context file (`HANDOFF.md`, `STATUS.md`, `DECISIONS.md`) you used; if you could not find one, say so.

## Language

Read [`CONTEXT.md`](CONTEXT.md) first. Use its terms exactly in code, tests, specs, issues, and pull requests (Activity Event, not log entry; Task, not ticket; Collector, not sync job).

## Commands

| Task | Command |
|---|---|
| Check the agent-context pin and this file | `bash scripts/check-context-pin.sh` |
| Prove the pin check can fail | `bash scripts/test-check-context-pin.sh` |

Commands for the TypeScript workspace arrive with that workspace. Do not invent commands.

## Invariants

- The Event Ledger is append-only. Fix a wrong Activity Event with a Correction. Do not edit the original.
- Do not attribute an Activity Event to an Actor without an Identity Binding. Unattributed is a valid answer.
- Do not invent a Milestone date. Unknown Date is a valid answer.
- Linear owns Tasks. GitHub owns Repository Events. The Control Room owns Work Sessions. software-factory owns Work Packets and Verdicts. Homer observes and projects.
- Do not copy software-factory code or agent-context skills into this repository. Integrate through `specs/integration-contracts/` and the Context Pin.
- Do not expose One Mind content through any Homer API or Projection.
- Do not put secrets, tokens, account ids, or live credentials in the tree, logs, or pull request text.

## Escalation

If CI, tests, or validators look wrong — missing coverage, silent skips, green-but-inert checks, or a suite that contradicts the spec:

1. Open a defect issue with label `defect`.
2. Do **not** patch tests, fixtures, or CI to force green.
3. Do **not** weaken an assertion to match a broken implementation.

A red honest check is better than a green lie.

## Merge and deploy

- Nothing merges without Danny's explicit yes. The software-factory merge contract applies: CI is green, an online passing Verdict for the current head SHA comes from a judge independent of the author model, and the reproduce check passes.
- No production deploy, Control Room cutover, credential change, or destructive migration without a human yes.
- Do not weaken the `main` ruleset or a CI check to land a change.

## Team context

Org and partner status is not this repository. Load `Zero-State-LLC/agent-context`:

1. `HANDOFF.md`
2. `STATUS.md`
3. `DECISIONS.md` only if a prior choice affects this task

Clone: `gh repo clone Zero-State-LLC/agent-context ~/agent-context`.
Pull `--ff-only` before you trust a local copy. Homer pins the files it consumes in `agent-context.pin.json`.

## Skills

Name only skills that already exist. Do not invent skills or bots.
Defaults: `anti-slop-code`, `production-systems`, `google-developer-style`, plus `zero-state-context` from agent-context.

## Size

Keep this file short (about 80 lines; hard ceiling 12 KB).
Move procedure and gotchas out, not in.
