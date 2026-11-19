# Control Room migration and rollback

Status: source discovery complete; production cutover not started.
Date: 2026-11-18 PT.

## Verified baseline

The editable Control Room source was opened through Sites at commit
`0d7ff3884a446771f179caac96193ebb40383296`. The current publication is version 13:
[Zero State Control Room](https://zero-state-control.sleek-park-3366.chatgpt.site).
The owner has source access. This resolves the earlier source-discovery blocker.
The source checkout and live D1 contents are different evidence: no production
D1 export, row counts or migration reconciliation was performed in this work.

Source findings:

| Area | Source | Preserve |
| --- | --- | --- |
| Application | `app/`, `lib/`, `vite.config.ts` | Vinext / Workers application, existing navigation and responsive behavior |
| State | `lib/store.ts`, `drizzle/0000_bent_bishop.sql` | D1 `control_state` payload, revision and optimistic concurrency |
| Work Sessions | `lib/work-sessions.ts`, `lib/work-session-schema.ts` | Session id, authenticated ownership, started/updated/expiry instants, branch, scope, evidence and Handoff |
| Observations | `lib/observations.ts` | Source revision type and digest, classification, deduplication, prior observations and failed collection attempts |
| Stack Health | `lib/stack-health.ts`, `lib/stack-health-core.ts` | Separate `stack_health` table, fixed public sources, saved observations and failures |
| Websites | `app/components/live-websites.tsx`, `lib/live-websites.json` | Current website cards and coverage limits |
| MCP | `app/mcp/route.ts`, `lib/coordination.ts` | Existing operation names, schemas, read/write boundaries and client compatibility |
| Access | `lib/access.ts`, `lib/work-sessions.ts`, Sites access policy | Current custom audience, authenticated contributors, own-session updates and owner-only administrative writes |
| Schedule | Sites scheduled task | Existing hourly Stack Health refresh, unchanged until independently verified replacement |

No private account identifiers, invite list, source state export or One Mind
content belongs in this repository. The access policy must be preserved through
Sites APIs and checked by authorized operators, not copied into public fixtures.

## Integration boundaries

HOME owns the Event Ledger and Projections. agent-context stays separate, consumed
through its verified Context Pin. software-factory stays separate, consumed through
the versioned Work Request and Factory Event contracts. No histories are rewritten,
no repositories are archived, and no skills or factory implementation are copied.

The existing Control Room remains the Work Session Authority. Linear remains the
Task Authority. Local Control Room task proposals are not evidence of Linear state.
Existing repository observations are point observations, not a complete GitHub
history. Never turn a last-updated time into an invented event time or Milestone.

The HOME Durable Object is an independent Worker capability. Sites currently
advertises D1 and R2 bindings; a cross-Worker binding or authenticated gateway for
the Durable Object must be verified before wiring the live UI. Do not assume that
a D1 binding can access the Durable Object. D1 remains the current Control Room
state store until a separate approved migration proves parity.

## Sequence and acceptance gates

1. **Baseline export.** Authorized operator exports `control_state` and
   `stack_health`, records the source revision, byte hashes and exact row counts
   in private evidence storage. Capture the current version and access policy.
   Test restoration into isolated storage before proceeding.
2. **Collector contracts.** Implement GitHub, Linear and Control Room mappings
   against real source schemas. Pin repository-to-Project mappings and reviewed
   Identity Bindings. Preserve unknown identity and dates. Derive stable Event
   Keys from source object and native revision, never collection time.
3. **Authenticated adapter.** Specify read/claim/admin Scopes and exercise
   unauthenticated, viewer, contributor, owner and cross-user denial tests.
   Preserve existing MCP operations. Do not expose the binding-only ledger directly.
4. **Shadow collection.** Observe without changing the current application's
   Authority. Replay retries to prove Duplicate behavior. Surface Conflicts for
   correction. Compare counts by source, Project, Actor, Kind and date. Record
   freshness from successful collections separately from attempts.
5. **UI parity.** Add day/week/month calendar and Project Timeline to the existing
   Control Room. Test desktop, mobile, keyboard access, UTC/Pacific DST, unknown
   dates, Unattributed events, stale-source labels, evidence navigation, dependency
   cycles, empty state and errors. Keep all existing cards and session controls.
6. **Reconcile.** Compare a fixed ledger head and projection snapshot against the
   preserved source exports. Require zero unexplained omissions, fabricated
   identities or invented dates. Verify Correction replay and independently stored
   trusted-head receipts. Failed or incomplete sources must remain visible.
7. **Stage and restore.** Prove the complete path in an isolated environment,
   including export/restore, auth, duplicate delivery, lost reply, concurrent
   writers and rollback. Local workerd tests do not prove Cloudflare recovery.
8. **Cutover.** After required review, fresh software-factory Verdict, reproduce
   check and explicit owner cutover authorization, publish the exact verified
   source revision. Read back the production version and perform authorized smoke
   tests. Keep ZER-9 open until production acceptance is evidenced.

## Rollback

Stop new HOME collection at its recorded source cursors. Preserve its append-only
history and trusted head; never delete or rewrite entries to hide a failure.
Restore the previous Control Room publication and adapter selection. Continue
using the original D1 state, which shadow collection never changed. Verify sign-in,
Work Session ownership, observations, health cards, MCP reads and the hourly
refresh. Resume from the recorded cursors only after the cause is repaired; retries
must reuse Event Keys. If a D1 migration has separately occurred, use the tested
private export/restore procedure and explicitly reconcile writes made since export.

## Open delivery work

- Live Collector implementation and source-specific acceptance fixtures.
- Reviewed Identity Bindings, Project mappings and Source Freshness budgets.
- Authenticated access from the existing Control Room to the ledger binding.
- Calendar/Timeline UI, mobile and accessibility verification in the existing Site.
- Staging resources, account/plan selection, deploy authorization and production receipts.

The packages in HOME complete the first internal data components. They do not
claim that the production calendar, unattended Linear synchronization or cutover
has shipped.
