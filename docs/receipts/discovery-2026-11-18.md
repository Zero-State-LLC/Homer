# Zero-State-LLC/home: discovery receipt

Read-only discovery, 2026-11-18 14:40-14:55 PST. Account: `scrimshawlife-ctrl` (gh on the box).
Nothing below was written to any existing repository or issue.

## Pinned revisions read

| Repo | Visibility | HEAD read |
|---|---|---|
| Zero-State-LLC/agent-context | public | `7d4c26c2f9ddf15daf5890de9674e5ba00ac9d9b` |
| Zero-State-LLC/software-factory | private | `7f8efeadf545c1d644027f2a4de8144348e69634` |
| Zero-State-LLC/JChain (org CI reference) | private | `8c75cdec44ec1c6cf491dbbf08561d256d126398` |
| Zero-State-LLC/Zero-State (brand reference) | public | `586b0b76ba528ea206470121879e5e8be1a68a17` |

## Access

- [verified] `GET /repos/Zero-State-LLC/home` -> 404 before creation. The repo did not exist.
- [verified] Org membership: `role=admin, state=active`. Org setting `members_can_create_private_repositories=true`. The account can create the repo.
- [verified] Org plan `team`; `default_repository_permission=none`. New repos are invisible to the `partner-agents` team until granted (agent-context TEAM.md).
- [verified] Org-level rulesets and Actions policy are not readable with the current token (needs `admin:org` scope). Not requested.
- [verified] For new repos: Dependabot alerts on by default; secret scanning and push protection off by default; Advanced Security off. Secret scanning on a private repo needs paid GitHub Secret Protection, so the org standard is gitleaks in CI (JChain `secret-scan.yml`).

## agent-context (canonical team context and template source)

- [verified] Root `AGENTS.md` is the team contract. Product repos copy `templates/` (AGENTS.md, CLAUDE.md, intent.md, AGENT-GOTCHAS.md, spec Workflows section, SDLC order).
- [verified] DECISIONS 2026-09-04: one `AGENTS.md` per product repo (~80 lines, 12 KB ceiling, must have `## Escalation`); `CLAUDE.md` is a thin adapter; `intent.md` is SDLC stage 0 and needs human accept before specify; intents live in `intent/` or `docs/intent/`; no agent fleets, no invented skills; FORGE owns plan/tasks; human yes on deploy, spend, legal.
- [verified] `scripts/check-agents-md.sh` is the lint for product AGENTS.md (size + `## Escalation`).
- [verified] Install path: `install.sh` symlinks `skills/zero-state-context` into Hermes, Grok, Claude, Cursor homes. Only one skill (`zero-state-context`) lives in the pack. HOME must reference it, not copy it.
- [verified] DECISIONS 2026-08-21: protected `main` = 1 review + code owners, with named admin bypass for `scrimshawlife-ctrl`, `prabu-openclaw`, team `partner-agents`; do not set enforce_admins false or drop the review count.
- [verified] HANDOFF notes an Actions-billing block on some private repos (dated). Live check today: private repos JChain and aspire-ai ran Actions successfully on 2026-11-18, so the block is not current for those repos. HOME CI still has to be observed, not assumed.

## software-factory (execution engine, proprietary)

- [verified] Pipeline: intake (GAP) -> spec (PROMETHEUS) -> implement (Boof) -> verify (ADVERSARY) -> merge (LANDER) -> deploy (Boof) -> learn (SCRIBE) -> done. Legal transitions enforced by `factory packet advance`; no implement->merge or verify->deploy edge.
- [verified] **Merge authorization contract** (`docs/judge.md`, `docs/pipeline.md`): merge only when `factory judge gate --verdict v.json` returns `merge_allowed: true`, which needs verdict `pass` in `online` mode, verdict head SHA equal to the live PR head, judge model independent of `author_model` (different vendor family), reproduce check exit 0, all CI green. Then Danny confirms, then LANDER merges. README: "Nothing merges without Danny's confirmation."
- [verified] Work packet schema `factory/packet/work_packet.schema.json`: required `id` (`WP-YYYY-MM-DD-slug`), `source` (`linear:ZER-n` | `github:owner/repo#n` | `manual:slug`), `pain`, `who`, `done_when[]`, `scope.repo` (`Zero-State-LLC/*`), `risk_tier`, `budget_usd`, `owner_agent`, `stage`; optional `author_model`, `test_command`, `links`, `history[]`.
- [verified] Governance: one egress route, hash-only ledger, Cursor Cloud Agent hosts blocked by policy, budget caps. License: Zero State Proprietary. Python 3.11+, pytest, `actions/checkout@v4` (tag, not SHA-pinned).
- [verified] No open PRs. Issue #7 is the HOME issue.

## GitHub issue software-factory#7 (author scrimshawlife-ctrl, 2026-11-18 22:47 UTC = 14:47 PST)

