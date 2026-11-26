# Receipt: open decisions researched and decided, 2026-11-25

Author: Claude Code for Danny (scrimshawlife-ctrl)
Date: 2026-11-25

At 16:43 Pacific time Danny asked for research on the open questions and a
decision on each. Claude Code listed every open-question section, the handoff's
Waiting on Danny list, the `ready-for-human` Tasks in Linear and the open pull
requests. It then researched the ones that needed a choice and asked Danny in
chat, with a recommendation for each.

## Decisions

| # | Question | Danny's answer | What follows |
| --- | --- | --- | --- |
| 1 | Should the PC and Mac self-hosted runners serve Homer (ZER-84)? | No. Homer's CI stays on GitHub-hosted runners. The self-hosted runners are managed in Homer's fleet pages but serve private repositories only. | ADR 002 is amended. The runner group keeps GitHub's default of serving no public repository. |
| 2 | What bypass should the `partner-agents` team have on `main` (ZER-85)? | Pull requests only. | Danny edits the ruleset; then `SECURITY.md` is updated to match. |
| 3 | Strict required checks or a merge queue (ZER-67)? | Strict checks, in a ruleset with no bypass list, so they bind every merge. Review stays bypassable by admins. | Danny creates the ruleset; steps below. |
| 4 | Dependabot #102 and #103? | Rebase, then merge both when CI and Codex are clean. Each is added to ZER-63. | A safety filter stops this session's bot commands, so Danny posts `@dependabot rebase` on each; an agent then merges. |
| 5 | Pull requests #30, #42 and #56, and the leftover branches (ZER-87)? | Close #42. Rebase #56 and #30; #30 stays a draft. Delete both `foundation/*` branches. Keep the 8 `backup/pre-rebase-2026-11-24/*` branches until the runner stack's Verdicts pass. | #42 is closed. This session cannot delete branches, so Danny deletes the two `foundation/*` branches. |
| 6 | Credential administration spec (ZER-86)? | Accept slices 1 and 2 as #32 built them. Slices 3 to 7 stay proposed until the spec's six open decisions are made. | Status lines of `spec.md` and `operator-experience.md` updated. |

Two items needed only a record, not a choice:

- **Event Ledger plan, open questions 2 to 6.** Their current state is now
  under the questions in `specs/event-ledger/plan.md`.
- **Package installs.** This account's agent sessions have network access off,
  so no session can add `@noble/curves` (ZER-61). ZER-61 blocks the Buzz
  Collector (ZER-54) and Alert posting (ZER-115). Danny can turn package
  installs on in the network settings; a new chat picks up the change.

## What the research found

**Self-hosted runners on a public repository.** GitHub recommends self-hosted
runners only for private repositories, and by default a runner group serves only
private ones. No Homer workflow uses a self-hosted runner today. The org is on
GitHub's Team plan (`discovery-2026-11-18.md`). GitHub's own page is unclear
whether that plan can restrict a runner group to selected workflows.

**The bypass list.** The `main protection` ruleset (id 27592526) gives `always`
bypass to organization admins and to team 18908169, which `SECURITY.md` names as
`partner-agents`. The 100 most recent Homer pull requests were all opened by
`scrimshawlife-ctrl` or Dependabot, and agents merge as `scrimshawlife-ctrl`, an
org admin, so they use the admin bypass, not the team's. Under
`pull_request` bypass the team can no longer push to `main` directly, but its pull
requests can still merge without review or passing checks.

**Keeping `main` green.** None of the last 60 commits on `main`, 37 merged on
2026-11-24 and 23 on 2026-11-25, has a failed check. Every one merged through the
org-admin bypass. That bypass skips the whole ruleset, so neither strict checks
nor a merge queue in that ruleset would have applied to them. What kept `main` green
was how each merge was done: the branch brought up to date, CI awaited on that
head, and `main` checked after. GitHub lets rulesets layer: rules in a ruleset with an empty
bypass list bind everyone. A merge queue is free on organization-owned public
repositories, but every workflow would need a `merge_group` trigger, the
docs-only classifier would have to read the queue's commits, and an admin can
still merge around it.

