# HOME glossary

HOME is the Zero State engineering headquarters: it observes work in GitHub, Linear, the Control Room and software-factory, records it in one Event Ledger, and projects it into calendars and timelines. This file is the ubiquitous language only. Code, specs, tests, issues and PRs use these terms exactly.

## Sources and authority

**Source System**:
A system HOME reads from: `github`, `linear`, `control-room`, `software-factory`. HOME never becomes the authority for a fact another Source System owns.
_Avoid_: integration, provider

**Authority**:
The one Source System whose value wins for a fact. Linear is the Authority for Task ownership, priority and status. GitHub is the Authority for Repository Events. The Control Room is the Authority for Work Sessions and Handoffs. software-factory is the Authority for Work Packet stage and Verdicts. HOME is the Authority only for Observations and Projections.
_Avoid_: owner (for systems), source of truth

**Collector**:
An adapter that reads one Source System and appends Activity Events to the Event Ledger. Collectors map, they never invent.
_Avoid_: sync job, scraper, ingester

**Source Freshness**:
The time of the last successful collection from one Source System. A Source is Stale when that time is older than its freshness budget. Stale data is shown as stale, never silently.
_Avoid_: last updated (unqualified)

## The ledger

**Activity Event**:
An immutable record that something happened in a Source System, with Provenance. It has a Kind, an occurred-at instant in UTC, an Actor reference and a Project reference when known.
_Avoid_: log entry, activity, record (unqualified)

**Event Key**:
The stable identifier of an Activity Event, derived only from its Source System, source object id and Kind (plus the source's own revision id when the source has one). The same happening collected twice yields the same Event Key.
_Avoid_: id (unqualified), hash

**Event Ledger**:
The append-only, hash-chained sequence of Activity Events and Corrections. Nothing in it is edited or deleted.
_Avoid_: database, event store, log

**Provenance**:
Where an Activity Event came from: Source System, source object id, source URL, collector name and version, and collected-at instant. An Activity Event without Provenance is refused.
_Avoid_: metadata, origin

**Duplicate**:
An append whose Event Key is already in the Event Ledger with identical content. It is acknowledged and not stored twice.
_Avoid_: retry, replay

**Conflict**:
An append whose Event Key is already in the Event Ledger with different content. It is refused; the fix is a Correction.

**Correction**:
An appended entry that supersedes or retracts one earlier Activity Event, with a reason and its own Provenance. Projections apply Corrections; the original stays in the Event Ledger.
_Avoid_: edit, update, delete

## People and agents

**Actor**:
The principal that performed an action: a Human, an Agent, a System (a bot or automation without agency, such as Dependabot or a CI runner) or Unknown.
_Avoid_: user, author (unqualified)

**Human**:
A person on the team. Humans are accountable in Linear.

**Agent**:
An AI principal (for example Hermes, Grok Bot, Claude Code, Codex). An Agent always has an Accountable Human. An Agent is never recorded as a Human, or the reverse.
_Avoid_: bot (for AI agents), assistant

**Accountable Human**:
The Human answerable for an Agent's actions on a Task.

**Identity Binding**:
An evidence-backed mapping from a source account (a GitHub login, a Linear user id, a Control Room session principal) to one Actor. Bindings live in reviewed config, never inferred from a display name.
_Avoid_: alias, username mapping

**Attribution**:
The link from an Activity Event to an Actor, with its evidence. When no Identity Binding covers the source account, the Activity Event is Unattributed: it shows the raw source account and is never guessed.
_Avoid_: credit, blame

## Work

**Project**:
A Zero State project as named in Linear, mapped to zero or more Repositories in reviewed config.
_Avoid_: product (unless meaning the shipped product), workspace

**Repository**:
A GitHub repository under `Zero-State-LLC`.

**Task**:
A Linear issue. Linear is its Authority.
_Avoid_: ticket, card, todo

**Work Session**:
Declared, time-boxed activity by one contributor on one Project in the Control Room: scope, branch, acting Agent, blocker. It is a declaration, not proof of work.
_Avoid_: lock, claim (unless the Claim operation)

**Handoff**:
An evidence-linked transfer of a Work Session's next step from one Actor to another.
_Avoid_: baton (outside agent-context), note

**Blocker**:
A named condition stopping a Task, Milestone or Release Gate, raised and cleared by Activity Events.

**Milestone**:
A target in a Project with a Planned Date when the source has one. A Milestone without a source date has an Unknown Date and is never given an invented one.
_Avoid_: deadline (unless the source calls it one), phase

**Planned Date / Actual Date**:
The source's target date, and the instant of the Activity Event that verifiably completed the Milestone. An Actual Date needs evidence; a status flip alone is not completion.

**Release Gate**:
A condition a release must pass: CI green, a passing software-factory Verdict, a human merge yes, a deploy receipt.

## software-factory

**Work Request**:
HOME's versioned request to software-factory to start a Work Packet at intake. HOME never advances a packet past intake.
_Avoid_: job, task (for factory work)

**Work Packet**:
software-factory's unit of work (`factory/packet/work_packet.schema.json`). HOME reads it; software-factory owns it.

**Verdict**:
software-factory's independent judge result for one PR head SHA. Only software-factory produces one.

**Factory Event**:
A versioned Activity Event that software-factory emits about a Work Packet stage change or Verdict.

## Context

**Context Pin**:
The exact `Zero-State-LLC/agent-context` commit HOME consumes, with the sha256 of each consumed file. Changing it is a reviewed PR.
_Avoid_: vendored copy, fork

## Views

**Projection**:
A read view rebuilt deterministically from the Event Ledger. Projections own no facts.
_Avoid_: report, dashboard (for the data)

**Activity Calendar**:
The Projection that answers who did what, when, on which Project, with what evidence, bucketed by day, week or month in a Display Time Zone.

**Display Time Zone**:
The IANA zone a viewer reads the Activity Calendar in. Storage is UTC; bucketing happens at read time.

**Project Timeline**:
The Projection that shows each Project's Milestones, Planned versus Actual Dates, dependencies, owners, Blockers, Release Gates and Source Freshness over time.

## Access

**Scope**:
What an MCP or API caller may do: `read`, `claim` (Work Session and Handoff writes for oneself) or `admin`. Read never implies claim; claim never implies admin.
_Avoid_: role, permission level
