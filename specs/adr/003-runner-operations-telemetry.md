# ADR 003: Runner operations and work attribution

Status: accepted by Danny on 2026-11-22, as the design direction he requested.
Protocol implementation is separate from the job Collector and detail UI below.
Intent: [calendar and runners](../../docs/intent/calendar-runners.md).
Extends [ADR 002](002-pc-mac-runners.md) and the scoped controller protocol.

## Decision

Use a fleet overview with one card per configured machine and a detail view per
machine. Keep configured scope, requested mode, host observations and GitHub job
state distinct. A request to enable a machine is not proof that it started.
Neither a workflow trigger nor a merge identifies who performed all the work.

## Operator surface

| Surface | Required content |
| --- | --- |
| Fleet card | Alias; PC/Mac; OS and architecture; configured repository scope; desired mode; host-reported listener/job/admission; freshness and last receipt; current GitHub job or Unknown; attention reason |
| Work tab | Repository; workflow and job; run ID and attempt; branch and full commit link; PR links when supplied; queued/start/end times; outcome; original actor and rerun initiator; provider source link |
| Operations tab | Enable/drain requests; authenticated requester or Unattributed; request time; configuration revision; operation ID; controller report and receipt; pending/blocked/completed state with source label |
| Health tab | Heartbeat age and budget; controller enrollment state and version when observed; last error code; optional CPU, memory and free disk with sample time |
| History tab | Paginated operations and job attempts; date, repository and actor filters; evidence links; corrections and missing-source warnings |

On desktop show PC and Mac cards side by side; on mobile stack them. Use text and
icons as well as color. Show elapsed durations with explicit timestamps on detail.
Dates use the operator's selected timezone, default America/Los_Angeles; store UTC.
Keep the latest successful read visible with its timestamp on refresh errors, but
expire live state to Unknown. Never retain a green completion assertion indefinitely.

Actions: request maintenance (finish current work), resume, read evidence, and open
GitHub job. Disable host actions until enrollment and native adapter qualification.
No force-stop, reboot or remote shell in this scope. Confirmation shows machine,
repository scope and desired change. A timeout triggers readback before retry.

## Identity and telemetry contract

| Question | Authority and identity |
| --- | --- |
| Who requested enable or maintenance? | Homer authenticated operation audit, resolved through explicit Identity Binding |
| What actually executed the request? | Enrolled controller principal plus immutable report receipt |
| Who triggered the original workflow? | GitHub run actor ID/login, displayed as provider identity |
| Who requested this rerun? | GitHub triggering_actor ID/login for that run attempt |
| Who wrote the change? | Commit/PR source evidence separately; never substitute workflow actor |
| Which machine ran the job? | GitHub runner ID matched to reviewed machine registration, never alias alone |

Store provider actor IDs independently of names, and preserve provider attribution
when Homer Actor binding is absent. Display Unattributed for the Homer Actor rather
than guessing. Store repository numeric ID and current name, workflow/run/job IDs,
run attempt, runner ID, commit SHA, source timestamps, received time, delivery ID
and source URL. Attach Event Key, sequence and entryDigest for ledger-backed records.
A scheduled run can identify an associated GitHub actor without proving a manual start.
A local service start outside Homer remains unknown unless separately evidenced.

## Workflows

1. Operator opens fleet, sees attention items first, then selects a machine to inspect
   its current job and source. Configured scope is never labelled current work.
2. Operator requests drain. The UI shows requester and pending operation immediately;
   a busy report means waiting for work, and only qualifying evidence shows completion.
3. Signed workflow_job deliveries record queued, in-progress and completed evidence.
   GitHub workflow run reads enrich original actor, triggering actor and attempt.
   Use read-only Actions access; never accept controller assertions of GitHub identity.
4. Collector deduplicates deliveries, preserves original receipts, tolerates late and
   out-of-order transitions, and reconciles gaps through bounded paginated API reads.
   Keep source evidence, do not regress a completed attempt from a late queued event.
5. Calendar projects job execution and operator requests with their distinct roles.
   Cross-midnight jobs span days; do not turn runtime into claimed human work hours.

## Depth, retention and privacy

Required first: operational state, attribution, repository/job context, durations,
source provenance and immutable request/report receipts. Optional next: sampled
resource capacity to explain failures. Detailed process lists, environment variables,
command arguments, personal paths, network addresses and raw logs are excluded.
Only bounded diagnostic codes reach Homer. No credentials in reports or URLs.
Link logs and traces to their controlled source; reuse the trace archive retention
policy when that integration is implemented. This ADR does not activate archival or
set a new retention duration. Define approved retention and deletion policy before
adding resource time-series collection. Preserve existing append-only history.

## Implementation slices and acceptance

1. Current protocol: scoped enrollment, safe reconciliation, fresh/expired evidence,
   original receipt on retry. Does not claim job attribution or native installation.
2. Collector contract and tests: signed workflow_job ingress; run enrichment; numeric
   identity join; replay/out-of-order handling; missing identity and stale API cases.
3. Projection and UI: fleet context plus Work/Operations/History, pagination, operator
   filters, midnight/timezone tests, mobile accessibility and source links.
4. Native qualification: busy drain, idle resume, lost acknowledgement, stale heartbeat
   and host restart on the real PC and Mac before enabling actual control.

Unknown runner IDs must remain unassigned. Concurrent jobs must display separately,
not overwrite a single current-job field. Reruns must preserve attempt identity.
No job start attributed to a human without source identity. Failed enrichment must
not erase already collected job evidence. No resource telemetry is required to start.

## Primary references

Reviewed November 22, 2026 PT:

- <https://docs.github.com/en/webhooks/webhook-events-and-payloads#workflow_job>
- <https://docs.github.com/en/rest/actions/workflow-jobs#get-a-job-for-a-workflow-run>
- <https://docs.github.com/en/rest/actions/workflow-runs#get-a-workflow-run>
- <https://docs.github.com/en/actions/reference/workflows-and-actions/contexts>
