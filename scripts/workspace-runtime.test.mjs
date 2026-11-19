import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyHistory, replayEffectiveHistory } from "@zs-home/event-ledger";
import { validateActivityEvent } from "@zs-home/shared-contracts/workers";
test("Node loads the built ledger and Workers validator exports", () => {
  const event = JSON.parse(
    readFileSync(
      new URL(
        "../packages/shared-contracts/test/fixtures/valid/activity-event-commit-pushed.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(validateActivityEvent(event).ok, true);
  assert.deepEqual(verifyHistory([]), { ok: true });
  assert.deepEqual(replayEffectiveHistory([]), []);
});
