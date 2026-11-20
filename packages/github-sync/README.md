# GitHub Collector components

`@zs-home/github-sync` provides a pure merged-PR mapper and a runtime mapping
catalog. It contains no production repository inventory and makes no network calls.

Inject a `MappingStore` into `GitHubMappingCatalog`. `list()` reloads the current
validated inventory. `replace(expectedRevision, repositories)` validates and
atomically replaces it through the store. `map(payload, repositoryId, collectedAt)`
uses the current enabled mapping and returns its revision with the mapping result.

The store must durably implement compare-and-swap. The caller must authenticate
GitHub reads and restrict replacement to authorized admins. Neither a mapping
entry nor a TypeScript interface authenticates a caller. No public endpoint or
live transport ships with this package.

PR title/body and arbitrary URLs are excluded. The source merging account stays
Unattributed until an evidence-backed Identity Binding exists. Reconfiguration
cannot silently change historical ledger content.

See [the specification](../../specs/github-collector/spec.md) for field semantics,
failure behavior, dynamic configuration and remaining live integration gates.
