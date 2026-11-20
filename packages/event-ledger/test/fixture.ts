import type { ActivityEvent } from "@zs-home/shared-contracts";
export function event(suffix = "one"): ActivityEvent {
  return {
    contract: "home.activity-event/v1",
    eventKey: `github:commit.pushed:synthetic/${suffix}`,
    kind: "commit.pushed",
    occurredAt: "2026-11-18T23:01:02.123456789Z",
    actor: { sourceAccount: "synthetic-account" },
    subject: "Synthetic commit",
    projectId: "project:fixture",
    repository: "Zero-State-LLC/fixture",
    provenance: {
      sourceSystem: "github",
      sourceObjectId: `synthetic/${suffix}`,
      sourceUrl: "https://example.test/evidence",
      collector: "fixture",
      collectorVersion: "1",
      collectedAt: "2026-11-18T23:02:00Z",
    },
  };
}
