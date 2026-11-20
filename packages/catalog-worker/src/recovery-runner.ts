import { verifyArchive, type CatalogArchive } from "./archive.js";
import type { MappingSnapshot } from "@zs-home/github-sync";

export interface RecoveryParams {
  drillId: string;
  expectedDigest: string;
  mode: "restore" | "verify";
}
export interface CatalogRecoveryPort {
  exportArchive(): Promise<CatalogArchive>;
  restoreArchive(archive: unknown, expectedDigest: string): Promise<MappingSnapshot>;
}
export interface ArchiveBackupPort {
  load(key: string): Promise<unknown>;
  saveIfAbsent(key: string, archive: CatalogArchive): Promise<void>;
}
export function parseRecoveryParams(input: unknown): RecoveryParams {
  const p = input as RecoveryParams | null;
  if (
    !p ||
    typeof p.drillId !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,79}$/.test(p.drillId) ||
    typeof p.expectedDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(p.expectedDigest) ||
    (p.mode !== "restore" && p.mode !== "verify")
  )
    throw new Error("invalid_recovery_parameters");
  return { drillId: p.drillId, expectedDigest: p.expectedDigest, mode: p.mode };
}
export async function runCatalogRecovery(
  input: unknown,
  source: Pick<CatalogRecoveryPort, "exportArchive">,
  target: CatalogRecoveryPort,
  backup: ArchiveBackupPort,
) {
  const p = parseRecoveryParams(input);
  const key = `catalog/${p.drillId}.json`;
  const live = await verifyArchive(await source.exportArchive(), p.expectedDigest);
  let saved = await backup.load(key);
  if (saved === null) {
    if (p.mode === "verify") throw new Error("recovery_backup_missing");
    await backup.saveIfAbsent(key, live);
    saved = await backup.load(key);
  }
  const archive = await verifyArchive(saved, p.expectedDigest);
  if (JSON.stringify(archive) !== JSON.stringify(live)) throw new Error("recovery_source_mismatch");
  const before = await target.exportArchive();
  if (JSON.stringify(before) !== JSON.stringify(archive)) {
    if (p.mode === "verify") throw new Error("recovery_target_mismatch");
    if (before.headRevision !== 0) throw new Error("restore_target_not_empty");
    await target.restoreArchive(archive, p.expectedDigest);
  }
  const restored = await verifyArchive(await target.exportArchive(), p.expectedDigest);
  if (JSON.stringify(restored) !== JSON.stringify(archive))
    throw new Error("recovery_target_mismatch");
  const after = await source.exportArchive();
  if (JSON.stringify(after) !== JSON.stringify(live)) throw new Error("recovery_source_changed");
  return {
    outcome: "verified" as const,
    archiveKey: key,
    digest: archive.digest,
    revisions: archive.entries.length,
    headRevision: archive.headRevision,
    mode: p.mode,
  };
}
