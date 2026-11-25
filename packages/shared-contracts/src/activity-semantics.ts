import {
  MACHINE_NAME,
  fleetRuleName,
  ipAddressIn,
  isMachineAlertKind,
  machineAlertEventKey,
  machineAlertObjectId,
} from "./fleet.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/**
 * JSON Schema cannot tie the Event Key prefix to Provenance, or require
 * actorId whenever actorKind is set. Those rules live here.
 * actorId and actorKind are filled only from an Identity Binding.
 * A machine alert's Event Key, object id and subject are built from its data
 * and the rule catalogue, and it carries no IP address; those checks live here too.
 */
export function activityEventSemanticErrors(input: unknown): string[] {
  if (!isRecord(input)) {
    return [];
  }
  const errors: string[] = [];
  const prefixError = eventKeyPrefixError(input);
  if (prefixError !== undefined) {
    errors.push(prefixError);
  }
  const actorError = actorKindError(input["actor"]);
  if (actorError !== undefined) {
    errors.push(actorError);
  }
  errors.push(...machineAlertErrors(input));
  return errors;
}

/** Only for the machine alert kinds; the schema checks each field's shape first. */
function machineAlertErrors(value: Record<string, unknown>): string[] {
  const kind = value["kind"];
  if (!isMachineAlertKind(kind)) {
    return [];
  }
  const errors: string[] = [];
  const address = ipAddressIn(value);
  if (address !== undefined) {
    errors.push(`${address} must not carry an IP address`);
  }
  const data = value["data"];
  const provenance = value["provenance"];
  if (!isRecord(data) || !isRecord(provenance)) {
    return errors;
  }
  const { machineId, rule, startsAt } = data;
  const source = provenance["sourceSystem"];
  if (
    typeof machineId !== "string" ||
    typeof rule !== "string" ||
    typeof startsAt !== "string" ||
    (source !== "sparkdash" && source !== "homer")
  ) {
    return errors;
  }
  const eventKey = machineAlertEventKey(source, kind, machineId, rule, startsAt);
  if (eventKey !== undefined && value["eventKey"] !== eventKey) {
    errors.push(
      "eventKey must be <source>:<kind>:<data.machineId>:<data.rule>:<data.startsAt in ms>",
    );
  }
  const objectId = machineAlertObjectId(machineId, rule, startsAt);
  if (objectId !== undefined && provenance["sourceObjectId"] !== objectId) {
    errors.push(
      "provenance.sourceObjectId must be <data.machineId>:<data.rule>@<data.startsAt in ms>",
    );
  }
  const ruleName = fleetRuleName(rule);
  const subject = value["subject"];
  if (ruleName !== undefined && typeof subject === "string") {
    const prefix = kind === "machine.alert_fired" ? `${ruleName} on ` : `${ruleName} cleared on `;
    if (!subject.startsWith(prefix) || !MACHINE_NAME.test(subject.slice(prefix.length))) {
      errors.push(`subject must be "${prefix}<machine name>", from Homer's rule catalogue`);
    }
  }
  return errors;
}

function eventKeyPrefixError(value: Record<string, unknown>): string | undefined {
  const eventKey = value["eventKey"];
  const provenance = value["provenance"];
  if (typeof eventKey !== "string" || !isRecord(provenance)) {
    return undefined;
  }
  const sourceSystem = provenance["sourceSystem"];
  if (typeof sourceSystem !== "string") {
    return undefined;
  }
  const separator = eventKey.indexOf(":");
  if (separator <= 0) {
    return undefined;
  }
  const prefix = eventKey.slice(0, separator);
  if (prefix === sourceSystem) {
    return undefined;
  }
  return `eventKey prefix "${prefix}" must equal provenance.sourceSystem "${sourceSystem}"`;
}

function actorKindError(actor: unknown): string | undefined {
  if (!isRecord(actor)) {
    return undefined;
  }
  if (actor["actorKind"] !== undefined && actor["actorId"] === undefined) {
    return "actorKind present only if actorId present";
  }
  return undefined;
}
