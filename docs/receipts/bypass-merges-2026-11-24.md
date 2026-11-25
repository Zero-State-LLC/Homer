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
