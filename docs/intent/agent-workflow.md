# Intent — Pocock engineering workflow and Trail-code index

Author: Claude Code for Danny (scrimshawlife-ctrl)
Date: 2026-11-21
Status: accepted
Product: Homer (`Zero-State-LLC/Homer`)

This file is a proto-spec. It comes **before** specify.
The next stage is `specs/` (spec-kit specify). Do not skip to code.

Danny accepted this intent on 2026-11-21 and ruled that this stream needs
no spec: it lands as two small pull requests, the Pocock config first and
the Trail-code setup second. Each follows the repository's review and
merge process.

Built: the Pocock config in #25 and the Trail-code setup in #26, both
merged on 2026-11-21. The Trail-code receipt is
[`docs/receipts/trail-code-2026-11-21.md`](../receipts/trail-code-2026-11-21.md).

## Problem / why now

Danny asked on 2026-11-21 for Homer to adopt Matt Pocock's engineering
workflow and to be indexed with Trail-code.

Today an agent in Homer starts every session by reading files by hand,
and Homer has no config that tells Pocock's skills where Tasks, specs,
the glossary, and decisions live. Homer already follows part of the
Pocock pattern: `CONTEXT.md` is a glossary with `_Avoid_` lines, which is
the format Pocock's `domain-modeling` skill writes. The agent-context
`AGENTS.md` template already expects a `graft/` code map in product
repositories, and Noema uses one. Homer has neither the skills config
nor the map.

[verified: Danny accepted this file on 2026-11-21. It reads "Pocock
workflow" as `mattpocock/skills` and "trailhq" as Trail-code
(`trailhq/Trail-Code`, formerly graft).]

## Proposed outcome

Observable done (a stranger can check this without reading the chat):

Pocock workflow:

- `AGENTS.md` has an `## Agent skills` block that points at
  `docs/agents/issue-tracker.md` and `docs/agents/domain.md`.
- `docs/agents/issue-tracker.md` maps each Pocock verb onto Homer's order
  of work. A spec lands in `specs/<area>/spec.md` with `## Workflows`. A
  Task lands in Linear team ZER. A defect lands as a GitHub issue with
  label `defect`.
- `docs/agents/domain.md` points the skills at `CONTEXT.md` and at
  Homer's decision locations.
- `CLAUDE.md` stays a thin adapter. It imports `AGENTS.md` with
  `@AGENTS.md`, which agent-context allows, so Claude Code loads the
  `## Agent skills` block that the skills expect.
- No Pocock skill file is committed to Homer. Each contributor installs
  the skills on their own machine, for example
  `claude plugin install mattpocock-skills@claude-plugins-official`.
- `CONTRIBUTING.md` and `docs/map.md` name where the Pocock skills fit
  in the order of work.

Trail-code index:

- A contributor runs `trail init --team --agents claude` and commits only
  the shared files it writes: one SessionStart hook in
  `.claude/settings.json`, `.trail/` (the `hook.cjs` shim and
  `learnings/`), and its `.gitignore` and `.ignore` updates. Personal
  files stay out of git: `.claude/settings.local.json`,
  `.trail/statusline.cjs`, and the skill in `~/.claude/skills/`. The
  code map lives in `.trail/cache/`, which `.trail/.gitignore` keeps out
  of git. `trail init --dry-run` lists the files before anything is
  written.
- `trail status` on a fresh clone reports a built map. The exact CLI
  version, the `trail init` flags, and the `trail status` output land as
  a receipt in `docs/receipts/`.
- `AGENTS.md` regains the agent-context "Graft and docs" rule, updated
  for the `trail` command.
- Every learning that `trail init` seeds from past sessions or merged
  pull request reviews is read before commit. Any learning that holds a
  secret, an account id, One Mind content, or a guess is dropped.

Both:

- `AGENTS.md` stays about 80 lines and under 12 KB, and
  `bash scripts/check-context-pin.sh` passes.
- `npm run check`, markdownlint, the link check, and the secret scan
  pass without any check being loosened.

## Affected users / systems

- Users: Danny, Prabu, the Control Room developers, and authorized
  agents (Hermes, Grok Bot, Claude Code, Codex, OpenClaw).
- Systems: the Homer repository; each contributor's machine, because
  `trail init` writes user-level files such as `~/.claude/settings.json`
  unless `--no-global` is passed; Linear team ZER and GitHub Issues,
  depending on the tracker choice; Anthropic, because `trail init` uses
  the contributor's own Claude Code login to read their past sessions;
  Trail's anonymous usage ping and npm version check, unless disabled.

## Constraints

Product-true locks (do not reopen in implement):

- `AGENTS.md` stays the one contract and `CLAUDE.md` stays a one-line
  adapter. Pocock's setup skill edits `CLAUDE.md` when it exists; in
  Homer the block goes in `AGENTS.md` instead.
- No second skills library. Do not copy `mattpocock/skills` into Homer
  with `npx skills add` or by hand. Trail-code keeps its skill in
  `~/.claude/skills/`, outside the repository, so no skill file is
  committed.
- Linear stays the Authority for Tasks. Use `CONTEXT.md` terms: a Pocock
  "ticket" is a Task, and an "issue" means a Task unless it is a GitHub
  defect.
- FORGE still owns plan and tasks, as the agent-context SDLC says.
  Pocock's skills do not replace FORGE, spec-kit specify, or the
  software-factory judge.
