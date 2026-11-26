# Homer admin surface: operator and developer experience

Status: accepted by Danny on 2026-11-25 for what #32 built: the Repository
admission editor and the read-only credential and developer setup views (ZER-86).
The credential journeys, offboarding and trace screens stay proposed. Proposed on
2026-11-21.
Companion to the credential specification and trace archive PR #30.
No live UI, access policy, credential or deployment changes are included.

## 1. Product decision

Make Homer admin an operations workspace that answers:
What needs attention? What will this change affect? What evidence proves it worked?

Use one scoped resource model with two default views: operator Overview and
developer My setup. These are navigation preferences, not authorization roles.
Server-side capabilities determine what a person or agent can inspect or change.

Keep the existing authority boundaries: Linear Tasks, GitHub Repository Events,
Control Room Work Sessions and Handoffs, software-factory Work Packets and Verdicts.
Homer projects evidence and operates its integrations. Do not rebuild a Task
tracker or duplicate the Control Room calendar inside admin.

## 2. Current implementation assessment

Source review at Homer main b6849a9, not a visual audit of the live site:

| Existing behavior | Keep | Improve |
| --- | --- | --- |
| Authenticated repository JSON editor | Access verification and no-store responses | Add common navigation and field-based mapping forms |
| Review current versus proposed full snapshot | Revision checks and explicit review | Summarize added, changed and removed rows with affected Projects |
| Server validates mappings during save | Authoritative server checks | Add inline preflight errors and source-verified identity selectors |
| Conflict preserves draft and refuses blind retry | Concurrency safety | Offer reconciliation showing current, original and proposed values |
| Uncertain save tells operator to reload | Honest outcome | Add durable operation ID and readback-based reconciliation |
| Live status message and responsive controls | Accessible feedback | Consistent states, keyboard focus and mobile layouts across modules |
| Only mapping editor and catalog routes exist | Small implementation surface | Add resource health and operations before broad credential writes |

PR #30 provides archive code and private staging buckets but no enabled live
Collector. PR #31 is a credential specification, not running secret management.
The prototype accompanying this document uses fictional sample states.

## 3. Information architecture

Persistent shell: Homer identity, Project filter, environment filter, global
metadata search, notifications and signed-in principal/capabilities.
Always show environment as text. All-environments is a read-only comparison view;
mutations require one explicit environment. Never switch environment mid-operation.

| Navigation | Main question | Initial content |
| --- | --- | --- |
| Overview | What needs my attention? | Action queue, blocked operations, source freshness |
| Projects and sources | Is this Project connected correctly? | Repository admission, Linear identity, Collector health |
| Credentials | Who can use which integration? | Service credentials, my integrations, consumers, rotations |
| Traces and archives | Is execution evidence captured and recoverable? | Coverage, export lag, expiry risk, restore evidence |
| People and agents | Who owns this work and access? | Identity Bindings, accountable human, setup/offboarding |
| Operations | What is running or uncertain? | Persistent operation progress, failures and reconciliation |
| Audit and recovery | What happened and how do we recover? | Receipts, Corrections, runbooks, restore drills |

Developer home is My setup: assigned/participating Projects, own integration
health, agent instrumentation, next setup action and recent Work Sessions.
Cross-link to authoritative Task and Work Session interfaces rather than editing
their ownership here.

Global search indexes authorized metadata only: resource names, opaque IDs,
provider, Project and operation references. Never index secret values, prompt
bodies or private transcript content. Search results must not leak existence of
resources the caller cannot inspect.

## 4. Operator Overview

Use a compact attention list as the primary content, not a wall of totals.
Each item includes impact, Project/environment, evidence age, responsible owner,
next safe action and a link to evidence. Rank by observed risk and time remaining:
source data near deletion, failed production consumer, blocked rotation,
unknown write outcome, stale Collector, missing setup.

Do not invent a single health score. Distinguish:

- Not configured: setup is absent.
- Unverified: configured but no successful probe.
- Healthy: a named check passed within its freshness budget.
- Degraded: a named check failed or only some consumers passed.
- Stale: last evidence exceeds its freshness budget.
- Unknown: source could not be inspected.
- Reconciling: a write may have succeeded; retry is not safe yet.

An alert is an observed condition, not a Task. It can link to an existing Linear
Task; creating one is explicit and deduplicated. Acknowledgement does not resolve
the underlying condition. Group repeated failures by root cause and affected
resources. Snoozing requires a duration and cannot hide a known expiry deadline.

Illustrative item: “Archive coverage cannot be verified. Last source inventory
check unavailable. Owner unassigned. Next: connect source account.”
This is more honest than a green “2 buckets configured” card.

