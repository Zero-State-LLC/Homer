# Dry run: release candidate v0.1.0-rc.1

Date: 2026-11-25 (UTC), 2026-11-24 evening Pacific.
Task: ZER-95, versioning spec packet 5. Runbook:
[`docs/deployment/releases.md`](../deployment/releases.md).

This dry run used a scratch clone of the packet 5 branch at `a674d75`, with its
remote removed. No tag reached GitHub, `main` did not change, and nothing was
deployed.

## Steps and results

| Step | Result |
| --- | --- |
| `node scripts/version.mjs 0.1.0-rc.1` | 12 files: the root, all 10 workspace packages and the lock file. All 9 dependencies between workspace packages and both lock fields read `0.1.0-rc.1`. |
| CHANGELOG | `## Unreleased` became `## [0.1.0-rc.1] - 2026-11-25`, with a new, empty Unreleased above it. The contracts table had no `Unreleased` rows. |
| `node scripts/check-versions.mjs` | "Versions agree: 0.1.0-rc.1 in package.json, 10 workspace packages and package-lock.json." |
| Commit and tag | Scratch commit `b35f1c7b1fd0ac1710f1a408686247da97884465`, annotated tag `v0.1.0-rc.1`, both local only. |
| Build | `scripts/build-info.mjs` wrote Build Version `0.1.0-rc.1+b35f1c7`. Only that file was compiled, because this environment cannot run `npm ci`. CI runs the full build on every pull request. |
| `node scripts/deploy-check.mjs v0.1.0-rc.1` | "Deploy check passed: v0.1.0-rc.1 at b35f1c7, Build Version 0.1.0-rc.1+b35f1c7." |
| Refusals | An untracked file: refused, the working tree has changes. A `.dirty` build: refused, naming both versions. Tag `v0.1.0` from the same checkout: refused for four reasons (version, CHANGELOG section, missing tag, build). |
| `node scripts/release-notes.mjs v0.1.0-rc.1` | 55 entries under Added, Changed and Fixed, 10,344 bytes. Everything before the first release sits in this one section. |

## Not done

- **Staging deploy receipts.** These need Danny's yes for staging, the staging
  Cloudflare account and its Access applications. They would be
  `deploy-staging-homer-event-ledger-v0.1.0-rc.1.md` and
  `deploy-staging-homer-catalog-v0.1.0-rc.1.md`, in the runbook's format.
  ZER-90 stays open until they exist.
- **The real release candidate.** It is a `release: v0.1.0-rc.1` pull request
  by these same steps, then Danny's tag. `v0.1.0` itself waits for the Verdicts
  in ZER-63.
