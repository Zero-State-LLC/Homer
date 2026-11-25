# Receipt — audit of `main`, 2026-11-24

Author: Claude Code for Danny (scrimshawlife-ctrl)
Date: 2026-11-24
Scope: `main` at `586fe8b`, the repository's settings and ruleset, and its open
branches. Requested by Danny: design gaps, security and repository hygiene,
versioning included.

## Method

Read every workflow, Worker configuration, router and authentication module,
the ruleset, the repository settings the API exposes, every intent, spec and ADR
status line, `CONTEXT.md`, `SECURITY.md`, the CHANGELOG and the branch list.
Swept the tree for secrets, account ids, Access audiences and team domains,
private addresses, email addresses and secret references. GitHub Actions
settings (fork pull request approval, default token permissions, runners) are
not readable from this session; they are marked unverified below.

## What is sound

- **Workflows.** Every workflow sets `permissions: contents: read`, pins each
  action to a commit SHA, uses no `pull_request_target`, and puts no untrusted
  event field into a `run:` step. gitleaks scans the full history with a
  checksum-verified binary. `npm audit` fails on high and critical.
- **Repository.** Secret scanning and push protection are on, and so are
  Dependabot security updates. Branches are deleted on merge. The tree holds no
  secrets, account ids or Access audiences. The only private address is an
  internal Docker test network in the curator host guide. The only identifiers
  are Buzz public keys and channel ids, which the Buzz spec records as not
  secret.
- **Worker authentication.** The catalog Worker validates its Access
  configuration on every request and fails closed. It verifies Access JWTs
  itself: RS256 only, issuer and audience pinned, `sub`, `exp` and `iat`
  required. Admin paths need the admin audience. Controller tokens must carry
  exactly one audience and come from a service identity. The GitHub webhook is
  verified with HMAC-SHA256 over at most 1 MiB, with a checked delivery id.
- **Admin pages.** There is no `innerHTML` or similar sink. Every page sends a
  strict Content Security Policy (`default-src 'none'`), `nosniff`, `DENY`
  framing and `no-store`. Cross-origin requests are refused, and writes need
  `If-Match`.
- **Workers.** `workers_dev` and preview URLs are off.

## Findings

Ranked by severity. Each has a Linear Task, or names the one it extends.

### High

**H1. The checks that test code are not required on `main`.** The ruleset
requires `markdownlint`, `links`, `context-pin` and `gitleaks`, but not `check`,
`audit` or `admin-browser`. Required checks are not strict, and there is no
merge queue, so two green pull requests can combine into a red `main`. On
2026-11-24, 20 pull requests merged through the admin bypass. Today `main`'s
quality rests on convention. → ZER-67, extended to `admin-browser` and the
strict-or-merge-queue decision.

**H2. Eighteen code pull requests owe a Verdict.** These merged without a
software-factory Verdict or a reproduce check: pull requests #51 to #55, #63,
the runner stack #31 to #46, and #64 and #66 to #68. The judge cannot run yet, because the runbook that turns
a Task into a Work Packet (ZER-74) does not exist. → ZER-63 and ZER-74.

**H3. The repository is public, and its settings and docs assume it is not.**

- `SECURITY.md` says private vulnerability reporting "is not available on
  private repositories"; on a public repository it is, and it is not yet the
  documented channel.
- The Actions settings that matter for a public repository are unverified: the
  approval policy for fork pull requests, and the default `GITHUB_TOKEN`
  permissions.
- ZER-34 plans self-hosted CI runners on a personal PC and Mac. GitHub
  recommends self-hosted runners only for private repositories, because a
  fork's pull request can run code on them ([GitHub: adding self-hosted
  runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners)).
  By default, a runner group does not serve public repositories. That default
  is the guardrail to keep. ADR 002 already forbids running untrusted fork
  pull requests on those runners. Nothing in the repository enforces that, and
  the runner settings are unverified.

→ ZER-84, which blocks ZER-34.

**H4. Homer has no versioning or release mechanism.**

- Every package is at `0.0.0`, the root has no version, and there are no tags
  or releases. The CHANGELOG is one Unreleased section of 47 entries.
