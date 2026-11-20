import { env } from "cloudflare:workers";
import { abortAllDurableObjects, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { event } from "./fixture.js";
import { canonicalJson, digest, entryBody, comparisonDigest } from "../src/canonical.js";
import {
  createLedgerArchive,
  verifyLedgerArchive,
  MAX_LEDGER_ARCHIVE_BYTES,
} from "../src/archive.js";
import { replayEffectiveHistory, verifyHistory } from "../src/history.js";
import type { LedgerArchive, LedgerEntry, LedgerRecoveryRpc } from "../src/index.js";
import type { LedgerRpc } from "../src/client.js";
import {
  runLedgerRecovery,
  parseLedgerRecoveryParams,
  type LedgerBackupPort,
} from "../src/recovery-runner.js";
import recoveryWorker from "../src/recovery-workflow.js";
import { ledgerRpcData } from "../src/rpc-data.js";

function ledger(id = env.EVENT_LEDGER.newUniqueId()) {
  // Match the explicit JSON wire contract used by the existing ledger client.
  return env.EVENT_LEDGER.get(id) as unknown as DurableObjectStub & LedgerRpc & LedgerRecoveryRpc;
}
async function refusal(operation: () => Promise<unknown>, message?: string) {
  let error: unknown;
  try {
    await operation();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(Error);
  if (message) expect((error as Error).message).toContain(message);
}
async function source() {
  const store = ledger();
  const original = event();
  const first = await store.appendActivityEvent(original);
  const supersede = {
    contract: "home.correction/v1",
    correctionId: "restore-c1",
    action: "supersede",
    targetEventKey: original.eventKey,
    reason: "Reviewed synthetic evidence",
    provenance: original.provenance,
    replacement: { ...original, subject: "Corrected" },
  };
  const correction = await store.appendCorrection(supersede);
  await store.appendCorrection({
    ...supersede,
    correctionId: "restore-c2",
    replacement: { ...original, subject: "Final" },
  });
  const head = ledgerRpcData(await store.head());
  const archive = ledgerRpcData(await store.exportArchive(head));
  return { store, first, supersede, correction, head, archive };
}
function reseal(archive: LedgerArchive) {
  const { version, head, entries } = archive;
  archive.digest = digest({ version, head, entries });
  return archive;
}

it("restores every original entry, receipt and Correction across restart and continues the chain", async () => {
  const s = await source();
  let target = ledger();
  expect(await target.restoreArchive(s.archive, s.head, s.archive.digest)).toEqual({
    head: s.head,
    entries: 3,
    digest: s.archive.digest,
  });
  await abortAllDurableObjects();
  target = ledger(target.id);
  const restored = await target.exportArchive(s.head);
  expect(restored).toEqual(s.archive);
  expect(await target.appendActivityEvent(event())).toEqual({ ...s.first, outcome: "duplicate" });
  expect(await target.appendCorrection(s.supersede)).toEqual({
    ...s.correction,
    outcome: "duplicate",
  });
  expect((await target.appendActivityEvent({ ...event(), subject: "Different" })).outcome).toBe(
    "conflict",
  );
  expect(replayEffectiveHistory(restored.entries, s.head!)[0]!.subject).toBe("Final");
  expect(await target.appendActivityEvent(event("after-restore"))).toMatchObject({
    outcome: "appended",
    receipt: { sequence: 4 },
  });
  const history = await target.readHistory();
  expect(history[3]!.previousDigest).toBe(s.head!.entryDigest);
  expect(verifyHistory(history, (await target.head())!)).toEqual({ ok: true });
  expect(await ledger(s.store.id).exportArchive(s.head)).toEqual(s.archive);
});

it("requires an explicit trusted empty head and never accepts a nonempty history as empty", async () => {
  const empty = ledger(),
    target = ledger();
  const archive = await empty.exportArchive(null);
  expect(archive.entries).toEqual([]);
  expect(archive.head).toBeNull();
  expect(await target.restoreArchive(archive, null, archive.digest)).toEqual({
    head: null,
    entries: 0,
    digest: archive.digest,
  });
  expect(await target.head()).toBeNull();
  const s = await source();
  await refusal(async () => s.store.exportArchive(null));
  expect(() => verifyLedgerArchive(s.archive, null, s.archive.digest)).toThrow();
  expect(() => createLedgerArchive([], undefined as never)).toThrow();
});

it("refuses malformed fields, altered entries, digests and independently wrong heads before writing", async () => {
  const s = await source();
  const cases: unknown[] = [
    null,
    {},
    { ...s.archive, version: 2 },
    { ...s.archive, extra: true },
    { ...s.archive, digest: "0".repeat(64) },
    { ...s.archive, head: { ...s.head, extra: true } },
    {
      ...s.archive,
      entries: [{ ...s.archive.entries[0], extra: true }, ...s.archive.entries.slice(1)],
    },
    { ...s.archive, entries: s.archive.entries.slice(1) },
  ];
  const changed = structuredClone(s.archive);
  changed.entries[0]!.payload.provenance.collector = "tampered";
  cases.push(reseal(changed));
  for (const input of cases) {
    const target = ledger();
    await refusal(async () => target.restoreArchive(input, s.head, s.archive.digest));
    expect(await target.head()).toBeNull();
  }
  const target = ledger();
  await refusal(
    async () => target.restoreArchive(s.archive, s.head, "0".repeat(64)),
    "ledger_archive_digest_mismatch",
  );
  await refusal(
    async () =>
      target.restoreArchive(
        s.archive,
        { ...s.head!, entryDigest: "0".repeat(64) },
        s.archive.digest,
      ),
    "ledger_archive_head_mismatch",
  );
  expect(await target.head()).toBeNull();
});

it("refuses a truncated but internally valid archive against the independently retained head", async () => {
  const s = await source(),
    target = ledger();
  const first = s.archive.entries[0]!;
  const truncated = createLedgerArchive([first], { sequence: 1, entryDigest: first.entryDigest });
  await refusal(
    async () => target.restoreArchive(truncated, s.head, truncated.digest),
    "ledger_archive_head_mismatch",
  );
  expect(await target.head()).toBeNull();
});

it("rejects a hash-consistent Correction with no earlier target", async () => {
  const s = await source(),
    target = ledger();
  const entry = structuredClone<LedgerEntry>(s.archive.entries[1]!);
  entry.sequence = 1;
  entry.previousDigest = null;
  entry.entryDigest = digest(entryBody(entry));
  const archive = reseal({
    version: 1,
    head: { sequence: 1, entryDigest: entry.entryDigest },
    entries: [entry],
    digest: "",
  });
  await refusal(
    async () => target.restoreArchive(archive, archive.head, archive.digest),
    "invalid_payload",
  );
  expect(await target.head()).toBeNull();
});

it("refuses occupied targets even when history is identical or its Projection is empty", async () => {
  const s = await source(),
    target = ledger();
  await target.restoreArchive(s.archive, s.head, s.archive.digest);
  await refusal(
    async () => target.restoreArchive(s.archive, s.head, s.archive.digest),
    "restore_target_not_empty",
  );
  await target.appendCorrection({
    contract: "home.correction/v1",
    correctionId: "retract-all",
    targetEventKey: event().eventKey,
    action: "retract",
    reason: "Synthetic withdrawal",
    provenance: event().provenance,
  });
  const head = await target.head(),
    before = await target.exportArchive(head);
  expect(replayEffectiveHistory(before.entries)).toEqual([]);
  await refusal(
    async () => target.restoreArchive(s.archive, s.head, s.archive.digest),
    "restore_target_not_empty",
  );
  expect(await target.exportArchive(head)).toEqual(before);
});

it("rolls back the complete import when a later insert fails", async () => {
  const s = await source(),
    target = ledger();
  await runInDurableObject(target, (_object, state) => {
    state.storage.sql.exec(
      "CREATE TRIGGER fail_restore AFTER INSERT ON entries WHEN NEW.sequence=2 BEGIN SELECT RAISE(ABORT, 'injected restore failure'); END;",
    );
  });
  await refusal(
    async () => target.restoreArchive(s.archive, s.head, s.archive.digest),
    "injected restore failure",
  );
  expect(await target.head()).toBeNull();
  expect(await target.readHistory()).toEqual([]);
  await runInDurableObject(target, (_object, state) => {
    state.storage.sql.exec("DROP TRIGGER fail_restore");
  });
  await target.restoreArchive(s.archive, s.head, s.archive.digest);
  expect(await target.exportArchive(s.head)).toEqual(s.archive);
});

it("allows one of two concurrent restores and never overwrites its winner", async () => {
  const s = await source(),
    target = ledger();
  const restore = async () => {
    try {
      await target.restoreArchive(s.archive, s.head, s.archive.digest);
      return "restored";
    } catch {
      return "refused";
    }
  };
  expect((await Promise.all([restore(), restore()])).sort()).toEqual(["refused", "restored"]);
  expect(await target.exportArchive(s.head)).toEqual(s.archive);
});

it("serializes restore with an ordinary append without mixing partial histories", async () => {
  const s = await source();
  for (let i = 0; i < 4; i++) {
    const target = ledger();
    const restore = async () => {
      try {
        await target.restoreArchive(s.archive, s.head, s.archive.digest);
        return true;
      } catch {
        return false;
      }
    };
    const append = async () => target.appendActivityEvent(event("racing"));
    const results =
      i % 2 ? await Promise.all([append(), restore()]) : await Promise.all([restore(), append()]);
    const restored = results.includes(true);
    const history = await target.readHistory();
    expect(history).toHaveLength(restored ? 4 : 1);
    expect(verifyHistory(history, (await target.head())!)).toEqual({ ok: true });
    if (restored) expect(history.slice(0, 3)).toEqual(s.archive.entries);
  }
});

it("refuses corrupt source metadata, deleted history and a changed source head", async () => {
  const s = await source();
  await s.store.appendActivityEvent(event("newer"));
  await refusal(async () => s.store.exportArchive(s.head), "trusted_head_mismatch");
  for (const sql of [
    "UPDATE entries SET comparison_digest='bad' WHERE sequence=1",
    "DELETE FROM entries WHERE sequence=2",
    "DELETE FROM entries WHERE sequence=3",
  ]) {
    const corrupt = await source();
    await runInDurableObject(corrupt.store, (_object, state) => {
      state.storage.sql.exec("DROP TRIGGER entries_no_update; DROP TRIGGER entries_no_delete;");
      state.storage.sql.exec(sql);
    });
    await refusal(async () => corrupt.store.exportArchive(corrupt.head));
  }
});

it("refuses oversized imports and exports rather than producing a partial archive", async () => {
  const s = await source(),
    target = ledger();
  await refusal(
    async () =>
      target.restoreArchive(
        { ...s.archive, padding: "x".repeat(MAX_LEDGER_ARCHIVE_BYTES) },
        s.head,
        s.archive.digest,
      ),
    "ledger_archive_too_large",
  );
  expect(await target.head()).toBeNull();
  const large = ledger();
  for (let i = 0; i < 5; i++)
    expect(
      (
        await large.appendActivityEvent({
          ...event(`large-${i}`),
          data: { text: "x".repeat(900000) },
        })
      ).outcome,
    ).toBe("appended");
  await refusal(async () => large.exportArchive(await large.head()), "ledger_archive_too_large");
  const many = ledger();
  for (let i = 0; i < 1001; i++) await many.appendActivityEvent(event(`many-${i}`));
  await refusal(async () => many.exportArchive(await many.head()), "ledger_archive_too_large");
  expect(() =>
    createLedgerArchive(
      Array.from({ length: 1001 }, () => s.archive.entries[0]!),
      s.head,
    ),
  ).toThrow("ledger_archive_too_large");
}, 30000);

it("rejects oversized but otherwise valid payloads and non-JSON input", async () => {
  const s = await source(),
    target = ledger();
  const entry = structuredClone<LedgerEntry>(s.archive.entries[0]!);
  if (entry.entryType === "activity_event") entry.payload.data = { text: "x".repeat(1024 * 1024) };
  entry.entryDigest = digest(entryBody(entry));
  entry.comparisonDigest = comparisonDigest(entry.payload);
  const archive = reseal({
    version: 1,
    head: { sequence: 1, entryDigest: entry.entryDigest },
    entries: [entry],
    digest: "",
  });
  await refusal(
    async () => target.restoreArchive(archive, archive.head, archive.digest),
    "ledger_archive_payload_too_large",
  );
  expect(() =>
    verifyLedgerArchive({ ...s.archive, extra: undefined }, s.head, s.archive.digest),
  ).toThrow();
  expect(() =>
    verifyLedgerArchive(
      {
        ...s.archive,
        get digest() {
          throw new Error("getter executed");
        },
      },
      s.head,
      s.archive.digest,
    ),
  ).toThrow("JSON requires enumerable data properties");
  expect(await target.head()).toBeNull();
  expect(canonicalJson(s.archive)).not.toContain("undefined");
});

async function drill() {
  const s = await source(),
    target = ledger(),
    backups = new Map<string, LedgerArchive>();
  const backup: LedgerBackupPort = {
    load: (key) => Promise.resolve(structuredClone(backups.get(key) ?? null)),
    saveIfAbsent: (key, value) => {
      if (!backups.has(key)) backups.set(key, structuredClone(value));
      return Promise.resolve();
    },
  };
  return {
    ...s,
    target,
    backups,
    backup,
    params: {
      drillId: "synthetic-ledger",
      expectedHead: s.head,
      expectedDigest: s.archive.digest,
      mode: "restore" as const,
    },
  };
}
it("backs up before restore, verifies an identical retry and supports a separate read-only verification", async () => {
  const d = await drill();
  const receipt = await runLedgerRecovery(d.params, d.store, d.target, d.backup);
  expect(receipt).toEqual({
    outcome: "verified",
    archiveKey: "event-ledger/synthetic-ledger.json",
    head: d.head,
    digest: d.archive.digest,
    entries: 3,
    mode: "restore",
  });
  expect(d.backups.get(receipt.archiveKey)).toEqual(d.archive);
  expect(await runLedgerRecovery(d.params, d.store, d.target, d.backup)).toEqual(receipt);
  expect(
    await runLedgerRecovery({ ...d.params, mode: "verify" }, d.store, d.target, d.backup),
  ).toEqual({ ...receipt, mode: "verify" });
  expect(await d.store.exportArchive(d.head)).toEqual(d.archive);
  expect(JSON.stringify(receipt)).not.toContain("synthetic-account");
  expect(JSON.stringify(receipt)).not.toContain("payload");
});
it("stops before restore on failed backup storage or a corrupt existing backup", async () => {
  const d = await drill();
  await refusal(
    () =>
      runLedgerRecovery(d.params, d.store, d.target, {
        ...d.backup,
        saveIfAbsent: () => Promise.reject(new Error("backup_unavailable")),
      }),
    "backup_unavailable",
  );
  expect(await d.target.head()).toBeNull();
  d.backups.set("event-ledger/synthetic-ledger.json", { ...d.archive, digest: "0".repeat(64) });
  await refusal(
    () => runLedgerRecovery(d.params, d.store, d.target, d.backup),
    "ledger_archive_digest_mismatch",
  );
  expect(await d.target.head()).toBeNull();
  expect(d.backups.get("event-ledger/synthetic-ledger.json")!.digest).toBe("0".repeat(64));
});
it("verify-only never creates a missing backup or recovery history", async () => {
  const d = await drill(),
    params = { ...d.params, mode: "verify" };
  await refusal(
    () => runLedgerRecovery(params, d.store, d.target, d.backup),
    "ledger_recovery_backup_missing",
  );
  expect(d.backups.size).toBe(0);
  d.backups.set("event-ledger/synthetic-ledger.json", d.archive);
  await refusal(
    () => runLedgerRecovery(params, d.store, d.target, d.backup),
    "ledger_recovery_target_missing",
  );
  expect(await d.target.head()).toBeNull();
});
it("refuses a different occupied target and wrong independently retained evidence", async () => {
  const d = await drill();
  await d.target.appendActivityEvent(event("other"));
  const head = await d.target.head(),
    before = await d.target.exportArchive(head);
  await refusal(
    () => runLedgerRecovery(d.params, d.store, d.target, d.backup),
    "restore_target_not_empty",
  );
  expect(await d.target.exportArchive(head)).toEqual(before);
  await refusal(
    () =>
      runLedgerRecovery(
        { ...d.params, expectedDigest: "0".repeat(64) },
        d.store,
        d.target,
        d.backup,
      ),
    "ledger_archive_digest_mismatch",
  );
  expect(await d.store.exportArchive(d.head)).toEqual(d.archive);
});
it("detects a source change during recovery without rewriting either history", async () => {
  const d = await drill();
  const backup: LedgerBackupPort = {
    ...d.backup,
    saveIfAbsent: async (key, value) => {
      await d.backup.saveIfAbsent(key, value);
      await d.store.appendActivityEvent(event("source-changed"));
    },
  };
  await refusal(
    () => runLedgerRecovery(d.params, d.store, d.target, backup),
    "trusted_head_mismatch",
  );
  expect(await d.target.exportArchive(d.head)).toEqual(d.archive);
  expect((await d.store.head())!.sequence).toBe(4);
});
it("bounds runner parameters and never exposes an HTTP recovery operation", () => {
  for (const drillId of ["../live", "", "x".repeat(81), 123])
    expect(() =>
      parseLedgerRecoveryParams({
        drillId,
        expectedHead: null,
        expectedDigest: "a".repeat(64),
        mode: "restore",
      }),
    ).toThrow("invalid_ledger_recovery_parameters");
  expect(() =>
    parseLedgerRecoveryParams({ drillId: "test", expectedDigest: "a".repeat(64), mode: "restore" }),
  ).toThrow();
  expect(recoveryWorker.fetch().status).toBe(404);
});

it("detaches only documented RPC metadata while retaining strict rejection of arbitrary symbols and getters", async () => {
  const s = await source();
  const raw = await s.store.exportArchive(s.head);
  expect(Reflect.ownKeys(raw)).toContain(Symbol.dispose);
  expect(() => canonicalJson(raw)).toThrow("JSON does not support symbol keys");
  expect(verifyLedgerArchive(ledgerRpcData(raw), s.head, s.archive.digest)).toEqual(s.archive);
  const symbol = Symbol("untrusted");
  expect(() => canonicalJson(ledgerRpcData({ ...raw, [symbol]: "bad" }))).toThrow(
    "JSON does not support symbol keys",
  );
  let called = false;
  const getter = {
    ...raw,
    get extra() {
      called = true;
      return "bad";
    },
  };
  expect(() => canonicalJson(ledgerRpcData(getter))).toThrow(
    "JSON requires enumerable data properties",
  );
  expect(called).toBe(false);
});
