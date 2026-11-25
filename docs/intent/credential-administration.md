# Intent: credential administration

Author: ChatGPT for Daniel
Date: 2026-11-21
Status: accepted for repository implementation
Product: Homer (`Zero-State-LLC/Homer`)

## Problem / why now

Daniel requested an admin section for adding and rotating stack and developer
keys. The current admin surface edits repository mappings only. Trace archival
also needs scoped credential management.

[verified: current catalog-worker editor and Daniel's request in this conversation]

## Proposed outcome

Daniel accepted the end-to-end Task breakdown and testing boundaries in this
conversation on November 21, 2026 PT. Live credential enrollment, policy changes
and production activation still require the specific inputs in the delivery contract.

- Authorized operators manage shared credentials and their consumer bindings.
- Developers manage their own approved integration credentials.
- Saved values remain in a managed secret backend and are never revealed by Homer.
- Rotation includes consumer validation and provider revocation evidence.
- Operators get an attention queue with impact, evidence freshness and next action.
- Developers get scoped setup, integration health and trace capture evidence.
- Interrupted operations remain inspectable and reconcile before retry.

## Affected users / systems

Developers, credential operators, Homer, Cloudflare secret storage, and explicitly
supported credential providers and consumer services.

## Constraints

- No One Mind content or secret values in Event Ledger events or Projections.
- Identity Bindings determine ownership; existing catalog admin is not secret admin.
- Personal local credentials remain local unless deliberately enrolled.
- No credentials are collected through chat or committed to Git.
- No live credential changes, new access grants or production deployment in this draft.
- Preserve the trace archive work in PR #30 as a separate change stream.

## Open questions

Initial provider adapters, operator membership, production activation authority,
centrally held developer integrations, overlap policy and recovery owner.

## Claims

| Claim | Label |
| --- | --- |
| Current Homer admin UI supports repository mappings | verified: catalog-worker source |
| Cloudflare provides managed write-only administration of saved secret values | verified: official documentation cited in the spec; bound services can read values |
| Rotation must verify actual consumers and old-key revocation | proposed acceptance requirement |

## Next

Review this intent and the accompanying [draft specification](../../specs/credential-admin/spec.md).
The [experience design](../../specs/credential-admin/operator-experience.md) adds
research, implementation priorities and an offline interactive prototype.
Implement the approved Task graph in the delivery contract. Acceptance does not
claim that a running credential surface or live provider qualification exists.
