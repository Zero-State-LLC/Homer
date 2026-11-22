import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { r2Store } from "../src/r2.js";
import { archiveBatch, restoreArchive, sha256 } from "../src/index.js";
import type { ArchivePolicy } from "../src/index.js";

const buckets = env as unknown as { TRACE_TEST_LANDING: R2Bucket; TRACE_TEST_ARCHIVE: R2Bucket };
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
