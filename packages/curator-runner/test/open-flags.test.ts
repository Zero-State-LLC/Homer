import { expect, it } from "vitest";
import { openFlagsForCurator, type OpenKnowledgeFlagInput } from "../src/index.js";

function flag(eventKey: string, status: OpenKnowledgeFlagInput["status"]): OpenKnowledgeFlagInput {
  return {
    eventKey,
    sourceSystem: "github",
    sourceUrl: "https://github.com/Zero-State-LLC/Homer/issues/60",
    gapKind: "unspecified",
    targetRef: null,
    observationHash: null,
    traceRef: null,
    linkedVerdict: null,
    status,
    curatorAttempts: 0,
  };
}

it("keeps only open and stuck flags, in ledger order", () => {
  const flags = [
    flag("a", "resolved"),
    flag("b", "open"),
    flag("c", "needs_human"),
    flag("d", "stuck"),
  ];
  expect(openFlagsForCurator(flags).map((entry) => entry.eventKey)).toEqual(["b", "d"]);
});

it("returns a new array and leaves the input untouched", () => {
  const flags = [flag("a", "open"), flag("b", "resolved")];
  const open = openFlagsForCurator(flags);
  expect(open).not.toBe(flags);
  expect(open).toHaveLength(1);
  expect(flags).toHaveLength(2);
  expect(openFlagsForCurator([])).toEqual([]);
});

it("accepts a Projection's flag, with the fields the curator does not use", () => {
  const projected = {
    ...flag("github:knowledge.flagged:Zero-State-LLC/Homer#60", "open"),
    occurredAt: "2026-11-24T10:00:00Z",
    actor: { sourceAccount: "github:example-dev" },
    projectId: "project:example",
    repository: "Zero-State-LLC/Homer",
    taskId: "ZER-35",
    needsHumanReason: null,
    resolvedByPrUrl: null,
    linkedVerdict: {
      eventKey: "software-factory:factory.verdict_recorded:WP-2026-11-18-home",
      packetId: "WP-2026-11-18-home",
      repository: "Zero-State-LLC/Homer",
      headSha: "a1b2c3d",
      pr: 1,
      result: "fail" as const,
      occurredAt: "2026-11-24T09:00:00Z",
    },
  };
  expect(openFlagsForCurator([projected]).map((entry) => entry.eventKey)).toEqual([
    "github:knowledge.flagged:Zero-State-LLC/Homer#60",
  ]);
});
