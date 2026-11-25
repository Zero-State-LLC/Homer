# Changelog

All notable changes to Homer are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions: [SemVer](https://semver.org/).

## Unreleased

### Added

- The pure core of the Fleet Collector, `packages/fleet-collector` (ZER-78, fleet monitoring packet 2). It parses sparkDash's `/api/health`, `/metrics` and `/api/alerts`, keeping only the fields the spec lists. It applies the continuity rules on sparkDash's history (none, contiguous, gap, restart) and builds each poll's Machines and `machine.alert_fired` and `machine.alert_cleared` events. It holds `collector_gap` and `sparkdash_restarted` until a delivered report carries them, and builds a Fleet Report of at most 100 events. Names are cleaned, untrusted text is dropped on read, and a report with an IP address anywhere is refused. No network, files or clock: the runtime is packet 3.

- Activity Event contract version 3 and the Fleet Report contract, `home.fleet-report/v1` (ZER-77, fleet monitoring packet 1). Version 3 is version 2 plus the `sparkdash` Source System and the `machine.alert_fired` and `machine.alert_cleared` Kinds, admitted only from `sparkdash` and from `homer` for a Reachability Check; version 2 stays. A machine alert carries ids and fixed text only: its Event Key, object id and subject are built from its machine, rule and start time and Homer's rule catalogue, and no IP address may appear in it. A Fleet Report holds at most 64 Machines and 100 events in at most 256 KiB, and carries no address. `@zs-home/shared-contracts` validates both, in Node and in Workers (`validateFleetReport`), and exports the rule catalogue and the address check for the Fleet Collector. The Event Ledger now checks a Correction's Provenance with `validateProvenance`, against version 3, so a Correction can carry `sparkdash` Provenance; it no longer builds a synthetic version 2 event for that check.

- Accepted ADR 013 (ZER-88): split the catalog Worker by who calls it. `homer-catalog` keeps the routes people reach through Access with the read or admin audience. A new `homer-intake` takes the GitHub webhook and job evidence, the runner controller protocol and fleet intake, with workload audiences only. Durable Object bindings point one way, from intake to the catalog. Not built yet.

- The runbook from a Task to a Verdict, `docs/deployment/work-requests.md` (ZER-74): emit the Work Request, build the judge's packet, run `factory judge run --reproduce` and `factory judge gate`, and post the Verdict on the pull request, with every credential named by its 1Password reference. Two commands support it. `npm --silent run work-packet -- <request.json> --author-model <provider/model>` prints `toWorkPacket`'s packet plus the author model, as ASCII JSON; the packet stays at intake. `npm --silent run verdict-comment -- <verdict.json> <gate.json>` prints the pull request comment for a Verdict and the gate's answer.

- The release runbook, `docs/deployment/releases.md` (ZER-95): preparing a release pull request, Danny's tag and GitHub Release, deploying a Worker from a clean clone of the tag, the deploy receipt format, and the Release Gate. `node scripts/deploy-check.mjs vX.Y.Z` refuses a deploy unless HEAD is the annotated tag's commit, the tree is clean, the version and CHANGELOG section match the tag, and the build is that commit's, not `.dirty` or `+unknown`. `CONTEXT.md` defines Release, Build Version and Deploy Receipt, and its Release Gate names the four checks.

- The catalog Worker answers `GET /v1/version` behind Access with the read audience (ZER-94): the product version, the Build Version, and Cloudflare's version id and upload tag, nothing else. Every deployable Wrangler file binds `version_metadata` as `CF_VERSION_METADATA`. The Event Ledger and recovery Workers have no HTTP surface and get none for this; their deploy receipt takes the version from Wrangler's output.

- Release notes from the CHANGELOG (ZER-93): `node scripts/release-notes.mjs vX.Y.Z` prints that version's section. `scripts/check-versions.mjs` now also fails when Unreleased is not first, a section holds anything but the six Keep a Changelog subsections, releases are out of order, or the product version has no section of its own. The contracts README lists each contract with the product version that first shipped it.

- One lockstep product version (ZER-91): `node scripts/version.mjs <version>` sets the root, every workspace package, every internal dependency and the lock file, and refuses a version that is not SemVer or not above the current one. `scripts/check-versions.mjs` fails when any of them disagree, as its own Versions step in CI and in `npm run check`. The root package is renamed `homer`; the version stays `0.0.0` until the first release.

- Reviewed machine enrollment, and audited resume, drain, disconnect and revoke controls, with separate controller and runner evidence.

- Machine-scoped runner controller polling, durable host reports and a portable safe reconciliation core.

- ADRs and operator surfaces for evidence-linked work calendars and revisioned PC/Mac runner fleet intent.

- Accepted versioning and releases intent and spec (`specs/versioning/spec.md`) and ADR 012: one lockstep product version, a build version on every Activity Event, `GET /v1/version` on every Worker, release tags cut only by Danny, and a receipt for every deploy.

- Accepted fleet monitoring intent and spec (`specs/fleet-monitoring/spec.md`) and ADR 011: every machine reachable over SSH, read-only, through sparkDash and an SSH reachability check.

- `@zs-home/work-request-emitter` and `npm --silent run work-request -- <source>` (ZER-73): reads a Linear Task, GitHub issue or manual request, records each Work Request once in an append-only store, prints the recorded bytes on a retry without asking Jev again, and reads credentials from 1Password by reference. The policy file and manual requests come from `origin/main` (or `--ref`), never the working tree.

- Homer's Work Request policy (`docs/work-requests/policy.json`) and the Jev risk-tier client in `@zs-home/shared-contracts` (ZER-72), which asks Jev through Cloudflare Workers AI and never repeats a credential.

- The pure Work Request builder in `@zs-home/shared-contracts` (ZER-71): reads Linear, GitHub and manual sources, refuses bad ones with the spec's reason codes, derives every field, and turns Jev's answer into a risk tier.

- A "Say how risky the change is" section in `CONTRIBUTING.md`: blast radius, rollback cost, error detection, and screenshots for operator-screen changes.
- Accepted CI feedback intent and spec (`specs/ci-feedback/spec.md`), ADRs 008 to 010, and a measured CI baseline receipt.

- Optional signed `workflow_job` admission with an isolated append-only Durable Object for original delivery receipts; defaults disabled and does not dispatch CI.

- Pure GitHub workflow-job evidence mapper and read-only run enrichment contract, with source identity and rerun attribution tests. Live collection remains disabled.

- Strict read-only GitHub Job Attempt timing Projection, source evidence validation, comparable sample grouping and synthetic tests. No CI routing or host operations.

- Draft runner performance and scheduling intent plus proposed ADR 005, defining measured CI bottlenecks, trust-first eligibility and read-only routing advice. No live runner or workflow changes.

- Read-only scoped Credentials and My setup use a trusted versioned Credential Directory,
  exact owner/Project/environment grants and evidence-backed Identity Bindings. Missing
  source, denied access and authorized empty inventory are distinct; no secret values
  or credential mutations are exposed. Production directory binding remains unset.

- Authenticated admin Overview shows observed Repository admission and unknown collection health.
  Field-based mapping review lists added, changed and removed mappings, retains drafts
  after conflicts or uncertain saves, and requires readback before another mutation.
  Validation identifies invalid fields and duplicate rows with linked error summaries.

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

- The catalog Worker is split by who calls it (ZER-96, ADR 013). `homer-catalog` keeps every route people and agents reach through Access with the read or admin audience, and no longer holds the webhook secret or `RUNNER_CONTROLLER_AUD`. The new `homer-intake` Worker (`packages/intake-worker`) takes `POST /v1/hooks/github` with job evidence, and the runner controller's poll and report, and holds no read or admin audience, no page and no `GET /v1/version`. `JOB_EVIDENCE` and its `job-evidence-v1` migration move to `homer-intake`. Intake binds the catalog's `MAPPING_CATALOG` and `RUNNER_FLEET` by `script_name`, and the catalog binds nothing of intake's, so the deploy order is the ledger, then `homer-catalog`, then `homer-intake`. Each Worker's router has a caller table and answers `404` for any path it does not list. Routes, contracts and stored formats are unchanged. Deployment: `docs/deployment/intake.md`.

- The Event Ledger Worker is renamed `homer-event-ledger` before its first deploy, so every Worker is `homer-*`. Durable Object class names and migration tags are unchanged.

- Context Pin moves to agent-context `8cf82d5`, which adds the Zero State versioning rule (`templates/versioning.md`): one SemVer version per repository, a CHANGELOG section for every version, release candidates included, and human-only tags. The pin now covers that file; the versioning spec names it as the rule it follows.

- Every Collector writes the Build Version as Provenance's `collectorVersion` (ZER-92): the product version plus the commit, as in `0.1.0+a1b2c3d`, marked `.dirty` for a changed working tree and `+unknown` without git. The build writes it to `@zs-home/shared-contracts` (`BUILD_VERSION`, `BUILD_COMMIT`, `PRODUCT_VERSION`) from `scripts/build-info.mjs`. The hand-typed `1.0.0` and `0.1.0` are gone, and `scripts/check-versions.mjs` refuses a new one in any package's `src`. A source event collected again after a release stays a Duplicate in the Event Ledger. `@zs-home/buzz-collector` no longer exports `COLLECTOR_VERSION`.

- A docs-only pull request, as `AGENTS.md` defines it, skips the workspace steps of the CI `check` job; every other change, and any change CI cannot classify, runs them all (ADR 009, `scripts/ci-changes.sh` and its test).

- CI and `npm run check` build the workspace once instead of four and three times, and check formatting first (ADR 008).

- Context Pin moves to agent-context `a4b7b7e`, whose `AGENTS.md` template checks Trail-code's `.trail/cache/` map and records Homer's Pocock exception. Only `templates/AGENTS.md.template` changes digest.

### Fixed

- Runner controllers accept Cloudflare's singleton-array audiences while keeping the exact workload scope (#41).

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
