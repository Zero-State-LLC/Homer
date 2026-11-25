# ADR 012: one product version, and Provenance versions from the build

Status: accepted by Danny on 2026-11-24 with the spec (#75).
Intent: [Versioning and releases](../../docs/intent/versioning-and-releases.md)
(accepted by Danny on 2026-11-24, #74).
Spec: [Versioning and releases](../versioning/spec.md).

## Context

Homer is one repository of ten private workspace packages and two Workers.
Nothing is published to a registry. The audit of `main` on 2026-11-24 found
that every package is `0.0.0` and there are no tags. It also found that each
Collector types its own Provenance version, so an Activity Event cannot be
traced to the code that made it. The Event Ledger already ignores
`collectorVersion` when it compares a re-collected event, so a version string
can change without turning Duplicates into Conflicts.

## Decision

1. **One version for the product.** The root and every workspace package carry
   the same SemVer version, and internal dependencies name it. One script
   changes it, and `check` refuses any drift.
2. **Provenance versions come from the build.** Each build generates the
   product version and the commit, as `X.Y.Z+<sha7>`, with `.dirty` for a
   changed tree. Every Collector and Emitter writes that string. A hand-typed
   version in source is refused.
3. **A release is a tag Danny cuts**, with a GitHub Release whose notes are that
   version's CHANGELOG section.
4. **Workers report their version** through Cloudflare's version metadata
   binding, and every deploy leaves a receipt naming the tag, commit and
   Cloudflare version.
5. **Contracts keep their own versions**, under the existing rules. Their ids
   never change.

## Consequences

- One number answers "what is running": the tag on a deploy receipt, the build
  version in Provenance, and `/v1/version` all agree.
- A fix in one package bumps the version of all of them. Nothing is published,
  so nobody pays for that.
- The first release, `v0.1.0`, contains all the code on `main`, so it waits on
  the eighteen after-the-fact Verdicts (ZER-63).
- Re-collecting an event after an upgrade is still a Duplicate, because the
  ledger's comparison leaves the version out.

## Alternatives considered

- **Independent versions per package**, with changesets. They suit packages
  published to a registry. Homer publishes none, and per-package numbers would
  not tell Provenance which commit ran.
- **The commit alone, with no product version.** It is traceable, but it gives
  Danny no release to approve and the Release Gate nothing to gate.
- **Calendar versions**, such as `2026.11.24`. They are readable, but they carry
  no compatibility signal, and the contracts already use SemVer-style rules.
