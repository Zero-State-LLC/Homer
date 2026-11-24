# CI feedback time

Status: proposed. Not accepted until Danny accepts the intent.
Intent: [CI feedback time](../../docs/intent/ci-feedback.md) (draft).
Evidence: [CI baseline receipt](../../docs/receipts/ci-baseline-2026-11-24.md).
Decisions: [ADR 008](../adr/008-ci-builds-once.md),
[ADR 009](../adr/009-docs-only-skips-workspace.md),
[ADR 010](../adr/010-measured-ci-changes-only.md).

## Scope

This spec changes how the CI `check` job runs, not what it checks. It covers
`.github/workflows/ci.yml`, the root `package.json` scripts, and one new script
with its test. The Docs and Secret scan workflows, the `audit` job and the `main`
ruleset do not change.

The techniques come from StarSling's
[OpenClaw CI playbook](https://starsling.dev/ci-playbooks/openclaw), which
collects 46 of them from Vincent Koc's write-up and OpenClaw's merged pull
requests. [ADR 010](../adr/010-measured-ci-changes-only.md) weighs each family
against Homer's measured baseline. Two fit: build once, and skip work a change
cannot affect.

## Requirements

1. **R1 Build once.** A `check` run runs `npm run build` once, after Format and
   before Lint. Typecheck and Test run with npm's `--ignore-scripts`, which skips
   the `pre` and `post` scripts of the named script and still runs the script.
   The trailing Build step goes: the one build is the build check, and it still
   runs the `postbuild` runtime tests. `npm run check` uses the same order. The
   `pretypecheck` and `pretest` scripts stay, so `npm test` alone still works on
   a clean tree.
2. **R2 Classify the change.** Before any workspace step, `scripts/ci-changes.sh`
   decides whether the change needs the workspace steps, by the rules in
   [Classification rules](#classification-rules). It writes `workspace=true` or
   `workspace=false` to the step output.
3. **R3 Skip only docs-only pull requests.** Each workspace step (Node setup,
   `npm ci`, Format, Build, Lint, Typecheck, Test, Workers smoke) runs unless
   `workspace` is `false`, so a missing or garbled output runs everything. A
   step that is not run shows as skipped in the log, never hidden.
4. **R4 Say why.** The classifier writes the deciding rule to the run's step
   summary and, when the workspace steps do not run, the changed files.
5. **R5 Prove the fallbacks.** `scripts/test-ci-changes.sh` builds throwaway
   repositories with real merge commits and asserts the classifier's output for
   every row of the rules table. It runs first in every `check` run, before the
   classifier is trusted.
6. **R6 Same checks, same names.** Every change that is not docs-only runs every
   step that runs today, in the same job. The jobs stay `check` and `audit`, so no
   ruleset or required-check edit is needed.
7. **R7 Measure.** Each pull request that implements this spec records, in a
   receipt under `docs/receipts/`, the `check` median of at least five green runs
   before and after, by the commands in [Measuring a change](#measuring-a-change).

## Workflows

### A code pull request

1. `actions/checkout` with `fetch-depth: 2`, so the merge commit and both of its
   parents are present.
2. `bash scripts/test-ci-changes.sh` proves the classifier's fallbacks.
3. `bash scripts/ci-changes.sh` lists the change and outputs `workspace=true`.
4. `actions/setup-node`, then `npm ci --no-audit --no-fund`.
5. Format, Build, Lint, `npm run --ignore-scripts typecheck`,
   `npm test --ignore-scripts`, Workers smoke.

### A docs-only pull request

1. Steps 1 to 3 as above. The classifier outputs `workspace=false` and writes the
   changed Markdown files to the step summary.
2. The workspace steps report as skipped and `check` ends green within seconds.
3. Everything else runs as before: `audit` in CI, `markdownlint`, `links` and
   `context-pin` in Docs, and `gitleaks` in Secret scan. A broken link or an
   `AGENTS.md` lint failure still fails the pull request.

### A push to `main`, or any other event

The classifier outputs `workspace=true` for every event that is not
`pull_request`. A push to `main` runs every step. Pull requests do not have to
be up to date with `main` before they merge, so this run is the first check of
the exact merged tree.

### Classification rules

The first matching row decides.

| Condition | `workspace` | Why |
| --- | --- | --- |
| The event is not `pull_request` | `true` | Pushes, manual runs and any future trigger run everything |
| `HEAD` is not a merge commit with two parents | `true` | The pull request's change cannot be listed |
| `git diff` fails | `true` | The change cannot be listed |
| The diff lists no path | `true` | Nothing shows the change is docs-only |
| A path is under `.github/` | `true` | `AGENTS.md`: a docs-only change has nothing under `.github/` |
| A path does not end in `.md` (lowercase) | `true` | Only Markdown is docs-only |
| Otherwise | `false` | Docs-only, as `AGENTS.md` defines it |

How the change is listed: for a `pull_request` event, `actions/checkout` checks
out the merge commit GitHub creates for the pull request. Its first parent is the
base branch. `git diff --name-only --no-renames -z HEAD^1 HEAD` lists every path
the merge would change. With `--no-renames`, a renamed file lists both its old
and its new path, so renaming `a.ts` to `a.md` is not docs-only. NUL separators
keep a path with spaces in one piece.

The rules and `AGENTS.md` define docs-only together. A change to one without the
other is a defect. If a build, lint, type check or test ever reads a Markdown
file from the repository, the same pull request classifies that path as code.

### Measuring a change

```sh
gh run list -R Zero-State-LLC/Homer --workflow CI --status success -L 30 \
  --json databaseId,event,headBranch,createdAt
gh run view <id> -R Zero-State-LLC/Homer --json jobs \
  --jq '.jobs[] | select(.name == "check") | [.startedAt, .completedAt] | @tsv'
```

A median over at least five green runs of the same kind (code pull request,
docs-only pull request, or push to `main`) counts. The
[baseline receipt](../../docs/receipts/ci-baseline-2026-11-24.md) is the before.

### Threat model

- A pull request can change the classifier or its test, just as it can change
  `ci.yml` today. Trust does not change: such a pull request touches a path that
  is not Markdown, so it is not docs-only, it runs every step, and the merge
  contract needs a Verdict for it.
- The classifier reads git metadata only. It needs no token, no secret and no
  network, and checkout keeps `persist-credentials: false`.
- A file name is data. The classifier never evaluates one, and the step summary
  writes names inside a code block.
- A Markdown file that code reads would make the docs-only rule unsafe. None
  exists [verified: search of `packages/`, `scripts/` and the Vitest configs].

### Skills

- `anti-slop-code`
- `production-systems`
- `google-developer-style`

### GitHub Actions

| Workflow | Path | When to use |
| --- | --- | --- |
| CI | `.github/workflows/ci.yml` | Every pull request and push to `main`. `check` skips its workspace steps only for a docs-only pull request; `audit` always runs |
| Docs | `.github/workflows/docs.yml` | Unchanged: Markdown lint, links, and the Context Pin |
| Secret scan | `.github/workflows/secret-scan.yml` | Unchanged: every pull request, push to `main`, and on schedule |

## Acceptance and implementation plan

Work packets, in order. FORGE owns the plan and Tasks; each becomes a Linear Task
when this spec is accepted.

1. **Build once** ([ADR 008](../adr/008-ci-builds-once.md)). `ci.yml` and
   `npm run check` build once, with Format first.
   Acceptance: a green `check` log shows one `npm run build` and one run of the
   `postbuild` runtime tests; the same steps pass; the `check` median over at
   least five green code runs is at least 15 seconds below 76, in a receipt.
2. **Docs-only classification** ([ADR 009](../adr/009-docs-only-skips-workspace.md)).
   `scripts/ci-changes.sh`, `scripts/test-ci-changes.sh`, the `if:` conditions in
   `check`, and the Buzz spec's GitHub Actions row.
   Acceptance: the classifier test passes in CI with a case for every row of the
   rules table; a code pull request still runs every step; the first docs-only
   pull request after merge shows the workspace steps skipped, the summary line,
   and a green `check` in under 20 seconds, recorded in a receipt.

Open pull request #32 adds an `admin-browser` job that builds the workspace. When
it lands after packet 2, that job takes the same classifier step and `if:`
conditions.

## Open choices with defaults

Each default holds unless Danny changes it when accepting this spec.

| Choice | Default | Alternative |
| --- | --- | --- |
| Require `check` and `audit` in the `main` ruleset | Not changed here. Packet 2 makes it safe, because a docs-only pull request still gets a green `check` | Danny adds both after packet 2 lands |
| `audit` on docs-only pull requests | Keeps running: 7 seconds, in parallel with `check`, and a new advisory should block any merge | Skip it with the same classifier |
| Non-Markdown files that cannot affect the build, such as images under `assets/` | Not docs-only: run everything | Widen the rule, which first needs `AGENTS.md`'s definition to change |
| Keep tuning CI over time, the write-up's main point | Each CI change records before and after in a receipt; [ADR 010](../adr/010-measured-ci-changes-only.md) lists when to revisit | A scheduled agent that opens CI pull requests. Declined by default: the Zero State SDLC adds no bots or agent fleets |

Sources: StarSling's [OpenClaw CI playbook](https://starsling.dev/ci-playbooks/openclaw),
read 2026-11-24; Yonas Beshawred's post on X about it, 2026-11-24; GitHub's
[troubleshooting required status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).
Terms: `CONTEXT.md` Verdict, Curator Run. No new term for `CONTEXT.md`.
