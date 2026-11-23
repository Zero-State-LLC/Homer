# Buzz and knowledge loop: implementation receipt and handoff

Date: 2026-11-23 Pacific Time. Author: Claude (Claude Code). Written so the next
agent, from any provider, can pick up the work without this session's chat.

## Start here

1. [`AGENTS.md`](../../AGENTS.md), then [`CONTEXT.md`](../../CONTEXT.md). The
   knowledge-loop terms (Knowledge Flag, Curator, Curator Run, Curator Profile,
   Harness, Model Provider, Host Adapter, Qualification) are new today.
2. The two accepted specs: [Buzz](../../specs/buzz/spec.md) and the
   [knowledge loop](../../specs/knowledge-loop/spec.md).
3. Linear project Homer, team ZER: one Task per work packet, ZER-45 to ZER-61.
4. This file, for state, decisions and conventions.

## Decisions (Danny, 2026-11-23)

| Decision | Recorded in |
| --- | --- |
| Buzz is a Source System and the alert channel. Homer pulls with a cursor and signs with its own key; `homer` is the alert and flag channel. | Buzz spec |
| The knowledge loop: Knowledge Flags from Buzz, then GitHub, then Linear (label `knowledge-flag`); a Curator that only opens pull requests; ACP as the Harness switch layer. | Knowledge-loop spec, Decisions |
| Launch options: Claude Code with Anthropic (default), Codex with OpenAI, Hermes with a local model, and Hermes with Cloudflare Workers AI. | Knowledge-loop spec |
| Runners are local; Cloudflare handles everything else. Cloudflare Sandboxes were considered for the runner and not chosen. | Knowledge-loop spec, Hosting; [runbook](../deployment/curator-host.md) |
| The first runner host is Windows with WSL2 (Ubuntu) and Docker, no GPU, 32 GB. | [Runbook](../deployment/curator-host.md) |
| Runner secrets, including the Cloudflare account id, come from 1Password through a read-only service account. | Knowledge-loop spec; runbook |
| A Curator Run cites flags by Event Key, not by link. `buzz://` links stay on Buzz events. | [Contract README](../../specs/integration-contracts/README.md); both specs |

## On main

| PR | What landed |
| --- | --- |
| #47, #48 | The Buzz and knowledge-loop intents, accepted |
| #49, #50 | The Buzz and knowledge-loop specs, accepted |
| #51 | `packages/curator-runner`: the host-agnostic Curator core (compatibility, ACP permission policy, change checks, flag reports, receipts) |
| #52 | `packages/curator-host-docker`: the Docker Host Adapter (locked-down container, egress allowlist proxy and probe, ACP client, tree diff) and the host runbook |
| #53 | The hosting decision and 1Password secret references in the adapter |
| #54 | Activity Event contract version 2 (ZER-45): `buzz` and `homer`, four Kinds, rules in the schema, both validators, Event Ledger support |
| #55 | `packages/buzz-collector`: the pure Buzz mapper (ZER-46), with the Schnorr verifier passed in |

In review: #56, the Buzz channel allowlist (ZER-47). CI and Codex were clean at
`6aaf4d9`; it still needs the merge contract below, then Danny's merge.

