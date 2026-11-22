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
| Plan and task breakdown | FORGE | FORGE |

## When a skill says "publish to the issue tracker"

- **A spec** (for example `/to-spec`): write `specs/<area>/spec.md` on a
  branch and open a pull request. Link the Linear Task (`ZER-N`) in the
  pull request when one exists. Do not publish the spec as a Linear
  issue or a GitHub issue, and do not apply a triage label.
- **A set of tickets** (for example `/to-tickets`): FORGE owns plan and
  tasks. Show the proposed Tasks and their blocking edges as text first.
  Create them in Linear team ZER only after a human says yes to that
  breakdown, and record each block as a Linear "blocked by" relation.
- **A defect** (the `AGENTS.md` Escalation): open a GitHub issue with
  label `defect`, for example
  `gh issue create --label defect --title "..." --body "..."`.

## When a skill says "fetch the relevant ticket"

Read the Linear Task (`ZER-N`) with the session's Linear connector. If the
session has no Linear access, say so and ask for the Task text. Do not
fall back to GitHub Issues for a Task.

Use the Linear branch name when a Task exists (`zer0state/zer-N-...`), as
[`CONTRIBUTING.md`](../../CONTRIBUTING.md) says.

## Not configured in Homer

- **Triage** (`/triage`): not adopted. Do not create triage labels in
  GitHub or Linear.
- **Wayfinding** (`/wayfinder`): not configured. Ask Danny before using
  it.
- **Parallel implementation** (`/implement-spec`): not used without
  Danny's yes, under the agent-context rule against agent fleets. Use
  `/implement` instead.
- **Pull requests as a request surface**: no.

## Review and merge

`/code-review` and `/pr` help the author before review. They are not a
software-factory Verdict. A pull request body follows
[`.github/pull_request_template.md`](../../.github/pull_request_template.md).
Merging needs Danny's yes and the software-factory merge contract. Agents
never merge.
