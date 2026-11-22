# Intent: developer traces and verified archive

Author: ChatGPT for Daniel
Date: 2026-11-21
Status: accepted
Product: Homer (`Zero-State-LLC/Homer`)

Daniel requested the trace architecture and secure Cloudflare archive, reviewed
the specification in this conversation, then said "Continue". This accepts
implementation of that direction. It does not authorize a merge, production
deployment, credential creation, or the staging resource provisioning rejected
by automatic approval review.

## Problem / why now

Developer execution evidence can expire in Langfuse before it is preserved.
Homer has no trace Collector in the inspected main baseline `b6849a9`.
[verified: runtime packages, manifests and Activity Event v1 contract]

## Proposed outcome

- Authorized developer traces retain Work Session and source Provenance.
- Private R2 archives can be verified and restored independently of Langfuse.
- Missing or expired source data is explicit; an upload is not a completeness claim.

## Affected users / systems

- Developers, reviewers and authorized operators.
- Homer, Langfuse, Cloudflare R2 and developer-side instrumentation.

## Constraints

- Existing Event Ledger receipts and runtime catalog mappings stay intact.
- No One Mind content or secrets in Homer APIs, Projections or the ledger.
- Attribution requires an Identity Binding; Unattributed remains valid.
- No raw personal-session synchronization. Capture is scoped to approved work.
- No automatic source deletion or training-dataset promotion.

## Open questions

- Actual Langfuse account, plan, export format and retention policy.
- Explicit approval to provision the two named private staging R2 buckets.
- Operational alert destination and credential setup.

## Claims

| Claim | Label |
| --- | --- |
| Langfuse retries may overwrite incomplete export objects | verified: official blob export documentation cited in the spec |
| A landing bucket must stay separate from protected archive objects | proposed design constraint |
| Source coverage and stored-byte integrity are different guarantees | design invariant |

## Next

Implement the specification in [spec.md](../../specs/trace-archive/spec.md).
This first change supplies the bounded verifier and expiry classifier.
Native export normalization, privacy-policy implementation, scheduling,
authenticated retrieval and a versioned Event Ledger integration remain release gates.
