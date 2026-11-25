import validators from "./activity-validator.cjs";
import { activityEventSemanticErrors } from "./activity-semantics.js";
import { fleetReportSemanticErrors } from "./fleet-report.js";
import type { ActivityEvent, FleetReport, Provenance, Result } from "./types.js";
export type {
  ActivityEvent,
  ActivityEventContract,
  EventKind,
  FleetDiagnosticCode,
  FleetMachine,
  FleetReport,
  Provenance,
  Result,
  SourceSystem,
} from "./types.js";
export {
  FLEET_RULE_NAMES,
  MACHINE_ID,
  MAX_FLEET_REPORT_BYTES,
  fleetRuleName,
  ipAddressIn,
} from "./fleet.js";

type Validate = (typeof validators)["v1"];
function errorsOf(validate: Validate, input: unknown): string[] {
  return validate(input)
    ? []
    : (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? e.keyword}`);
}

/**
 * Generated at build time; no filesystem reads or runtime code generation. Picks the version
 * the input's `contract` names, as the Node validator does.
 */
export function validateActivityEvent(input: unknown): Result<ActivityEvent> {
  const contract =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)["contract"]
      : undefined;
  const validate =
    contract === "home.activity-event/v3"
      ? validators.v3
      : contract === "home.activity-event/v2"
        ? validators.v2
        : validators.v1;
  const errors = errorsOf(validate, input);
  errors.push(...activityEventSemanticErrors(input));
  return errors.length ? { ok: false, errors } : { ok: true, value: input as ActivityEvent };
}

/** A Provenance on its own, as the Node validator checks it, for a Correction. */
export function validateProvenance(input: unknown): Result<Provenance> {
  const errors = errorsOf(validators.provenance, input);
  return errors.length ? { ok: false, errors } : { ok: true, value: input as Provenance };
}

/** A Fleet Report, as the Node validator checks it, for `homer-intake`. */
export function validateFleetReport(input: unknown): Result<FleetReport> {
  const errors = errorsOf(validators.fleetReport, input);
  errors.push(...fleetReportSemanticErrors(input));
  return errors.length ? { ok: false, errors } : { ok: true, value: input as FleetReport };
}

/** The product version, commit and Build Version this code was built from (versioning spec). */
export { BUILD_COMMIT, BUILD_VERSION, PRODUCT_VERSION } from "./generated/build-info.js";

export { workerVersion, type WorkerVersion } from "./worker-version.js";
