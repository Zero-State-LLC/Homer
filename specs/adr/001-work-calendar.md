# ADR 001: Evidence-linked daily work calendar

Status: accepted by Danny on 2026-11-21, for implementation.

## Decision

Expose the existing Activity Calendar Projection through authenticated HTTP and a
responsive Homer calendar view. Read and verify a fixed Event Ledger prefix and
apply Corrections before projection. Display day/week/month, IANA Display Time
Zone, Actor and Project filters. Default display zone is America/Los_Angeles;
keep UTC source instants. Show who, what, when, Project, Kind, source link and
Event Key. Missing Identity Binding remains Unattributed; never infer a Human
from display names or Task assignment. Agent and Accountable Human stay distinct.
Work Sessions are declarations, not proof of performed work. Counts are observed
Activity Events, not hours, productivity scores or comprehensive work coverage.

## Contract and acceptance

Use existing verified ledger client and projectActivityCalendar, not another
history store. A bounded fixed-prefix read fails honestly if too large or corrupt;
no silent truncation or fabricated empty success. Read scope grants calendar access
under the current workspace-wide read policy. No new public read route.
Empty, unavailable and unattributed states differ. Untrusted source text is rendered
as text; only HTTP(S) evidence links are clickable. Filters are URL-addressable.
HTTP tests cover authentication, invalid zones/filters, verified replay, corrections
and attribution; browser tests exercise real Worker data and keyboard/mobile layout.

## Consequences

Completeness depends on configured Collectors. Current GitHub merge collection
cannot prove all developer work; other Sources need their own verified Collectors.
No changes to original ledger receipts or source ownership.
