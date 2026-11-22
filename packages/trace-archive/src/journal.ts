import { sha256 } from "./index.js";
import type { ScanJournal, ScanState } from "./collector.js";

/** Dedicated trace archive D1 database. Never use the Event Ledger's backing store. */
export function d1Journal(db: D1Database, scope: string): ScanJournal {
  if (!/^[a-f0-9]{64}$/.test(scope)) throw new Error("invalid_journal_scope");
  return {
    async read() {
      await db
        .prepare("INSERT OR IGNORE INTO trace_scan (scope, revision, cursor) VALUES (?, 0, NULL)")
        .bind(scope)
        .run();
      const row = await db
        .prepare("SELECT revision, cursor FROM trace_scan WHERE scope = ?")
        .bind(scope)
        .first<ScanState>();
      if (!row || !Number.isSafeInteger(row.revision) || row.revision < 0)
        throw new Error("invalid_journal_state");
      return row;
    },
    async advance(expectedRevision, cursor) {
      const result = await db
        .prepare(
          "UPDATE trace_scan SET revision = revision + 1, cursor = ? WHERE scope = ? AND revision = ?",
        )
        .bind(cursor, scope, expectedRevision)
        .run();
      return result.meta.changes === 1;
    },
    async record(result) {
      const keyDigest = await sha256(new TextEncoder().encode(result.key));
      await db
        .prepare(
          "INSERT INTO trace_attempt (attempt_id, scope, key_digest, attempted_at, outcome, receipt) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(
          crypto.randomUUID(),
          scope,
          keyDigest,
          result.at,
          result.outcome,
          result.receipt === null ? null : JSON.stringify(result.receipt),
        )
        .run();
    },
  };
}