- [verified] Target layout: `apps/control-room` (UI + MCP facade), `packages/event-ledger`, `packages/github-sync`, `packages/linear-sync`, `specs/`. agent-context consumed by pinned reference; software-factory integrated by versioned event/command contracts, no code copy. Linear owns tasks; GitHub owns code evidence; Control Room owns sessions and observations. One Mind privacy boundary preserved.
- [verified] Acceptance steps 1-6 (create repo, audit, contracts + tests, obtain Control Room source through authorized workflow, calendar/timeline per ZER-9, staging then prod with rollback).

## Linear (workspace zer0state, team ZER)

- [verified] ZER-9 "Implement Control Room activity calendar and project timelines" (High, Backlog, created 2026-11-18 by Danny). Acceptance: immutable source-linked ledger; GitHub + Linear + Control Room session ingestion with dedup; day/week/month calendar with actor/project filters; Gantt with milestones, deadlines, dependencies, verified actual completions; human vs agent attribution; source freshness and access controls; mobile parity; test and deploy receipts. First blocker named in the issue: editable Site project and authorized Site editor/deploy access.
- [verified] Related: ZER-5 (hosted Linear reads, blocked on Sites plugin eligibility), ZER-6 (GitHub-to-Linear pilot), ZER-7 (scoped contributor sessions; receipt says Control Room version 7, commit `49f5d39b...`, 4-hour session expiry, 30 s refresh, nine projects, four developers; live sign-in checks pending).
- [verified] 39 Linear projects, all Backlog, **none with a start or target date**. A timeline built today must show "no date in source", not invented dates.
- [verified] No existing Linear project for HOME.

## Control Room

- [verified] Site URL `https://zero-state-control.sleek-park-3366.chatgpt.site` returns HTTP 401 "Sign in required" (ChatGPT Sites). No unauthenticated access; I did not try to sign in.
- [verified] Commit `49f5d39b57f742acf5f998bbde3d3f97976c01b4` is not found by GitHub commit search; GitHub code search finds no Control Room source in the org. The editable source lives in the ChatGPT Sites project, not GitHub.
- [verified] The implementation spec (`chatgpt.com/space/page_53ba...`) is behind ChatGPT sign-in; not read.
- BLOCKED: Control Room source, deploy config, records and spec text are not accessible to this account. Migration into `apps/control-room/` can be planned, not executed.

## Org conventions to reuse

- [verified] JChain is the most complete CI reference: actions pinned to commit SHAs with `# vX.Y.Z` comments (`actions/checkout@3d3c42e5...` v7.0.1, `actions/setup-node@949feb24...` v7.1.0, `upload-artifact@cf430e03...` v7.0.2, `markdownlint-cli2-action@696eb3f2...` v25.0.0, `lychee-action@e7477775...` v2.9.0); top-level `permissions: contents: read`; gitleaks 8.30.1 CLI with checksum verification; Dependabot (github-actions + npm, weekly, grouped minor/patch); Node 22; vitest; TypeScript; `CONTEXT.md` glossary (Pocock ubiquitous language); `* @scrimshawlife-ctrl` CODEOWNERS; Zero State Proprietary License for private repos.
- [verified] Branch protection on private repos varies: JChain `main` = 1 review, code owners, enforce_admins, required checks; software-factory, aspire-ai, scry, one-mind: unprotected. Renovate is not used anywhere found; Dependabot is the org standard.
- [verified] Brand (Zero-State `design.md`, adopted): dark-first "observatory void, bone light, ember signal"; Balanced Aperture mark (split zero ring, frame corners, yellow dashed highway); Geist / Geist Mono; accent copper oklch(72% 0.14 50), transition yellow `#F2C200`, carbon `#1D2321`, stone `#F4F0E8`. Symbols are hairline geometry, never literal robots.

## NVIDIA-first notes for HOME

| Layer | NVIDIA option | Alternatives | Decision | Reason |
|---|---|---|---|---|
| Coordination runtime (ledger, projections) | none applicable | TypeScript on Node 22 | TS CHOSEN | Deterministic CRUD/projection code; no GPU or model in the loop. Matches JChain stack. |
| Agent observability | NeMo Relay | HOME event ledger | Relay NOT EVALUATED YET | HOME records evidence events from GitHub/Linear; Relay traces model calls inside agents. Revisit when agents emit traces. |
| Agent eval | NeMo Helix / Evaluator | software-factory judge | REJECTED for HOME | Judging stays in software-factory; HOME does not duplicate it. |
| Image generation for assets | build.nvidia.com hosted image models | GenerateImage, QuiverAI | see assets receipt | Evaluated first at asset time. |
| Coding agent | none in use | Grok Build CLI | Grok Build CHOSEN | Directive: Grok Build first. |

No NVIDIA product is claimed as in use by HOME.