**Dependabot.** #102 moves `actions/upload-artifact` from 4.6.2 to 7.0.2. Version
6 runs on Node 24 and needs runner 2.327.1 or later, which GitHub-hosted runners
meet. Version 7's change affects only `archive: false`, which Homer's one use (the
admin screenshots in `ci.yml`) does not set. It also moves
`markdownlint-cli2-action` from 25.0.0 to 25.1.0. #103 moves `wrangler`,
`@cloudflare/workers-types`, `@cloudflare/vitest-plugin` and `playwright` by minor
versions. Both passed CI on a `main` from before #107, which also changed
`package.json` files and the lockfile.

**The old pull requests.** #42 holds Work Packets for the runner stack's
pre-rebase heads; ZER-63 makes new packets for the merged heads. #56 is the Buzz
channel catalog (ZER-47), which the Buzz Collector needs. #30 is the trace archive
draft: its intent says accepted, its spec is a 0.1 proposal, and two private
staging R2 buckets exist for it (`trace-r2-provisioning-2026-11-21.md` on its
branch). Neither adds an outside package, so both rebase without network. Every
file on `foundation/event-ledger-plan` (`f9e39f7`) and `foundation/governance`
(`88ae13e`) exists on `main` in a newer version.

**Credential administration.** The delivery contract has seven slices. #32 built
slices 1 and 2 (ZER-25, ZER-26). Nothing writes, rotates or revokes a key.

**Deployments.** In the Zero State Cloudflare account, Homer's Workers are
`homer-catalog-staging`, `homer-event-ledger-staging` and their two recovery
Workers, all last changed on 2026-11-20. No production Homer Worker, `homer-intake`
or `homer-buzz` is deployed.

## Danny's steps

These change rulesets and settings, which only a human does.

1. **Create the checks ruleset first** (ZER-67), so `main` is never without
   required checks. Settings → Rules → Rulesets → New branch ruleset:
   - Name: `main required checks`. Target: the default branch. Enforcement:
     active. Bypass list: empty.
   - Require status checks to pass, with "Require branches to be up to date
     before merging" on. Checks: `markdownlint`, `links`, `context-pin`,
     `gitleaks`, `check`, `audit` and `admin-browser`, each with GitHub
     Actions as its source.
2. **Edit `main protection`** (ZER-67, ZER-85): remove its status checks rule,
   now held by the new ruleset, and set the `partner-agents` team's bypass to
   "For pull requests only". Keep the rest.
3. **Public repository settings** (ZER-84):
   - In the repository's security settings, turn on private vulnerability
     reporting.
   - Settings → Actions → General: "Require approval for all external
     contributors", and set workflow permissions to read repository contents
     only.
   - In the organization's runner group for the PC and Mac, leave public
     repositories off, and list only the private repositories they serve.
4. **Delete the branches** `foundation/event-ledger-plan` and
   `foundation/governance` (ZER-87).
5. ~~Comment `@dependabot rebase` on #102 and #103.~~ Done another way; both
   merged.

At 19:04 Danny told this session to take these steps itself. The session's
GitHub proxy refused each write: creating a ruleset, editing one, turning on
private vulnerability reporting, and deleting a branch. It also refused reading
the Actions settings and runner groups. Nothing changed: `main protection` is
still the only ruleset, and private reporting is still off. The session did not
try another route around the proxy, so steps 1 to 4 are still Danny's. Step 5
is done: #102 and #103 are merged. All three workflows already set
`contents: read` themselves, so the default token setting changes nothing they
do today.

An unbypassable check that breaks blocks every merge, admins' included, until it
is fixed or the ruleset is edited. The `links` check's second run (#113) is there
for exactly that case.

After steps 1 to 3, an agent updates `SECURITY.md` to match, and records the
settings in a receipt.

## Sources

- [GitHub: managing access to self-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access)
- [GitHub: approving workflow runs from forks](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/approve-runs-from-forks)
- [GitHub changelog: merge queue is generally available](https://github.blog/changelog/2023-07-12-pull-request-merge-queue-is-now-generally-available/)
- [GitHub blog: repository rules are generally available](https://github.blog/2023-07-24-github-repository-rules-are-now-generally-available)
- [GitHub Enterprise Server docs: managing a merge queue](https://docs.github.com/en/enterprise-server@3.16/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
- [actions/upload-artifact releases](https://github.com/actions/upload-artifact/releases)
