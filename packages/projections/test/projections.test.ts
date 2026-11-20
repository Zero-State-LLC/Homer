import { expect, it } from "vitest";
import type { ActivityEvent } from "@zs-home/shared-contracts";
import {
  projectActivityCalendar,
  projectProjectTimeline,
  projectSourceFreshness,
} from "../src/index.js";
import { replayEffectiveHistory } from "@zs-home/event-ledger";
import { comparisonDigest, digest, entryBody } from "../../event-ledger/src/canonical.js";
import type { LedgerEntry } from "@zs-home/event-ledger";
import { event } from "../../event-ledger/test/fixture.js";
const options = { timeZone: "America/Los_Angeles", bucket: "day" as const };
const asOf = "2026-11-19T01:00:00Z";
function milestone(
  id: string,
  data: Record<string, unknown> = {},
  kind: "milestone.planned" | "milestone.completed" = "milestone.planned",
): ActivityEvent {
  return {
    ...event(id),
    eventKey: `linear:${kind}:${id}`,
    kind,
    provenance: { ...event(id).provenance, sourceSystem: "linear" },
    data: { milestoneId: id, ...data },
  };
}
it("buckets Pacific dates without changing stored UTC timestamps", () => {
  const a = { ...event("a"), occurredAt: "2026-11-19T01:00:00Z" };
  const snapshot = structuredClone(a);
  const buckets = projectActivityCalendar([a], options);
  expect(buckets[0]!.key).toBe("2026-11-18");
  expect(buckets[0]!.events[0]!.occurredAt).toBe(a.occurredAt);
  buckets[0]!.events[0]!.subject = "mutated";
  expect(a).toEqual(snapshot);
});
it("keeps repeated fall-back instants and respects spring-forward day boundaries", () => {
  const times = [
    "2026-11-01T08:30:00Z",
    "2026-11-01T09:30:00Z",
    "2026-03-08T09:30:00Z",
    "2026-03-08T10:30:00Z",
  ];
  const buckets = projectActivityCalendar(
    times.map((occurredAt, i) => ({ ...event(String(i)), occurredAt })),
    options,
  );
  expect(buckets.map((b) => [b.key, b.events.length])).toEqual([
    ["2026-03-08", 2],
    ["2026-11-01", 2],
  ]);
  expect(buckets.flatMap((b) => b.events.map((e) => e.occurredAt))).toEqual([
    times[2],
    times[3],
    times[0],
    times[1],
  ]);
});
it("uses Monday weeks across the year and supports month buckets", () => {
  const input = [{ ...event(), occurredAt: "2027-01-01T12:00:00Z" }];
  expect(projectActivityCalendar(input, { ...options, bucket: "week" })[0]!.key).toBe("2026-12-28");
  expect(projectActivityCalendar(input, { ...options, bucket: "month" })[0]!.key).toBe("2027-01");
  expect(() => projectActivityCalendar(input, { ...options, timeZone: "invalid-zone" })).toThrow();
});
it("sorts late arrivals at nanosecond precision", () => {
  const events = [
    { ...event("a"), occurredAt: "2026-11-18T12:00:00.000000009Z" },
    { ...event("z"), occurredAt: "2026-11-18T12:00:00.000000001Z" },
  ];
  expect(projectActivityCalendar(events, options)[0]!.events.map((e) => e.eventKey)).toEqual([
    events[1]!.eventKey,
    events[0]!.eventKey,
  ]);
});
it("composes Actor and Project filters without guessing Attribution from account names", () => {
  const events: ActivityEvent[] = [
    event("unattributed"),
    {
      ...event("agent"),
      actor: { sourceAccount: "synthetic", actorId: "actor:agent", actorKind: "agent" },
    },
    {
      ...event("human"),
      actor: { sourceAccount: "synthetic", actorId: "actor:human", actorKind: "human" },
    },
  ];
  expect(
    projectActivityCalendar(events, { ...options, actorKind: "unattributed" })[0]!.events,
  ).toHaveLength(1);
  expect(
    projectActivityCalendar(events, { ...options, actorKind: "human", actorId: "actor:agent" }),
  ).toEqual([]);
  expect(
    projectActivityCalendar(events, {
      ...options,
      actorKind: "agent",
      projectId: "project:fixture",
    })[0]!.events[0]!.actor.actorId,
  ).toBe("actor:agent");
  expect(projectActivityCalendar(events, { ...options, projectId: "project:other" })).toEqual([]);
});
it("keeps Planned and Actual Dates unknown when source dates and verification are absent", () => {
  const timeline = projectProjectTimeline(
    [milestone("m"), milestone("m", {}, "milestone.completed")],
    { projectId: "project:fixture", asOf },
  );
  expect(timeline.milestones[0]).toMatchObject({
    plannedDate: null,
    actualDate: null,
    ownerActorId: null,
  });
  expect(timeline.warnings).toHaveLength(1);
  expect(timeline.sourceFreshness.every((s) => s.status === "unknown")).toBe(true);
});
it("requires a matching evidence receipt to show Actual Date and never shifts a Planned Date", () => {
  const plan = milestone("m", {
    plannedDate: "2026-11-20",
    ownerActorId: "actor:owner",
    dependencies: [],
  });
  const completed = {
    ...milestone("m", {}, "milestone.completed"),
    evidence: [{ label: "Verified deployment", url: "https://example.test/deployment" }],
  };
  const receipt = {
    eventKey: completed.eventKey,
    sourceUrl: completed.provenance.sourceUrl,
    evidenceUrl: completed.evidence[0]!.url,
  };
  expect(
    projectProjectTimeline([plan, completed], {
      projectId: "project:fixture",
      asOf,
      verifiedCompletions: [receipt],
    }).milestones[0],
  ).toMatchObject({
    plannedDate: "2026-11-20",
    actualDate: completed.occurredAt,
    ownerActorId: "actor:owner",
  });
  expect(
    projectProjectTimeline([completed], {
      projectId: "project:fixture",
      asOf,
      verifiedCompletions: [{ ...receipt, evidenceUrl: "https://example.test/unrelated" }],
    }).milestones[0]!.actualDate,
  ).toBeNull();
});
it("warns on wrong Authorities, invalid dates and malformed dependencies", () => {
  const wrong = { ...milestone("wrong"), provenance: event().provenance };
  const timeline = projectProjectTimeline(
    [wrong, milestone("bad", { plannedDate: "2026-02-30", dependencies: [1] })],
    { projectId: "project:fixture", asOf },
  );
  expect(timeline.milestones).toHaveLength(1);
  expect(timeline.milestones[0]!.plannedDate).toBeNull();
  expect(timeline.warnings).toHaveLength(3);
});
it("surfaces unknown dependencies and cycles", () => {
  const timeline = projectProjectTimeline(
    [milestone("a", { dependencies: ["b", "missing"] }), milestone("b", { dependencies: ["a"] })],
    { projectId: "project:fixture", asOf },
  );
  expect(timeline.warnings.join(" ")).toContain("dependency cycle");
  expect(timeline.warnings.join(" ")).toContain("unknown dependency missing");
});
it("folds source-scoped Blockers and preserves Release Gate evidence without promoting release", () => {
  const raise = {
    ...event(),
    kind: "blocker.raised" as const,
    data: { blockerId: "b", milestoneId: "m" },
  };
  const other = { ...raise, provenance: { ...raise.provenance, sourceSystem: "linear" as const } };
  const clear = { ...raise, kind: "blocker.cleared" as const };
  const gate = { ...event(), kind: "ci.completed" as const };
  const timeline = projectProjectTimeline([raise, other, clear, gate], {
    projectId: "project:fixture",
    asOf,
  });
  expect(timeline.blockers.map((b) => b.id)).toEqual(["linear:b"]);
  expect(timeline.releaseGates).toEqual([gate]);
});
it("retains last successful collection when an attempt fails and makes missing budgets Unknown", () => {
  const freshness = projectSourceFreshness(
    [
      {
        sourceSystem: "github",
        lastSuccessAt: "2026-11-19T00:00:00Z",
        maxAgeSeconds: 60,
        lastAttemptFailed: true,
      },
      { sourceSystem: "linear", lastSuccessAt: "2026-11-19T00:59:00Z", maxAgeSeconds: 60 },
      { sourceSystem: "control-room", lastSuccessAt: asOf, maxAgeSeconds: null },
      {
        sourceSystem: "software-factory",
        lastSuccessAt: "2027-01-01T00:00:00Z",
        maxAgeSeconds: 60,
      },
    ],
    asOf,
  );
  expect(freshness.map((s) => s.status)).toEqual(["stale", "fresh", "unknown", "unknown"]);
  expect(freshness[0]!.lastSuccessAt).toBe("2026-11-19T00:00:00Z");
});
it("rebuilds from Corrections while preserving the original history", () => {
  const original = milestone("m", { plannedDate: "2026-11-20" });
  const e1 = {
    formatVersion: 1,
    sequence: 1,
    entryType: "activity_event",
    previousDigest: null,
    payload: original,
    entryDigest: "",
    comparisonDigest: comparisonDigest(original),
  } as LedgerEntry;
  e1.entryDigest = digest(entryBody(e1));
  const replacement = { ...original, data: { milestoneId: "m", plannedDate: "2026-12-01" } };
  const correction = {
    contract: "home.correction/v1" as const,
    correctionId: "c1",
    targetEventKey: original.eventKey,
    action: "supersede" as const,
    reason: "Reviewed date change",
    provenance: original.provenance,
    replacement,
  };
  const e2 = {
    formatVersion: 1,
    sequence: 2,
    entryType: "correction",
    previousDigest: e1.entryDigest,
    payload: correction,
    entryDigest: "",
    comparisonDigest: comparisonDigest(correction),
  } as LedgerEntry;
  e2.entryDigest = digest(entryBody(e2));
  const effective = replayEffectiveHistory([e1, e2]);
  expect(
    projectProjectTimeline(effective, { projectId: "project:fixture", asOf }).milestones[0]!
      .plannedDate,
  ).toBe("2026-12-01");
  expect(projectActivityCalendar(effective, options).flatMap((b) => b.events)).toHaveLength(1);
  expect(original.data?.plannedDate).toBe("2026-11-20");
});