Other open pull requests (#30 to #46: runner fleet, credentials, traces) belong
to other work and are not part of this handoff.

## Next Tasks

| Task | What | Waiting on |
| --- | --- | --- |
| ZER-62 | Homer emits Work Requests from its sources, so code can get a Verdict | An intent Danny accepts |
| ZER-63 | After-the-fact Verdicts for #51 to #55, run on the box | ZER-62 |
| ZER-61 | `@noble/curves` in the Buzz mapper, with real Nostr test vectors | A session that can install packages; this one could not |
| ZER-54 | Buzz Collector transport | ZER-61, and #56 merged |
| ZER-48 | Identity Bindings and Homer's Buzz key | Danny attests the key |
| ZER-55 | Buzz alerts | ZER-48 |
| ZER-49 | `docs/agents/buzz.md` | Nothing |
| ZER-50 | The curator's GitHub App | Danny creates it |
| ZER-51 | Set up the Windows runner host | Danny, with the runbook |
| ZER-53 | Curator Profile store and harness catalog | Nothing |
| ZER-56 | Finish the runner: inputs, content validator, publisher, harness images, flags by Event Key | ZER-50 |
| ZER-57 | Curator page | ZER-53 |
| ZER-58 | Qualification dry runs | ZER-56, ZER-51 |
| ZER-59 | Knowledge Flag intake | ZER-54 |
| ZER-60 | Flag resolution, stuck flags, missed-run alerts | ZER-59, ZER-55 |
| ZER-52 | Team rule in `CONTRIBUTING.md` | Nothing |

Any code Task can be built now, but none merges until ZER-62 makes a Verdict
possible. That includes #56 (ZER-47). Docs-only Tasks merge on Danny's acceptance
(decision 8 below).

## How work landed

- **Branches and merges:** branch from `main` and open a pull request to `main`.
  Merges are squash only.
- **Review:** after each push, comment `@codex review` and wait for the receipt
  naming the current head. Fix every finding and ask again. A Codex review is a
  pull request review, not a Verdict (`CONTRIBUTING.md`, stage 5).
- **Merging, from now on:** follow the merge contract in `AGENTS.md`: CI green, an
  online passing software-factory Verdict for the current head SHA from a judge
  independent of the author model, a passing reproduce check, and Danny's explicit
  yes. The [discovery receipt](discovery-2026-11-18.md) describes the judge gate.
  Docs-only pull requests are the exception: decision 8 below.
- **What today's merges had:** Danny's explicit "merge", green CI, and a clean Codex
  review of the head being merged. They went through the admin bypass that
  agent-context `DECISIONS.md` grants. This session had no software-factory judge,
  so no Verdict or reproduce check was recorded for #47 to #55. Danny's answer is
  decision 1 below.
- **Stacked pull requests:** after a parent squash-merges, merge `main` into the
  child, resolve the conflicts, and get a fresh review before merging.
- **Linear:** use the labels `ready-for-agent` or `ready-for-human`, and never
  `agent`, which syncs to Hermes Kanban. Linear changes appear as Danny's account.
- **Secrets:** no secret, token or account id goes in the tree, a pull request,
  Linear, Buzz or chat. That includes the Cloudflare account id.

## Merge contract decisions

Danny settled these on 2026-11-23, one question at a time, after the gap above was
found.

1. **Past merges.** The five code pull requests, #51 to #55, get online
   software-factory Verdicts with a reproduce check, after the fact, against their
   merged head SHAs. The four docs pull requests, #47 to #50, stand as Danny's
   acceptance. A failing Verdict is fixed forward in a new pull request, never by
   rewriting history.
2. **Who judges, for now.** Verdicts come from software-factory's judge through
   OpenRouter: `factory judge run --reproduce`, whose default judge is GLM-5.3 and
   whose vendor family differs from the author's. This is the current arrangement,
   not a permanent one.
3. **Where it runs.** On the box: ADVERSARY or Boof runs the judge where the
   OpenRouter key and the governance egress guard already live, and posts the
   verdict JSON on the pull request. No agent pastes or holds the key elsewhere.
4. **Codex review stays, before verify.** Authors request `@codex review` and fix
   its findings before asking for a Verdict. It remains a pull request review, not a
   Verdict.
5. **Work Packets come from Homer Work Requests.** Homer emits a Work Request
   (`specs/integration-contracts/work-request.v1.schema.json`), and GAP turns it
   into the Work Packet the judge grades. Homer does not emit Work Requests yet.
6. **Until then.** This handoff (#57, docs only) merges on Danny's acceptance, as
   the past docs pull requests did. The code waits for Work Requests: the
   after-the-fact Verdicts for #51 to #55, and #56.
7. **Homer is fed by its sources.** Work Requests come from the sources the
   repository already defines, the ones the Work Request contract's `source` field
   names: a Linear Task (`linear:ZER-N`), a GitHub issue
   (`github:<owner>/<repo>#N`), or a manual request (`manual:<slug>`). They are not
   written by hand per pull request.
8. **Docs merge on acceptance, from now on.** A pull request that changes only docs
   (intents, specs, the glossary, receipts, other Markdown) merges on Danny's
   explicit yes once CI is green and the Codex review is clean. A pull request that
   touches code, configuration or CI needs the full gate: a passing online Verdict
   with a reproduce check for the head SHA, then Danny's yes. AGENTS.md's Merge
   section does not say this yet; it waits for Danny to change the contract.

## Gotchas

- **Prettier:** CI uses the lockfile's Prettier, 3.10.1. It keeps a union that fits
  on the line after `=` on one line, where 3.8 splits it. Format with
  `npm run format`, not a global Prettier.
- **ESLint:** type-checked ESLint cannot resolve `Buffer`'s type next to the Workers
  types, so use `Uint8Array` and `btoa`. `no-control-regex` refuses
  control-character regexes, so check code points instead.
- **Generated bindings:** `packages/catalog-worker/src/bindings.d.ts` comes from
  Wrangler. After a `wrangler.jsonc` change, run `node scripts/catalog-bindings.mjs`.
  #56 edits it by hand and should be regenerated once Wrangler is installed.
- **Choosing a contract version:** validators and the Event Ledger pick the schema
  that `contract` names. Anything else is checked as version 1.
- **Context-pin check:** the CI job fetches pinned files from GitHub and can hit a
  429. Rerun the job.
- **This session's environment:** `gh pr create` (GraphQL) was refused, but the REST
  call `gh api repos/Zero-State-LLC/Homer/pulls` worked. Raw GitHub file URLs and
  package installs were blocked from the shell.

## Evidence

Each pull request's CI run and Codex receipt are on GitHub. Local checks in this
session used stand-ins (a vitest shim, ajv 8.18 from another package, stub
formats) because installs were blocked. CI is the authority. Nothing was
deployed, and no key, App, vault or Cloudflare resource was created.
