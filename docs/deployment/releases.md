# Releases and Worker deploys

How a Homer release is prepared, cut and deployed, and how each deploy is
recorded. The rules are in the [versioning spec](../../specs/versioning/spec.md)
and ADR 012; every Zero State repository follows the same versioning rule
(`templates/versioning.md` in `Zero-State-LLC/agent-context`).

| Step | Who |
| --- | --- |
| [Prepare a release](#prepare-a-release) | An Agent, by pull request |
| [Cut a release](#cut-a-release) | Danny: merge, tag, GitHub Release |
| [Deploy a Worker](#deploy-a-worker) | Only after Danny says yes for that environment. Agents do not deploy to production. |
| [Write the deploy receipt](#the-deploy-receipt) | Whoever deployed |

Nothing here needs a new GitHub Actions workflow. No workflow can push a tag or
create a release: every workflow has `contents: read`.

## Prepare a release

1. Branch from the newest `main`: `git switch -c release/vX.Y.Z origin/main`.
2. Pick the version from what Unreleased holds. In `0.x`, a breaking change
   (anything under Removed, or a change to a contract's meaning) or an addition
   is a minor bump, and fixes alone a patch. From `1.0.0`, a breaking change is
   a major bump, an addition a minor one, and fixes alone a patch.
3. Set it everywhere: `node scripts/version.mjs X.Y.Z`. It refuses a version
   that is not above the current one.
4. In `CHANGELOG.md`, rename `## Unreleased` to `## [X.Y.Z] - YYYY-MM-DD`, using
   today's date in UTC, and add a new, empty `## Unreleased` above it. Preview
   the notes: `node scripts/release-notes.mjs vX.Y.Z`.
5. In `specs/integration-contracts/README.md`, change each `Unreleased` in the
   contracts table to `vX.Y.Z`. A release candidate leaves them `Unreleased`:
   the table records the release that first shipped a contract, and
   `check-versions.mjs` accepts only `vX.Y.Z` or `Unreleased` there.
6. Run `npm run check`. `scripts/check-versions.mjs` fails until the versions,
   the CHANGELOG section and the contracts table all agree.
7. Open the pull request `release: vX.Y.Z`. Its body has the release notes and
   the [Release Gate](#the-release-gate) items still open: the Verdicts owed for
   code in this release (ZER-63 lists them), and the deploy receipts to come.

A release candidate, `vX.Y.Z-rc.N`, is prepared the same way, except for the
contracts table (step 5). It gets its own section, `## [X.Y.Z-rc.N] - YYYY-MM-DD`. When `X.Y.Z` follows its candidates, its
section lists what changed since the last candidate.

## Cut a release

Danny only. Agents never push a tag.

1. Merge the release pull request. Note the merge commit.
2. Tag that commit and push the tag:

   ```sh
   git fetch origin
   git tag -a vX.Y.Z -m "Homer vX.Y.Z" <merge-commit>
   git push origin vX.Y.Z
   ```

3. For a release, not a release candidate, create the GitHub Release by hand
   with that version's CHANGELOG section as its notes:

   ```sh
   node scripts/release-notes.mjs vX.Y.Z > notes.md
   gh release create vX.Y.Z --verify-tag --title "Homer vX.Y.Z" --notes-file notes.md
   ```

## Deploy a Worker

Deploy one environment at a time, staging first. In each environment, deploy
the Event Ledger (`homer-event-ledger`), then the catalog (`homer-catalog`),
then intake (`homer-intake`). A binding to another Worker's namespace must
resolve at upload: the catalog binds the ledger's, and intake binds the
ledger's and the catalog's (ADR 013). Deploy a recovery Worker only when its
recovery procedure calls for it. The environment's bindings, Access
applications and secrets are in
[`cloudflare-catalog.md`](cloudflare-catalog.md), [`intake.md`](intake.md) and
[`event-ledger-recovery.md`](event-ledger-recovery.md).

1. Start from a fresh clone of the tag, so nothing else is in the tree:

   ```sh
   git clone --branch vX.Y.Z https://github.com/Zero-State-LLC/Homer homer-vX.Y.Z
   cd homer-vX.Y.Z
   npm ci --no-audit --no-fund
   npm run build
   ```

2. Check that the deploy is traceable. Do not deploy unless it passes:

   ```sh
   node scripts/deploy-check.mjs vX.Y.Z
   ```

   It refuses when HEAD is not the commit the annotated tag points at, the tree
   has changes, the product version or the CHANGELOG section disagrees with the
   tag, or the build is `.dirty`, `+unknown` or another commit's.
3. Deploy with the tag as the Cloudflare version tag and the commit as its
   message. Keep the environment's Wrangler configuration outside the clone, so
   the clone stays clean; its `main` points into the clone. `wrangler deploy`,
   not `versions upload`, applies Durable Object migrations:

   ```sh
   WRANGLER_OUTPUT_FILE_PATH=../deploy-output.ndjson \
     npx wrangler deploy --config <environment config> \
     --tag vX.Y.Z --message "$(git rev-parse HEAD)"
   ```

4. Read what is running:
   - The catalog Worker: `GET /v1/version` with a read service token, with the
     token's values supplied at run time from 1Password, never pasted. Its
     `buildVersion` must equal the deploy check's Build Version, and its
     `workerVersionTag` must be `vX.Y.Z`.
   - The Event Ledger, intake and recovery Workers serve no version route.
     Take the version id from the deploy output and confirm its tag and message with
     `npx wrangler versions view <version-id> --config <environment config>`.
5. Write the [deploy receipt](#the-deploy-receipt) in a pull request.

To roll back, deploy the last verified version:
`npx wrangler rollback <version-id> --config <environment config>`. A rollback
cannot cross a Durable Object migration. Record it in a deploy receipt like any
other deploy, naming the version rolled back from.

## The deploy receipt

One file per Worker per environment per deploy:
`docs/receipts/deploy-<environment>-<worker>-vX.Y.Z.md`, for example
`docs/receipts/deploy-staging-homer-catalog-v0.1.0-rc.1.md`. It carries no
account id, hostname, token or Access audience.

```md
# Deploy receipt: <worker> vX.Y.Z to <environment>

| Field | Value |
| --- | --- |
| Environment | staging |
| Worker | homer-catalog |
| Tag and commit | vX.Y.Z, <full commit SHA> |
| Deploy check | passed, Build Version X.Y.Z+<7 characters> |
| Cloudflare version id | <version id> |
| Durable Object migration tags | v1, runner-v1 (homer-catalog); job-evidence-v1 (homer-intake) |
| Time | YYYY-MM-DDTHH:MM:SSZ |
| Version answer | the `GET /v1/version` JSON, or the `wrangler versions view` tag and message |
| Deployed by | <person>, with Danny's yes on <date> |
| Rolled back from | only for a rollback: the version id it replaced |
```

## The Release Gate

A release has passed its Release Gate in an environment when all four hold:

1. CI is green on the tagged commit.
2. The code in the release has passing Verdicts. Until ZER-63 is done, the
   release pull request says which are still owed.
3. Danny said yes, by merging the release pull request and pushing the tag.
4. A deploy receipt exists for each Worker deployed to that environment.

`v0.1.0` contains every line of code on `main`, so it waits for the Verdicts in
ZER-63.
