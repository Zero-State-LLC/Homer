import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import migration from "../migrations/0001_scan.sql?raw";
import { d1Journal } from "../src/journal.js";
import { traceArchiveWorker } from "../src/scheduled.js";
import { r2Store } from "../src/r2.js";
import { archiveBatch, restoreArchive, sha256 } from "../src/index.js";
import type { ArchivePolicy } from "../src/index.js";

const buckets = env as unknown as {
  TRACE_TEST_LANDING: R2Bucket;
  TRACE_TEST_ARCHIVE: R2Bucket;
  TRACE_INDEX: D1Database;
};
beforeAll(async () => {
  for (const sql of migration
    .replace(/^--.*$/gm, "")
    .split(";")
    .filter((s) => s.trim()))
    await buckets.TRACE_INDEX.prepare(sql).run();
});
it("D1 prevents a stale scan from overwriting the discovery cursor", async () => {
  const journal = d1Journal(buckets.TRACE_INDEX, "c".repeat(64));
  const first = await journal.read();
  expect(await journal.advance(first.revision, "page-two")).toBe(true);
  expect(await journal.advance(first.revision, "stale-cursor")).toBe(false);
  expect(await journal.read()).toEqual({ revision: 1, cursor: "page-two" });
});
it("scheduled processing is off by default and exposes no HTTP route", async () => {
  let loaded = false;
  const worker = traceArchiveWorker(() => {
    loaded = true;
    throw new Error("must_not_load");
  });
  await worker.scheduled({} as ScheduledController, {
    TRACE_LANDING: buckets.TRACE_TEST_LANDING,
    TRACE_ARCHIVE: buckets.TRACE_TEST_ARCHIVE,
    TRACE_INDEX: buckets.TRACE_INDEX,
  });
  expect(loaded).toBe(false);
  expect(worker.fetch().status).toBe(404);
});
it("scheduled R2 discovery records the native batch in D1 and wraps the cursor", async () => {
  const sourceProject = "scheduled-test";
  const prefix = `schedule/${sourceProject}/`;
  const dataKey = `${prefix}observations_v2/2026-11-21T01-00-00.jsonl`;
  const data = '{"project_id":"scheduled-test","id":"synthetic"}\n';
  await buckets.TRACE_TEST_LANDING.put(dataKey, data);
  await buckets.TRACE_TEST_LANDING.put(
    `${prefix}manifests/2026-11-21T01-00-00.json`,
    JSON.stringify({
      version: 1,
      projectId: sourceProject,
      exportSource: "EVENTS",
      createdAt: "2026-11-21T01:01:00.000Z",
      maxTimestamp: "2026-11-21T01:00:00.000Z",
      window: {
        minTimestamp: "2026-11-21T00:00:00.000Z",
        maxTimestamp: "2026-11-21T01:00:00.000Z",
      },
      tables: ["observations_v2"],
      files: [
        {
          key: dataKey,
          table: "observations_v2",
          fileType: "JSONL",
          format: "jsonl-raw",
          compressed: false,
          contentType: "application/x-ndjson; charset=utf-8",
          sizeBytes: new TextEncoder().encode(data).length,
          rowCount: 1,
        },
      ],
    }),
  );
  const worker = traceArchiveWorker(() =>
    Promise.resolve({
      projectId: sourceProject,
      prefix: "schedule/",
      policy: {
        environment: "staging",
        sourceProject,
        landingPrefix: prefix,
        version: "synthetic-v1",
        inspect: (bytes, count) => {
          expect(new TextDecoder().decode(bytes)).toBe(data);
          expect(count).toBe(1);
          return Promise.resolve();
        },
      },
    }),
  );
  const bindings = {
    TRACE_LANDING: buckets.TRACE_TEST_LANDING,
    TRACE_ARCHIVE: buckets.TRACE_TEST_ARCHIVE,
    TRACE_INDEX: buckets.TRACE_INDEX,
    TRACE_ARCHIVE_ENABLED: "true",
  };
  await worker.scheduled({} as ScheduledController, bindings);
  await worker.scheduled({} as ScheduledController, bindings);
  const rows = await buckets.TRACE_INDEX.prepare(
    "SELECT receipt FROM trace_attempt WHERE outcome = 'verified'",
  ).all<{ receipt: string }>();
  expect(rows.results).toHaveLength(2);
  expect(rows.results[0]!.receipt).toBe(rows.results[1]!.receipt);
  const receipt = JSON.parse(rows.results[0]!.receipt) as {
    sourceCoverage: string;
    ledgerStatus: string;
  };
  expect(receipt.sourceCoverage).toBe("unknown");
  expect(receipt.ledgerStatus).toBe("pending");
});
it("R2 conditional creation never overwrites, and bounded reads reject oversize objects", async () => {
  const store = r2Store(buckets.TRACE_TEST_ARCHIVE);
  const key = crypto.randomUUID();
  const original = new Uint8Array([1, 2]);
  expect(await store.create(key, original)).toBe(true);
  expect(await store.create(key, new Uint8Array([9]))).toBe(false);
  expect(await store.read(key, 2)).toEqual(original);
  await expect(store.read(key, 1)).rejects.toThrow("object_too_large");
  expect(await store.read("missing-object", 2)).toBeNull();
});
it("promotes and restores a synthetic batch on the Workers R2 runtime", async () => {
  const landing = r2Store(buckets.TRACE_TEST_LANDING),
    archive = r2Store(buckets.TRACE_TEST_ARCHIVE);
  const bytes = new TextEncoder().encode('{"id":"synthetic-observation"}\n');
  const key = `exports/${crypto.randomUUID()}.jsonl`;
  await landing.create(key, bytes);
  const policy: ArchivePolicy = {
    environment: "staging",
    sourceProject: "synthetic",
    landingPrefix: "exports/",
    version: "synthetic-v1",
    inspect: (value, rows) => {
      expect(value).toEqual(bytes);
      expect(rows).toBe(1);
      return Promise.resolve();
    },
  };
  const json = JSON.stringify({
    version: 1,
    environment: "staging",
    sourceProject: "synthetic",
    sourceManifestDigest: "b".repeat(64),
    windowStart: "2026-11-21T00:00:00.000Z",
    windowEnd: "2026-11-21T01:00:00.000Z",
    policyVersion: "synthetic-v1",
    files: [{ key, sha256: await sha256(bytes), bytes: bytes.length, rows: 1 }],
  });
  const first = await archiveBatch(json, policy, landing, archive, "2026-11-21T02:00:00.000Z");
  const duplicate = await archiveBatch(json, policy, landing, archive, "2026-11-21T03:00:00.000Z");
  expect(duplicate).toEqual(first);
  await buckets.TRACE_TEST_LANDING.delete(key);
  expect((await restoreArchive(first.batchDigest, policy, archive)).files).toEqual([bytes]);
});
