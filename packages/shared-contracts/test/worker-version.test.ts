import { describe, expect, it } from "vitest";
import { BUILD_VERSION, PRODUCT_VERSION, workerVersion } from "../src/index.js";

describe("workerVersion", () => {
  it("answers the build's versions and the binding's id and tag", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(workerVersion({ id, tag: "v0.1.0", timestamp: "2026-11-24T00:00:00Z" })).toEqual({
      productVersion: PRODUCT_VERSION,
      buildVersion: BUILD_VERSION,
      workerVersionId: id,
      workerVersionTag: "v0.1.0",
    });
  });
  it("answers null for a missing binding, an empty tag or an unexpected value", () => {
    for (const metadata of [undefined, null, "x", { id: "", tag: "" }, { id: 7, tag: ["v1"] }]) {
      expect(workerVersion(metadata)).toEqual({
        productVersion: PRODUCT_VERSION,
        buildVersion: BUILD_VERSION,
        workerVersionId: null,
        workerVersionTag: null,
      });
    }
    expect(workerVersion({ id: "a".repeat(129), tag: "v0.1.0" }).workerVersionId).toBeNull();
  });
  it("answers exactly four fields", () => {
    expect(Object.keys(workerVersion({ id: "x", tag: "y", timestamp: "z", extra: 1 }))).toEqual([
      "productVersion",
      "buildVersion",
      "workerVersionId",
      "workerVersionTag",
    ]);
  });
});
