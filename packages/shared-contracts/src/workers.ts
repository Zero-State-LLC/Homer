import validators from "./activity-validator.cjs";
import { activityEventSemanticErrors } from "./activity-semantics.js";
import type { ActivityEvent, Result } from "./types.js";
export type {
  ActivityEvent,
  ActivityEventContract,
  EventKind,
  Provenance,
  Result,
  SourceSystem,
} from "./types.js";

/**
 * Generated at build time; no filesystem reads or runtime code generation. Picks the version
 * the input's `contract` names, as the Node validator does.
 */
export function validateActivityEvent(input: unknown): Result<ActivityEvent> {
  const v2 =
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    (input as Record<string, unknown>)["contract"] === "home.activity-event/v2";
  const validate = v2 ? validators.v2 : validators.v1;
  const errors = validate(input)
    ? []
    : (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? e.keyword}`);
  errors.push(...activityEventSemanticErrors(input));
  return errors.length ? { ok: false, errors } : { ok: true, value: input as ActivityEvent };
}

/** The product version, commit and Build Version this code was built from (versioning spec). */
export { BUILD_COMMIT, BUILD_VERSION, PRODUCT_VERSION } from "./generated/build-info.js";

export { workerVersion, type WorkerVersion } from "./worker-version.js";
