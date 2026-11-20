import { canonicalJson } from "./canonical.js";
import { verifyLedgerArchive, type LedgerArchive, type LedgerRecoveryRpc } from "./archive.js";
import type { TrustedHead } from "./types.js";
import { ledgerRpcData } from "./rpc-data.js";

export interface LedgerRecoveryParams {
  drillId: string;
  expectedHead: TrustedHead | null;
  expectedDigest: string;
  mode: "restore" | "verify";
}
export interface LedgerRecoveryPort extends LedgerRecoveryRpc {
  head(): Promise<TrustedHead | null>;
}
export interface LedgerBackupPort {
  load(key: string): Promise<unknown>;
  saveIfAbsent(key: string, archive: LedgerArchive): Promise<void>;
}
export function parseLedgerRecoveryParams(input: unknown): LedgerRecoveryParams {
  const p = input as LedgerRecoveryParams | null;
  if (
    !p ||
    typeof p.drillId !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,79}$/.test(p.drillId) ||
    typeof p.expectedDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(p.expectedDigest) ||
    (p.mode !== "restore" && p.mode !== "verify") ||
    (p.expectedHead !== null &&
      (!p.expectedHead ||
        !Number.isSafeInteger(p.expectedHead.sequence) ||
        p.expectedHead.sequence < 1 ||
        typeof p.expectedHead.entryDigest !== "string" ||
        !/^[a-f0-9]{64}$/.test(p.expectedHead.entryDigest)))
  )
    throw new Error("invalid_ledger_recovery_parameters");
  return {
    drillId: p.drillId,
    expectedHead: p.expectedHead,
    expectedDigest: p.expectedDigest,
    mode: p.mode,
  };
}
export async function runLedgerRecovery(
  input: unknown,
  source: Pick<LedgerRecoveryPort, "exportArchive">,
  target: LedgerRecoveryPort,
  backup: LedgerBackupPort,
) {
  const p = parseLedgerRecoveryParams(input);
  const key = `event-ledger/${p.drillId}.json`;
  const live = verifyLedgerArchive(
    ledgerRpcData(await source.exportArchive(p.expectedHead)),
    p.expectedHead,
    p.expectedDigest,
  );
  let saved = await backup.load(key);
  if (saved === null) {
    if (p.mode === "verify") throw new Error("ledger_recovery_backup_missing");
    await backup.saveIfAbsent(key, live);
    saved = await backup.load(key);
  }
  const archive = verifyLedgerArchive(saved, p.expectedHead, p.expectedDigest);
  if (canonicalJson(archive) !== canonicalJson(live))
    throw new Error("ledger_recovery_source_mismatch");
  const before = ledgerRpcData(await target.head());
  if (before === null && p.expectedHead !== null) {
    if (p.mode === "verify") throw new Error("ledger_recovery_target_missing");
    await target.restoreArchive(archive, p.expectedHead, p.expectedDigest);
  } else if (canonicalJson(before) !== canonicalJson(p.expectedHead)) {
    throw new Error("restore_target_not_empty");
  }
  const restored = verifyLedgerArchive(
    ledgerRpcData(await target.exportArchive(p.expectedHead)),
    p.expectedHead,
    p.expectedDigest,
  );
  if (canonicalJson(restored) !== canonicalJson(archive))
    throw new Error("ledger_recovery_target_mismatch");
  const after = ledgerRpcData(await source.exportArchive(p.expectedHead));
  if (canonicalJson(after) !== canonicalJson(live))
    throw new Error("ledger_recovery_source_changed");
  return {
    outcome: "verified" as const,
    archiveKey: key,
    digest: archive.digest,
    head: archive.head,
    entries: archive.entries.length,
    mode: p.mode,
  };
}
