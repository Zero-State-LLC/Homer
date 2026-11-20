import { canonicalJson, digest } from "./canonical.js";
import { assertHistory } from "./history.js";
import type { LedgerEntry, TrustedHead } from "./types.js";

export const MAX_LEDGER_ARCHIVE_BYTES = 4 * 1024 * 1024;
export const MAX_LEDGER_ARCHIVE_ENTRIES = 1000;
export interface LedgerArchive {
  version: 1;
  head: TrustedHead | null;
  entries: LedgerEntry[];
  digest: string;
}
/** Explicit wire contract: the platform RPC mapped type cannot represent unknown JSON payloads. */
export interface LedgerRecoveryRpc {
  exportArchive(expectedHead: TrustedHead | null): Promise<LedgerArchive>;
  restoreArchive(
    input: unknown,
    expectedHead: TrustedHead | null,
    expectedDigest: string,
  ): Promise<{
    head: TrustedHead | null;
    entries: number;
    digest: string;
  }>;
}
function exactKeys(value: unknown, keys: string[]): void {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error("invalid_ledger_archive");
}
export function ledgerArchiveBytes(value: unknown): number {
  return new TextEncoder().encode(canonicalJson(value)).byteLength;
}
function requireArray(value: unknown): void {
  if (!Array.isArray(value)) throw new Error("invalid_ledger_archive");
}
function checkedHead(input: TrustedHead | null): TrustedHead | null {
  if (input === null) return null;
  exactKeys(input, ["sequence", "entryDigest"]);
  if (
    !Number.isSafeInteger(input.sequence) ||
    input.sequence < 1 ||
    typeof input.entryDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.entryDigest)
  )
    throw new Error("invalid_trusted_head");
  return { sequence: input.sequence, entryDigest: input.entryDigest };
}
export function createLedgerArchive(
  entries: readonly LedgerEntry[],
  expectedHead: TrustedHead | null,
): LedgerArchive {
  const head = checkedHead(expectedHead);
  requireArray(entries);
  if (entries.length > MAX_LEDGER_ARCHIVE_ENTRIES) throw new Error("ledger_archive_too_large");
  const payload = { version: 1 as const, head, entries };
  if (ledgerArchiveBytes({ ...payload, digest: "0".repeat(64) }) > MAX_LEDGER_ARCHIVE_BYTES)
    throw new Error("ledger_archive_too_large");
  for (const entry of entries) {
    exactKeys(entry, [
      "formatVersion",
      "sequence",
      "entryType",
      "payload",
      "previousDigest",
      "entryDigest",
      "comparisonDigest",
    ]);
    if (ledgerArchiveBytes(entry.payload) > 1024 * 1024)
      throw new Error("ledger_archive_payload_too_large");
  }
  if (head === null && entries.length !== 0) throw new Error("ledger_archive_head_mismatch");
  assertHistory(entries, head ?? undefined);
  return JSON.parse(canonicalJson({ ...payload, digest: digest(payload) })) as LedgerArchive;
}
export function verifyLedgerArchive(
  input: unknown,
  expectedHead: TrustedHead | null,
  expectedDigest: string,
): LedgerArchive {
  // Validate the JSON domain before inspecting properties or copying data.
  const encoded = canonicalJson(input);
  if (new TextEncoder().encode(encoded).byteLength > MAX_LEDGER_ARCHIVE_BYTES)
    throw new Error("ledger_archive_too_large");
  const value = JSON.parse(encoded) as LedgerArchive;
  exactKeys(value, ["version", "head", "entries", "digest"]);
  if (
    value.version !== 1 ||
    typeof expectedDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(expectedDigest)
  )
    throw new Error("invalid_ledger_archive");
  if (canonicalJson(checkedHead(value.head)) !== canonicalJson(checkedHead(expectedHead)))
    throw new Error("ledger_archive_head_mismatch");
  const archive = createLedgerArchive(value.entries, expectedHead);
  if (archive.digest !== value.digest || archive.digest !== expectedDigest)
    throw new Error("ledger_archive_digest_mismatch");
  return archive;
}
