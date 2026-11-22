# Contributing to Homer

## Order of work

Zero State SDLC (from agent-context, `templates/sdlc/README.md` at the Context Pin):

1. `docs/intent/<stream>.md` (stage 0) — accepted by a human
2. Spec in `specs/` with a `## Workflows` section
3. Plan and tasks (FORGE)
4. Implement in small PRs
5. Review and evidence
6. Land — Danny's yes, under the software-factory merge contract

Pocock's engineering skills fit this order; they do not replace it. Install them per machine (`claude plugin install mattpocock-skills@claude-plugins-official`), never into the repo. [`docs/agents/`](docs/agents/) says where each one writes.

- Stages 1–2: `/grill-with-docs` sharpens an intent and `CONTEXT.md`; `/to-spec` drafts the spec in `specs/`.
- Stage 3: FORGE owns the plan. `/to-tickets` writes Tasks to Linear team ZER, and `/triage` labels them.
- Stage 4: `/tdd`, `/implement`, or `/implement-spec`, which runs implementers in parallel on one integration branch.
- Stage 5: `/code-review` and `/pr` prepare the pull request. They are not a Verdict.

## Pull requests

- One change per PR. Branch names: `<area>/<short-slug>`, or the Linear branch name when a Task exists (`zer0state/zer-N-...`).
- Use [`CONTEXT.md`](CONTEXT.md) terms in code, tests and PR text.
- Fill in the PR template, including the exact test commands you ran and their results.
- Squash merge only. Agents never merge.

## Land the fix

If you discover a wrong term, rule, date, or Activity Event, land the fix in the authoritative file. Do not leave it only in a chat or a draft.

- A glossary term goes in [`CONTEXT.md`](CONTEXT.md).
- The agent contract or Escalation goes in [`AGENTS.md`](AGENTS.md).
- An accepted outcome or constraint goes in `docs/intent/`.
- Evidence of a check or decision goes in `docs/receipts/`.
- A wrong Activity Event is fixed with a Correction, never an edit.
- Team-wide status or a decision goes in agent-context `STATUS.md` or `DECISIONS.md`. Do not fork a second copy into Homer.

## Tests

- Tests come with the change. Never skip, delete or loosen a test to get green CI; open a `defect` issue instead.
- Contract changes bump the contract version and update its fixtures in the same PR.

## Changelog and releases

- `CHANGELOG.md` follows Keep a Changelog. Add a line under `Unreleased` in every user-visible PR.
- Versions follow SemVer. Integration contracts carry their own versions (`specs/integration-contracts/`). There is no release yet; a tag is a human decision.

## Secrets

Never commit or paste one. CI secrets are GitHub Actions secrets; local values live in gitignored `.env` files.
