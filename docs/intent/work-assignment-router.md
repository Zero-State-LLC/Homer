# Intent — Work Assignment Router

Author: Hermes (Yes And) for Danny (scrimshawlife-ctrl)
Date: 2026-11-23
Status: draft
Product: Homer (`Zero-State-LLC/Homer`)

This file is a proto-spec. It comes **before** specify.
Next stage is `spec.md` (spec-kit specify). Do not skip to code.

One committed intent per change stream. Live under `docs/intent/`.

## Problem / why now

Homer can describe work but cannot say who executes it. A Work Request names the
work; a Curator Profile names one harness, provider, model and host; the
knowledge-loop spec keeps exactly **one active profile** and creates a run request
for it at 02:00 or on Run now. Nothing chooses between profiles, hosts or models
for a particular piece of work.

The result is assignment by convention. Whoever set the active profile decided
what runs tonight, and a second machine (Galadriel, a Mac, a second Windows box)
cannot take work unless a human switches the pointer first. That is assignment by
person, not by capability, and it does not survive a fleet.

Danny named the requirement on 2026-11-23: a **dev- and user-agnostic router for
Homer's work assignments**. Routing must depend on what the work needs and what a
host can prove it can do, never on which developer or which user is involved.

[verified: `specs/knowledge-loop/spec.md` lines 78-96 (single active profile,
switch clears qualification) and line 203 (run request for the active profile);
no router, assignment or dispatch code exists in `packages/`]

## Proposed outcome

Observable done (a stranger can check this without reading the chat):

- A Work Request plus a set of host descriptions (the host adapter's `describe()`)
  yields one **Assignment**: the profile revision, host, harness, provider and
  model that will do the work, or an explicit abstention.
- Every candidate is `eligible`, `excluded` with one reason code, or `unknown`.
  Unknown or stale capability abstains. An empty candidate set fails closed and
  produces no Assignment.
- The same inputs produce the same Assignment, byte for byte. There is no
  randomness and no wall-clock tie-break.
- No field of a Host description or a routing rule reads a developer or user
  identity. A routing decision that would change when a different person logs in
  is a defect.
- The decision is recorded as evidence: the inputs it used, each exclusion with
  its reason, and the chosen Assignment, so an operator can explain any run.
- A test proves the guard: two hosts identical except for a human identity
  attribute produce the same Assignment.

## Affected users / systems

- Users: Danny as operator (sees why a host was chosen or refused), and every
  agent that receives work; today an agent gets the active profile's work whether
  or not the host can do it.
- Systems: Homer (new router module, Curator Profile store, host descriptions),
  the Curator runner and host adapters, the operator UI, and the Event Ledger if
  the decision is recorded there.

## Constraints

Product-true locks (do not reopen in implement):

- **Agnostic is the point.** Eligibility and ordering read only: declared
  capability from `describe()`, the profile's declared needs, qualification
  revision and freshness, capacity and concurrency, and reviewed policy. No
  developer identity, user account, display name, email, machine owner or login
  session may enter the decision.
- Identity still exists for **attribution** (Actor, Accountable Human, Identity
  Binding) and for the audit trail. It must not be an input to routing.
- **Fail closed.** Missing, stale or contradictory facts are `unknown`, and
  `unknown` never wins. No stale-fallback default host.
- **Deterministic.** Stable ordering with documented tie-breakers on reviewed
  identifiers; never a display alias.
- **Homer observes and projects; it does not become the authority** for Linear
  Task state, GitHub job assignment or Control Room Work Sessions. An Assignment
  is Homer's own record.
- **One profile per Assignment.** The router picks; it does not merge two
  profiles into a hybrid, and it does not mutate the active-profile pointer
  implicitly.
- **Advisory first.** Version 1 decides and records. It does not dispatch,
  enqueue, retarget, cancel or install anything, matching the read-only staging
  in the runner-scheduling direction. Dispatch is a later, separately accepted
  slice.
- No secret, token, account id or credential value in an Assignment, a log, or a
  reason code.

Non-goals:

- Scheduling inside GitHub Actions, or choosing `runs-on` values.
- Judging whether an agent's output is correct; that is software-factory's judge.
- Load-balancing across a cloud pool. Hosts are local by decision.
- Replacing the Curator Profile store or its compare-and-swap semantics.

## Open questions

- **Where the router lives.** A pure function in `packages/shared-contracts` or a
  new `packages/work-router`. The function-first option is testable without a
  Worker and matches how `toWorkPacket` and the Buzz mapper are built.
- **Whether a decision is an Activity Event.** Recording `homer`-sourced
  assignments would audit well, but a new Kind means Activity Event contract
  version 3. The alternative is a receipt outside the ledger, which is cheaper
  and weaker. I would start with a receipt and revisit.
- **Granularity.** Route per Work Request, per flag batch, or per run window.
  Per Work Request is composable; per window matches the current 02:00 cron.
- **Qualification transport.** Whether a host's `describe()` result is signed and
  by whom. Without that, a host can overstate its capability.
- **Interaction with PR #44.** `specs/runner-scheduling/spec.md` already defines
  eligibility gates and abstention for GitHub job attempts. This router should
  reuse those reason-code shapes rather than invent a second vocabulary, and
  neither should quietly become the other.

## Claims

| Claim | Label |
|---|---|
| Homer keeps one active Curator Profile and creates run requests for it | `[verified: specs/knowledge-loop/spec.md lines 78-96, 203]` |
| No assignment or routing code exists in `packages/` | `[verified: repository search for assign/route/dispatch]` |
| Host adapters already report capability via `describe()` | `[verified: specs/knowledge-loop/spec.md host adapter section]` |
| Eligibility gates and abstention already exist for GitHub job attempts | `[verified: specs/runner-scheduling/spec.md, on PR #44, not yet on main]` |
| Routing must not read dev or user identity | `[verified: Danny's requirement, 2026-11-23]` |

## Next

A human accepts this file (`Status: accepted`). Then specify
(`spec.md` + `## Workflows`). Do not implement from this file alone.
