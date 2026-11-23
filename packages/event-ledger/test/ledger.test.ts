import type { LedgerRpc } from "../src/client.js";
import { env } from "cloudflare:workers";
import { runInDurableObject, evictDurableObject, abortAllDurableObjects } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  openEventLedger,
  replayEffectiveHistory,
  verifyHistory,
  EventLedgerIntegrityError,
} from "../src/index.js";
import type { Correction } from "../src/index.js";
import { canonicalJson, digest, entryBody } from "../src/canonical.js";
import { buzzEvent, event } from "./fixture.js";
function ledger() {
  return env.EVENT_LEDGER.get(env.EVENT_LEDGER.newUniqueId()) as unknown as DurableObjectStub &
    LedgerRpc;
}
function correction(action: "retract" | "supersede", correctionId: string): Correction {
  const base = {
    contract: "home.correction/v1" as const,
    correctionId,
    targetEventKey: event().eventKey,
    reason: "Reviewed synthetic evidence",
    provenance: event().provenance,
  };
  return action === "retract"
    ? { ...base, action }
    : { ...base, action, replacement: { ...event(), subject: correctionId } };
}
async function fails(operation: () => Promise<unknown>): Promise<void> {
  let error: unknown;
  try {
    await operation();
  } catch (e) {
    error = e;
  }
  expect(error).toBeDefined();
}
describe("Durable Event Ledger", () => {
  it("preserves immutable Provenance and nanosecond timestamps; acknowledges a Duplicate", async () => {
    const l = ledger();
    const input = event();
    const first = await l.appendActivityEvent(input);
    expect(first.outcome).toBe("appended");
    input.subject = "mutated";
    expect((await l.readHistory())[0]!.payload).toEqual(event());
    expect(verifyHistory(await l.readHistory())).toEqual({ ok: true });
    const retry = event();
    retry.provenance = {
      ...retry.provenance,
      collectedAt: "2026-11-19T00:00:00Z",
      collector: "other",
      collectorVersion: "2",
    };
    expect(
      await l.appendActivityEvent(Object.fromEntries(Object.entries(retry).reverse())),
    ).toEqual({ ...first, outcome: "duplicate" });
    expect(await l.readHistory()).toHaveLength(1);
    expect((await l.readHistory())[0]!.payload.provenance).toEqual(event().provenance);
    expect((await l.appendActivityEvent({ ...event(), subject: "different" })).outcome).toBe(
      "conflict",
    );
  });
  it("stores version 1 and version 2 events side by side", async () => {
    const l = ledger();
    expect((await l.appendActivityEvent(event())).outcome).toBe("appended");
    const first = await l.appendActivityEvent(buzzEvent());
    expect(first.outcome).toBe("appended");
    const retry = buzzEvent();
    retry.provenance = { ...retry.provenance, collectedAt: "2026-11-23T16:00:00Z" };
    expect(await l.appendActivityEvent(retry)).toEqual({ ...first, outcome: "duplicate" });
    expect(
      (await l.appendActivityEvent({ ...buzzEvent(), occurredAt: "2026-11-23T15:04:06Z" })).outcome,
    ).toBe("conflict");
    const wrongLink = event("two");
    wrongLink.contract = "home.activity-event/v2";
    wrongLink.provenance = { ...wrongLink.provenance, sourceUrl: buzzEvent().provenance.sourceUrl };
    expect((await l.appendActivityEvent(wrongLink)).outcome).toBe("refused");
    const history = await l.readHistory();
    expect(history.map((entry) => entry.payload.contract)).toEqual([
      "home.activity-event/v1",
      "home.activity-event/v2",
    ]);
    expect(verifyHistory(history)).toEqual({ ok: true });
    expect(replayEffectiveHistory(history).map((e) => e.eventKey)).toEqual([
      event().eventKey,
      buzzEvent().eventKey,
    ]);
  });
  it("validates before Duplicate classification and retains Unattributed source accounts", async () => {
    const l = ledger();
    await l.appendActivityEvent(event());
    const head = await l.head();
    for (const value of [
      { ...event(), provenance: undefined },
      { ...event(), occurredAt: "2026-11-18T15:00:00-08:00" },
      { ...event(), eventKey: "github:task.created:synthetic/one" },
      { ...event(), actor: { sourceAccount: "synthetic", actorKind: "agent" } },
    ])
      expect((await l.appendActivityEvent(value)).outcome).toBe("refused");
    expect(await l.head()).toEqual(head);
    const payload = (await l.readHistory())[0]!.payload;
    expect(payload).toMatchObject({ actor: { sourceAccount: "synthetic-account" } });
    expect(payload).not.toHaveProperty("actor.actorId");
  });
  it("preserves array order and distinguishes absent optional fields", async () => {
    const l = ledger();
    await l.appendActivityEvent({ ...event(), data: { items: [1, 2] } });
    expect((await l.appendActivityEvent({ ...event(), data: { items: [2, 1] } })).outcome).toBe(
      "conflict",
    );
    expect(
      (await l.appendActivityEvent({ ...event(), data: { items: [1, 2] }, evidence: [] })).outcome,
    ).toBe("conflict");
  });
  it("keeps append order for late arrivals and returns bounded history", async () => {
    const l = ledger();
    await l.appendActivityEvent(event());
    await l.appendActivityEvent({ ...event("two"), occurredAt: "2026-01-01T00:00:00Z" });
    expect((await l.readHistory()).map((e) => e.sequence)).toEqual([1, 2]);
    expect(await l.readHistory({ throughSequence: 1 })).toHaveLength(1);
    expect(await l.readHistory({ throughSequence: 0 })).toEqual([]);
    await fails(() => l.readHistory({ throughSequence: -1 }));
  });
  it("supersedes, retracts and restores without releasing the original Event Key", async () => {
    const l = ledger();
    const first = await l.appendActivityEvent(event());
    await l.appendCorrection(correction("supersede", "c1"));
    await l.appendCorrection(correction("retract", "c2"));
    await l.appendCorrection(correction("supersede", "c3"));
    expect(replayEffectiveHistory(await l.readHistory({ throughSequence: 1 }))[0]!.subject).toBe(
      "Synthetic commit",
    );
    expect(replayEffectiveHistory(await l.readHistory({ throughSequence: 2 }))[0]!.subject).toBe(
      "c1",
    );
    expect(replayEffectiveHistory(await l.readHistory({ throughSequence: 3 }))).toEqual([]);
    expect(replayEffectiveHistory(await l.readHistory())[0]!.subject).toBe("c3");
    expect(await l.readHistory()).toHaveLength(4);
    expect(await l.appendActivityEvent(event())).toEqual({ ...first, outcome: "duplicate" });
    expect((await l.appendActivityEvent({ ...event(), subject: "c3" })).outcome).toBe("conflict");
  });
  it("validates Corrections and preserves source identity", async () => {
    const l = ledger();
    const c = correction("supersede", "c1");
    expect((await l.appendCorrection(c)).outcome).toBe("refused");
    await l.appendActivityEvent(event());
    for (const bad of [
      { ...c, reason: " " },
      { ...c, provenance: { ...c.provenance, sourceUrl: "http://example.test" } },
      { ...c, targetEventKey: "missing" },
      { ...c, action: "retract" },
      {
        ...c,
        replacement: { ...event(), provenance: { ...event().provenance, sourceObjectId: "other" } },
      },
    ])
      expect((await l.appendCorrection(bad)).outcome).toBe("refused");
    const first = await l.appendCorrection(c);
    expect(first.outcome).toBe("appended");
    expect(await l.appendCorrection(c)).toEqual({ ...first, outcome: "duplicate" });
    expect((await l.appendCorrection({ ...c, reason: "Changed reason" })).outcome).toBe("conflict");
    const retry = correction("supersede", "c1");
    retry.provenance.collector = "new";
    if (retry.action === "supersede") retry.replacement.provenance.collectorVersion = "new";
    expect(await l.appendCorrection(retry)).toEqual({ ...first, outcome: "duplicate" });
    expect(await l.readHistory()).toHaveLength(2);
  });
  it("rolls back an insert failure without consuming sequence; survives eviction and restart", async () => {
    let l = ledger();
    const first = await l.appendActivityEvent(event());
    await runInDurableObject(l, (_object, state) => {
      state.storage.sql.exec(
        "CREATE TRIGGER reject_insert BEFORE INSERT ON entries BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
      );
    });
    await fails(() => l.appendActivityEvent(event("two")));
    expect((await l.head())?.sequence).toBe(1);
    await runInDurableObject(l, (_object, state) => {
      state.storage.sql.exec("DROP TRIGGER reject_insert");
    });
    await evictDurableObject(l);
    expect(await l.appendActivityEvent(event())).toEqual({ ...first, outcome: "duplicate" });
    await abortAllDurableObjects();
    l = env.EVENT_LEDGER.get(l.id);
    expect((await l.appendActivityEvent({ ...event(), subject: "changed" })).outcome).toBe(
      "conflict",
    );
    expect(await l.appendActivityEvent(event("two"))).toMatchObject({
      outcome: "appended",
      receipt: { sequence: 2 },
    });
  });
  it.each(["UPDATE entries SET event_key='other'", "DELETE FROM entries"])(
    "refuses ordinary mutation: %s",
    async (sql) => {
      const l = ledger();
      await l.appendActivityEvent(event());
      await runInDurableObject(l, (_object, state) => {
        expect(() => state.storage.sql.exec(sql)).toThrow(/append-only/);
      });
    },
  );
  it("detects comparison digest poisoning before classifying or replaying", async () => {
    const l = ledger();
    await l.appendActivityEvent(event());
    await runInDurableObject(l, (_object, state) => {
      state.storage.sql.exec(
        "DROP TRIGGER entries_no_update; UPDATE entries SET comparison_digest='bad'",
      );
    });
    expect(verifyHistory(await l.readHistory())).toMatchObject({
      ok: false,
      failure: { reason: "comparison_digest_mismatch" },
    });
    await fails(() => l.appendActivityEvent(event()));
    expect(() => replayEffectiveHistory([])).not.toThrow();
    const corrupt = await l.readHistory();
    expect(() => replayEffectiveHistory(corrupt)).toThrow(EventLedgerIntegrityError);
  });
  it.each([
    "UPDATE entries SET sequence=3",
    "UPDATE entries SET previous_digest='bad'",
    "UPDATE entries SET event_key='bad'",
    "UPDATE entries SET entry_json='{}'",
  ])("detects corrupt stored columns: %s", async (sql) => {
    const l = ledger();
    await l.appendActivityEvent(event());
    await runInDurableObject(l, (_object, state) => {
      state.storage.sql.exec(`DROP TRIGGER entries_no_update; ${sql}`);
    });
    await fails(() => l.readHistory());
  });
  it("verifies sequence, links, format, digest and trusted heads", async () => {
    const l = ledger();
    await l.appendActivityEvent(event());
    await l.appendActivityEvent(event("two"));
    const history = await l.readHistory();
    const head = (await l.head())!;
    expect(verifyHistory(history, head)).toEqual({ ok: true });
    expect(verifyHistory(history.slice(0, 1))).toEqual({ ok: true });
    expect(verifyHistory(history.slice(0, 1), head)).toMatchObject({
      ok: false,
      failure: { reason: "trusted_head_mismatch" },
    });
    for (const patch of [
      { sequence: 3 },
      { previousDigest: "bad" },
      { entryDigest: "bad" },
      { formatVersion: 2 },
    ])
      expect(
        verifyHistory([{ ...history[0]!, ...patch } as (typeof history)[number]]),
      ).toMatchObject({ ok: false });
    const tampered = structuredClone(history);
    if (tampered[0]!.entryType === "activity_event") tampered[0]!.payload.subject = "changed";
    expect(verifyHistory(tampered)).toMatchObject({
      ok: false,
      failure: { reason: "entry_digest_mismatch" },
    });
    expect(() => replayEffectiveHistory(tampered)).toThrow(EventLedgerIntegrityError);
    expect(canonicalJson(entryBody(history[0]!))).not.toContain("entryDigest");
    expect(digest(entryBody(history[0]!))).toBe(history[0]!.entryDigest);
  });
  it("pages a fixed prefix through the client and detects deleted middle rows", async () => {
    const l = openEventLedger(env.EVENT_LEDGER);
    for (let i = 0; i < 1005; i++) await l.appendActivityEvent(event(String(i)));
    expect(await l.readHistory()).toHaveLength(1005);
    expect(await l.readHistory({ throughSequence: 2 })).toHaveLength(2);
    const stub = env.EVENT_LEDGER.get(env.EVENT_LEDGER.idFromName("event-ledger"));
    await runInDurableObject(stub, (_object, state) => {
      state.storage.sql.exec(
        "DROP TRIGGER entries_no_delete; DELETE FROM entries WHERE sequence=500",
      );
    });
    await fails(() => l.readHistory());
  });
});

