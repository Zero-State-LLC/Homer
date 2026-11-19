import type { LedgerRpc } from "../src/client.js";
import { env } from "cloudflare:workers";
import { runInDurableObject, abortAllDurableObjects } from "cloudflare:test";
import { expect, it } from "vitest";
import { verifyHistory } from "../src/index.js";
import { event } from "./fixture.js";
it("serializes eight independent writers, conflicting or identical, for 20 rounds", async () => {
  for (let round = 0; round < 20; round++) {
    const id = env.EVENT_LEDGER.newUniqueId();
    const stubs = Array.from(
      { length: 8 },
      () => env.EVENT_LEDGER.get(id) as unknown as DurableObjectStub & LedgerRpc,
    );
    const results = await Promise.all(
      stubs.map((s, i) =>
        s.appendActivityEvent({ ...event(), subject: round % 2 ? "identical" : `subject-${i}` }),
      ),
    );
    expect(results.filter((r) => r.outcome === "appended")).toHaveLength(1);
    expect(
      results.filter((r) => r.outcome === (round % 2 ? "duplicate" : "conflict")),
    ).toHaveLength(7);
    const history = await stubs[0]!.readHistory();
    expect(history).toHaveLength(1);
    expect(verifyHistory(history)).toEqual({ ok: true });
  }
});
it("commits four writers times 200 appends as one chain", async () => {
  const id = env.EVENT_LEDGER.newUniqueId();
  const stubs = Array.from(
    { length: 4 },
    () => env.EVENT_LEDGER.get(id) as unknown as DurableObjectStub & LedgerRpc,
  );
  const results = await Promise.all(
    stubs.flatMap((s, w) =>
      Array.from({ length: 200 }, (_, i) => s.appendActivityEvent(event(`${w}/${i}`))),
    ),
  );
  expect(results.every((r) => r.outcome === "appended")).toBe(true);
  const history = await stubs[0]!.readHistory();
  expect(history).toHaveLength(800);
  expect(verifyHistory(history)).toEqual({ ok: true });
});
it("rolls back a throw after insert and returns the committed receipt after a lost reply", async () => {
  let l = env.EVENT_LEDGER.get(env.EVENT_LEDGER.newUniqueId()) as unknown as DurableObjectStub &
    LedgerRpc;
  const receipt = await l.appendActivityEvent(event());
  await runInDurableObject(l, (_object, state) => {
    expect(() =>
      state.storage.transactionSync(() => {
        state.storage.sql.exec(
          "INSERT INTO entries SELECT 2, entry_type, 'synthetic-other', NULL, NULL, comparison_digest, previous_digest, entry_digest, entry_json FROM entries WHERE sequence=1",
        );
        throw new Error("failure after insert");
      }),
    ).toThrow("failure after insert");
    expect(state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM entries").one().n).toBe(
      1,
    );
  });
  await abortAllDurableObjects();
  l = env.EVENT_LEDGER.get(l.id);
  expect(await l.appendActivityEvent(event())).toEqual({ ...receipt, outcome: "duplicate" });
  expect(verifyHistory(await l.readHistory())).toEqual({ ok: true });
});
