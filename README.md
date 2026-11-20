# Zero State Homer

Engineering headquarters for Zero State LLC. This repository is being bootstrapped through reviewed pull requests; see the open PRs for the foundation, contracts, and the first working components.

## Event Ledger implementation

The internal [Event Ledger package](packages/event-ledger/) implements atomic
append, Corrections, digest verification and replay in a SQLite-backed Cloudflare
Durable Object. No HTTP endpoint or cloud deployment is included.

Use Node 22.13+, Node 24, or Node 26+. Run `npm ci --no-audit --no-fund` then
`npm run check`. This builds the workspace, checks formatting, lint and types,
runs synthetic Node and Workers tests, and runs a plain local Wrangler smoke.

The required independent software-factory Verdict and owner merge decision remain
separate gates. See the [implementation plan](specs/event-ledger/plan.md).
