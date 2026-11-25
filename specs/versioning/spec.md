# Versioning and releases

Version: 0.1.1
Status: accepted by Danny on 2026-11-24 (#75), with the defaults in
[Open choices with defaults](#open-choices-with-defaults). Amended by Danny the
same day: a release candidate has its own CHANGELOG section, and this is the
versioning rule for every Zero-State repository.
Intent: [Versioning and releases](../../docs/intent/versioning-and-releases.md)
(accepted by Danny on 2026-11-24, #74)
Decision: [ADR 012](../adr/012-one-product-version.md)

Homer gets one product version. Every Activity Event names the exact code that
made it, every Worker can say which release it runs, and a release is a tag
Danny cuts with notes from the CHANGELOG. Contracts keep their own versions.

## Facts this spec rests on

| Fact | Source |
| --- | --- |
| Every workspace package is `0.0.0`; the root package is named `home` and has no version | `package.json` files on `main` [verified] |
| Nine workspace dependencies on other `@zs-home` packages are pinned to exactly `0.0.0` | workspace `package.json` files [verified] |
| Provenance versions are typed per Collector: `1.0.0` (`buzz-collector`), `1.0.0` (`github-sync` merge mapping), `0.1.0` (workflow-job mapper) | source on `main` [verified] |
| The Event Ledger compares Provenance without `collector`, `collectorVersion` and `collectedAt`, so a new version string on a re-collected event is a Duplicate, not a Conflict | `packages/event-ledger/src/canonical.ts`, `comparisonDigest` [verified] |
| Cloudflare's version metadata binding gives a Worker its version id, tag and creation time, and a version can carry a tag and a message when it is uploaded | [Cloudflare: version metadata binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/), [versions and deployments](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/) |
| The ledger Worker is `home-event-ledger`; every other Worker is `homer-*` | `wrangler*.jsonc` [verified] |
| No Worker is deployed to production | `SECURITY.md` |

## Contract

### The product version

- One SemVer version, in the root `package.json`. It stays `0.x` until the
  first production cutover.
- Every workspace package has the same `version`, and every dependency on
  another `@zs-home` package names that same version. `package-lock.json`
  matches.
- The root package is named `homer`. The `@zs-home` scope stays, because
  renaming it would touch every import for no traceability gain.
- No package is published. Every package keeps `"private": true`.

`scripts/version.mjs <version>` is the only way to change the version. It sets
the root, every workspace package and every internal dependency, and the lock
file's matching fields. It refuses anything that is not SemVer, or that is not
above the current version. `scripts/check-versions.mjs` fails when any of these
disagree. It runs as its own **Versions** step in the CI `check` job, right
after the docs-only classifier and before Node setup, because that job runs
each step itself rather than `npm run check`. It also runs in `npm run check`,
for local use. It reads files only, so it needs no install and runs for
docs-only pull requests too.

### The build version

Every build writes `packages/shared-contracts/src/generated/build-info.ts`,
which git ignores:

```ts
export const PRODUCT_VERSION = "0.1.0";
export const BUILD_COMMIT = "a1b2c3d"; // 7 characters, or "unknown"
export const BUILD_VERSION = "0.1.0+a1b2c3d"; // SemVer build metadata
```

- `BUILD_COMMIT` comes from `git rev-parse --short=7 HEAD`. If the working tree
  has changes, the version carries `.dirty`, as in `0.1.0+a1b2c3d.dirty`. With no
  git, the commit is `unknown`.
- Every Collector and Emitter writes `BUILD_VERSION` as Provenance's
  `collectorVersion`. A hand-typed version anywhere in `packages/*/src` is
  refused by `check-versions.mjs`.
- A deploy refuses a `.dirty` or `unknown` build (see [Deploy](#deploy-a-worker)).

The Activity Event contract keeps `collectorVersion` a free string, so this
changes no contract. Tightening it to SemVer would need a new major contract
file. That is a choice for later, not this spec.

### Worker version

- Every Worker's Wrangler file binds `version_metadata` as
  `CF_VERSION_METADATA`.
- `GET /v1/version`, behind Access with the read audience, answers
  `{ productVersion, buildVersion, workerVersionId, workerVersionTag }`. It
  never carries an account id, a hostname or a binding name.
- The ledger Worker is renamed `homer-event-ledger` before its first deploy.
  Durable Object class names and migration tags do not change.

### Contracts

`specs/integration-contracts/README.md` keeps its versioning rules. It gains a
table: contract id, schema file, and the first product version that shipped
it. Every contract that exists today is listed as first shipped in `v0.1.0`. A
contract id already in the Event Ledger never changes, which includes the
`home.*` ids.

### The CHANGELOG

- The CHANGELOG keeps `## Unreleased` at the top, with only `### Added`,
  `### Changed`, `### Deprecated`, `### Removed`, `### Fixed` and
  `### Security` under it (Keep a Changelog).
- A release turns Unreleased into `## [X.Y.Z] - YYYY-MM-DD` and opens a new,
  empty Unreleased. Every version above `0.0.0` has a section of its own, a
  release candidate included (`## [0.1.0-rc.1] - YYYY-MM-DD`), newest first.
  Each lists what changed since the version before it. `check-versions.mjs`
  fails when the root version is above `0.0.0` and has no section of its own.

## Workflows

### Prepare a release (an Agent, by pull request)

1. Pick the next version by SemVer from Unreleased. From `1.0`, a breaking
   change (anything under `Removed`, or a change to a contract's meaning) is a
   major bump, anything under `Added` a minor one, and only fixes a patch. In
   `0.x`, a breaking change or an addition is a minor bump, and only fixes a
   patch.
2. Run `scripts/version.mjs <version>`.
3. Turn Unreleased into the version's section, and add any new contract to the
   contracts table.
4. Open the pull request `release: vX.Y.Z`. It lists the Release Gate items
   still open: Verdicts for the code in this release, and the deploy receipts
   that will follow.

### Cut a release (Danny)

1. Merge the release pull request.
2. Tag the merge commit: `git tag -a vX.Y.Z -m "Homer vX.Y.Z" <sha>` and push the
   tag. Only Danny tags; Agents never push a tag.
3. Create the GitHub Release for the tag, with that version's CHANGELOG section
   as its notes. `scripts/release-notes.mjs vX.Y.Z` prints them.

A release candidate for staging is `vX.Y.Z-rc.N`, prepared and tagged the same
way, with its own CHANGELOG section and no GitHub Release.

### Deploy a Worker

1. Check out the tag. The build refuses to deploy a `.dirty` or `unknown` build.
2. Upload the Worker version with the tag as its version tag and the commit as
   its message, then deploy it.
3. Read `GET /v1/version` through Access, and write the deploy receipt.

### The deploy receipt

One file per deploy, `docs/receipts/deploy-<environment>-<worker>-vX.Y.Z.md`,
naming:

- the environment;
- the Worker;
- the tag and commit;
- the Cloudflare version id;
- the Durable Object migration tags;
- the time;
- the `GET /v1/version` answer;
- who deployed.

It carries no account id, hostname or token. The Release Gate for an
environment is met when the release has a receipt there.

### The Release Gate

`CONTEXT.md`'s Release Gate becomes checkable per release:

- CI is green on the tagged commit.
- The code in the release has passing Verdicts.
- Danny said yes, by merging the release pull request and tagging it.
- A deploy receipt exists for each environment the release reaches.

`v0.1.0` contains every line of code on `main`. So it needs the eighteen
after-the-fact Verdicts in ZER-63 first.

### Threat model

- **A forged version.** Provenance and `/v1/version` come from the build and
  the Cloudflare binding, not from a request. A Collector cannot be told its
  version.
- **An untraceable deploy.** A `.dirty` or `unknown` build cannot deploy, and
  every deploy has a receipt.
- **A leak through the version endpoint.** `/v1/version` is behind Access, and
  answers four fixed fields.
- **A tag pushed by an Agent.** Only Danny tags. A tag ruleset that limits who
  can create `v*` tags is an open choice below.

### Skills

None new. `docs/deployment/releases.md` is the runbook (packet 5).

### GitHub Actions

No new workflow. The `check` job in `.github/workflows/ci.yml` gains a
**Versions** step that runs `node scripts/check-versions.mjs` and
`node --test scripts/check-versions.test.mjs`, unconditionally, like the
classifier's own test.

## Test matrix

| Case | Expected |
| --- | --- |
| `version.mjs 0.1.0` from `0.0.0` | root, ten packages, nine internal dependencies and the lock file all say `0.1.0`; `npm ci` succeeds |
| `version.mjs 0.0.9` from `0.1.0`, or `version.mjs banana` | refused, nothing changed |
| One package at a different version, or an internal dependency at `0.0.0` | `check-versions.mjs` fails, naming the file |
| A `collectorVersion: "1.0.0"` literal in `packages/*/src` | `check-versions.mjs` fails, naming the file and line |
| A build in a clean checkout of `a1b2c3d` | `BUILD_VERSION` is `0.1.0+a1b2c3d` |
| A build with a changed file | `BUILD_VERSION` ends in `.dirty`; deploy refuses it |
| A build with no git | `BUILD_COMMIT` is `unknown`; deploy refuses it |
| An Activity Event from each Collector | `provenance.collectorVersion` equals `BUILD_VERSION` |
| The same source event collected before and after a version change | a Duplicate, not a Conflict |
| `GET /v1/version` without Access, or with a human read token | `401` without, the four fields with |
| Root version `0.1.0` with no `## [0.1.0]` section | `check-versions.mjs` fails |
| `release-notes.mjs v0.1.0` | exactly that version's section |

## Acceptance and implementation plan

One Linear Task per packet in the Homer project. Each changes code, so each owes
a Verdict under the merge contract:

1. **Lockstep version.** `version.mjs`, `check-versions.mjs` and its test, the
   root rename to `homer`, internal dependencies rewritten, and the Versions
   step in the CI `check` job, plus `npm run check`.
   The version stays `0.0.0` until the release pull request.
2. **Build version.** `build-info.ts` generation, and every Collector and
   Emitter on `BUILD_VERSION`, with the literal check on.
3. **Worker version.** `version_metadata` in every Wrangler file, `GET
   /v1/version`, and the ledger Worker renamed `homer-event-ledger`, with the
   deployment guides updated.
4. **CHANGELOG and contracts.** The CHANGELOG restructured to the allowed
   subsections, `release-notes.mjs`, and the contracts table.
5. **Release runbook.** `docs/deployment/releases.md`, the deploy receipt
   format, and the Release Gate in `CONTEXT.md` worded to match.

Done for the stream: a dry run of `v0.1.0-rc.1` produces matching versions
everywhere, its release notes, and a staging deploy receipt, without a tag on
`main`.

## Open choices with defaults

| Choice | Default | Alternative |
| --- | --- | --- |
| Who may create `v*` tags | Any admin, by convention: Danny tags | A tag ruleset that limits `v*` tags to Danny |
| GitHub Release creation | By hand, from `release-notes.mjs` | A workflow on tag push. It needs `contents: write`, which no workflow has today |
| Dirty builds in local development | Allowed, marked `.dirty` | Refused everywhere |
| Collector version in the contract | A free string, as today | A SemVer pattern, in a new major contract file |

## Terms

New terms for `CONTEXT.md` when built: Release (a tagged product version),
Build Version, Deploy Receipt.
