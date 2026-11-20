# Contributing to HOME

## Order of work

Zero State SDLC (from agent-context, `templates/sdlc/README.md` at the Context Pin):

1. `docs/intent/<stream>.md` (stage 0) — accepted by a human
2. Spec in `specs/` with a `## Workflows` section
3. Plan and tasks (FORGE)
4. Implement in small pull requests
5. Review and evidence
6. Land — Danny's yes, under the software-factory merge contract

## Pull requests

- One change per pull request. Branch names: `<area>/<short-slug>`, or the Linear branch name when a Task exists (`zer0state/zer-N-...`).
- Use [`CONTEXT.md`](CONTEXT.md) terms in code, tests, and pull request text.
- Fill in the pull request template, including the exact test commands you ran and their results.
- Squash merge only. Agents never merge.

## Land the fix

If you discover a wrong term, rule, date, or Activity Event, land the fix in the authoritative file. Do not leave it only in a chat or a draft.

- A glossary term goes in [`CONTEXT.md`](CONTEXT.md).
- The agent contract or Escalation goes in [`AGENTS.md`](AGENTS.md).
- An accepted outcome or constraint goes in `docs/intent/`.
- Evidence of a check or decision goes in `docs/receipts/`.
- A wrong Activity Event is fixed with a Correction, never an edit.
- Team-wide status or a decision goes in agent-context `STATUS.md` or `DECISIONS.md`. Do not fork a second copy into HOME.

## Tests

- Tests come with the change. Never skip, delete, or loosen a test to get green CI. Open a `defect` issue instead.
- Contract changes bump the contract version and update its fixtures in the same pull request.

## Changelog and releases

- `CHANGELOG.md` follows Keep a Changelog. Add a line under `Unreleased` in every user-visible pull request.
- Versions follow SemVer. Integration contracts carry their own versions (`specs/integration-contracts/`). There is no release yet. A tag is a human decision.

## Secrets

Never commit a secret or paste one. CI secrets are GitHub Actions secrets. Local values live in gitignored `.env` files.
