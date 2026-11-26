import validators from "./activity-validator.cjs";
import { activityEventSemanticErrors } from "./activity-semantics.js";
import { identityBindingSemanticErrors, routingPolicySemanticErrors } from "./company.js";
import { fleetReportSemanticErrors } from "./fleet-report.js";
import type {
  ActivityEvent,
  FleetReport,
  IdentityBindingSnapshot,
  Provenance,
  Result,
  RoutingPolicy,
} from "./types.js";
export type {
  ActivityEvent,
  ActivityEventContract,
  ContextPinSnapshot,
  EventKind,
  FleetDiagnosticCode,
  FleetMachine,
  FleetReport,
  IdentityBindingSnapshot,
  IdentityResolution,
  IdentitySource,
  KnowledgeFlagData,
  ModelRouteRule,
  Provenance,
  ProviderBudgetLimits,
  Result,
  RoutingPolicy,
  RoutingProviderId,
  RoutingTaskClass,
  SourceIdentityBinding,
  SourceSystem,
  TraceRef,
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
    contract === "home.activity-event/v4"
      ? validators.v4
      : contract === "home.activity-event/v3"
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

/** A reviewed Identity Binding snapshot, as the Node validator checks it, for `homer-catalog`. */
export function validateIdentityBindingSnapshot(input: unknown): Result<IdentityBindingSnapshot> {
  const errors = errorsOf(validators.identityBindings, input);
  errors.push(...identityBindingSemanticErrors(input));
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: input as IdentityBindingSnapshot };
}

/** The versioned model and budget routing policy, as the Node validator checks it. */
export function validateRoutingPolicy(input: unknown): Result<RoutingPolicy> {
  const errors = errorsOf(validators.routingPolicy, input);
  errors.push(...routingPolicySemanticErrors(input));
  return errors.length ? { ok: false, errors } : { ok: true, value: input as RoutingPolicy };
}

/** The same exact-match Identity Binding lookup the Node surface uses. */
export { resolveIdentityBinding } from "./company.js";

/** The Context Pin, generated at build time from the repository's agent-context.pin.json. */
export { CONTEXT_PIN } from "./generated/context-pin.js";

/** The product version, commit and Build Version this code was built from (versioning spec). */
export { BUILD_COMMIT, BUILD_VERSION, PRODUCT_VERSION } from "./generated/build-info.js";

export { workerVersion, type WorkerVersion } from "./worker-version.js";
