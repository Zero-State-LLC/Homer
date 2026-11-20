import { describe, expect, it } from "vitest";
import { validateWorkRequest } from "../src/index.js";
import { loadFixture } from "./fixture.js";

describe("Work Request contract", () => {
  it("accepts a Work Request for software-factory intake", () => {
    const result = validateWorkRequest(loadFixture("valid/work-request.json"));
    if (!result.ok) {
      expect.fail(result.errors.join("\n"));
    }
    expect(result.value.contract).toBe("home.work-request/v1");
    expect(result.value.repository).toBe("Zero-State-LLC/home");
  });

  it("rejects a budget of zero", () => {
    const result = validateWorkRequest(loadFixture("invalid/work-request-budget-zero.json"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toContain("/budgetUsd must be > 0");
    }
  });

  it("rejects duplicate doneWhen items", () => {
    const result = validateWorkRequest(
      loadFixture("invalid/work-request-duplicate-done-when.json"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toContain("must NOT have duplicate items");
    }
  });

  it("rejects a source outside linear, github, and manual", () => {
    const result = validateWorkRequest(loadFixture("invalid/work-request-bad-source.json"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toContain("/source must match pattern");
    }
  });
});
