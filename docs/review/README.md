# HOME merge review handoff

Daniel explicitly authorized merging and continuing in this conversation on
2026-11-18 Pacific Time. That authorization is recorded here; it does not replace
the independent software-factory Verdict, required code-owner approval, or CI.
No further routine merge confirmation is needed for this approved stack once its
required gates pass. Production cutover remains a separate action.

## Current blocker

No online factory Verdict is attached to any of PRs 1 through 6. PRs 5 and 6 have
clean Codex automated reviews, but the factory requires a judge from a different
vendor family than the author. Those reviews cannot substitute for that gate.
This author environment has no configured OpenRouter credential and no authenticated
factory runner. No paid model request was made and no verdict was fabricated.

The two packets here are ready for an authorized factory runner. Their USD 5 caps
are proposed maximums carried from the implementation plan, not recorded spending
or new spend authorization. Use the existing governed provider route and approved
budget. Never paste provider credentials into a PR, packet or shell transcript.

## Execute independent review

Use the existing software-factory installation and its authenticated GitHub access.
Obtain HOME at the Projection branch to read these packet files. Run from the
factory checkout, passing absolute packet paths as appropriate:

```sh
factory judge run --repo Zero-State-LLC/home --pr 5 --packet /path/to/home/docs/review/pr-5.packet.json --model z-ai/glm-5.3 --reproduce --out /tmp/home-pr-5.verdict.json
factory judge gate --verdict /tmp/home-pr-5.verdict.json
factory judge run --repo Zero-State-LLC/home --pr 6 --packet /path/to/home/docs/review/pr-6.packet.json --model z-ai/glm-5.3 --reproduce --out /tmp/home-pr-6.verdict.json
factory judge gate --verdict /tmp/home-pr-6.verdict.json
```

The runner fetches the live head SHA; packets do not pin a stale SHA. Keep the
actual online Verdict and reproduce receipt with the PR. A failing, stale,
offline, truncated or missing Verdict blocks merge. Do not run an offline fixture
and relabel it online. Author identity for these two changes is `openai/gpt-6`.

PRs 1 through 4 also need current-head factory evidence. Their original author's
exact model identifier must be confirmed from the author or factory record before
judging. Do not infer a model from the GitHub account that created the commit.

## Stack order

| PR | Branch | Intended merge target after its predecessor lands |
| --- | --- | --- |
| 1 | `foundation/governance` | `main` |
| 2 | `foundation/contracts` | `main` |
| 3 | `foundation/event-ledger-spec` | `main` |
| 4 | `foundation/event-ledger-plan` | `main` |
| 5 | `implementation/event-ledger` | `main` |
| 6 | `implementation/activity-projections` | `main` |

Each PR currently targets its predecessor. Do not squash a successor into its
predecessor branch and call that a release. After each predecessor is squash-merged
into `main`, retarget the next PR, reconcile its branch with current `main`, verify
that its diff contains only its intended change, and rerun tests and judge checks
for the resulting head. Use expected-head SHA protection on each merge. Preserve
review threads and fix any findings before resolving them. Do not bypass the main
ruleset, invent an approval, or relax checks to land the stack.

## Continue after landing

Follow [the migration plan](../migration/control-room.md): implement source-specific
Collectors and reviewed mappings; verify authenticated access to the ledger;
add calendar/timeline UI to the existing Control Room with mobile parity; then
prove restoration, reconciliation and production acceptance. Keep ZER-9 open until
its live acceptance criteria pass. No deployment is implied by a merged package.
