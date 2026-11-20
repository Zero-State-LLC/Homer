# GitHub merged pull request mapping

Status: implementation slice of the accepted foundation intent and Control Room
migration sequence, step 2. No live collection or deployment is enabled.

## Contract

`mapMergedPullRequest(input, context)` maps an untrusted JSON response from
GitHub REST `GET /repos/{owner}/{repo}/pulls/{pull_number}` to one Activity Event.
The transport must authenticate GitHub and check HTTP status before calling it.
This pure function is not authentication, authorization, pagination or a webhook.

Context is trusted, reviewed configuration: the allowed repository's immutable
numeric id, current full name, optional Project mapping, and explicit collectedAt.
The input base repository must match both id and name. Fork head repositories do
not define the Authority. Only Zero-State-LLC repositories are supported by v1.

Only a closed, merged PR with merged_at, merge_commit_sha and merged_by is admitted.
Missing or inconsistent fields produce a refusal with static error codes. Open or
unmerged PRs are skipped. A deleted or missing merging account is refused rather
than inventing an Actor. The PR author is never used as the merging account.

Event Key is `github:pull_request.merged:<repository-id>/<pr-id>/<merge-sha>`.
It excludes collection time, title, login, repository name and update time.
occurredAt is merged_at, never closed_at or updated_at. Provenance uses numeric PR
id and a canonical HTTPS GitHub URL built from the allowed repository and number.
The input URL must match that canonical URL. Only 40-character lowercase SHA-1
commit identifiers are supported; a future hash format requires explicit support.

Output is an allowlist: fixed subject, PR number, merge SHA and numeric source
account id. No title, body, comment, email, raw payload or arbitrary URL is copied.
sourceAccount preserves the raw merging login. actorId and actorKind are absent:
no display name, user type or account name proves Human or Agent identity.
Any later Attribution change needs reviewed Identity Bindings and Corrections.

Retries keep the same Event Key and semantic content despite new collectedAt.
Changed source metadata at the same key is a Conflict, never a second event or
automatic overwrite. A repository rename retains the key but requires a reviewed
configuration update and correction policy for changed Provenance URLs.

## Journeys and workflows

### Runtime mappings and listings

Daniel's 2026-11-20 direction requires dynamic mappings and listings. There is no
compiled repository inventory, Project map, source account list or freshness
budget. `GitHubMappingCatalog` loads a validated snapshot from `MappingStore` on
every list and map call. Inventory changes take effect without a build or deploy.
The existing v1 Activity Event contract's organization restriction remains a wire
contract constraint, not an inventory. Supporting other organizations requires a
versioned contract change rather than silently loosening the current schema.

Snapshots carry schema version, monotonic revision and repository entries with
immutable source id, current name, enabled state and optional Project mapping.
Empty inventory is valid and admits nothing. Missing/disabled entries refuse
collection. A missing or invalid source fails closed; stale cached values are not
used. Listings and mapping read the same source. Responses include the revision.

Replacement validates the complete next snapshot before compare-and-swap. The
store must enforce atomic revision comparison and durable replacement. Duplicate
ids or case-insensitive repository names, invalid fields and unsafe revisions are
rejected. Returned snapshots are detached from stored state. A stale writer gets
an explicit conflict and must reread, never overwrite silently.

The storage port is injected. This package supplies no in-memory production
fallback or seeded inventory. The live storage and authenticated admin adapter
remain delivery gates; only trusted internal code may hold the write capability.
An eventual admin endpoint must authenticate and authorize before calling replace.
Discovery may propose entries, but it must not grant repository or identity access.
Mapping changes do not rewrite old events: replaying a changed mapping for an
existing Event Key yields a Conflict that needs a reviewed Correction.

Tests cover add, remap, disable, remove, immediate listing refresh, detached reads,
concurrent revision conflicts, invalid updates and storage read failures.

1. A trusted transport reads one PR from an explicitly allowed repository.
2. Mapping validates JSON structure, repository identity and merge evidence.
3. Skipped/refused results do not append or advance a collection checkpoint.
4. A mapped event passes the existing Activity Event contract before return.
5. A later transport appends it through the trusted ledger binding, records its
   receipt, and advances a cursor only after all page entries are accounted for.

## Acceptance and implementation plan

- Test merge actor versus author, stable retries and rename-stable keys.
- Test open/unmerged skip, contradictory states, unsafe numbers, absent actors,
  malformed dates/SHA, repository mismatch and malicious URL refusal.
- Prove free-text secrets and identity claims cannot enter the mapped event.
- Prove mapping has no network/write effects and compiled exports load.
- Run workspace checks and keep the existing ledger and Projection tests intact.

Source: [GitHub REST pull requests](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request).
Terms: CONTEXT.md Event Key, Provenance, Attribution, Collector and Authority.
Intent: docs/intent/home-foundation.md. Team context HANDOFF.md and STATUS.md were
read but their October project status is not current Homer evidence. DECISIONS.md
supplies the stage-0 and product-spec workflow, not a new deployment authorization.
