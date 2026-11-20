import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import {
  runCatalogRecovery,
  parseRecoveryParams,
  type ArchiveBackupPort,
} from "../src/recovery-runner.js";
import recoveryWorker from "../src/recovery-workflow.js";
import type { CatalogArchive } from "../src/archive.js";

async function setup() {
  const source = env.MAPPING_CATALOG.get(env.MAPPING_CATALOG.newUniqueId());
  const target = env.MAPPING_CATALOG.get(env.MAPPING_CATALOG.newUniqueId());
  await source.replace(0, { version: 1, revision: 1, repositories: [] }, "a".repeat(64));
  const archive = await source.exportArchive();
  const values = new Map<string, CatalogArchive>();
  const backup: ArchiveBackupPort = {
    load: (key) => Promise.resolve(structuredClone(values.get(key) ?? null)),
    saveIfAbsent: (key, value) => {
      if (!values.has(key)) values.set(key, structuredClone(value));
      return Promise.resolve();
    },
  };
  return {
    source,
    target,
    archive,
    values,
    backup,
    params: {
      drillId: "synthetic-recovery",
      expectedDigest: archive.digest,
      mode: "restore" as const,
    },
  };
}
it("saves before restoring and re-verifies through a separate invocation without source writes", async () => {
  const s = await setup();
  const receipt = await runCatalogRecovery(s.params, s.source, s.target, s.backup);
  expect(receipt).toEqual({
    outcome: "verified",
    archiveKey: "catalog/synthetic-recovery.json",
    digest: s.archive.digest,
    revisions: 1,
    headRevision: 1,
    mode: "restore",
  });
  expect(s.values.get(receipt.archiveKey)).toEqual(s.archive);
  expect(await s.source.exportArchive()).toEqual(s.archive);
  expect(await s.target.exportArchive()).toEqual(s.archive);
  expect(await runCatalogRecovery(s.params, s.source, s.target, s.backup)).toEqual(receipt);
  expect(
    await runCatalogRecovery({ ...s.params, mode: "verify" }, s.source, s.target, s.backup),
  ).toEqual({ ...receipt, mode: "verify" });
  expect(JSON.stringify(receipt)).not.toContain("principalDigest");
});
it("stops before target writes when backup storage fails", async () => {
  const s = await setup();
  await expect(
    runCatalogRecovery(s.params, s.source, s.target, {
      ...s.backup,
      saveIfAbsent: () => Promise.reject(new Error("backup_unavailable")),
    }),
  ).rejects.toThrow("backup_unavailable");
  expect((await s.target.read()).revision).toBe(0);
});
it("refuses a changed or corrupt existing backup rather than replacing it", async () => {
  const s = await setup();
  const wrong = { ...s.archive, digest: "0".repeat(64) };
  s.values.set("catalog/synthetic-recovery.json", wrong);
  await expect(runCatalogRecovery(s.params, s.source, s.target, s.backup)).rejects.toThrow(
    "archive_digest_mismatch",
  );
  expect(s.values.get("catalog/synthetic-recovery.json")).toEqual(wrong);
  expect((await s.target.read()).revision).toBe(0);
});
it("verify-only refuses missing backup or target and never repairs them", async () => {
  const s = await setup(),
    p = { ...s.params, mode: "verify" };
  await expect(runCatalogRecovery(p, s.source, s.target, s.backup)).rejects.toThrow(
    "recovery_backup_missing",
  );
  expect(s.values.size).toBe(0);
  s.values.set("catalog/synthetic-recovery.json", s.archive);
  await expect(runCatalogRecovery(p, s.source, s.target, s.backup)).rejects.toThrow(
    "recovery_target_mismatch",
  );
  expect((await s.target.read()).revision).toBe(0);
});
it("refuses a different occupied target and an incorrect expected source digest", async () => {
  const s = await setup();
  await s.target.replace(0, { version: 1, revision: 1, repositories: [] }, "b".repeat(64));
  const before = await s.target.exportArchive();
  await expect(runCatalogRecovery(s.params, s.source, s.target, s.backup)).rejects.toThrow(
    "restore_target_not_empty",
  );
  expect(await s.target.exportArchive()).toEqual(before);
  await expect(
    runCatalogRecovery(
      { ...s.params, expectedDigest: "0".repeat(64) },
      s.source,
      s.target,
      s.backup,
    ),
  ).rejects.toThrow("archive_digest_mismatch");
});
it("rejects unbounded object names and never serves a public recovery endpoint", () => {
  for (const drillId of ["../live", "", "x".repeat(81)])
    expect(() =>
      parseRecoveryParams({ drillId, expectedDigest: "a".repeat(64), mode: "restore" }),
    ).toThrow("invalid_recovery_parameters");
  expect(recoveryWorker.fetch().status).toBe(404);
});
