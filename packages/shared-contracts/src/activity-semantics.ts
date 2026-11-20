function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/**
 * JSON Schema cannot tie the Event Key prefix to Provenance, or require
 * actorId whenever actorKind is set. Those rules live here.
 * actorId and actorKind are filled only from an Identity Binding.
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
