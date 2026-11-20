# Contributing to Homer

## Order of work

Zero State SDLC (from agent-context, `templates/sdlc/README.md` at the Context Pin):

1. `docs/intent/<stream>.md` (stage 0) — accepted by a human
2. Spec in `specs/` with a `## Workflows` section
3. Plan and tasks (FORGE)
4. Implement in small PRs
5. Review and evidence
6. Land — Danny's yes, under the software-factory merge contract

## Pull requests

- One change per PR. Branch names: `<area>/<short-slug>`, or the Linear branch name when a Task exists (`zer0state/zer-N-...`).
- Use [`CONTEXT.md`](CONTEXT.md) terms in code, tests and PR text.
- Fill in the PR template, including the exact test commands you ran and their results.
- Squash merge only. Agents never merge.

## Tests

- Tests come with the change. Never skip, delete or loosen a test to get green CI; open a `defect` issue instead.
- Contract changes bump the contract version and update its fixtures in the same PR.

## Changelog and releases

- `CHANGELOG.md` follows Keep a Changelog. Add a line under `Unreleased` in every user-visible PR.
- Versions follow SemVer. Integration contracts carry their own versions (`specs/integration-contracts/`). There is no release yet; a tag is a human decision.

## Secrets

Never commit or paste one. CI secrets are GitHub Actions secrets; local values live in gitignored `.env` files.
