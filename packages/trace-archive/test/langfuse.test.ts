import { expect, it } from "vitest";
import { normalizeLangfuseManifest } from "../src/langfuse.js";
import type { LangfuseSource } from "../src/langfuse.js";
import { collectTracePage } from "../src/collector.js";
import type { ScanJournal } from "../src/collector.js";
import { archiveBatch } from "../src/index.js";
import type { ObjectStore } from "../src/index.js";

const now = "2026-11-21T01:00:00.000Z";
const key = "export/project-a/manifests/2026-11-21T01-00-00.json";
const dataKey = "export/project-a/observations_v2/2026-11-21T01-00-00.jsonl";
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
class Store implements ObjectStore {
  data = new Map<string, Uint8Array>();
  async read(key: string, limit: number) {
    const bytes = this.data.get(key);
    if (bytes && bytes.byteLength > limit) throw new Error("oversize");
    return Promise.resolve(bytes ?? null);
  }
  create(key: string, bytes: Uint8Array) {
    if (this.data.has(key)) return Promise.resolve(false);
    this.data.set(key, bytes);
    return Promise.resolve(true);
  }
}
function fixture() {
  const landing = new Store(),
    archive = new Store();
  const row = { project_id: "project-a", id: "observation-a", trace_id: "trace-a" };
  const data = new TextEncoder().encode(JSON.stringify(row) + "\n");
  const manifest = {
    version: 1,
    projectId: "project-a",
    exportSource: "EVENTS",
    window: { minTimestamp: "2026-11-21T00:00:00.000Z", maxTimestamp: now },
    maxTimestamp: now,
    createdAt: now,
    tables: ["observations_v2"],
    files: [
      {
        key: dataKey,
        table: "observations_v2",
        fileType: "JSONL",
        format: "jsonl-raw",
        compressed: false,
        contentType: "application/x-ndjson; charset=utf-8",
        sizeBytes: data.length,
        rowCount: 1,
      },
    ],
  };
  const source: LangfuseSource = {
    projectId: "project-a",
    prefix: "export/",
    policy: {
      environment: "staging",
      sourceProject: "homer",
      landingPrefix: "export/project-a/",
      version: "synthetic-v1",
      inspect: () => Promise.resolve(), // Fixture only; never a production policy.
    },
  };
  landing.data.set(dataKey, data);
  landing.data.set(key, encode(manifest));
  return { landing, archive, source, manifest };
}
it("normalizes a pinned native EVENTS manifest and tolerates additive fields", async () => {
  const f = fixture();
  f.landing.data.set(key, encode({ ...f.manifest, additive: "ignored" }));
  const normalized = await normalizeLangfuseManifest(key, f.source, f.landing);
  expect(normalized.batch.files[0]).toMatchObject({ key: dataKey, rows: 1 });
  const receipt = await archiveBatch(normalized.json, f.source.policy, f.landing, f.archive, now);
  expect(receipt.sourceCoverage).toBe("unknown");
});
it("archives an empty native batch without claiming source coverage", async () => {
  const f = fixture();
  f.manifest.files = [];
  f.manifest.tables = [];
  f.landing.data.set(key, encode(f.manifest));
  const normalized = await normalizeLangfuseManifest(key, f.source, f.landing);
  expect(
    (await archiveBatch(normalized.json, f.source.policy, f.landing, f.archive, now))
      .sourceCoverage,
  ).toBe("unknown");
});
it("supports zero-byte JSONL files only with a zero row count", async () => {
  const f = fixture();
  f.manifest.files[0]!.sizeBytes = 0;
  f.manifest.files[0]!.rowCount = 0;
  f.landing.data.set(dataKey, new Uint8Array());
  f.landing.data.set(key, encode(f.manifest));
  const normalized = await normalizeLangfuseManifest(key, f.source, f.landing);
  await archiveBatch(normalized.json, f.source.policy, f.landing, f.archive, now);
});
it.each([{ version: 2 }, { exportSource: "TRACES_OBSERVATIONS" }, { projectId: "other" }])(
  "rejects unsupported source %j",
  async (change) => {
    const f = fixture();
    f.landing.data.set(key, encode({ ...f.manifest, ...change }));
    await expect(normalizeLangfuseManifest(key, f.source, f.landing)).rejects.toThrow(
      "unsupported_native_manifest",
    );
  },
);
it.each([
  { compressed: true },
  { fileType: "PARQUET" },
  { format: "json" },
  { rowCount: null },
  { key: "export/project-a/observations_v2/../scores/file.jsonl" },
  { key: "export/project-b/observations_v2/file.jsonl" },
])("rejects unsupported file %j", async (change) => {
  const f = fixture();
  f.landing.data.set(
    key,
    encode({ ...f.manifest, files: [{ ...f.manifest.files[0], ...change }] }),
  );
  await expect(normalizeLangfuseManifest(key, f.source, f.landing)).rejects.toThrow(
    "unsupported_native_file",
  );
});
it("rejects row count drift and cross-project row injection", async () => {
  const f = fixture();
  const injected = new TextEncoder().encode('{"id":"test","project_id":"other"}\n');
  f.landing.data.set(dataKey, injected);
  f.manifest.files[0]!.sizeBytes = injected.length;
  f.landing.data.set(key, encode(f.manifest));
  await expect(normalizeLangfuseManifest(key, f.source, f.landing)).rejects.toThrow(
    "native_row_scope_mismatch",
  );
  f.manifest.files[0]!.rowCount = 2;
  f.landing.data.set(key, encode(f.manifest));
  await expect(normalizeLangfuseManifest(key, f.source, f.landing)).rejects.toThrow(
    "native_row_count_mismatch",
  );
});
it("refuses a completion manifest that changes while files are read", async () => {
  const f = fixture();
  let reads = 0;
  const changing: ObjectStore = {
    create: f.landing.create.bind(f.landing),
    read: async (k, max) => {
      if (k === key && ++reads > 1)
        return encode({ ...f.manifest, createdAt: "2026-11-21T02:00:00.000Z" });
      return f.landing.read(k, max);
    },
  };
  await expect(normalizeLangfuseManifest(key, f.source, changing)).rejects.toThrow(
    "native_manifest_changed",
  );
});
it("persists failure before checkpointing and revisits the manifest on the next scan", async () => {
  const f = fixture();
  f.landing.data.delete(dataKey);
  const records: string[] = [];
  const journal: ScanJournal = {
    read: () => Promise.resolve({ revision: 0, cursor: null }),
    advance: () => {
      records.push("checkpoint");
      return Promise.resolve(true);
    },
    record: (r) => {
      records.push(r.outcome);
      return Promise.resolve();
    },
  };
  const list = { list: () => Promise.resolve({ keys: [key], cursor: null }) };
  expect(await collectTracePage(f.source, f.landing, f.archive, list, journal, now)).toMatchObject({
    failed: 1,
    sourceCoverage: "unknown",
  });
  expect(records).toEqual(["failed", "checkpoint"]);
  const good = fixture();
  f.landing.data.set(dataKey, good.landing.data.get(dataKey)!);
  expect(await collectTracePage(f.source, f.landing, f.archive, list, journal, now)).toMatchObject({
    verified: 1,
  });
});
it("does not checkpoint after journal failure or silently overwrite a lost cursor lease", async () => {
  const f = fixture();
  let advanced = false;
  const journal: ScanJournal = {
    read: () => Promise.resolve({ revision: 2, cursor: null }),
    advance: () => {
      advanced = true;
      return Promise.resolve(false);
    },
    record: () => Promise.reject(new Error("journal_unavailable")),
  };
  const list = { list: () => Promise.resolve({ keys: [key], cursor: null }) };
  await expect(
    collectTracePage(f.source, f.landing, f.archive, list, journal, now),
  ).rejects.toThrow("journal_unavailable");
  expect(advanced).toBe(false);
  journal.record = () => Promise.resolve();
  expect(await collectTracePage(f.source, f.landing, f.archive, list, journal, now)).toMatchObject({
    checkpointed: false,
  });
});
