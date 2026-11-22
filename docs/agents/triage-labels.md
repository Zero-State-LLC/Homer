# Triage labels

Pocock's engineering skills speak in five triage roles. This file maps
each role to the label Homer uses in Linear team ZER. `/to-tickets`
applies `ready-for-agent`; `/triage` moves Tasks between the rest.

Accepted in [`docs/intent/agent-workflow.md`](../intent/agent-workflow.md).

| Role in `mattpocock/skills` | Label in Linear team ZER | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | A maintainer needs to evaluate this Task |
| `needs-info` | `needs-info` | Waiting on the reporter for more information |
| `ready-for-agent` | `ready-for-agent` | Fully specified, ready for an agent |
| `ready-for-human` | `ready-for-human` | Needs a human to implement |
| `wontfix` | `wontfix` | Will not be actioned |

When a skill names a role, use the label from the second column.

These labels exist only in Linear. Do not create them in GitHub, where
Homer's one label is `defect`. If a label is missing in team ZER, say so
and ask a human to create it; do not apply a different label instead.