## 5. Resource detail pattern

Every resource has a stable URL and a shared layout:

1. Identity: human-readable purpose, provider, owner, Project, environment.
2. State: last check, evidence time, capability limitations and current operation.
3. Impact: consumers, dependencies and inherited access.
4. Actions: only available operations, with clear reasons for unavailable ones.
5. Evidence: immutable receipts and authoritative source links.
6. History: operation transitions, Corrections and observed configuration drift.

Default to a table of direct consumers; offer a dependency graph as a secondary
view. Graph edges must state whether discovered, configured or verified and when.
Unknown consumers mean impact is incomplete, not zero. Do not gate every routine
action on loading a graph.

Desktop: full-width inventory with optional detail side panel for quick inspection.
Use a dedicated detail page for complex rotation and recovery work. Mobile:
priority fields become cards, actions remain visible, and review flows use a
single column. Never hide critical production scope or impact in hover content.

## 6. Credential journeys

Inventory defaults to purpose, provider, owner, Project/environment, health,
expiry and consumer count. Expand for version and rotation detail.
Saved views: Mine, Expiring soon, Unverified, Rotation in progress and Orphaned.
Views contain non-sensitive filters only; server authorization still applies.

Add a connection:

- Choose service or personal ownership and target Project/environment.
- Prefer provider OAuth/app connection where supported.
- Use write-only key entry or local/external reference where appropriate.
- Check granted provider identity and scope using a fixed adapter probe.
- Review the intended consumers and activate only after required checks.
- End on an operation receipt with explicit next action.

Rotate:

- Show affected consumers and whether overlap is supported.
- Separate candidate validation from consumer cutover and old-key revocation.
- Show per-consumer results; do not collapse partial cutover to success.
- Reopen the operation after navigation or authentication expiry.
- Retry only idempotent steps. Reconcile ambiguous writes before new submission.
- Explain rollback limits after revocation, and link out-of-band recovery.

No routine “Are you sure?” dialogs for read-only checks or reversible drafts.
Use a meaningful review page for changed scope, production cutover and revocation.
For critical actions show purpose, environment, consumers and exact consequence;
avoid habituating users to typing names for every action.

## 7. Developer setup and offboarding

Provide an ordered checklist only where dependencies exist:
identity binding -> Project access -> integration connection -> local
instrumentation -> synthetic diagnostic -> first real-session evidence.
Independent steps remain selectable. Show blocked reasons, not disabled buttons
without explanation.

Offer copyable, scoped setup commands without embedded secrets. Authentication
happens through supported provider/device flows or the local OS secret store.
Never export another developer's credential to bootstrap a machine.

“My traces” shows capture on/off/unsupported, last observed session, missing
attribution, content exclusions and a link to the source trace. Separate session
declaration from actual captured evidence. Do not rank developers by token usage,
trace count or coding activity.

Offboarding preview lists owned integrations, shared consumer bindings and
unassigned operational responsibilities. Personal credentials are revoked, not
transferred. Shared service ownership changes are explicit. Record unresolved
provider revocations and delegated access.

## 8. Trace and archive screen

Show separate dimensions:

- Instrumentation coverage: which sessions/harnesses are represented.
- Content coverage: metadata-only, sanitized content, exclusions and truncation.
- Source coverage: inventory reconciled, partial or unknown.
- Archive integrity: files verified and digest readback.
- Recoverability: most recent successful restore exercise.
- Retention exposure: oldest known uncovered entity and time to source expiry.

A bucket existing is not an archive success. A verified batch is not complete
source coverage. Show no expiry countdown when actual retention is unknown.

Main actions: inspect failed batch, reconcile source inventory, run authorized
restore drill, inspect content policy and connect source. Do not offer “delete old
traces” until verification and retention controls exist. Long operations move to
Operations so the browser tab need not remain open.

## 9. Shared operation model and API/MCP parity

Proposed operation fields: operationId, kind, targetRef, scope, actorRef,
expectedRevision, state, startedAt, updatedAt, evidenceFreshness, affectedConsumers,
stepResults, safeActions, retryClass and sanitized evidenceRefs.

Operation outcomes include queued, running, awaiting-input, partially-applied,
reconciling, failed, cancelled and succeeded. Capability metadata explains whether
an action is supported, permitted and currently safe. UI hiding is not enforcement.

Plans expire when source revision or target scope changes. Do not submit a stale
review. Refreshing a read view does not change operator drafts. Secret values are
never resumable drafts; resume by candidate backend reference after confirmed
submission, otherwise require re-entry.

