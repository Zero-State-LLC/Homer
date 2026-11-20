import { env } from "cloudflare:workers";
import { abortAllDurableObjects, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { createArchive, verifyArchive, MAX_ARCHIVE_BYTES } from "../src/archive.js";

const snapshot = (revision: number) => ({
  version: 1 as const,
  revision,
  repositories: [
    { repositoryId: 42, repository: "Zero-State-LLC/synthetic", enabled: revision % 2 === 1 },
  ],
});
async function refuses(operation: () => PromiseLike<unknown>, message?: string): Promise<void> {
  let failure: unknown;
  try {
    await operation();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  if (message) expect((failure as Error).message).toContain(message);
}
const fresh = () => env.MAPPING_CATALOG.get(env.MAPPING_CATALOG.newUniqueId());
async function populated() {
  const source = fresh();
  for (let revision = 1; revision <= 3; revision++)
    await source.replace(revision - 1, snapshot(revision), "a".repeat(64));
  return source;
}
it("restores every revision and audit field into an isolated object across restart", async () => {
  const source = await populated(),
    archive = await source.exportArchive(),
    target = fresh();
  expect(archive.headRevision).toBe(3);
  expect(archive.entries.map((entry) => entry.snapshot.revision)).toEqual([1, 2, 3]);
  expect(await target.restoreArchive(archive, archive.digest)).toEqual(snapshot(3));
  expect(await target.exportArchive()).toEqual(archive);
  await abortAllDurableObjects();
  const restored = env.MAPPING_CATALOG.get(target.id);
  const original = env.MAPPING_CATALOG.get(source.id);
  expect(await restored.exportArchive()).toEqual(archive);
  expect(await original.exportArchive()).toEqual(archive);
  expect(await restored.replace(3, snapshot(4), "b".repeat(64))).toBe(true);
  expect(await original.read()).toEqual(snapshot(3));
  await runInDurableObject(restored, (_object, state) => {
    expect(() => state.storage.sql.exec("DELETE FROM catalog_history")).toThrow();
  });
});
it("exports and restores the implicit initial empty catalog", async () => {
  const archive = await fresh().exportArchive(),
    target = fresh();
  expect(archive).toMatchObject({ version: 1, headRevision: 0, entries: [] });
  expect(await target.restoreArchive(archive, archive.digest)).toEqual({
    version: 1,
    revision: 0,
    repositories: [],
  });
  expect(await target.exportArchive()).toEqual(archive);
});
it("refuses modified, incomplete or untrusted archives without writing anything", async () => {
  const archive = await (await populated()).exportArchive();
  const variants = [
    { ...archive, digest: "0".repeat(64) },
    { ...archive, headRevision: 2 },
    { ...archive, unexpected: "private" },
    { ...archive, entries: archive.entries.slice(1), headRevision: 2 },
  ];
  const modified = structuredClone(archive);
  modified.entries[0]!.snapshot.repositories[0]!.enabled = false;
  variants.push(modified);
  for (const broken of variants) {
    const target = fresh();
    await refuses(() => target.restoreArchive(broken, archive.digest));
    expect((await target.read()).revision).toBe(0);
  }
  await refuses(() => fresh().restoreArchive(archive, "0".repeat(64)), "archive_digest_mismatch");
});
it("validates original audit fields and rejects unknown snapshot fields", async () => {
  const archive = await (await populated()).exportArchive();
  for (const patch of [
    { principalDigest: "email@example.com" },
    { recordedAt: "yesterday" },
    { recordedAt: "2026-11-20" },
  ]) {
    const copy = structuredClone(archive.entries);
    Object.assign(copy[0]!, patch);
    await expect(createArchive(copy)).rejects.toThrow("invalid_catalog_archive");
  }
  const copy = structuredClone(archive.entries);
  Object.assign(copy[0]!.snapshot, { token: "must-not-export" });
  await expect(createArchive(copy)).rejects.toThrow("invalid_catalog_archive");
});
it("refuses occupied targets even if their current inventory is empty", async () => {
  const source = await populated(),
    archive = await source.exportArchive(),
    target = fresh();
  await target.replace(0, { version: 1, revision: 1, repositories: [] }, "b".repeat(64));
  const before = await target.exportArchive();
  await refuses(() => target.restoreArchive(archive, archive.digest), "restore_target_not_empty");
  expect(await target.exportArchive()).toEqual(before);
});
it("allows exactly one concurrent restore and preserves the winning history", async () => {
  const archive = await (await populated()).exportArchive(),
    target = fresh();
  const results = await Promise.allSettled([
    target.restoreArchive(archive, archive.digest),
    target.restoreArchive(archive, archive.digest),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(await target.exportArchive()).toEqual(archive);
});
it("rolls back all imported revisions after a mid-import SQL failure", async () => {
  const archive = await (await populated()).exportArchive(),
    target = fresh();
  await runInDurableObject(target, (_object, state) => {
    state.storage.sql.exec(
      "CREATE TRIGGER injected_restore_failure AFTER INSERT ON catalog_history WHEN NEW.revision = 2 BEGIN SELECT RAISE(ABORT, 'injected restore failure'); END;",
    );
  });
  await refuses(() => target.restoreArchive(archive, archive.digest), "injected restore failure");
  expect((await target.exportArchive()).entries).toEqual([]);
  await runInDurableObject(target, (_object, state) => {
    state.storage.sql.exec("DROP TRIGGER injected_restore_failure");
  });
  await target.restoreArchive(archive, archive.digest);
  expect(await target.exportArchive()).toEqual(archive);
});
it("refuses bounded archive overflow instead of truncating history", async () => {
  await expect(
    verifyArchive({ padding: "x".repeat(MAX_ARCHIVE_BYTES) }, "a".repeat(64)),
  ).rejects.toThrow("archive_too_large");
  const source = fresh();
  await runInDurableObject(source, (_object, state) => {
    for (let revision = 1; revision <= 1001; revision++)
      state.storage.sql.exec(
        "INSERT INTO catalog_history VALUES (?, ?, ?, ?)",
        revision,
        JSON.stringify({ version: 1, revision, repositories: [] }),
        "a".repeat(64),
        "2026-11-20T00:00:00.000Z",
      );
  });
  await refuses(() => source.exportArchive(), "archive_too_large");
  expect((await source.read()).revision).toBe(1001);
});
it("refuses corrupt historical rows even when the latest snapshot is valid", async () => {
  const source = fresh();
  await runInDurableObject(source, (_object, state) => {
    state.storage.sql.exec(
      "INSERT INTO catalog_history VALUES (2, ?, ?, ?)",
      JSON.stringify(snapshot(2)),
      "a".repeat(64),
      "2026-11-20T00:00:00.000Z",
    );
  });
  expect((await source.read()).revision).toBe(2);
  await refuses(() => source.exportArchive(), "catalog_integrity_failure");
});

it("refuses byte overflow even below the revision count limit", async () => {
  const source = fresh();
  for (let revision = 1; revision <= 6; revision++) {
    const repositories = Array.from({ length: 1800 }, (_, index) => ({
      repositoryId: index + 1,
      repository: `Zero-State-LLC/synthetic-repository-${index}`,
      enabled: true,
    }));
    await source.replace(revision - 1, { version: 1, revision, repositories }, "a".repeat(64));
  }
  await refuses(() => source.exportArchive(), "archive_too_large");
  expect((await source.read()).revision).toBe(6);
});
