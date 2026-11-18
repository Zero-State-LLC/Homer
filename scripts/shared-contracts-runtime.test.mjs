import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validateActivityEvent } from "@zs-home/shared-contracts";

test("Node can load the built workspace package and validate an Activity Event", () => {
  const fixture = new URL(
    "../packages/shared-contracts/test/fixtures/valid/activity-event-commit-pushed.json",
    import.meta.url,
  );
  const activityEvent = JSON.parse(readFileSync(fixture, "utf8"));
  assert.deepEqual(validateActivityEvent(activityEvent), { ok: true, value: activityEvent });
});
