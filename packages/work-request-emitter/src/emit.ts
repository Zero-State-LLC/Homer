import {
  admitWorkRequestSource,
  changedPacketFields,
  decideRiskTier,
  finishWorkRequest,
  prepareWorkRequest,
  toWorkPacket,
  validateWorkRequest,
  workRequestId,
  type IdentityBindingLookup,
  type JevChoiceAnswer,
  type RiskDecision,
  type WorkRequest,
  type WorkRequestPolicy,
  type WorkRequestRefusalCode,
  type WorkRequestResult,
  type WorkRequestSource,
} from "@zs-home/shared-contracts";
import { StoreUnavailableError, type RequestStore, type StoredRecord } from "./store.js";

/**
 * Emit one Work Request, by the spec's "Retries and changed sources":
 *
 * 1. Read the source and derive its requestId.
 * 2. Admission: a canceled or closed source is refused, record or not.
 * 3. No record: derive, ask Jev, validate, record, output.
 * 4. A record for the same source: a Duplicate. Output the recorded bytes, and
 *    warn `source_changed` if the source no longer derives the same packet.
 *    Jev is never asked again.
 * 5. A record for a different source: `id_collision`.
 */

export interface EmitDependencies {
  readSource(source: string): Promise<WorkRequestResult<WorkRequestSource>>;
  askJev(state: string, model: string): Promise<WorkRequestResult<JevChoiceAnswer>>;
  store: RequestStore;
  policy: WorkRequestPolicy;
  bindings: IdentityBindingLookup;
  /** The emitting Agent, `agent:<name>`. */
  requester: string;
  now(): Date;
}

export type EmitRefusalCode = WorkRequestRefusalCode | "id_collision" | "request_invalid";

export type EmitOutcome =
  | {
      ok: true;
      kind: "emitted" | "duplicate";
      requestId: string;
      /** The request file's bytes: what a human gives to `factory judge run`. */
      json: string;
      warnings: string[];
    }
  | { ok: false; code: EmitRefusalCode; field: string; detail: string };

export async function emitWorkRequest(
  source: string,
  deps: EmitDependencies,
): Promise<EmitOutcome> {
  const read = await deps.readSource(source);
  if (!read.ok) return read;
  const admitted = admitWorkRequestSource(read.value);
  if (!admitted.ok) return admitted;
  const requestId = workRequestId(admitted.value);

  const recorded = await deps.store.read(requestId);
  if (recorded !== undefined) {
    return duplicate(admitted.value, requestId, recorded, deps);
  }

  const prepared = prepareWorkRequest(admitted.value, deps.policy, deps.bindings);
  if (!prepared.ok) return prepared;
  const answer = await deps.askJev(prepared.value.risk.state, prepared.value.risk.model);
  if (!answer.ok) return answer;
  const decision = decideRiskTier(answer.value, prepared.value.risk);
  if (!decision.ok) return decision;

  const now = deps.now();
  const request = finishWorkRequest(
    prepared.value,
    decision.value,
    deps.requester,
    deps.bindings,
    now,
  );
  const checked = validateWorkRequest(request);
  if (!checked.ok) {
    return {
      ok: false,
      code: "request_invalid",
      field: "request",
      detail: `The built request does not validate, so nothing was recorded: ${checked.errors.join("; ")}`,
    };
  }
  const json = `${JSON.stringify(checked.value, null, 2)}\n`;
  const risk = `${JSON.stringify({ requestId, ...decision.value, decidedAt: now.toISOString() }, null, 2)}\n`;
  if ((await deps.store.record(requestId, json, risk)) === "exists") {
    // Another emission recorded it first; its record stands.
    const raced = await deps.store.read(requestId);
    if (raced === undefined) {
      throw new StoreUnavailableError(`the record ${requestId} vanished.`);
    }
    return duplicate(admitted.value, requestId, raced, deps);
  }
  return { ok: true, kind: "emitted", requestId, json, warnings: [] };
}

function duplicate(
  source: WorkRequestSource,
  requestId: string,
  recorded: StoredRecord,
  deps: EmitDependencies,
): EmitOutcome {
  const checked = validateWorkRequest(recorded.request);
  if (!checked.ok) {
    // A record never changes, so one that no longer validates is an incident to look at.
    throw new StoreUnavailableError(`the record ${requestId} is not a valid Work Request.`);
  }
  if (checked.value.source !== source.source) {
    return {
      ok: false,
      code: "id_collision",
      field: "requestId",
      detail: `${requestId} is recorded for ${checked.value.source}, not ${source.source}.`,
    };
  }
  return {
    ok: true,
    kind: "duplicate",
    requestId,
    json: recorded.bytes,
    warnings: changes(source, checked.value, deps),
  };
}

/** What a retry reports about the source, without ever replacing the record. */
function changes(
  source: WorkRequestSource,
  recorded: WorkRequest,
  deps: EmitDependencies,
): string[] {
  const prepared = prepareWorkRequest(source, deps.policy, deps.bindings);
  if (!prepared.ok) {
    return [
      `source_changed: the source no longer derives a request (${prepared.code} at ${prepared.field}); the recorded request stands.`,
    ];
  }
  // The recorded tier stands with the recorded request: a retry never asks Jev.
  const decision: RiskDecision = {
    model: prepared.value.risk.model,
    choice: recorded.riskTier,
    confidence: 1,
    floor: prepared.value.risk.floor,
    minConfidence: prepared.value.risk.minConfidence,
    tier: recorded.riskTier,
  };
  const now = deps.now();
  const derived = finishWorkRequest(prepared.value, decision, deps.requester, deps.bindings, now);
  let fields: string[];
  try {
    fields = changedPacketFields(toWorkPacket(recorded, now), toWorkPacket(derived, now));
  } catch {
    return [
      "source_changed: the source no longer derives a valid request; the recorded request stands.",
    ];
  }
  return fields.length === 0
    ? []
    : [
        `source_changed: ${fields.join(", ")} differ from the source now; the recorded request stands.`,
      ];
}
