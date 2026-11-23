import { DurableObject } from "cloudflare:workers";
import type { ActivityEvent } from "@zs-home/shared-contracts";
import { canonicalJson, comparisonDigest, digest, entryBody } from "./canonical.js";
import { correctionTargetErrors, validateCorrection, validateEvent } from "./validation.js";
import { EventLedgerIntegrityError } from "./types.js";
import type { AppendOutcome, Correction, LedgerEntry, TrustedHead } from "./types.js";
import {
  createLedgerArchive,
  verifyLedgerArchive,
  ledgerArchiveBytes,
  MAX_LEDGER_ARCHIVE_BYTES,
  MAX_LEDGER_ARCHIVE_ENTRIES,
  type LedgerArchive,
} from "./archive.js";

export interface Env {
  EVENT_LEDGER: DurableObjectNamespace<EventLedgerObject>;
}
const schema = `
CREATE TABLE IF NOT EXISTS ledger_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
INSERT OR IGNORE INTO ledger_meta VALUES ('formatVersion','1');
CREATE TABLE IF NOT EXISTS entries (
 sequence INTEGER PRIMARY KEY CHECK(sequence>=1), entry_type TEXT NOT NULL CHECK(entry_type IN ('activity_event','correction')),
 event_key TEXT UNIQUE, correction_id TEXT UNIQUE, target_event_key TEXT, comparison_digest TEXT NOT NULL,
 previous_digest TEXT, entry_digest TEXT NOT NULL, entry_json TEXT NOT NULL
) STRICT;
CREATE TRIGGER IF NOT EXISTS entries_no_update BEFORE UPDATE ON entries BEGIN SELECT RAISE(ABORT,'Event Ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS entries_no_delete BEFORE DELETE ON entries BEGIN SELECT RAISE(ABORT,'Event Ledger is append-only'); END;`;

