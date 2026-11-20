# Changelog

All notable changes to Homer are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions: [SemVer](https://semver.org/).

## Unreleased

### Added

- Renamed the product and repository from HOME (`Zero-State-LLC/home`) to Homer (`Zero-State-LLC/Homer`).
- Front-door map (`docs/map.md`), a cite-the-file-used rule, and a "Land the fix" section in `CONTRIBUTING.md`.

- Governance foundation: `AGENTS.md`, the `CLAUDE.md` adapter, the `CONTEXT.md` glossary, `SECURITY.md`, `CONTRIBUTING.md`, CODEOWNERS, and issue and pull request templates.
- Accepted stage-zero intent `docs/intent/home-foundation.md`.
- agent-context Context Pin, with a CI check and negative tests.
- CI for docs lint, link check, gitleaks secret scan, and Dependabot for GitHub Actions.

### Fixed

- Treat rate-limited documentation links as failed checks after retries.
