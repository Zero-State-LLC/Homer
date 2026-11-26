import { archiveBatch } from "./index.js";
import type { ArchiveReceipt, ObjectStore } from "./index.js";
import { nativeManifestPrefix, normalizeLangfuseManifest } from "./langfuse.js";
import type { LangfuseSource } from "./langfuse.js";

export interface ScanState {
  revision: number;
  cursor: string | null;
}
/** Durable implementations must persist failures and use compare-and-swap for cursors. */
export interface ScanJournal {
  read(): Promise<ScanState>;
  advance(expectedRevision: number, cursor: string | null): Promise<boolean>;
  record(result: {
    key: string;
    at: string;
    outcome: "verified" | "failed";
    receipt: ArchiveReceipt | null;
  }): Promise<void>;
}
export interface ManifestListing {
  list(
    prefix: string,
    cursor: string | null,
    limit: number,
  ): Promise<{ keys: string[]; cursor: string | null }>;
}
/** One bounded scheduled pass. Failed keys are revisited when the scan wraps.
 * Cursor is a discovery optimization, never a coverage/expiry watermark. */
export async function collectTracePage(
  source: LangfuseSource,
  landing: ObjectStore,
  archive: ObjectStore,
  listing: ManifestListing,
  journal: ScanJournal,
  now: string,
): Promise<{ verified: number; failed: number; checkpointed: boolean; sourceCoverage: "unknown" }> {
  const prefix = nativeManifestPrefix(source);
  if (!Number.isFinite(Date.parse(now)) || new Date(now).toISOString() !== now)
    throw new Error("invalid_scan_time");
  const state = await journal.read();
  const page = await listing.list(prefix, state.cursor, 20);
  if (
    page.keys.length > 20 ||
    new Set(page.keys).size !== page.keys.length ||
    page.keys.some((k) => !k.startsWith(prefix)) ||
    (page.cursor !== null && page.cursor === state.cursor)
  )
    throw new Error("invalid_scan_page");
  let verified = 0,
    failed = 0;
  for (const key of page.keys) {
    let receipt: ArchiveReceipt;
    try {
      const normalized = await normalizeLangfuseManifest(key, source, landing);
      receipt = await archiveBatch(normalized.json, source.policy, landing, archive, now);
    } catch {
      // Never persist an upstream error message: it may contain trace content or secrets.
      await journal.record({ key, at: now, outcome: "failed", receipt: null });
      failed++;
      continue;
    }
    // Journal persistence failure prevents cursor advancement and forces replay.
    await journal.record({ key, at: now, outcome: "verified", receipt });
    verified++;
  }
  const checkpointed = await journal.advance(state.revision, page.cursor);
  return { verified, failed, checkpointed, sourceCoverage: "unknown" };
}
