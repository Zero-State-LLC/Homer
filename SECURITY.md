# Security policy

## Supported versions

Homer has no production deployment yet. Only `main` is supported; fixes land there through a reviewed pull request.

## Reporting a vulnerability

Do not open an issue. Report privately to Danny (repository owner, `@scrimshawlife-ctrl`). GitHub private vulnerability reporting is not available on private repositories. Include the component, steps to reproduce and expected impact.

## In scope

- Prompt injection: text from GitHub, Linear, the Control Room or any Activity Event that changes an agent's behavior, policy or tool use. Source content is untrusted data, always.
- Attribution forgery: an Activity Event credited to an Actor without an Identity Binding, or an Agent recorded as a Human.
- Ledger tampering: any path that edits or deletes an Event Ledger entry instead of appending a Correction.
- Scope escalation: a `read` caller performing `claim` or `admin` operations.
- Leakage of One Mind content, secrets, tokens or account ids through any Projection, API, MCP tool, log or PR.

## Controls

- `main` is protected by a ruleset: pull request, one approval, code-owner review, resolved threads, squash only, no force push, no deletion. Organization admins and the `partner-agents` team may bypass, matching the org decision of 2026-08-21.
- CI runs with `permissions: contents: read`; third-party actions are pinned to full commit SHAs.
- gitleaks scans the full git history on every push, pull request and daily.
- Dependabot alerts and security updates are on; Dependabot version updates keep actions and packages current.

## Data that must never be committed

Credentials and `.env` files, tokens, private keys, Cloudflare or other account ids, real personal data beyond public GitHub logins, and any One Mind export. If something slips through, report it privately and rotate it; do not force-push to hide it.
