# Trail-code receipt, 2026-11-21

Intent: `docs/intent/agent-workflow.md`.

## What was done

- Installed `@trailhq/trail-code` globally; `trail --version` reports `0.30.5` (Node v24.22.1). npm skipped the package postinstall script (install scripts blocked by default); the CLI runs without it.
- Ran `trail init --dry-run --team --agents claude`; Danny approved the file list, including the machine-wide writes, on 2026-11-21.
- Ran `trail init --team --agents claude`, then `trail telemetry disable`, then `trail status`.
- `trail status`: code map 313 nodes, in sync with the code; 0 learnings added. No past Claude Code sessions for this repo existed on the machine, so `.trail/learnings/` is empty and nothing was reviewed or committed there.
- Wired Claude Code only. No other agent was added.

## Committed

- `.claude/settings.json` (SessionStart hook)
- `.trail/hook.cjs` (hooks shim)
- `.trail/.gitignore` (ignores `statusline.cjs` and `cache/`)
- `AGENTS.md` `## Code map` section after `## Agent skills`
- `.prettierignore` entry for `.trail/hook.cjs`, the only file Prettier flagged in a clean tree

Not committed: `.claude/settings.local.json`, `.trail/statusline.cjs`, `.trail/cache/`, `.trail/README.md`, `graft/` (not present).

## Checks

Run in a clean worktree with only the committed changes: `npm ci`, `npm run check`, `bash scripts/check-context-pin.sh`, `npx markdownlint-cli2 "**/*.md"`. No check or test was loosened.
