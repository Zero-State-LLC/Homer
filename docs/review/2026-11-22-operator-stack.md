# Current operator stack review handoff

Observed November 22, 2026 PT. This supplements the historical review README.
No packet is a Verdict, merge approval, deployment receipt or spend authorization.

## Reviewed scope

Accepted intents: `docs/intent/credential-administration.md` on PR31 and
`docs/intent/calendar-runners.md` on PR35. Contracts are on their respective
branches under `specs/credential-admin/`, `specs/adr/`,
`specs/runner-controller/` and `specs/runner-lifecycle/`.
Use CONTEXT.md Scope, Identity Binding, Authority and Event Ledger.
Team HANDOFF.md and STATUS.md were inspected but are stale for this stack;
no runner-specific DECISIONS.md entry was found. Context Pin is unchanged.

| Order | PR | Expected head |
| --- | --- | --- |
| 1 | [#31](https://github.com/Zero-State-LLC/Homer/pull/31) | `039eb47c5d6a7650ac9e8aa80691aab2583807e6` |
| 2 | [#32](https://github.com/Zero-State-LLC/Homer/pull/32) | `428f9072f98be6a8958771aea436daf47b247ab5` |
| 3 | [#35](https://github.com/Zero-State-LLC/Homer/pull/35) | `386781cdb6763ba60f8cf712df4cdfa752a15433` |
| 4 | [#38](https://github.com/Zero-State-LLC/Homer/pull/38) | `439cad0d339b5cc49a7a7aaeffdbd498e1c7f8eb` |
| 5 | [#39](https://github.com/Zero-State-LLC/Homer/pull/39) | `42cd11ea9519d1a7af5e7d22d93b782b8899616b` |

PR29 (context update) and draft PR30 (trace archival) are separate.
Do not merge successors into predecessor branches and call that a main release.
Land in order, retarget/reconcile each successor with main, then rerun CI,
independent judging and reproduce on every changed head. Use expected-head
protection at merge time. Never reuse a Verdict from before a merge/rebase.

## Current evidence and blockers

PR38's controller audience correction reproduced a 401 before repair.
The repaired head passed 250 local tests and all seven CI checks.
PR39's combined tree passed 259 local tests and all seven CI checks.
The correction is tracked in defect41; keep it open until the fix lands on main.
These are synthetic qualifications, not real PC/Mac or staging ingestion receipts.

This workspace has no factory executable, GitHub CLI credential or configured
OpenRouter/subq credential. The inspected software-factory GitHub workflow only
runs pytest; it exposes no workflow_dispatch judge job. No online judge ran here.

## Operator execution

Use the existing governed machine with factory, authenticated gh and approved
provider access. Do not paste credentials into this repository or command output.
Packet USD5 caps are proposals inherited from the earlier review convention;
use only an already approved budget and credit floor. Confirm the judge is on the
provider allowlist and independent of every contributing author family.
Packets identify the confirmed OpenAI repair/implementation family; verify full
authorship before running. Do not infer model family from a GitHub username.

Read each packet against the current diff before execution. These packets describe
review criteria, not fabricated stage-transition history. The numeric PR remains
the source pointer. Keep packets outside the clean reproduce checkout so adding
review artifacts does not change the head being judged.

From this handoff checkout on the governed machine:

```sh
pr=38
expected_head=439cad0d339b5cc49a7a7aaeffdbd498e1c7f8eb
test "$(gh pr view "$pr" --repo Zero-State-LLC/Homer --json headRefOid --jq .headRefOid)" = "$expected_head"
factory judge run --repo Zero-State-LLC/Homer --pr "$pr" --packet "$PWD/docs/review/pr-$pr.packet.json" --model z-ai/glm-5.3 --reproduce --out "/tmp/homer-pr-$pr.verdict.json"
factory judge gate --verdict "/tmp/homer-pr-$pr.verdict.json"
```

Run each command only if the preceding command succeeds. Select the PR and current
expected head from the table; the model shown is the existing factory default,
not a new model recommendation. Factory reproduce checks the fetched head against
the judged head and runs npm ci plus npm run check in a clean checkout.
Node must satisfy package.json. A browser CI pass is additionally required on the
same head. The packet's test command does not install or run Chromium.

Retain complete Verdict JSON, reproduce result, source head, diff digest and CI
links. A failed, missing, offline or truncated Verdict blocks merge.
Do not use gate's test-only --ci-green or --head-sha overrides to bypass live checks.
No production, credentials, Access changes or native installation are authorized
by these packets.

## After landing

Verify staging on the deployed revision before claiming live results. Preserve
original Event Ledger receipts and duplicate history. Trace retention deadlines,
Langfuse access, actual machine identities/OS, and provider rotation qualification
remain separate unresolved inputs. No synthetic test establishes live readiness.