UI and MCP/CLI use the same authenticated command/operation API, preconditions and
audit evidence. Agents may inspect or prepare a plan within granted capability.
They do not get broader privileges because they act headlessly. Secret values
must not travel through ordinary LLM tool arguments or transcripts; any secure
submission path needs an explicit non-recording channel.

## 10. Accessibility and interaction requirements

Aim for WCAG 2.2 AA and test, rather than claim compliance from the design alone.
Use semantic headings and tables, keyboard-operable controls, visible focus,
text labels for state, error summaries linked to fields, and non-focus-stealing
status announcements. Stop or reduce animation under reduced-motion preference.

Default to comfortable density, with an optional compact table preference.
Use at least 44 CSS-pixel primary touch controls as a product target. Support
320 CSS-pixel viewport reflow and 200% text zoom. Never rely on color alone or on
hover to reveal the only action. Restore focus after closing a panel.

Show both relative and exact timestamps with the viewer's named time zone.
Storage remains UTC. Preserve a stable screen while polling; announce meaningful
state changes rather than every refresh. Use persistent operations for important
failures; a disappearing toast is not enough.

Empty states must distinguish no resources, no filter matches, access denied and
source unavailable. Never display an empty inventory as proof that no keys exist.

## 11. Research-to-design decisions

| Source | Guidance used | Homer-specific application |
| --- | --- | --- |
| GOV.UK check answers | Review before submission | Show scope and impact before cutover, without secret values |
| GOV.UK task list | Task names and states guide multi-step completion | Setup checklist with explicit dependency reasons |
| Cloudscape resource tables | Filtering, contextual actions, preferences and feedback | Scoped credential inventory with saved views and persistent outcomes |
| W3C status messages | Announce status without requiring focus | Archive checks and rotation steps remain screen-reader observable |
| Cloudflare Secrets Store access control | Metadata access and consuming-service scope are distinct | Separate inventory visibility, secret administration and consumer binding |
| Cloudflare audit logs | Provider actions have audit evidence | Correlate Homer operations with provider evidence, without promising instantaneous completeness |

These sources support interaction patterns and provider capabilities. They do not
prove the proposed Homer workflows are usable. Validate with operator/developer
tasks before enabling consequential mutations.

## 12. Priorities and expansion

P0: shared admin shell, persistent scope, Overview attention list, resource detail
pattern, durable Operations, field-based catalog editing with existing CAS safety.

P1: credential inventory and self-service setup, source-verified connection checks,
rotation rehearsal, trace/archive health with honest unknown states, recovery evidence.

P2: verified dependency impact, drift detection against approved configuration,
expiry planning, developer offboarding, saved views, scoped bulk metadata changes.

P3: policy-guided rotation automation, incident evidence bundles and evaluation
dataset nomination from approved traces. Automation waits for successful manual
drills and provider-specific retry/revocation behavior.

Avoid in the first release: arbitrary dashboard builders, global secret export,
bulk production revocation, automatic key issuance across every provider, chat
controls that receive secrets, or a duplicate project-management system.

## 13. Validation plan

Run these usability scenarios with Daniel and at least two developers; fixtures
are synthetic and not real incidents.

| Scenario | Proposed acceptance target |
| --- | --- |
| Identify the most urgent archive issue | Correct issue and next action within 60 seconds |
| Find what depends on a credential | Direct consumers and unknown scope identified within 60 seconds |
| Rotate a staging fixture | No secret disclosure; no premature revoke; correct failure recovery |
| Recover from an uncertain save | User reconciles without duplicate submission |
| Join a Project | Developer completes eligible setup without borrowing a shared personal token |
| Inspect trace coverage | User distinguishes verified bytes from complete source coverage |
| Mobile check while away | Scope, owner, evidence and next action usable without horizontal page scroll |
| Offboard a fixture developer | No personal-key transfer; unresolved revocations remain visible |

Measure task completion, error/retry rate, time to actionable evidence and recovery
success. Record only allowlisted product events; never raw credential forms,
keystrokes, body capture or session replay. Targets are proposed, not measured.

## References

- [Check answers](https://design-system.service.gov.uk/patterns/check-answers/)
- [Task list](https://design-system.service.gov.uk/components/task-list/)
- [Cloudscape tables](https://cloudscape.design/patterns/resource-management/view/table-view/)
- [W3C status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)
- [Cloudflare access control](https://developers.cloudflare.com/secrets-store/access-control/)
- [Cloudflare audit logs](https://developers.cloudflare.com/secrets-store/audit-logs/)
- [Credential specification](spec.md)
- [Illustrative prototype](../../docs/design/admin-prototype.html)

Source review and research completed November 21, 2026 PT. No live visual audit,
usability study, production deployment or credential operation is claimed.
