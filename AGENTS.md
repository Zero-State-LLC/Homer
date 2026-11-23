# Agent contract — Homer

You are working in **Homer** (`Zero-State-LLC/Homer`), the Zero State engineering headquarters.
This file is the canonical contract for Cursor, Claude, Codex, Grok, Hermes and OpenClaw.
Harness adapters (`CLAUDE.md`) only point here.

## Intent

Read the active intent in `docs/intent/` before editing. Next stage is the spec in `specs/` — do not skip to code.

If the change is non-trivial and no intent exists, draft one from the agent-context template (`templates/intent.md.template` at the Context Pin) and wait for a human to accept it.

Cite the intent, the spec section, any `CONTEXT.md` term, and any pinned agent-context file (`HANDOFF.md`, `STATUS.md`, `DECISIONS.md`) you used; if you could not find one, say so.

## Language

Read [`CONTEXT.md`](CONTEXT.md) first. Use its terms exactly in code, tests, specs, issues and PRs (Activity Event, not log entry; Task, not ticket; Collector, not sync job).

## Commands

| Task | Command |
|---|---|
| Check the agent-context pin and this file | `bash scripts/check-context-pin.sh` |
| Prove the pin check can fail | `bash scripts/test-check-context-pin.sh` |
| Check the TypeScript workspace | `npm run check` |

`npm run check` runs format, lint, typecheck, tests and build. Do not invent commands.

## Invariants

- The Event Ledger is append-only. Fix a wrong Activity Event with a Correction, never an edit.
- Never attribute an Activity Event to an Actor without an Identity Binding. Unattributed is a valid answer.
- Never invent a Milestone date. Unknown Date is a valid answer.
- Linear owns Tasks, GitHub owns Repository Events, the Control Room owns Work Sessions, software-factory owns Work Packets and Verdicts. Homer observes and projects.
- Do not copy software-factory code or agent-context skills into this repo. Integrate through `specs/integration-contracts/` and the Context Pin.
- Never expose One Mind content through any Homer API or Projection.
- Do not put secrets, tokens, account ids or live credentials in the tree, logs or PR text.

## Escalation

If CI, tests, or validators look wrong — missing coverage, silent skips,
green-but-inert checks, or a suite that contradicts the spec:

1. Open a defect issue with label `defect`.
2. Do **not** patch tests, fixtures, or CI to force green.
3. Do **not** weaken an assertion to match a broken implementation.

A red honest check is better than a green lie.

## Merge and deploy

- Nothing merges without Danny's explicit yes.
- A pull request that touches code, configuration or CI also needs the software-factory merge contract: CI green, an online passing Verdict for the current head SHA from a judge independent of the author model, and a passing reproduce check.
- A docs-only pull request, one that changes only Markdown files and nothing under `.github/`, needs CI green and a clean Codex review of the current head SHA instead of a Verdict (Danny, 2026-11-23).
- No production deploy, Control Room cutover, credential change or destructive migration without a human yes.
- Never weaken the `main` ruleset or a CI check to land a change.

## Team context

Org and partner status is not this repo. Load `Zero-State-LLC/agent-context`:

1. `HANDOFF.md`
2. `STATUS.md`
3. `DECISIONS.md` only if a prior choice affects this task

Clone: `gh repo clone Zero-State-LLC/agent-context ~/agent-context`.
Pull `--ff-only` before trusting a local copy. Homer pins the files it consumes in `agent-context.pin.json`.

## Skills

Name only skills that already exist. Do not invent skills or bots.
Defaults: `anti-slop-code`, `production-systems`, `google-developer-style`, plus `zero-state-context` from agent-context.
Pocock's engineering skills (`mattpocock-skills`) are installed per machine as a plugin; never copy them into Homer.

## Agent skills

### Issue tracker

Tasks in Linear team ZER, specs in `specs/`, defects as GitHub issues. See `docs/agents/issue-tracker.md`; triage labels in `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md`, decisions in `docs/receipts/` and agent-context. See `docs/agents/domain.md`.

## Code map

If `.trail/cache/` exists (Trail-code's local map; a grep from the root skips it), run `trail ask "<task>" --source` before grepping. Otherwise start at `docs/map.md`. Do not copy a code map into this file.

## Size

Keep this file short (about 80 lines; hard ceiling 12 KB).
Move procedure and gotchas out, not in.
