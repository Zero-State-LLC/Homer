import type { ActivityEvent } from "@zs-home/shared-contracts";
import { comparisonDigest, digest, entryBody, snapshot } from "./canonical.js";
import { correctionTargetErrors, validateCorrection, validateEvent } from "./validation.js";
import { EventLedgerIntegrityError } from "./types.js";
import type { IntegrityFailure, LedgerEntry, TrustedHead } from "./types.js";

export function verifyHistory(
  entries: readonly LedgerEntry[],
  trustedHead?: TrustedHead,
): { ok: true } | { ok: false; failure: IntegrityFailure } {
  const originals = new Map<string, ActivityEvent>();
  const corrections = new Set<string>();
  let previous: string | null = null;
  const fail = (sequence: number | null, reason: IntegrityFailure["reason"]) => ({
    ok: false as const,
    failure: { sequence, reason },
  });
  for (const [index, entry] of entries.entries()) {
    const sequence = index + 1;
    if (entry.sequence !== sequence) return fail(sequence, "sequence_gap");
    if (entry.formatVersion !== 1) return fail(sequence, "unsupported_format");
    if (entry.previousDigest !== previous) return fail(sequence, "previous_digest_mismatch");
    try {
      if (digest(entryBody(entry)) !== entry.entryDigest)
        return fail(sequence, "entry_digest_mismatch");
      if (entry.entryType === "activity_event") {
        if (!validateEvent(entry.payload).ok || originals.has(entry.payload.eventKey))
          return fail(sequence, "invalid_payload");
        originals.set(entry.payload.eventKey, entry.payload);
      } else if (entry.entryType === "correction") {
        if (
          !validateCorrection(entry.payload).ok ||
          corrections.has(entry.payload.correctionId) ||
          correctionTargetErrors(entry.payload, originals.get(entry.payload.targetEventKey)).length
        )
          return fail(sequence, "invalid_payload");
        corrections.add(entry.payload.correctionId);
      } else return fail(sequence, "unsupported_format");
      if (comparisonDigest(entry.payload) !== entry.comparisonDigest)
        return fail(sequence, "comparison_digest_mismatch");
    } catch {
      return fail(sequence, "invalid_payload");
    }
    previous = entry.entryDigest;
  }
  if (
    trustedHead &&
    (trustedHead.sequence !== entries.length || trustedHead.entryDigest !== previous)
  )
    return fail(null, "trusted_head_mismatch");
  return { ok: true };
}
export function assertHistory(entries: readonly LedgerEntry[], trustedHead?: TrustedHead): void {
  const result = verifyHistory(entries, trustedHead);
  if (!result.ok) throw new EventLedgerIntegrityError(result.failure);
}
export function replayEffectiveHistory(
  entries: readonly LedgerEntry[],
  trustedHead?: TrustedHead,
): ActivityEvent[] {
  assertHistory(entries, trustedHead);
  const effective = new Map<string, ActivityEvent | null>();
  for (const entry of entries) {
    if (entry.entryType === "activity_event") effective.set(entry.payload.eventKey, entry.payload);
    else
      effective.set(
        entry.payload.targetEventKey,
        entry.payload.action === "retract" ? null : entry.payload.replacement,
      );
  }
  return [...effective.values()]
    .filter((e): e is ActivityEvent => e !== null)
    .map((e) => snapshot(e) as ActivityEvent);
}
