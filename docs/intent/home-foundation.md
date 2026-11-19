# Intent — HOME foundation and first working components

Author: Grok Bot for Danny (scrimshawlife-ctrl)
Date: 2026-11-18
Status: accepted
Product: HOME (`Zero-State-LLC/home`)

This file is a proto-spec. It comes **before** specify.
Next stage is `specs/` (spec-kit specify). Do not skip to code.

Danny accepted this intent on 2026-11-19. His execution directive of 2026-11-18 calls for small PRs covering the foundation and the first working components. Each PR follows the repository's review and merge process.

## Problem / why now

Engineering work at Zero State is spread across GitHub (about 70 repositories), Linear (team ZER, 39 projects), the Control Room Site, software-factory and agent-context. Nobody can answer "who did what, when, on which project, with what evidence" without reading each system by hand, and agents cannot either.

[verified: software-factory#7 and Linear ZER-9, both opened by Danny on 2026-11-18]

## Proposed outcome

Observable done (a stranger can check this without reading the chat):

- `Zero-State-LLC/home` is private, has a protected `main`, CODEOWNERS, SECURITY, templates, least-privilege SHA-pinned CI, gitleaks and Dependabot.
- HOME consumes agent-context through a Context Pin that CI verifies, not a copy.
- Versioned integration contracts exist for the Activity Event, the Work Request (HOME -> software-factory intake) and the Factory Event (software-factory -> HOME), with contract tests that fail on incompatible change.
- An append-only Event Ledger with Event Keys, Provenance, deduplication, Conflict refusal and Corrections, with tests.
- Activity Calendar and Project Timeline Projections built from the ledger, with tests for UTC storage, Display Time Zone bucketing (including DST), human/agent filters, and Unknown Dates.
- A Control Room migration plan that names what must be preserved and the rollback, without touching production.

## Affected users / systems

- Users: Danny, Prabu, the four Control Room developers, and authorized agents (Hermes, Grok Bot, Claude Code, Codex, OpenClaw).
- Systems: GitHub, Linear, Control Room Site, software-factory, agent-context.

## Constraints

Product-true locks (do not reopen in implement):

- Linear is the Authority for Tasks; GitHub for Repository Events; the Control Room for Work Sessions and Handoffs; software-factory for Work Packets and Verdicts.
- Event Ledger is append-only; Corrections, never edits.
- No invented Attribution and no invented Milestone dates.
- No One Mind content in any HOME surface.
- Existing repositories, histories and the production Control Room stay as they are until a verified migration with a human yes.

Non-goals:

- Replacing the software-factory pipeline or its judge.
- A second skills library or new agent bots.
- Production deploy or Control Room cutover in this stream.

## Open questions

- Where does the Control Room Site source live, and who can grant editor/deploy access? (ZER-9 first blocker)
- Hosting for HOME's API and MCP gateway: Cloudflare Workers like JChain, or the Control Room's ChatGPT Sites host?
- Freshness budgets per Source System.
- Should `partner-agents` get access to this repo? (org default permission is none)

## Claims

| Claim | Label |
|---|---|
| `home` did not exist before 2026-11-18 | `[verified: GET /repos/Zero-State-LLC/home returned 404]` |
| Control Room source is not on GitHub | `[verified: commit 49f5d39 not found by commit search; no code search hits]` |
| No Linear project has a target date | `[verified: list_projects, 39 projects, 2026-11-18]` |
| Dependabot, not Renovate, is the org standard | `[verified: JChain .github/dependabot.yml; no renovate config found]` |

## Next

Specify the Event Ledger in `specs/` with a `## Workflows` section, then follow the [order of work](../../CONTRIBUTING.md#order-of-work).
