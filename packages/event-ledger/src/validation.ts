import { validateActivityEvent, validateProvenance } from "@zs-home/shared-contracts/workers";
import type { ActivityEvent, Result } from "@zs-home/shared-contracts/workers";
import { snapshot } from "./canonical.js";
import type { Correction } from "./types.js";

export function validateEvent(input: unknown): Result<ActivityEvent> {
  try {
    const value = snapshot(input);
    const result = validateActivityEvent(value);
    if (!result.ok) return result;
    if (result.value.eventKey.split(":")[1] !== result.value.kind)
      return { ok: false, errors: ["Event Key Kind segment must equal kind"] };
    return result;
  } catch {
    return { ok: false, errors: ["Activity Event must be valid canonical JSON"] };
  }
}
export function validateCorrection(input: unknown): Result<Correction> {
  try {
    const value = snapshot(input);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const v = value as Record<string, unknown>;
    const required = [
      "contract",
      "correctionId",
      "targetEventKey",
      "action",
      "reason",
      "provenance",
    ];
    if (
      required.some((k) => !(k in v)) ||
      Object.keys(v).some((k) => ![...required, "replacement"].includes(k))
    )
      throw new Error();
    if (
      v.contract !== "home.correction/v1" ||
      typeof v.correctionId !== "string" ||
      !v.correctionId.trim() ||
      v.correctionId.length > 300 ||
      typeof v.targetEventKey !== "string" ||
      typeof v.reason !== "string" ||
      !v.reason.trim()
    )
      throw new Error();
    if (v.action !== "supersede" && v.action !== "retract") throw new Error();
    if (v.action === "retract" && "replacement" in v) throw new Error();
    if (v.action === "supersede") {
      const replacement = validateEvent(v.replacement);
      if (!replacement.ok) return replacement;
    }
    // The authoritative Provenance schema, from the newest Activity Event contract, so a
    // Correction can name any Source System an event comes from (sparkdash included).
    const check = validateProvenance(v.provenance);
    if (!check.ok) {
      // Errors name paths inside the Provenance; give them the Correction's path.
      const errors = check.errors.map((e) => `/provenance${e.startsWith("/ ") ? e.slice(1) : e}`);
      return { ok: false, errors };
    }
    return { ok: true, value: value as Correction };
  } catch {
    return {
      ok: false,
      errors: ["Correction must have valid JSON, identity, action, reason and Provenance"],
    };
  }
}
export function correctionTargetErrors(
  c: Correction,
  original: ActivityEvent | undefined,
): string[] {
  if (!original) return ["Correction target must be an earlier Activity Event"];
  if (c.action === "supersede") {
    const r = c.replacement;
    if (
      r.eventKey !== original.eventKey ||
      r.kind !== original.kind ||
      r.provenance.sourceSystem !== original.provenance.sourceSystem ||
      r.provenance.sourceObjectId !== original.provenance.sourceObjectId
    )
      return ["Replacement must preserve source identity"];
  }
  return [];
}