- The version in each Activity Event's Provenance is typed by hand per
  Collector: `1.0.0` in `buzz-collector` and in `github-sync`'s merge mapping,
  `0.1.0` in the workflow-job mapper. None of them is tied to a package
  version or a commit, so a recorded event cannot be traced to the code that
  made it.
- Workers deploy by hand. The deployment guide asks the operator to record the
  Worker version, source SHA and migration version, and nothing produces them.
- `CONTEXT.md` defines a Release Gate that needs "a deploy receipt", but there
  is no release for one to belong to.

→ ZER-90 and the draft intent `docs/intent/versioning-and-releases.md`.

### Medium

**M1. A team can always bypass `main` protection.** The ruleset's bypass list
is organization admins and a team (id 18908169), both with `always`.
`SECURITY.md` names that team as `partner-agents`. So an agent in that team can
merge with no review and no checks. → ZER-85 (Danny's decision).

**M2. Credential administration code merged on an unaccepted spec.**
`specs/credential-admin/spec.md` is still a "draft specification", and
`operator-experience.md` is a "proposed design". Only the delivery contract's
Task breakdown was accepted. #32, which implements them, is on `main`. → ZER-86:
accept or revise.

**M3. Five pull requests and branches sit on the pre-restart history.** Pull
requests #30, #42 and #56 (ZER-47) share no history with `main`, as the runner
stack did. So do the branches `foundation/event-ledger-plan` and `foundation/governance`,
which have no pull request. Eight `backup/pre-rebase-2026-11-24/*` branches wait
for deletion. → ZER-87.

**M4. The catalog Worker has become the whole back end.** One Worker
(`homer-catalog`) serves the repository catalog, the GitHub webhook, the
credential directory, the Activity Calendar, the runner fleet, the controller
protocol, job evidence and every admin page, under one Access configuration and
one deploy. No ADR decides that boundary. Fleet intake (ZER-80) would add one
more concern. → ZER-88: an ADR, which blocks ZER-80.

**M5. The map and the decision records have drifted.**

- `docs/map.md` calls `implementation-2026-11-23.md` the latest handoff. It does
  not list the accepted runner, credential and work assignment router work.
- ADR 007 says "proposed. Not accepted until Danny accepts the intent" and
  calls the intent a draft, but that intent was accepted on 2026-11-23 (#60).
  Whether that accepts the ADR is Danny's call.
- Intents, specs and ADRs use more than ten different forms of status line.

→ ZER-89.

### Low

**L1. `CONTEXT.md` lacks terms the code and specs use.** These include
Observation, which the Authority definition itself relies on, plus Machine,
Runner, Alert and Alert Key, and Job Attempt. → ZER-89.

**L2. Two names for one product.** The product is Homer. But the root package is
`home`, the scope `@zs-home`, the ledger Worker `home-event-ledger` and the
contract ids `home.*`, while the catalog Worker is `homer-catalog`. Contract ids
are frozen by the versioning rule. Worker names are cheap to change before the
first deploy. → ZER-90, in the versioning intent's open questions.

**L3. A required check depends on the internet.** `links` failed on #71 today
because github.com answered `502` for three pull request links. It passed on a
re-run. → ZER-89.

**L4. Agent hooks run repository code.** `.claude/settings.json` runs
`.trail/hook.cjs` at the start of every agent session, and the hook resolves
packages from `node_modules`. In a public repository, a change to `.claude/` or
`.trail/` is a code change. The docs-only classifier already treats it that
way. No Task; noted for review.

**L5. Small shape issues.**

- Four CHANGELOG entries sit outside any `###` subsection.
- Receipt names put the date first in four files and last in seven.
- `docs/review/` holds Work Packets for pull requests from before the restart.
- Only the root and `event-ledger` declare `engines`, and there is no `.nvmrc`.
- Six links in docs and specs carry Linear Task titles in their URLs, which is
  public now.

→ ZER-89.

## Not checked

- GitHub Actions settings (fork approval, token defaults, runners and runner
  groups): not readable from this session.
- Anything deployed: Homer has no production deployment (`SECURITY.md`).
- `agent-context`, which is outside this repository.
