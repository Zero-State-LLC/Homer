# Intent — Versioning and releases

Author: Claude Code for Danny (scrimshawlife-ctrl)
Date: 2026-11-24
Status: accepted
Product: Homer (`Zero-State-LLC/Homer`)

This file is a proto-spec. It comes **before** specify.
Next stage is `spec.md` (spec-kit specify). Do not skip to code.

One committed intent per change stream. Live under `docs/intent/`.

Danny accepted this intent on 2026-11-24 (#74), with the proposed defaults
below. It is not built. The next stage is the spec in `specs/versioning/`.
Nothing here authorizes a tag, a release, a deploy or a change to a contract
before that spec is accepted.

## Problem / why now

Homer cannot say which code produced what. The audit of `main` on 2026-11-24
(H4) found:

- Every package is at `0.0.0`, the root has no version, and there are no tags or
  releases.
- The CHANGELOG is one Unreleased section of 47 entries.
- Each Collector types its own Provenance version by hand: `1.0.0` in
  `buzz-collector` and in `github-sync`'s merge mapping, `0.1.0` in the
  workflow-job mapper. None of them is tied to a package or a commit.
- Workers deploy by hand, and nothing records which commit a Worker runs.
- `CONTEXT.md` defines a Release Gate that ends in "a deploy receipt", but there
  is no release for a receipt to belong to.

This matters more each day. Twenty pull requests merged on 2026-11-24. Eighteen
owe after-the-fact Verdicts against exact heads. Fleet monitoring will add a
Collector and a new contract. And the first deploy is coming, with nothing yet
to name what is deployed.

[verified: audit receipt `docs/receipts/main-audit-2026-11-24.md`, `main` at
`586fe8b`] [assumed: Danny asked for this on 2026-11-24 with "Likely need
versioning etc"]

## Proposed outcome

Observable done, once a later accepted spec is built:

- **One product version.** Homer has one SemVer version, `0.x` until the first
  production cutover, in the root `package.json`. Every workspace package
  carries the same version, set by one script, and none is published.
- **Releases are tags.** A release is an annotated tag `vX.Y.Z` on a `main`
  commit, plus a GitHub Release whose notes are that version's CHANGELOG
  section. The CHANGELOG's Unreleased section becomes the version section in
  the release pull request.
- **Provenance names the code.** Every Collector and Emitter records the product
  version and the commit in its Provenance, such as `0.2.0+a1b2c3d`, injected at
  build time and never typed by hand. An Activity Event can be traced to the
  exact code that made it.
- **Deploys name the release.** Each Worker deploy records the Cloudflare
  version id, the tag and the commit in a deploy receipt, per environment. Each
  Worker can say which version it runs, behind Access.
- **Contracts keep their own versions.** The rules in
  `specs/integration-contracts/README.md` already say how contracts are
  versioned. The README also gains a table of each contract id and the first
  product version that shipped it.
- **The Release Gate becomes checkable.** CI is green, the Verdicts are
  recorded, Danny says yes, and there is a deploy receipt for each environment.

## Affected users / systems

- Users: Danny, who cuts releases; Agents, who prepare release pull requests;
  anyone who reads Provenance or a deploy receipt.
- Systems: the root and workspace `package.json` files; every Collector and
  Emitter that writes Provenance; the Workers and their deployment guide;
  `CHANGELOG.md`; GitHub tags and Releases; `CONTEXT.md` (Release Gate).

## Constraints

Product-true locks (do not reopen in implement):

- A tag is a human decision (`CONTRIBUTING.md`). Agents prepare release pull
  requests; Danny tags.
- No package is published to a registry. The versions are for traceability.
- Contract ids already in the Event Ledger never change. `home.activity-event/v1`
  and `/v2` stay valid forever, as the versioning rule requires.
- A version is derived from the repository and the build, never typed per
  Collector.
- Nothing in this stream changes the merge contract or the Verdict
  requirement.

Non-goals:

- Independent versions per package.
- Automatic deploys or automatic tags.
- Renaming a contract id that is already in use.

## Decisions

Danny accepted these defaults on 2026-11-24.

| Question | Decision |
| --- | --- |
| What is the first version? | `v0.1.0`, tagged when Danny decides `main` is ready, after the audit's High findings have Tasks |
| Do workspace packages carry the version, or only the root? | All of them, in lockstep, so each Collector can read its own `package.json` |
| How is the commit written? | SemVer build metadata, `+` and the 7-character commit, such as `0.1.0+a1b2c3d` |
| What do staging deploys use? | Release candidates, such as `v0.2.0-rc.1` |
| Product name: `home` or `homer`? | Rename the root package and the Workers to `homer-*` before the first deploy, since no Worker is deployed yet. The `@zs-home` scope and the `home.*` contract ids stay |
| When is a release cut? | On demand, by Danny |
| Does a release need every Verdict, or only those for the code in it? | Only the code in that release |

## Claims

| Claim | Label |
| --- | --- |
| Every workspace package is at `0.0.0`, and there are no tags or releases | `[verified: package.json files and the GitHub API, 2026-11-24]` |
| Provenance versions are typed per Collector and differ (`1.0.0`, `1.0.0`, `0.1.0`) | `[verified: buzz-collector/src/mapping.ts, github-sync/src/mapping.ts, github-sync/src/workflow-job.ts]` |
| No Worker is deployed to production | `[verified: SECURITY.md, "no production deployment yet"]` |
| The deployment guide asks for the Worker version, source SHA and migration version to be recorded by hand | `[verified: docs/deployment/cloudflare-catalog.md]` |
| The contracts README already defines contract versioning | `[verified: specs/integration-contracts/README.md, Versioning]` |

## Next

Specify `specs/versioning/spec.md` with `## Workflows`. Do not implement from
this file alone.
