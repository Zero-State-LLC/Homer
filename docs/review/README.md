# Homer merge review handoff

For the current operator stack (PRs31,32,35,38,39), use the
[November22 handoff](2026-11-22-operator-stack.md). The audit below records the
historical foundation stack and does not describe current PR status.

Daniel authorized the HOME merge stack on 2026-11-18 PT. The 2026-11-20 PT
request covers all Homer PRs and engineering debt. Routine repairs and stack
reconciliation are authorized. Required independent reviews and CI still apply.
Production deployment and Control Room cutover are separate actions.

## Current evidence

The live audit is tracked in [defect #13](https://github.com/Zero-State-LLC/Homer/issues/13).
Historical passing Verdicts exist for PRs 2, 3, 5, 6, 8 and 9. Only #8 still has
its reviewed head (`9d73fa6a2221bb6e4dc64f7714d515f89ee0fb19`). The other Verdicts
are historical evidence, not approval of current heads. PRs 10 through 12 had
no attached online Verdict at audit time. Do not reuse earlier receipt hashes.

The `type:bug`, `defect`, and `intent` labels were verified through GitHub on
2026-11-20 PT and Prabu was asked to re-review #8. That review remains a merge
gate until GitHub records the required approval. No review was dismissed.

This environment has no configured OpenRouter/subq credential or factory runner.
No paid model request was made. Run the independent judge on the existing governed
runner. Each packet's USD 5 cap is a proposal, not new spending authorization;
use the approved provider budget and current credit floor.

## Stack order

| PR | Branch | Predecessor | Action |
| --- | --- | --- | --- |
| 8 | `foundation/governance-grok` | `main` | Renew the label review, then land after all gates pass. |
| 2 | `foundation/contracts` | #8 | Its base still names superseded `foundation/governance`; retarget to `main` after #8 lands and reconcile governance wording. |
| 3 | `foundation/event-ledger-spec` | #2 | Land after #2. |
| 9 | `foundation/event-ledger-plan-grok` | #3 | Replaces closed #4; land after #3. |
| 5 | `implementation/event-ledger` | #9 | Land after #9. |
| 6 | `implementation/activity-projections` | #5 | Land after #5. |
| 10 | `docs/front-door-map` | #8 | Separate docs stack; retain the runtime command table when combining with #2. |
| 11 | `docs/galadriel-intent` | #10 | Keep Galadriel intent `draft`; merging the document does not accept implementation. |
| 12 | `docs/homer-brand` | #11 | Keep the hero, product name and live package documentation when reconciling. |

Successors are reconciled with their predecessor through commits that preserve
both histories. After a predecessor is squash-merged, retarget the next PR to
`main`, reconcile it again and verify the intended diff. Do not merge a successor
into its predecessor branch and call that a release. Use expected-head protection.
A changed head always needs fresh CI, reproduce evidence and an online Verdict.

## Independent review

Use the existing software-factory checkout and authenticated GitHub connection.
Current review packets for PRs 2, 3, 5, 6, 9, 10, 11 and 12 are here as
`pr-N.packet.json`. They describe the current repair author; confirm earlier
author families from the PR records as well. The
historical packets in `specs/foundation/work-packets/` identify earlier fixed
heads; do not run those unchanged against a new head. Use the new packets here and check each against the live diff. Keep the command wrapped in
`bash -c` so the reproduce runner executes every `&&` segment.

```sh
factory judge run --repo Zero-State-LLC/Homer --pr 5 --packet /path/to/Homer/docs/review/pr-5.packet.json --model z-ai/glm-5.3 --reproduce --out /tmp/homer-pr-5.verdict.json
factory judge gate --verdict /tmp/homer-pr-5.verdict.json
factory judge run --repo Zero-State-LLC/Homer --pr 6 --packet /path/to/Homer/docs/review/pr-6.packet.json --model z-ai/glm-5.3 --reproduce --out /tmp/homer-pr-6.verdict.json
factory judge gate --verdict /tmp/homer-pr-6.verdict.json
```

Repair commits identify `openai/gpt-6` as their author model. Earlier implementation
and Grok Build contributions also remain in history. The judge must be independent
of every contributing author family. Confirm the author record for each PR before
judging; GitHub usernames do not identify model families. Attach the full online
Verdict and reproduce receipt for the live head. A stale, offline, failed, missing
or truncated result blocks merge. Never replace a required check with this audit.

## Debt disposition

| Finding | Disposition |
| --- | --- |
| Invalid Work Request ids and mutable packet arrays | Validation and defensive copying with regression tests in #2. |
| Ledger input/integrity failures wrapped as storage failures | Local validation is outside the RPC wrapper; transport failures keep their cause in #5. |
| Byte-capped page path untested | Large synthetic entries force a short page and the client verifies the full chain in #5. |
| Local smoke endpoint could run when deployed by mistake | Default route refuses access; only the local command injects compile-time enablement in #5. |
| Freshness conflicts silently discarded | Unknown status has explicit diagnostics in #6; no winner is guessed. |
| Internal replay imports and unclear timeline edge semantics | Public replay export and explicit date, subject and Blocker rules in #6. |
| HTTP 429 accepted as healthy link | Removed from success statuses in both stacks; retries remain enabled. |
| Broken plan-branch links and replay slice ownership | Commit-pinned links and ZER-21 ownership in #9. |
| Deep JSON recursion | Validation catches canonicalization errors and refuses invalid input before storage; no accepted wire-depth limit is invented. |
| Trusted binding lacks per-caller Scope | Deliberately pending the authenticated adapter; do not grant untrusted callers the binding. |
| Canonical Event Key suffix mapping | Must be pinned per Source System before admitting live Collectors. |
| Missing implementation author in intake slice packets | Leave intake history intact; use confirmed author records when advancing a packet to verify. |

## Continue after landing

Follow [the migration plan](../migration/control-room.md). Remaining product work
includes source-specific Collectors with reviewed Event Key and Identity Binding
mappings, an authenticated API/MCP boundary, calendar/timeline UI with mobile
parity, restore and reconciliation drills, and production acceptance. Keep ZER-9
open until those live criteria pass. A merged package is not a production receipt.

The Galadriel intent remains a separate draft. Its hardware inventory, Access
configuration, trace provider, alert destination and freshness budgets need
verified inputs before implementation. This maintenance pass does not invent them.
