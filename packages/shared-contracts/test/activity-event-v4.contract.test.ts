import { describe, expect, it } from "vitest";
import { validateActivityEvent, type ActivityEvent } from "../src/index.js";
import { loadFixture } from "./fixture.js";

// Every Source System a Knowledge Flag can be raised from, plus a Verdict and a curator run.
const validFixtures = [
  "valid/activity-event-v4-buzz-knowledge-flag.json",
  "valid/activity-event-v4-github-knowledge-flag.json",
  "valid/activity-event-v4-linear-knowledge-flag.json",
  "valid/activity-event-v4-software-factory-knowledge-flag.json",
  "valid/activity-event-v4-software-factory-verdict-recorded.json",
  "valid/activity-event-v4-homer-curator-run-completed.json",
];

function accepted(name: string): ActivityEvent {
  const result = validateActivityEvent(loadFixture(name));
  if (!result.ok) {
    expect.fail(`${name}: ${result.errors.join("\n")}`);
  }
  return result.value;
}

function errorsOf(name: string): string {
  const result = validateActivityEvent(loadFixture(name));
  expect(result.ok, name).toBe(false);
  return result.ok ? "" : result.errors.join("\n");
}

describe("Activity Event contract version 4", () => {
  it.each(validFixtures)("accepts %s", (name) => {
    expect(accepted(name).contract).toBe("home.activity-event/v4");
  });

  it("admits a software-factory Knowledge Flag, which version 3 refuses", () => {
    const flag = accepted("valid/activity-event-v4-software-factory-knowledge-flag.json");
    const result = validateActivityEvent({ ...flag, contract: "home.activity-event/v3" });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain(
      "/provenance/sourceSystem must be equal to one of the allowed values",
    );
  });

  it("keeps every new Knowledge Flag field optional", () => {
    const flag = accepted("valid/activity-event-v4-buzz-knowledge-flag.json");
    const result = validateActivityEvent({ ...flag, data: {} });
    expect(result.ok, result.ok ? "" : result.errors.join("\n")).toBe(true);
  });

  it("rejects a malformed trace id", () => {
    expect(errorsOf("invalid/activity-event-v4-bad-trace-id.json")).toContain(
      '/data/traceRef/traceId must match pattern "^[A-Za-z0-9._-]{1,128}$"',
    );
  });

  it("requires a trace link to be https", () => {
    expect(errorsOf("invalid/activity-event-v4-trace-ref-not-https.json")).toContain(
      '/data/traceRef/url must match pattern "^https://"',
    );
  });

  it("keeps verdictEventKey to a software-factory Verdict event", () => {
    expect(errorsOf("invalid/activity-event-v4-verdict-event-key-not-factory.json")).toContain(
      "/data/verdictEventKey must match pattern",
    );
  });

  it("requires an observation hash to be a sha256", () => {
    expect(errorsOf("invalid/activity-event-v4-bad-observation-hash.json")).toContain(
      '/data/observationHash must match pattern "^[0-9a-f]{64}$"',
    );
  });

  it("rejects an unknown gapKind", () => {
    expect(errorsOf("invalid/activity-event-v4-unknown-gap-kind.json")).toContain(
      "/data/gapKind must be equal to one of the allowed values",
    );
  });

  it("takes a Verdict's Langfuse trace on factory.verdict_recorded", () => {
    const verdict = accepted("valid/activity-event-v4-software-factory-verdict-recorded.json");
    expect(verdict.data?.["traceRef"]).toEqual({
      provider: "langfuse",
      traceId: "judge-2026-11-18.7",
      url: "https://langfuse.example.test/trace/judge-2026-11-18.7",
    });
  });

  it("cites a software-factory Knowledge Flag by Event Key in a curator run", () => {
    const run = accepted("valid/activity-event-v4-homer-curator-run-completed.json");
    expect(run.data?.["addressedFlags"]).toEqual([
      "software-factory:knowledge.flagged:WP-2026-11-18-home:a1b2c3d",
    ]);
  });
});
