export { openEventLedger } from "./client.js";
export { verifyHistory, replayEffectiveHistory } from "./history.js";
export { EventLedgerIntegrityError, EventLedgerStorageError } from "./types.js";
export { createLedgerArchive, verifyLedgerArchive } from "./archive.js";
export type { LedgerArchive, LedgerRecoveryRpc } from "./archive.js";
export type {
  AppendOutcome,
  Correction,
  EventLedger,
  IntegrityFailure,
  LedgerEntry,
  Receipt,
  TrustedHead,
} from "./types.js";
