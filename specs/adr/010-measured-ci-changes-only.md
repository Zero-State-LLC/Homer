# ADR 010: Homer adopts a CI technique only when a measurement shows it pays

Status: accepted by Danny on 2026-11-24 (#62).
Intent: [CI feedback time](../../docs/intent/ci-feedback.md) (accepted).
Spec: [CI feedback time](../ci-feedback/spec.md), requirement R7.
Evidence: [CI baseline receipt](../../docs/receipts/ci-baseline-2026-11-24.md).

## Context

StarSling's [OpenClaw CI playbook](https://starsling.dev/ci-playbooks/openclaw)
collects 46 techniques from Vincent Koc's write-up and OpenClaw's merged pull
requests. OpenClaw runs a large matrix on paid runners, at hundreds of commits a
day, and saves minutes and queue time with scope gates, hourly `main` runs and
duration-packed shards.

Homer is different on every axis that matters for those techniques:

- One workspace job, `check`, at a 76-second median, and four other jobs of 5 to
  8 seconds that run beside it.
- A public repository: standard GitHub-hosted runners are free, so the cost is
  time spent waiting on `check`, not minutes.
- A merge contract that forbids weakening a check, and an SDLC that adds no bots
  or agent fleets.

## Decision

Homer adopts two techniques, [ADR 008](008-ci-builds-once.md) (build once) and
[ADR 009](009-docs-only-skips-workspace.md) (skip what a change cannot affect),
and declines the rest for now. A declined technique comes back only through a
spec change that shows its measured gain, when its trigger fires:

| Technique family in the playbook | Homer today | Decision | Revisit when |
| --- | --- | --- | --- |
| Run broad validation on a post-merge schedule instead of every push to `main` | Push runs take 76 s; pull requests do not have to be up to date before merging, so the push run is the first check of the merged tree | Keep a full run on every push | Push runs queue behind each other, or a run passes 5 minutes |
| Select tests from changed owners, with conservative fallbacks | Test step 21 s, of which about 13 s is Vitest | Keep the full suite on every code change | Vitest alone passes 2 minutes |
| Bundle, split and pack shards by measured duration | One test job | No shards | Vitest alone passes 5 minutes |
| Use a measured native drop-in for type checking (TypeScript 7) | About 3 s of `tsc --noEmit` and an 8 s build; `typescript-eslint` 8.73 needs TypeScript below 6.1; Dependabot's 7.0.2 bump (#14) closed 2026-11-20 | Stay on TypeScript 6; do not run two compilers for seconds | `typescript-eslint` supports TypeScript 7, then it is a plain upgrade |
| Retain compiler state between runs | One build per run after ADR 008 | No cache | The single Build step passes 20 s |
| Run one combined static-analysis report | `markdownlint` 6 s, `context-pin` 7 s, `gitleaks` 5 s, `audit` 7 s, all parallel to `check` | Keep separate jobs, which are also the required check names | Never on its own; only if a job joins the critical path |
| Cancel or debounce superseded validation | `ci.yml` already cancels; Docs and Secret scan finish in about 10 s | No change | Either workflow passes 1 minute |
| Fetch only the history or paths a job needs | `check` fetches depth 1, or 2 after ADR 009; `gitleaks` scans full history by design | No change | |
| Check documentation links only where they changed | The lychee step takes 3 s (max 4) | Keep the full check on every pull request | A pull request fails on a link it did not touch |
| Gate scheduled security scans on changed inputs | The daily `gitleaks` run takes 5 s | No change | |
| Exclude test-only paths from deploy triggers | No deploy workflow in Homer | Not applicable | Homer gains a deploy workflow |
| Faster or third-party runners | Standard runners are free here; larger and third-party runners are billed | Standard runners | A measured gain that justifies a cost Danny approves |
| Agents that watch every run and open CI pull requests | The SDLC adds no bots or agent fleets | Declined. Each CI change records before and after in a receipt, and this table lists the triggers | Danny decides otherwise in agent-context `DECISIONS.md` |

The rest of the 46 target tools Homer does not use (Go module and race-detector
settings, iOS and Docker lanes, database worker reuse, registry batching,
prompt snapshots) and do not apply.

## Consequences

- Most of the playbook is deliberately not done. This table is the record of
  why, so the next agent does not propose a technique again without a
  measurement and a fired trigger.
- Every CI change states its measured gain in a receipt (spec R7). A change that
  cannot show one does not merge.
- Two of the declined families, test selection and a post-merge-only `main`,
  trade what a change checks for speed. They stay declined while the merge
  contract forbids weakening a check, whatever their measured gain.
- The triggers need someone to look. The baseline receipt's commands are the
  check, and any agent can run them.

## Alternatives considered

- **Apply the playbook wholesale.** Rejected: each technique adds moving parts to
  save seconds here, and some reduce what a change checks, which `AGENTS.md`
  forbids.
- **Run the playbook's own prompt with an agent and let it apply what fits.** It
  asks for a baseline, a fit decision per technique and one commit per
  technique, which is what this stream does. Rejected as a shortcut: in Homer the
  intent, spec and Verdict come first, and the prompt would skip them.
- **Adopt nothing.** Rejected: ADR 008 and ADR 009 each remove work that, by
  construction, cannot find anything new.
