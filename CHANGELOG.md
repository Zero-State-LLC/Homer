# Changelog

All notable changes to Homer are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions: [SemVer](https://semver.org/).

## Unreleased

### Added

- `@zs-home/work-request-emitter` and `npm run work-request -- <source>` (ZER-73): reads a Linear Task, GitHub issue or manual request, records each Work Request once in an append-only store, prints the recorded bytes on a retry without asking Jev again, and reads credentials from 1Password by reference.

- Homer's Work Request policy (`docs/work-requests/policy.json`) and the Jev risk-tier client in `@zs-home/shared-contracts` (ZER-72), which asks Jev through Cloudflare Workers AI and never repeats a credential.

- The pure Work Request builder in `@zs-home/shared-contracts` (ZER-71): reads Linear, GitHub and manual sources, refuses bad ones with the spec's reason codes, derives every field, and turns Jev's answer into a risk tier.

- Pocock skills: `/to-tickets` writes Tasks to Linear team ZER, `/triage` is on with labels mapped in `docs/agents/triage-labels.md`, and `/implement-spec` may run implementers in parallel.

- Trail code map wiring for Claude Code (`trail init --team --agents claude`, Trail 0.30.5): shared `.claude/settings.json` SessionStart hook, `.trail/hook.cjs` shim and a `## Code map` rule in `AGENTS.md`. Telemetry disabled.

- Accepted agent-workflow intent and Pocock engineering skills config: an `## Agent skills` block in `AGENTS.md`, `docs/agents/issue-tracker.md` (Tasks in Linear) and `docs/agents/domain.md` (`CONTEXT.md` glossary), and a `CLAUDE.md` import of `AGENTS.md`.

- Signed GitHub merge webhook Collector with live catalog admission, awaited
  Event Ledger receipts, duplicate delivery protection and explicit failure results.

- Cloudflare catalog API with Access JWT validation, separate read/admin audiences,
  durable revision checks and immutable mapping history.

- Runtime GitHub repository mappings and listings with validated revision updates,
  plus a merged-PR mapping that excludes free text and preserves unknown identity.

- Homer hero artwork and repository branding.

- Draft Galadriel intent for the operations and orchestration layer.

- Front-door map (`docs/map.md`), a cite-the-file-used rule, and a "Land the fix" section in `CONTRIBUTING.md`.

- Renamed the product and repository from HOME (`Zero-State-LLC/home`) to Homer (`Zero-State-LLC/Homer`).
- Cloudflare Durable Object Event Ledger with Corrections, digest verification and paged replay.
- Build-time Workers validator, plain runtime smoke, Activity Calendar and Project Timeline data.
- Verified Control Room source preservation map and migration/rollback plan.

- TypeScript workspace (`npm run check`) and versioned integration contracts for the Activity Event, the Work Request, and the Factory Event, with contract tests against the pinned software-factory Work Packet schema.
- Governance foundation: `AGENTS.md`, `CLAUDE.md` adapter, `CONTEXT.md` glossary, `SECURITY.md`, `CONTRIBUTING.md`, CODEOWNERS, issue and PR templates.
- Accepted stage-zero intent `docs/intent/home-foundation.md`.
- agent-context Context Pin with a CI check and negative tests.
- CI: docs lint, link check, gitleaks secret scan, Dependabot for GitHub Actions.

### Changed

- Context Pin moves to agent-context `a4b7b7e`, whose `AGENTS.md` template checks Trail-code's `.trail/cache/` map and records Homer's Pocock exception. Only `templates/AGENTS.md.template` changes digest.

### Fixed

- The `## Code map` rule in `AGENTS.md` now checks for `.trail/cache/`, where Trail 0.30.5 keeps the map, instead of `graft/`, which a repository on Trail does not have.

- Node consumers can import the built `@zs-home/shared-contracts` workspace package by name.

- Validate Work Requests before packet conversion and detach caller-owned arrays.
- Treat rate-limited documentation links as failed checks after retries.
- Clarify the specification acceptance date in UTC and Pacific Time.
- Pin Work Packet plan links to a retained commit and assign replay corruption coverage to ZER-21.
- Preserve client input and integrity errors, cover byte-capped paging, align runtime versions, and guard the local smoke route.
- Poll a read-only readiness route before the smoke check writes synthetic events.
- Report Source Freshness conflicts and invalid checkpoints; document Projection edge semantics.
- Refresh merge order and evidence requirements after the Homer rename and branch reconciliation.
