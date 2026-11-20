import { describe, expect, it } from "vitest";
import { validateFactoryEvent } from "../src/index.js";
import { loadFixture } from "./fixture.js";

describe("Factory Event contract", () => {
  it("accepts a stage change", () => {
    const result = validateFactoryEvent(loadFixture("valid/factory-event-stage-changed.json"));
    if (!result.ok) {
      expect.fail(result.errors.join("\n"));
    }
    expect(result.value.type).toBe("stage_changed");
    if (result.value.type === "stage_changed") {
      expect(result.value.from).toBe("intake");
      expect(result.value.to).toBe("spec");
    }
  });

  it("accepts a recorded Verdict", () => {
    const result = validateFactoryEvent(loadFixture("valid/factory-event-verdict-recorded.json"));
    if (!result.ok) {
      expect.fail(result.errors.join("\n"));
    }
    expect(result.value.type).toBe("verdict_recorded");
    if (result.value.type === "verdict_recorded") {
      expect(result.value.verdict.result).toBe("pass");
    }
  });

  it("rejects a Verdict that omits headSha", () => {
    const result = validateFactoryEvent(
      loadFixture("invalid/factory-event-verdict-missing-head-sha.json"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toContain("/verdict must have required property 'headSha'");
    }
  });

  it("rejects a stage outside the Work Packet stages", () => {
    const result = validateFactoryEvent(loadFixture("invalid/factory-event-bad-stage.json"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toContain("/to must be equal to one of the allowed values");
    }
  });
});
