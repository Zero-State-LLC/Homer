# Receipt — merges under Danny's admin bypass, 2026-11-24

Author: Claude Code for Danny (scrimshawlife-ctrl)
Date: 2026-11-24

## The decision

On 2026-11-24 at 17:48 Pacific time, Danny told Claude Code in chat to
"grant admin bypass for merge as needed". The main ruleset (`main protection`,
27592526) lets organization admins bypass it at all times, and this session's
GitHub identity reported `current_user_can_bypass: always`. Claude Code used
that bypass to squash-merge the eight pull requests below. The ruleset was not
edited. `AGENTS.md` and the merge contract in `CONTRIBUTING.md` are unchanged.
This receipt records that the bypass was used and what is still owed because
of it.

## What merged

| PR | Change | Merged head | Squash commit on `main` |
| --- | --- | --- | --- |
| [#61](https://github.com/Zero-State-LLC/Homer/pull/61) | Work Request emission spec, accepted | `d075413` | `c328674` |
| [#62](https://github.com/Zero-State-LLC/Homer/pull/62) | CI feedback intent, spec and ADRs 008 to 010, accepted | `90fbba0` | `41bde2d` |
| [#65](https://github.com/Zero-State-LLC/Homer/pull/65) | Merge-risk questions in `CONTRIBUTING.md` | `cdc480f` | `0cd4e82` |
| [#66](https://github.com/Zero-State-LLC/Homer/pull/66) | Pure Work Request builder (ZER-71) | `be9cec6` | `09687f2` |
| [#67](https://github.com/Zero-State-LLC/Homer/pull/67) | Homer's policy file and the Jev client (ZER-72) | `35f2d83` | `ff31792` |
| [#68](https://github.com/Zero-State-LLC/Homer/pull/68) | Request store and emitter CLI (ZER-73) | `ec85c60` | `db5b08f` |
| [#63](https://github.com/Zero-State-LLC/Homer/pull/63) | CI builds the workspace once (ADR 008, ZER-64) | `4bd055d` | `0d0e74e` |
| [#64](https://github.com/Zero-State-LLC/Homer/pull/64) | Docs-only pull requests skip the workspace steps (ADR 009, ZER-65) | `cda0c7f` | `3e2132d` |

The bypass waived only the code-owner review. Before each merge:

- All six checks (`check`, `audit`, `markdownlint`, `links`, `context-pin`,
  `gitleaks`) passed on the exact head that merged. Merges named that head
  SHA, so a later push could not slip in.
- Codex had completed a review with no unresolved findings, and the pull
  request had no unresolved review thread. Codex reviewed each branch before
  `main` was merged into it. Each merged head adds only that merge, and
  #68 also adds the changelog fix described below.
- A stacked pull request was retargeted to `main` once its base merged, and
  `main` was merged into its branch. Some conflicts came from files that both
  sides added, because squash merges leave git no common base. For those, the
  branch's copy was kept only after checking that `main`'s copy matched the
  parent pull request's head byte for byte. Every other conflict was in
  `CHANGELOG.md`, and both sides' entries were kept.

One gate caught a defect. The first update of #68 left extra blank lines and a
second copy of the ZER-71 changelog entry, and `markdownlint` failed on it. The
duplicate had already reached `main` with #67 (`ff31792`). Commit `ec85c60` on
pull request #68 removed both, so `main` was clean again from `db5b08f`.

After the last merge, `main` at `3e2132d` passed all six checks. The check job
ran 31 test files and took 56 seconds.

## What is still owed

- **Verdicts.** #63, #64, #66, #67 and #68 are code and merged without a
  software-factory Verdict or a reproduce check. ZER-63 lists them next to
  #51 to #55 for after-the-fact Verdicts against the merged heads above. A
  failing Verdict is fixed forward in a new pull request, never by rewriting
  history. #61, #62 and #65 are docs-only and stand on Danny's acceptance.
- **ZER-74**, the runbook, is the first real use of the emitter on `main`. It
  produces the Work Requests those Verdicts need.
- **ZER-67** (Danny): with #64 landed, `check` and `audit` can become required
  checks on `main`.
- **ZER-66**: record the first docs-only check run now that #64 has landed.

## Later the same day

Under the same grant, eleven more pull requests merged.

**Fleet monitoring and this receipt (docs-only).** #69 (`aca0d56`) records
Danny's acceptance of the fleet monitoring intent, #70 (`463ea35`) is this
receipt, and #71 (`8f6ad0e`) records his acceptance of the fleet monitoring
spec and ADR 011. They stand on his acceptance, CI and clean Codex reviews.

**The runner stack, rebased at Danny's request.** #31 to #46 were cut before
`main` restarted on 2026-11-23 and shared no history with it, and fleet
monitoring waits on #35 and #38. Before anything was rewritten, each original
head was pushed to `backup/pre-rebase-2026-11-24/<branch>`. Each PR's whole
diff was then replayed as one commit onto the rebased PR below it, with a
three-way merge against its original base, and pushed with leases pinned to
the original heads. Every file of every PR carries the same added and removed
lines as before, with two exceptions, both noted on the PRs:

- #32: the new `admin-browser` job takes the docs-only classifier step and its
  `if:` conditions, as the accepted CI feedback spec requires.
- #38: the build chain is `main`'s with `runner-controller` added, and the
  lockfile gains its two entries in npm's sorted order.

Codex then reviewed every rebased head. On #44 and #45 it found five problems,
four of them open since 2026-11-22, and one more on #44 after the first fixes.
Danny asked for them fixed, each with a test that fails when its fix is
reverted:

- #44: samples are compared and grouped in a canonical field order; timing
  warnings are kept when the execution time is valid; skipped and neutral jobs
  no longer count as failures; a conflicting attempt is flagged in every
  bucket it touches, whatever the input order.
- #45: GitHub's runner id `0` reads as Unknown; enrichment is refused when
  nothing names the job's attempt, so a rerun's actor is not attached to an
  older job.

| PR | Change | Merged head | Squash commit on `main` |
| --- | --- | --- | --- |
| [#31](https://github.com/Zero-State-LLC/Homer/pull/31) | Credential administration design | `56c622e` | `f652580` |
| [#32](https://github.com/Zero-State-LLC/Homer/pull/32) | Operator forms and scoped credential read views (ZER-25, ZER-26) | `2e290ff` | `e41d3dc` |
| [#35](https://github.com/Zero-State-LLC/Homer/pull/35) | Work calendar and runner fleet configuration (ZER-32, ZER-33) | `6922f78` | `8cb7057` |
| [#38](https://github.com/Zero-State-LLC/Homer/pull/38) | Scoped runner controller protocol (ZER-34) | `b0eaaaa` | `6d5e702` |
| [#39](https://github.com/Zero-State-LLC/Homer/pull/39) | Machine connection and runner disconnect (ZER-38, ZER-39) | `2794758` | `266e63a` |
| [#44](https://github.com/Zero-State-LLC/Homer/pull/44) | Runner performance Projection (ZER-40) | `71dd7cf` | `51050ae` |
| [#45](https://github.com/Zero-State-LLC/Homer/pull/45) | Workflow-job provenance mapper (ZER-36) | `226b823` | `c4fde94` |
| [#46](https://github.com/Zero-State-LLC/Homer/pull/46) | Workflow-job admission (ZER-36) | `5d47278` | `bad73ad` |

Each merged with all seven checks green on its exact head, `admin-browser`
included. After the last merge, `main`'s tree at `bad73ad` is identical to the
head Codex reviewed on #46, and all seven checks passed on it, with 41 test
files.

**Still owed:** all eight are code, and none has a Verdict. ZER-63 lists them
with their full head SHAs. ZER-34 and ZER-36 stay open for live enrollment and
the remaining job evidence work, as their pull requests say. The backup
branches can be deleted once Danny is satisfied with the rebase.

## The evening

Under the same grant, eleven more pull requests merged between 19:44 and 21:41
Pacific time. Each merged on its exact head, with all seven checks green and a
completed Codex review with no unresolved thread. After each merge, `main`'s
tree matched the reviewed head. After the last one, all seven checks passed on
`main` at `83827cf`.

**Docs and configuration.** These stand on Danny's acceptance, CI and clean
Codex reviews:

| PR | Change | Merged head | Squash commit on `main` |
| --- | --- | --- | --- |
| [#72](https://github.com/Zero-State-LLC/Homer/pull/72) | This receipt's runner-stack section | `518c1a8` | `586fe8b` |
| [#73](https://github.com/Zero-State-LLC/Homer/pull/73) | Audit of `main` for design gaps, security and hygiene | `38a781e` | `4b03a8a` |
| [#74](https://github.com/Zero-State-LLC/Homer/pull/74) | Versioning and releases intent, accepted | `2642b9e` | `bd4a785` |
| [#75](https://github.com/Zero-State-LLC/Homer/pull/75) | Versioning spec and ADR 012, accepted, with two Codex fixes | `764ef44` | `f46b2b0` |
| [#80](https://github.com/Zero-State-LLC/Homer/pull/80) | Context Pin moves to the Zero State versioning rule | `55e4e97` | `8979176` |

**Code: the versioning stream, ZER-91 to ZER-95.**

| PR | Change | Merged head | Squash commit on `main` |
| --- | --- | --- | --- |
| [#76](https://github.com/Zero-State-LLC/Homer/pull/76) | One lockstep product version (ZER-91), one Codex fix | `5de6a2e` | `d5f6e65` |
| [#77](https://github.com/Zero-State-LLC/Homer/pull/77) | Build Version on every Activity Event (ZER-92) | `c9a2737` | `0c9be45` |
| [#78](https://github.com/Zero-State-LLC/Homer/pull/78) | CHANGELOG check and release notes (ZER-93), three Codex fixes | `0a0790d` | `be08e6e` |
| [#79](https://github.com/Zero-State-LLC/Homer/pull/79) | A release candidate needs its own CHANGELOG section | `19c610b` | `14cf106` |
| [#81](https://github.com/Zero-State-LLC/Homer/pull/81) | The catalog Worker's `GET /v1/version` (ZER-94) | `4250174` | `9f0b0e5` |
| [#82](https://github.com/Zero-State-LLC/Homer/pull/82) | Release runbook and deploy check (ZER-95), one Codex fix | `92d7510` | `83827cf` |

Danny made four rulings during these merges, each recorded where it applies:

- the versioning spec's defaults (#75);
- a release candidate gets its own CHANGELOG section, and this is the
  versioning rule for every Zero State repository (#79, agent-context #12);
- only the catalog Worker serves `GET /v1/version` (#81);
- rule 5 of the cross-repository rule: a repository may name a human owner
  other than Danny to push tags.

agent-context #12 has no branch protection, so it merged on Danny's acceptance
without the bypass.

**Still owed:** the six code pull requests above have no Verdict. ZER-63 lists
them with their full head SHAs. ZER-95 stays open for the staging deploy
receipts, which need Danny's yes for staging.
