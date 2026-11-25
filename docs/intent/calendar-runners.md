# Intent: Activity Calendar and runner operations

Status: accepted by Danny on 2026-11-21, for repository implementation.

Daniel requested a calendar showing who did what work on each day, and management
of CI runners on one PC and one Mac, with ADRs and implementation.
This extends the accepted foundation and admin intents. Production activation and
machine installation require actual host identities and authenticated access.
No machine OS is inferred from PC; Windows and Linux are supported configuration.
Preserve source Authority, Identity Bindings, append-only history and existing CI.
