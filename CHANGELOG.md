# Changelog

All notable changes to HOME are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions: [SemVer](https://semver.org/).

## Unreleased

### Added

- TypeScript workspace (`npm run check`) and versioned integration contracts for the Activity Event, the Work Request, and the Factory Event, with contract tests against the pinned software-factory Work Packet schema.
- Governance foundation: `AGENTS.md`, `CLAUDE.md` adapter, `CONTEXT.md` glossary, `SECURITY.md`, `CONTRIBUTING.md`, CODEOWNERS, issue and PR templates.
- Stage-zero intent `docs/intent/home-foundation.md` (draft).
- agent-context Context Pin with a CI check and negative tests.
- CI: docs lint, link check, gitleaks secret scan, Dependabot for GitHub Actions.

### Fixed

- Node consumers can import the built `@zs-home/shared-contracts` workspace package by name.
