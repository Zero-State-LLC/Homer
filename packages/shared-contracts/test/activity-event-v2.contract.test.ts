import { describe, expect, it } from "vitest";
import { validateActivityEvent } from "../src/index.js";
import { loadFixture } from "./fixture.js";

const validFixtures = [
  "valid/activity-event-v2-buzz-message.json",
  "valid/activity-event-v2-buzz-thread-reply.json",
  "valid/activity-event-v2-buzz-knowledge-flag.json",
  "valid/activity-event-v2-github-knowledge-flag.json",
  "valid/activity-event-v2-curator-run-completed.json",
  "valid/activity-event-v2-curator-profile-switched.json",
  "valid/activity-event-v2-commit-pushed.json",
];

const versionOneFixtures = [
  "valid/activity-event-commit-pushed.json",
  "valid/activity-event-task-created.json",
  "valid/activity-event-work-session-started.json",
  "valid/activity-event-verdict-recorded.json",
];

function errorsOf(name: string): string {
  const result = validateActivityEvent(loadFixture(name));
  expect(result.ok, name).toBe(false);
  return result.ok ? "" : result.errors.join("\n");
}

describe("Activity Event contract version 2", () => {
  it.each(validFixtures)("accepts %s", (name) => {
    const result = validateActivityEvent(loadFixture(name));
    if (!result.ok) {
      expect.fail(result.errors.join("\n"));
    }
    expect(result.value.contract).toBe("home.activity-event/v2");
  });

  it.each(versionOneFixtures)("still accepts version 1 %s unchanged", (name) => {
    const result = validateActivityEvent(loadFixture(name));
    if (!result.ok) {
      expect.fail(result.errors.join("\n"));
    }
    expect(result.value.contract).toBe("home.activity-event/v1");
  });

  it("keeps the Buzz Source System out of version 1", () => {
    expect(errorsOf("invalid/activity-event-v1-buzz-source.json")).toContain(
      "/provenance/sourceSystem must be equal to one of the allowed values",
    );
  });

  it("allows a buzz:// source URL only on a Buzz event", () => {
    for (const name of [
      "invalid/activity-event-v2-buzz-url-on-github-source.json",
      "invalid/activity-event-v2-buzz-url-on-homer-source.json",
    ]) {
      expect(errorsOf(name)).toContain('/provenance/sourceUrl must match pattern "^https://"');
    }
  });

  it("allows buzz:// evidence only on Buzz events", () => {
    for (const name of [
      "invalid/activity-event-v2-buzz-url-in-github-evidence.json",
      "invalid/activity-event-v2-buzz-url-in-homer-evidence.json",
    ]) {
      expect(errorsOf(name)).toContain('url must match pattern "^https://"');
    }
  });

  it("cites a curator run's flags by their Event Keys", () => {
    const run = validateActivityEvent(
      loadFixture("valid/activity-event-v2-curator-run-completed.json"),
    );
    if (!run.ok) {
      expect.fail(run.errors.join("\n"));
    }
    expect(run.value.data?.["addressedFlags"]).toEqual([
      "buzz:knowledge.flagged:00000000-0000-4000-8000-000000000001/" + "a".repeat(64),
      "github:knowledge.flagged:Zero-State-LLC/Homer#60",
    ]);
    expect(errorsOf("invalid/activity-event-v2-curator-run-without-flags.json")).toContain(
      "/data must have required property 'addressedFlags'",
    );
    for (const name of [
      "invalid/activity-event-v2-curator-run-flag-as-link.json",
      "invalid/activity-event-v2-curator-run-non-flag-key.json",
    ]) {
      expect(errorsOf(name)).toContain("/data/addressedFlags/0 must match pattern");
    }
  });

  it("refuses a malformed buzz:// link", () => {
    expect(errorsOf("invalid/activity-event-v2-malformed-buzz-url.json")).toContain(
      "/provenance/sourceUrl must match pattern",
    );
  });

  it("keeps relay and agent text out of fixed subjects", () => {
    expect(errorsOf("invalid/activity-event-v2-buzz-free-text-subject.json")).toContain(
      "/subject must be equal to constant",
    );
    expect(errorsOf("invalid/activity-event-v2-curator-run-free-text-subject.json")).toContain(
      "/subject must match pattern",
    );
  });

  it("admits each new Kind only from its Source Systems", () => {
    expect(errorsOf("invalid/activity-event-v2-buzz-wrong-kind.json")).toContain(
      "/kind must be equal to one of the allowed values",
    );
    expect(errorsOf("invalid/activity-event-v2-homer-wrong-kind.json")).toContain(
      "/kind must be equal to one of the allowed values",
    );
    expect(errorsOf("invalid/activity-event-v2-curator-kind-from-github.json")).toContain(
      "/provenance/sourceSystem must be equal to constant",
    );
    expect(errorsOf("invalid/activity-event-v2-message-from-linear.json")).toContain(
      "/provenance/sourceSystem must be equal to constant",
    );
    expect(errorsOf("invalid/activity-event-v2-flag-from-control-room.json")).toContain(
      "/provenance/sourceSystem must be equal to one of the allowed values",
    );
  });

  it("still ties the Event Key prefix to the Source System", () => {
    const result = validateActivityEvent(
      loadFixture("invalid/activity-event-v2-event-key-prefix-mismatch.json"),
    );
    expect(result).toEqual({
      ok: false,
      errors: ['eventKey prefix "homer" must equal provenance.sourceSystem "buzz"'],
    });
  });

  it("checks an unknown contract as version 1", () => {
    const value = { ...(loadFixture("valid/activity-event-v2-buzz-message.json") as object) };
    const result = validateActivityEvent({ ...value, contract: "home.activity-event/v3" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toContain("/contract must be equal to constant");
    }
  });
});
