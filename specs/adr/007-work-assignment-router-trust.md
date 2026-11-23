# ADR 007: the Work Assignment Router decides, it never dispatches

Status: proposed. Not accepted until Danny accepts the intent.
Intent: [Work Assignment Router](../../docs/intent/work-assignment-router.md)
(draft).
Dependencies: the curated terms in [`CONTEXT.md`](../../CONTEXT.md), the Curator
Profile and Host Adapter sections of `specs/knowledge-loop/spec.md`, and the
`describe()` capability report in that spec.
Not yet on `main`, and not relied on here: the scoped runner controller and runner
lifecycle in PR #38 and #39, and ADR 002, 003 and 005 in PR #44.

## Context

Homer can describe work but cannot choose an executor. The knowledge-loop spec
keeps exactly one active Curator Profile and creates a run request for it, so
assignment is whoever last moved the pointer. That is assignment by person: it
does not scale to a second machine, it cannot express "this host is busy, that
one is capable", and it silently routes work a host cannot run.

The requirement Danny set on 2026-11-23 is a **dev- and user-agnostic router**:
routing must follow what the work needs and what a host has proven, never which
developer or which user is involved.

## Decision

A pure router decides one **Assignment** per Work Request:

- **Inputs are capability and policy only**: each Candidate's declared capability
  from `describe()`, the profile's declared needs, the current Qualification
  revision and its freshness, capacity and concurrency, and reviewed routing
  policy. No developer identity, user account, display name, email, machine
  owner or login session may enter the decision. Identity remains for attribution
  — Actor, Accountable Human, Identity Binding — and for the audit trail.
- **Three states per Candidate**, one **Reason code** each: `eligible`,
  `excluded`, `unknown`. Unknown abstains. An empty eligible set produces an
  **Abstention**, never a fallback to a default host.
- **Deterministic**: same inputs, same Assignment, documented tie-breakers on
  reviewed identifiers, never a display alias.
- **Per Work Request**, not per run window. A window is a batch of decisions.
- **It never moves the active Curator Profile pointer.** The spec makes that a
  single-writer compare-and-swap that only a qualified profile may win; a router
  writing it would give assignment two writers and let a stale read overwrite an
  operator's switch. Applying an Assignment is a separate, accepted action.
- **The decision is recorded as a receipt, not an Activity Event.** A `homer`
  sourced event would need Activity Event version 3 before the event shape is
  known.
- **v1 trust root is weaker than the target.** A host is trusted for v1 when a
  reviewed Curator Profile names it and its Qualification revision is current.
  The target — a host bound through the runner controller's enrollment — is not
  available: that controller is unmerged in PR #38/#39. This is a named, dated
  downgrade, not the final model.

Homer observes and projects. An Assignment is Homer's own record; it is not a
Work Session, a Work Packet stage, or a status change in Linear or GitHub.

## Consequences

- Two hosts identical except for a human identity attribute must produce the same
  Assignment; that is a required test, not a comment.
- Until #38/#39 land, a host can overstate its capability and win work it cannot
  run. The blast radius is bounded because v1 does not dispatch: a human applies
  the Assignment.
- No Activity Event major version, and no new Kind.
- The operator keeps the switch. Reconciling "the router wanted host B, the
  operator had A active" is a visible state, not a silent overwrite.
- Routing policy becomes reviewable configuration with revisions, like the GitHub
  mapping catalog, rather than code branches.
- A future dispatch slice inherits a decision record it can audit before it is
  allowed to act.

## Alternatives considered

- **Router writes the active-profile pointer.** Simplest operator story, one
  operation. Rejected: two writers on a compare-and-swap, and a stale router can
  overwrite a deliberate human switch.
- **Route inside GitHub by choosing `runs-on`.** Rejected: GitHub is Authority for
  job assignment and repository events; Homer would be writing another Source
  System's fact. The advisory candidate work in PR #44 stays advisory for the same
  reason.
- **Let a model score Candidates.** Rejected: non-deterministic, unexplainable
  after the fact, and it would make the router's own reasoning an unascribed
  Actor.
- **Route per run window only.** Rejected: it cannot express an urgent flag, and
  it couples routing to the cron rather than to the unit of work.
