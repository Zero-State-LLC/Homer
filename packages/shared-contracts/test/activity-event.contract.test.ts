import { describe, expect, it } from "vitest";
import { validateActivityEvent } from "../src/index.js";
import { loadFixture } from "./fixture.js";

const validFixtures = [
  "valid/activity-event-commit-pushed.json",
  "valid/activity-event-task-created.json",
  "valid/activity-event-work-session-started.json",
  "valid/activity-event-verdict-recorded.json",
];

describe("Activity Event contract", () => {
  it.each(validFixtures)("accepts %s", (name) => {
    const result = validateActivityEvent(loadFixture(name));
    if (!result.ok) {
      expect.fail(result.errors.join("\n"));
    }
    expect(result.value.contract).toBe("home.activity-event/v1");
  });

  it("keeps an unattributed Activity Event free of an Actor id", () => {
    const result = validateActivityEvent(loadFixture("valid/activity-event-task-created.json"));
    if (!result.ok) {
      expect.fail(result.errors.join("\n"));
    }
    expect(result.value.actor.actorId).toBeUndefined();
    expect(result.value.actor.actorKind).toBeUndefined();
    expect(result.value.actor.sourceAccount).toBe("linear:user_123");
  });

  it("rejects a non-UTC offset", () => {
    const result = validateActivityEvent(loadFixture("invalid/activity-event-non-utc-offset.json"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toContain("/occurredAt must match pattern");
    }
  });

  it("rejects a missing Provenance", () => {
    const result = validateActivityEvent(
      loadFixture("invalid/activity-event-missing-provenance.json"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toContain("must have required property 'provenance'");
    }
  });

  it("rejects an http source URL", () => {
    const result = validateActivityEvent(
      loadFixture("invalid/activity-event-http-source-url.json"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toContain('must match pattern "^https://"');
    }
  });

  it("rejects an unknown Kind", () => {
    const result = validateActivityEvent(loadFixture("invalid/activity-event-unknown-kind.json"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toContain(
        "/kind must be equal to one of the allowed values",
      );
    }
  });

  it("rejects an Event Key prefix that disagrees with the Source System", () => {
    const result = validateActivityEvent(
      loadFixture("invalid/activity-event-event-key-prefix-mismatch.json"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        'eventKey prefix "github" must equal provenance.sourceSystem "linear"',
      ]);
    }
  });

  it("rejects actorKind without an Identity Binding actorId", () => {
    const result = validateActivityEvent(
      loadFixture("invalid/activity-event-actor-kind-without-actor-id.json"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(["actorKind present only if actorId present"]);
    }
  });

  it("rejects an extra top-level property", () => {
    const result = validateActivityEvent(loadFixture("invalid/activity-event-extra-property.json"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toContain("must NOT have additional properties");
    }
  });

  it("rejects a subject longer than 300 characters", () => {
    const result = validateActivityEvent(
      loadFixture("invalid/activity-event-subject-too-long.json"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toContain("/subject must NOT have more than 300 characters");
    }
  });
});
