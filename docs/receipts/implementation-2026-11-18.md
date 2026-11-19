# HOME foundation implementation evidence

Date: 2026-11-18 Pacific Time. Author: Codex.

## Scope and source

This implements the first working components in the accepted [foundation intent](../intent/home-foundation.md): the Event Ledger, Activity Calendar and Project Timeline data, and a Control Room migration plan. It builds on the existing four-PR foundation stack, whose plan head was `aa2c49a084ede9c72bd0ff88472ec7f79e23f7f8` when work began.

The ledger uses a SQLite-backed Durable Object, following the revised Cloudflare plan. No cloud resources were created. The source and preservation map for the existing live Control Room is in the [migration plan](../migration/control-room.md).

## Local evidence

All tests use synthetic data. Author-run checks are evidence of implementation behavior, not an independent software-factory Verdict.

| Check | Result |
| --- | --- |
| `npm ci --no-audit --no-fund` followed by `npm run check` | Pass: package builds, compiled package import tests, formatting, ESLint, TypeScript, 76 Vitest tests across 11 files, and plain Wrangler/workerd smoke |
| `npm audit --audit-level=high` | 0 vulnerabilities |
| `npx markdownlint-cli2 '**/*.md'` | Pass |
| `bash scripts/check-context-pin.sh` | Pass: all five pinned files and AGENTS.md size |
| `bash scripts/test-check-context-pin.sh` | Pass: negative cases refuse invalid pins |
| `gitleaks dir --redact --no-banner .` (checksum-verified 8.30.1) | No leaks found in the working tree; remote CI separately scans full history |
| `git diff --check` | Pass |

Coverage includes canonical serialization vectors from an independent Python implementation, duplicate and conflict classification, atomic rollback, concurrent writers, restart and uncertain receipt recovery, append-only enforcement, Correction replay, digest/index tampering, paged history, size refusal, and Node/Workers validator parity. Expected failure injection produces Workers exception logs; assertions verify these failures and the suite passes.

Projection coverage includes Pacific spring/fall DST, Monday week boundaries, nanosecond ordering, Actor and Project filters, unknown dates, evidence-gated Actual Dates, source authority, dependency cycles, Blockers, Corrections and explicit Source Freshness.

The pinned software-factory Work Packet schema and its current main version both had blob `f26a5f9de9b9e565c1e7b2070a1a249a766b144c` when checked. The fixture SHA-256 is `efd8f633638ce7810eb6b5717ea67fa05428abbc6e853d91d3d6a77778a0d543`.

## Remaining gates

- Read the PR checks for the exact published head. Local evidence does not claim hosted CI passed.
- Obtain the required online, independent software-factory Verdict and reproduce evidence. No judge credentials were available in this author environment.
- The existing foundation PRs must land in dependency order before these implementation PRs. No merge permission or merge result is implied here.
- Live Collectors, Identity Binding administration, authenticated API/MCP wiring, calendar/timeline UI, staging restoration and any production cutover are follow-on work in the migration plan. No live milestone completion or identity has been inferred from synthetic fixtures.
- Point-in-time recovery and a real Cloudflare platform failure after a transaction callback remain untested locally. Full-history verification establishes internal consistency; external signed/anchored heads are needed to detect a privileged rewrite of all rows.
