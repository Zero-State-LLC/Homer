import { expect, it } from "vitest";
import { runnerAsset } from "../src/runner-ui.js";

it("offers a separate accessible machine operation review and preprovisioned enrollment fields", async () => {
  const html = await runnerAsset("/v1/admin/runners").text();
  expect(html).toContain('id="lifecycle-review"');
  expect(html).toContain('id="enrollment-digest"');
  expect(html).toContain('id="enrollment-evidence"');
  expect(html).toContain("Confirm machine operation");
  expect(html).toContain("Cancel machine operation");
});

it("serves syntactically valid lifecycle browser code", async () => {
  const js = await runnerAsset("/v1/admin/runners/app.js").text();
  // Parse trusted shipped script without executing browser code.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  expect(() => new Function(js)).not.toThrow();
});
