import { activityEventSemanticErrors } from "./activity-semantics.js";
import { MAX_FLEET_REPORT_BYTES, ipAddressIn } from "./fleet.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** While sparkDash cannot be read, or cannot be trusted, every sparkDash Machine is unknown. */
const UNREAD_STATES = new Set(["unreachable", "metrics_off", "shape_changed"]);

/**
 * What JSON Schema cannot say about a Fleet Report (fleet monitoring spec): its
 * size, unique machine ids and diagnostic codes, sparkDash Machines unknown
 * while sparkDash is not read, each event's own rules, and no IP address
 * anywhere. Workers-safe.
 */
export function fleetReportSemanticErrors(input: unknown): string[] {
  if (!isRecord(input)) {
    return [];
  }
  const errors: string[] = [];
  let bytes: number | undefined;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(input)).length;
  } catch {
    bytes = undefined;
  }
  if (bytes === undefined || bytes > MAX_FLEET_REPORT_BYTES) {
    errors.push(`/ must be at most ${MAX_FLEET_REPORT_BYTES} bytes of JSON`);
  }
  const machines = Array.isArray(input["machines"]) ? input["machines"] : [];
  const seen = new Set<unknown>();
  const sparkdash = input["sparkdash"];
  const unread = isRecord(sparkdash) && UNREAD_STATES.has(sparkdash["state"] as string);
  for (const [index, machine] of machines.entries()) {
    if (!isRecord(machine)) continue;
    if (seen.has(machine["machineId"])) {
      errors.push(`/machines/${index}/machineId must be unique`);
    }
    seen.add(machine["machineId"]);
    if (unread && machine["source"] === "sparkdash" && machine["state"] !== "unknown") {
      errors.push(`/machines/${index}/state must be unknown while sparkDash is not read`);
    }
  }
  const diagnostics = Array.isArray(input["diagnostics"]) ? input["diagnostics"] : [];
  const codes = new Set<unknown>();
  for (const [index, diagnostic] of diagnostics.entries()) {
    if (!isRecord(diagnostic)) continue;
    if (codes.has(diagnostic["code"])) {
      errors.push(`/diagnostics/${index}/code must be unique`);
    }
    codes.add(diagnostic["code"]);
  }
  const events = Array.isArray(input["events"]) ? input["events"] : [];
  for (const [index, event] of events.entries()) {
    for (const error of activityEventSemanticErrors(event)) {
      // An event's own address error already names its path; prefix it once.
      errors.push(error.startsWith("/") ? `/events/${index}${error}` : `/events/${index} ${error}`);
    }
  }
  // Each event was checked above; check everything else.
  const rest: Record<string, unknown> = { ...input };
  delete rest["events"];
  const address = ipAddressIn(rest);
  if (address !== undefined) {
    errors.push(`${address} must not carry an IP address`);
  }
  return errors;
}
