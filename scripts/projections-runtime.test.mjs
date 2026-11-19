import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { projectActivityCalendar } from "@zs-home/projections";
test("Node loads the built Projection exports", () => {
  const event = JSON.parse(
    readFileSync(
      new URL(
        "../packages/shared-contracts/test/fixtures/valid/activity-event-commit-pushed.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(
    projectActivityCalendar([event], { timeZone: "UTC", bucket: "day" })[0].events.length,
    1,
  );
});
