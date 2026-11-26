import { describe, expect, it } from "vitest";
import {
  archiveBatch,
  expiryRisk,
  MAX_FILE_BYTES,
  parseBatch,
  restoreArchive,
  sha256,
} from "../src/index.js";
import type { ArchiveBatch, ArchivePolicy, ObjectStore } from "../src/index.js";

const now = "2026-11-21T12:00:00.000Z";
const later = "2026-11-21T13:00:00.000Z";
class MemoryStore implements ObjectStore {
  objects = new Map<string, Uint8Array>();
  writes = 0;
  failKey: string | null = null;
  read(key: string, maxBytes: number): Promise<Uint8Array | null> {
    const bytes = this.objects.get(key);
    if (bytes && bytes.byteLength > maxBytes) return Promise.reject(new Error("object_too_large"));
    return Promise.resolve(bytes ? new Uint8Array(bytes) : null);
  }
  create(key: string, bytes: Uint8Array): Promise<boolean> {
    if (this.failKey && key.endsWith(this.failKey)) return Promise.reject(new Error("interrupted"));
    if (this.objects.has(key)) return Promise.resolve(false);
    this.objects.set(key, new Uint8Array(bytes));
    this.writes++;
    return Promise.resolve(true);
  }
}
async function fixture() {
  const landing = new MemoryStore();
  const archive = new MemoryStore();
  const bytes = new TextEncoder().encode('{"id":"observation-1","status":"ok"}\n');
  const key = "exports/project-a/observations.jsonl";
  landing.objects.set(key, bytes);
  const batch: ArchiveBatch = {
    version: 1,
    environment: "staging",
    sourceProject: "project-a",
    sourceManifestDigest: "a".repeat(64),
    windowStart: now,
    windowEnd: later,
    policyVersion: "test-policy-v1",
    files: [{ key, sha256: await sha256(bytes), bytes: bytes.byteLength, rows: 1 }],
  };
  // Synthetic fixture policy only. Never a production sanitizer or native-format adapter.
  const policy: ArchivePolicy = {
    environment: "staging",
    sourceProject: "project-a",
    landingPrefix: "exports/project-a/",
    version: "test-policy-v1",
    inspect(bytes, rows) {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (text.includes("SECRET_CANARY")) throw new Error("privacy_rejected");
      const lines = text.trim().split("\n");
      if (lines.length !== rows) throw new Error("row_count_mismatch");
      for (const line of lines) JSON.parse(line);
      return Promise.resolve();
    },
  };
  return { landing, archive, batch, policy, key, bytes };
}
describe("bounded verified trace archive", () => {
  it("restores after landing deletion and retains honest coverage", async () => {
    const f = await fixture();
    const receipt = await archiveBatch(
      JSON.stringify(f.batch),
      f.policy,
      f.landing,
      f.archive,
      now,
    );
    expect(receipt.sourceCoverage).toBe("unknown");
    expect(receipt.ledgerStatus).toBe("pending");
    f.landing.objects.clear();
    const restored = await restoreArchive(receipt.batchDigest, f.policy, f.archive);
    expect(restored.files).toEqual([f.bytes]);
  });
  it("concurrent retry preserves the first receipt and writes no extra objects", async () => {
    const f = await fixture();
    const json = JSON.stringify(f.batch);
    const receipts = await Promise.all([
      archiveBatch(json, f.policy, f.landing, f.archive, now),
      archiveBatch(json, f.policy, f.landing, f.archive, later),
    ]);
    expect(receipts[0]).toEqual(receipts[1]);
    expect(f.archive.writes).toBe(3);
    expect(await archiveBatch(json, f.policy, f.landing, f.archive, later)).toEqual(receipts[0]);
    expect(f.archive.writes).toBe(3);
  });
  it("recovers an interrupted manifest write without rewriting content", async () => {
    const f = await fixture();
    f.archive.failKey = "manifest.json";
    await expect(
      archiveBatch(JSON.stringify(f.batch), f.policy, f.landing, f.archive, now),
    ).rejects.toThrow("interrupted");
    expect(f.archive.writes).toBe(1);
    f.archive.failKey = null;
    await archiveBatch(JSON.stringify(f.batch), f.policy, f.landing, f.archive, later);
    expect(f.archive.writes).toBe(3);
  });
  it("does not promote any files if a later file is missing", async () => {
    const f = await fixture();
    f.batch.files.push({ ...f.batch.files[0]!, key: "exports/project-a/z-missing.jsonl" });
    await expect(
      archiveBatch(JSON.stringify(f.batch), f.policy, f.landing, f.archive, now),
    ).rejects.toThrow("missing_object");
    expect(f.archive.writes).toBe(0);
  });
  it("rejects tampering before promotion", async () => {
    const f = await fixture();
    f.landing.objects.set(f.key, new TextEncoder().encode("corrupt"));
    await expect(
      archiveBatch(JSON.stringify(f.batch), f.policy, f.landing, f.archive, now),
    ).rejects.toThrow("integrity_mismatch");
    expect(f.archive.writes).toBe(0);
  });
  it("refuses corrupted stored content without overwrite on retry or restore", async () => {
    const f = await fixture();
    const json = JSON.stringify(f.batch);
    const receipt = await archiveBatch(json, f.policy, f.landing, f.archive, now);
    const object = [...f.archive.objects.keys()].find((k) => k.includes("/objects/"))!;
    f.archive.objects.set(object, new Uint8Array([0]));
    await expect(archiveBatch(json, f.policy, f.landing, f.archive, later)).rejects.toThrow(
      "integrity_mismatch",
    );
    await expect(restoreArchive(receipt.batchDigest, f.policy, f.archive)).rejects.toThrow(
      "integrity_mismatch",
    );
    expect(f.archive.writes).toBe(3);
  });
  it("blocks a privacy canary even when byte hashes match", async () => {
    const f = await fixture();
    const bytes = new TextEncoder().encode('{"id":"SECRET_CANARY"}\n');
    f.landing.objects.set(f.key, bytes);
    f.batch.files[0] = {
      key: f.key,
      bytes: bytes.byteLength,
      sha256: await sha256(bytes),
      rows: 1,
    };
    await expect(
      archiveBatch(JSON.stringify(f.batch), f.policy, f.landing, f.archive, now),
    ).rejects.toThrow("privacy_rejected");
    expect(f.archive.writes).toBe(0);
  });
  it("rejects incorrect row counts", async () => {
    const f = await fixture();
    f.batch.files[0]!.rows = 2;
    await expect(
      archiveBatch(JSON.stringify(f.batch), f.policy, f.landing, f.archive, now),
    ).rejects.toThrow("row_count_mismatch");
    expect(f.archive.writes).toBe(0);
  });
  it.each([
    "../private",
    "exports/project-a/../other/file",
    "exports/project-ab/file",
    "exports/project-a/%2e%2e/file",
    "/exports/project-a/file",
  ])("rejects unsafe key %s", async (key) => {
    const f = await fixture();
    f.batch.files[0]!.key = key;
    expect(() => parseBatch(JSON.stringify(f.batch), f.policy)).toThrow("invalid_file");
  });
  it("rejects cross-project, environment and policy substitution", async () => {
    const f = await fixture();
    for (const replacement of [
      { sourceProject: "other" },
      { environment: "production" },
      { policyVersion: "other" },
    ])
      expect(() => parseBatch(JSON.stringify({ ...f.batch, ...replacement }), f.policy)).toThrow(
        "scope_or_policy_mismatch",
      );
  });
  it("rejects duplicate keys, oversized files and unknown fields", async () => {
    const f = await fixture();
    expect(() =>
      parseBatch(
        JSON.stringify({ ...f.batch, files: [...f.batch.files, ...f.batch.files] }),
        f.policy,
      ),
    ).toThrow("invalid_file");
    expect(() => parseBatch(JSON.stringify({ ...f.batch, secret: "extra" }), f.policy)).toThrow(
      "invalid_contract",
    );
    f.batch.files[0]!.bytes = MAX_FILE_BYTES + 1;
    expect(() => parseBatch(JSON.stringify(f.batch), f.policy)).toThrow("invalid_file");
  });
});
describe("source expiry", () => {
  it("does not infer safety without a known expiry", () =>
    expect(expiryRisk(now, null)).toBe("unknown"));
  it.each([
    ["2026-11-21T11:00:00.000Z", "expired"],
    ["2026-11-22T12:00:00.000Z", "urgent"],
    ["2026-11-25T12:00:00.000Z", "incident"],
    ["2026-11-29T12:00:00.000Z", "normal"],
  ])("classifies %s as %s", (expiry, result) => expect(expiryRisk(now, expiry)).toBe(result));
  it("rejects malformed dates rather than treating them as safe", () => {
    expect(() => expiryRisk(now, "invalid")).toThrow("invalid_timestamp");
    expect(() => expiryRisk(now, "2026-02-30T00:00:00.000Z")).toThrow("invalid_timestamp");
  });
});
