import type { ActivityEvent, Provenance } from "@zs-home/shared-contracts";

export type Correction = {
  contract: "home.correction/v1";
  correctionId: string;
  targetEventKey: string;
  reason: string;
  provenance: Provenance;
} & (
  { action: "retract"; replacement?: never } | { action: "supersede"; replacement: ActivityEvent }
);
export interface Receipt {
  sequence: number;
  entryDigest: string;
}
export type TrustedHead = Receipt;
export type AppendOutcome =
  | { outcome: "appended" | "duplicate"; receipt: Receipt }
  | { outcome: "conflict"; identifier: string }
  | { outcome: "refused"; errors: string[] };
export type LedgerEntry = {
  formatVersion: 1;
  sequence: number;
  previousDigest: string | null;
  entryDigest: string;
  comparisonDigest: string;
} & (
  | { entryType: "activity_event"; payload: ActivityEvent }
  | { entryType: "correction"; payload: Correction }
);
export interface EventLedger {
  appendActivityEvent(input: unknown): Promise<AppendOutcome>;
  appendCorrection(input: unknown): Promise<AppendOutcome>;
  readHistory(options?: { throughSequence?: number }): Promise<LedgerEntry[]>;
  head(): Promise<TrustedHead | null>;
}
export interface IntegrityFailure {
  sequence: number | null;
  reason:
    | "sequence_gap"
    | "unsupported_format"
    | "previous_digest_mismatch"
    | "entry_digest_mismatch"
    | "comparison_digest_mismatch"
    | "trusted_head_mismatch"
    | "invalid_payload"
    | "storage_metadata_mismatch";
}
export class EventLedgerIntegrityError extends Error {
  constructor(public readonly failure: IntegrityFailure) {
    super(`Event Ledger integrity failure: ${failure.reason} at ${String(failure.sequence)}`);
    this.name = "EventLedgerIntegrityError";
  }
}
export class EventLedgerStorageError extends Error {
  constructor(cause: unknown) {
    super(
      "Event Ledger storage operation failed; retry the same identifier to resolve an uncertain commit",
      { cause },
    );
    this.name = "EventLedgerStorageError";
  }
}
