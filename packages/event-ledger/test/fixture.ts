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

const channel = "00000000-0000-4000-8000-000000000001";
/** A contract version 2 Buzz message, as the Buzz mapper would produce it. */
export function buzzEvent(id = "a".repeat(64)): ActivityEvent {
  return {
    contract: "home.activity-event/v2",
    eventKey: `buzz:message.posted:${channel}/${id}`,
    kind: "message.posted",
    occurredAt: "2026-11-23T15:04:05Z",
    actor: { sourceAccount: `buzz:${"b".repeat(64)}` },
    subject: "Buzz message",
    provenance: {
      sourceSystem: "buzz",
      sourceObjectId: id,
      sourceUrl: `buzz://message?channel=${channel}&id=${id}`,
      collector: "buzz-collector",
      collectorVersion: "0.1.0",
      collectedAt: "2026-11-23T15:05:00Z",
    },
  };
}
