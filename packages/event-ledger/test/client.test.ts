import { expect, it, vi } from "vitest";
import { openEventLedger, type LedgerRpc } from "../src/client.js";
import type { EventLedgerObject } from "../src/ledger-object.js";
import { EventLedgerIntegrityError, EventLedgerStorageError } from "../src/types.js";
function client(rpc: Partial<LedgerRpc>) {
  const namespace = { get: () => rpc, idFromName: () => "synthetic" };
  return openEventLedger(namespace as unknown as DurableObjectNamespace<EventLedgerObject>);
}
it("refuses invalid bounds before calling storage", async () => {
  const head = vi.fn().mockRejectedValue(new Error("offline"));
  for (const throughSequence of [-1, 1.5, NaN, Infinity])
    await expect(client({ head }).readHistory({ throughSequence })).rejects.toBeInstanceOf(
      RangeError,
    );
  expect(head).not.toHaveBeenCalled();
});
it("reports a missing history page as an integrity failure", async () => {
  const rpc = {
    head: () => Promise.resolve({ sequence: 1, entryDigest: "a".repeat(64) }),
    readHistory: () => Promise.resolve([]),
  };
  await expect(client(rpc).readHistory()).rejects.toBeInstanceOf(EventLedgerIntegrityError);
});
it("wraps transport failures and preserves their cause", async () => {
  const cause = new Error("RPC unavailable");
  await expect(
    client({
      head: () => Promise.reject(cause),
    }).readHistory(),
  ).rejects.toMatchObject({ name: "EventLedgerStorageError", cause });
  await expect(
    client({
      head: () => Promise.reject(cause),
    }).head(),
  ).rejects.toBeInstanceOf(EventLedgerStorageError);
});