it("refuses oversized payloads before allocation and lets the client recover after object abort", async () => {
  const l = ledger();
  expect(
    (await l.appendActivityEvent({ ...event(), data: { large: "x".repeat(1024 * 1024) } })).outcome,
  ).toBe("refused");
  expect(await l.head()).toBeNull();
  const client = openEventLedger(env.EVENT_LEDGER);
  const first = await client.appendActivityEvent(event("recovery"));
  await abortAllDurableObjects();
  expect(await client.appendActivityEvent(event("recovery"))).toEqual({
    ...first,
    outcome: "duplicate",
  });
});
it("detects deletion of a stored tail with a separately trusted head", async () => {
  const l = ledger();
  await l.appendActivityEvent(event());
  await l.appendActivityEvent(event("two"));
  const trusted = (await l.head())!;
  await runInDurableObject(l, (_object, state) => {
    state.storage.sql.exec("DROP TRIGGER entries_no_delete; DELETE FROM entries WHERE sequence=2");
  });
  const history = await l.readHistory();
  expect(verifyHistory(history)).toEqual({ ok: true });
  expect(verifyHistory(history, trusted)).toMatchObject({
    ok: false,
    failure: { reason: "trusted_head_mismatch" },
  });
  expect(() => replayEffectiveHistory(history, trusted)).toThrow(EventLedgerIntegrityError);
});

it("continues after a byte-limited page and verifies the complete chain", async () => {
  const stub = ledger();
  const namespace = { get: () => stub, idFromName: () => stub.id };
  const client = openEventLedger(namespace as unknown as typeof env.EVENT_LEDGER);
  for (let i = 0; i < 20; i++)
    expect(
      (
        await client.appendActivityEvent({
          ...event(`large-${i}`),
          data: { text: "x".repeat(900000) },
        })
      ).outcome,
    ).toBe("appended");
  const page = await stub.readHistory();
  expect(page.length).toBeGreaterThan(0);
  expect(page.length).toBeLessThan(20);
  const history = await client.readHistory();
  expect(history).toHaveLength(20);
  expect(verifyHistory(history, (await client.head())!)).toEqual({ ok: true });
}, 30000);