// Binding-only RPC. There is deliberately no public fetch handler.
export class EventLedgerObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.transactionSync(() => {
      ctx.storage.sql.exec(schema);
      const version = ctx.storage.sql
        .exec<{ value: string }>("SELECT value FROM ledger_meta WHERE key='formatVersion'")
        .one();
      if (version.value !== "1")
        throw new EventLedgerIntegrityError({ sequence: null, reason: "unsupported_format" });
    });
  }
  #decode(row: Record<string, SqlStorageValue>): LedgerEntry {
    try {
      if (
        typeof row.entry_json !== "string" ||
        typeof row.entry_digest !== "string" ||
        typeof row.comparison_digest !== "string"
      )
        throw new Error();
      const entry = JSON.parse(row.entry_json) as LedgerEntry;
      if (
        row.sequence !== entry.sequence ||
        row.entry_type !== entry.entryType ||
        row.previous_digest !== entry.previousDigest ||
        row.event_key !== (entry.entryType === "activity_event" ? entry.payload.eventKey : null) ||
        row.correction_id !==
          (entry.entryType === "correction" ? entry.payload.correctionId : null) ||
        row.target_event_key !==
          (entry.entryType === "correction" ? entry.payload.targetEventKey : null) ||
        canonicalJson(entryBody(entry)) !== row.entry_json
      )
        throw new Error();
      return {
        ...entry,
        entryDigest: row.entry_digest,
        comparisonDigest: row.comparison_digest,
      };
    } catch {
      throw new EventLedgerIntegrityError({
        sequence: Number(row.sequence),
        reason: "storage_metadata_mismatch",
      });
    }
  }
  #checked(row: Record<string, SqlStorageValue>): LedgerEntry {
    const entry = this.#decode(row);
    if (digest(entryBody(entry)) !== entry.entryDigest)
      throw new EventLedgerIntegrityError({
        sequence: entry.sequence,
        reason: "entry_digest_mismatch",
      });
    if (comparisonDigest(entry.payload) !== entry.comparisonDigest)
      throw new EventLedgerIntegrityError({
        sequence: entry.sequence,
        reason: "comparison_digest_mismatch",
      });
    return entry;
  }
  #last(): LedgerEntry | undefined {
    const row = this.ctx.storage.sql
      .exec("SELECT * FROM entries ORDER BY sequence DESC LIMIT 1")
      .toArray()[0];
    return row ? this.#checked(row) : undefined;
  }
  #insert(entry: LedgerEntry): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      entry.sequence,
      entry.entryType,
      entry.entryType === "activity_event" ? entry.payload.eventKey : null,
      entry.entryType === "correction" ? entry.payload.correctionId : null,
      entry.entryType === "correction" ? entry.payload.targetEventKey : null,
      entry.comparisonDigest,
      entry.previousDigest,
      entry.entryDigest,
      canonicalJson(entryBody(entry)),
    );
  }
  #append(input: unknown, entryType: "activity_event" | "correction"): AppendOutcome {
    const result =
      entryType === "activity_event" ? validateEvent(input) : validateCorrection(input);
    if (!result.ok) return { outcome: "refused", errors: result.errors };
    const payload = result.value;
    // Leave ample room below the platform's per-row limit, including indexes.
    if (new TextEncoder().encode(canonicalJson(payload)).length > 1024 * 1024)
      return { outcome: "refused", errors: ["Payload exceeds the 1 MiB ledger limit"] };
    const comparison = comparisonDigest(payload);
    return this.ctx.storage.transactionSync(() => {
      const identifier =
        payload.contract === "home.correction/v1" ? payload.correctionId : payload.eventKey;
      const column = entryType === "activity_event" ? "event_key" : "correction_id";
      const row = this.ctx.storage.sql
        .exec(`SELECT * FROM entries WHERE ${column}=?`, identifier)
        .toArray()[0];
      if (row) {
        const existing = this.#checked(row);
        return existing.comparisonDigest === comparison
          ? {
              outcome: "duplicate",
              receipt: { sequence: existing.sequence, entryDigest: existing.entryDigest },
            }
          : { outcome: "conflict", identifier };
      }
      if (payload.contract === "home.correction/v1") {
        const target = this.ctx.storage.sql
          .exec("SELECT * FROM entries WHERE event_key=?", payload.targetEventKey)
          .toArray()[0];
        const original = target ? this.#checked(target) : undefined;
        const errors = correctionTargetErrors(
          payload,
          original?.entryType === "activity_event" ? original.payload : undefined,
        );
        if (errors.length) return { outcome: "refused", errors };
      }
      const previous = this.#last();
      const base = {
        formatVersion: 1 as const,
        sequence: (previous?.sequence ?? 0) + 1,
        previousDigest: previous?.entryDigest ?? null,
      };
      const body =
        entryType === "activity_event"
          ? { ...base, entryType, payload: payload as ActivityEvent }
          : { ...base, entryType, payload: payload as Correction };
      const entryDigest = digest(body);
      this.#insert({ ...body, entryDigest, comparisonDigest: comparison });
      return { outcome: "appended", receipt: { sequence: base.sequence, entryDigest } };
    });
  }
  appendActivityEvent(input: unknown): AppendOutcome {
    return this.#append(input, "activity_event");
  }
  appendCorrection(input: unknown): AppendOutcome {
    return this.#append(input, "correction");
  }
  head(): TrustedHead | null {
    const last = this.#last();
    return last ? { sequence: last.sequence, entryDigest: last.entryDigest } : null;
  }
  /** Trusted maintenance RPC only. A separately retained head is mandatory. */
  exportArchive(expectedHead: TrustedHead | null): LedgerArchive {
    const entries: LedgerEntry[] = [];
    let bytes = 0;
    for (const row of this.ctx.storage.sql.exec(
      "SELECT * FROM entries ORDER BY sequence LIMIT ?",
      MAX_LEDGER_ARCHIVE_ENTRIES + 1,
    )) {
      if (entries.length === MAX_LEDGER_ARCHIVE_ENTRIES)
        throw new Error("ledger_archive_too_large");
      const entry = this.#checked(row);
      bytes += ledgerArchiveBytes(entry);
      if (bytes > MAX_LEDGER_ARCHIVE_BYTES) throw new Error("ledger_archive_too_large");
      entries.push(entry);
    }
    return createLedgerArchive(entries, expectedHead);
  }
  restoreArchive(input: unknown, expectedHead: TrustedHead | null, expectedDigest: string) {
    const archive = verifyLedgerArchive(input, expectedHead, expectedDigest);
    return this.ctx.storage.transactionSync(() => {
      if (this.ctx.storage.sql.exec("SELECT sequence FROM entries LIMIT 1").toArray().length)
        throw new Error("restore_target_not_empty");
      for (const entry of archive.entries) this.#insert(entry);
      return { head: archive.head, entries: archive.entries.length, digest: archive.digest };
    });
  }
  readHistory(options: { fromSequence?: number; throughSequence?: number } = {}): LedgerEntry[] {
    const from = options.fromSequence ?? 1;
    const through = options.throughSequence ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(from) || from < 1 || !Number.isSafeInteger(through) || through < 0)
      throw new RangeError("Invalid sequence bounds");
    const entries: LedgerEntry[] = [];
    let bytes = 0;
    for (const row of this.ctx.storage.sql.exec(
      "SELECT * FROM entries WHERE sequence>=? AND sequence<=? ORDER BY sequence LIMIT 1000",
      from,
      through,
    )) {
      const entry = this.#decode(row);
      const size = new TextEncoder().encode(canonicalJson(entry)).length;
      if (bytes + size > 16 * 1024 * 1024) break;
      entries.push(entry);
      bytes += size;
    }
    return entries;
  }
}