- The merge gate is unchanged: CI green, an independent software-factory
  Verdict for the head SHA, a passing reproduce check, and Danny's yes.
  Pocock's `/code-review` and `/pr` are author-side aids, not a Verdict.
  Agents never merge.
- Do not connect a Trail workspace without Danny's yes. Connecting one
  sends committed learnings to Trail.
- Do not run `trail build --deep` without Danny's yes on the provider
  and key. It sends code to a model provider.
- No secret, token, account id, live credential, or One Mind content in
  `.trail/learnings/` or any other committed file.
- Team-wide decisions stay in agent-context `DECISIONS.md`. Trail
  learnings and any Homer decision records are Homer-only and never
  copy a team decision.
- Do not create a GitHub or Linear label for Pocock's `/triage` while
  triage is not adopted.

Non-goals:

- Copying Pocock's or agent-context's skills into Homer.
- Building the code map in CI. `.trail/cache/` is a local cache.
- Rewriting existing intents, specs, or receipts into Pocock's formats.
- Changing branch protection, CI checks, or the Context Pin.

## Open questions

Resolved by Danny on 2026-11-21:

- Issue tracker: Linear team ZER, which matches the Authority in
  `CONTEXT.md`. Agents need Linear access to write Tasks.
- Glossary name: keep `CONTEXT.md`. Do not rename it to `GLOSSARY.md`.
- Trail-code wiring: `--agents claude` only.
- Spec: none for this stream. Two small pull requests.

Defaulted by Claude Code on 2026-11-21 as the safer choice, pending
Danny's review. Each one is a one-word change in `docs/agents/`:

- `/to-spec` writes `specs/<area>/spec.md` in a pull request, not to the
  tracker.
- FORGE owns plan and tasks, so `/to-tickets` proposes a breakdown and a
  human says yes before any Linear Task is created. `/wayfinder` is not
  configured.
- `/implement-spec`, which runs implementer subagents in parallel, is not
  used without Danny's yes, under the agent-context rule against agent
  fleets. `/implement` is fine.
- No ADR folder. Homer decisions go in `docs/receipts/`; team decisions
  go in agent-context `DECISIONS.md`.
- Triage is not adopted, so no triage labels are created.
- Contributors turn off Trail's anonymous usage ping for Homer
  (`trail telemetry disable`).

Resolved by the Trail-code receipt on 2026-11-21:

- Danny ran `trail init` on his machine with Trail 0.30.5 and Node
  24.22.1, after he approved the dry-run file list.

Still open: Danny's review of the defaults above.

## Claims

| Claim | Label |
| --- | --- |
| Pocock's setup skill writes an `## Agent skills` block and `docs/agents/*.md`, edits `CLAUDE.md` before `AGENTS.md`, and offers to rename `CONTEXT.md` to `GLOSSARY.md` | `[verified: mattpocock/skills@abeeaf9, skills/engineering/setup-matt-pocock-skills/SKILL.md]` |
| Pocock's `/to-spec` publishes its spec to the issue tracker with the `ready-for-agent` label | `[verified: mattpocock/skills@abeeaf9, skills/engineering/to-spec/SKILL.md]` |
| For Claude Code, `trail init` shares a SessionStart hook in `.claude/settings.json` and `.trail/hook.cjs`, keeps `.claude/settings.local.json` and `.trail/statusline.cjs` personal, writes its skill to `~/.claude/skills/`, and writes no `.mcp.json`. The README still describes an older layout with `.claude/skills/trail/SKILL.md` and `.mcp.json` in the repo | `[verified: trailhq/trail-code@d8a59c1, src/claude/init.ts claudeTargetsFor]` |
| In a repository wired for Trail, the code map lives in `.trail/cache/`, which `.trail/.gitignore` ignores; `graft/` is the location for repositories not on Trail | `[verified: trailhq/trail-code@d8a59c1, src/context/map-dir.ts]` |
| Without `--no-global`, `trail init` writes user-level hooks and MCP config, including `~/.claude/settings.json` and `~/.claude.json` | `[verified: trailhq/trail-code@d8a59c1, README.md]` |
| `trail init` seeds learnings from the contributor's past Claude Code sessions and from merged pull request reviews | `[verified: trailhq/trail-code@d8a59c1, README.md]` |
| The code map is built locally with tree-sitter, with no model and no network | `[assumed: vendor README at d8a59c1; not independently tested]` |
| Trail sends an anonymous usage ping and a daily npm version check unless disabled | `[verified: trailhq/trail-code@d8a59c1, README.md]` |
| The README names the package `@trailhq/trail-code` and the command `trail`, but `package.json` at the same commit still names `@nanonets/graft` with a `graft` binary | `[verified: trailhq/trail-code@d8a59c1, README.md and package.json]` |
| The agent-context `AGENTS.md` template has a "Graft and docs" rule. It checks for `graft/`, which a repository on Trail does not have | `[verified: Zero-State-LLC/agent-context@7d4c26c, templates/AGENTS.md.template]` |
| Noema already uses graft | `[verified: Zero-State-LLC/agent-context@7d4c26c, HANDOFF.md]` |
| The cloud session that drafted this file cannot install npm packages | `[verified: session network policy on 2026-11-21]` |

## Next

Both pull requests have landed. What remains:

- Danny reviews the defaults under Open questions. Each one is a
  one-word change in `docs/agents/`.
- The agent-context `AGENTS.md` template should check for
  `.trail/cache/` as well as `graft/`. That change belongs in
  agent-context, not here.