it("reports conflicting checkpoints without choosing a success or budget", () => {
  const checkpoints = [
    { sourceSystem: "github" as const, lastSuccessAt: asOf, maxAgeSeconds: 60 },
    { sourceSystem: "github" as const, lastSuccessAt: "2026-11-18T00:00:00Z", maxAgeSeconds: 120 },
  ];
  const snapshot = structuredClone(checkpoints);
  const result = projectSourceFreshness(checkpoints, asOf)[0]!;
  expect(result).toMatchObject({
    status: "unknown",
    lastSuccessAt: null,
    maxAgeSeconds: null,
    warnings: ["github: multiple checkpoints"],
  });
  expect(
    projectProjectTimeline([], { projectId: "project:fixture", asOf, checkpoints }).warnings,
  ).toContain("github: multiple checkpoints");
  expect(checkpoints).toEqual(snapshot);
});
it("distinguishes missing, invalid and future Source Freshness inputs", () => {
  const result = projectSourceFreshness(
    [
      { sourceSystem: "github", lastSuccessAt: "invalid", maxAgeSeconds: 60 },
      { sourceSystem: "linear", lastSuccessAt: "2027-01-01T00:00:00Z", maxAgeSeconds: 60 },
      { sourceSystem: "control-room", lastSuccessAt: asOf, maxAgeSeconds: -1 },
    ],
    asOf,
  );
  expect(result.map((s) => s.status)).toEqual(["unknown", "unknown", "unknown", "unknown"]);
  expect(result.map((s) => s.warnings)).toEqual([
    ["github: invalid last success"],
    ["linear: last success is in the future"],
    ["control-room: invalid freshness budget"],
    ["software-factory: missing checkpoint"],
  ]);
});
