# Issue tracker: Linear, with specs in `specs/`

Pocock's engineering skills (`mattpocock-skills`) read this file to learn
where work lives in Homer. Homer's words win over the skills' words: a
"ticket" is a Task, and a Task is a Linear issue. See [`CONTEXT.md`](../../CONTEXT.md).

Accepted in [`docs/intent/agent-workflow.md`](../intent/agent-workflow.md).

## Where each thing lives

| Thing | Lives in | Authority |
| --- | --- | --- |
| Task | Linear team ZER | Linear |
| Spec | `specs/<area>/spec.md`, with a `## Workflows` section, landed by pull request | Humans accept it |
| Intent | `docs/intent/<stream>.md`, landed by pull request | Humans accept it |
| Defect | GitHub issue with label `defect` | GitHub |
| Plan | FORGE | FORGE |
| Triage label | Linear team ZER, mapped in [`triage-labels.md`](triage-labels.md) | Linear |

## When a skill says "publish to the issue tracker"

- **A spec** (for example `/to-spec`): write `specs/<area>/spec.md` on a
  branch and open a pull request. Link the Linear Task (`ZER-N`) in the
  pull request when one exists. Do not publish the spec as a Linear
  issue or a GitHub issue, and do not apply a triage label.
- **A set of tickets** (for example `/to-tickets`): create one Task per
  ticket in Linear team ZER, blockers first, with each block as a native
  Linear "blocked by" relation and the `ready-for-agent` label. Danny
  ruled on 2026-11-21 that running `/to-tickets` is the yes; FORGE still
  owns the plan.
- **A defect** (the `AGENTS.md` Escalation): open a GitHub issue with
  label `defect`, for example
  `gh issue create --label defect --title "..." --body "..."`.

## When a skill says "fetch the relevant ticket"

Read the Linear Task (`ZER-N`) with the session's Linear connector. If the
session has no Linear access, say so and ask for the Task text. Do not
fall back to GitHub Issues for a Task.

Use the Linear branch name when a Task exists (`zer0state/zer-N-...`), as
[`CONTRIBUTING.md`](../../CONTRIBUTING.md) says.

## When a skill says "close the ticket"

Close a Task only after its pull request merges. For `wontfix`, `/triage` may cancel the Task in Linear with
a comment that says why.

## Triage

`/triage` works on Linear Tasks in team ZER, with the labels in
[`triage-labels.md`](triage-labels.md). It does not triage GitHub
`defect` issues. A rejected enhancement is written to `.out-of-scope/`,
as the skill does by default, in a pull request.

## Parallel implementation

`/implement-spec` may run implementer subagents in parallel without
asking (Danny, 2026-11-21). This departs from "No agent fleets" in
agent-context `DECISIONS.md`, for Homer only. Subagents may merge into the
spec's integration branch. That branch reaches `main` only through a pull
request under the merge gate below.

## Not configured in Homer

- **Wayfinding** (`/wayfinder`): not configured. Ask Danny before using
  it.
- **Pull requests as a request surface**: no.

## Review and merge

`/code-review` and `/pr` help the author before review. They are not a
software-factory Verdict. A pull request body follows
[`.github/pull_request_template.md`](../../.github/pull_request_template.md).
Merging needs Danny's yes and the software-factory merge contract. Agents
never merge.
