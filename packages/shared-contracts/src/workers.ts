import validate from "./activity-validator.cjs";
import { activityEventSemanticErrors } from "./activity-semantics.js";
import type { ActivityEvent, Result } from "./types.js";
export type { ActivityEvent, Provenance, Result } from "./types.js";

/** Generated at build time; no filesystem reads or runtime code generation. */
export function validateActivityEvent(input: unknown): Result<ActivityEvent> {
  const errors = validate(input)
    ? []
    : (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? e.keyword}`);
  errors.push(...activityEventSemanticErrors(input));
  return errors.length ? { ok: false, errors } : { ok: true, value: input as ActivityEvent };
}
