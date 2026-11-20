import { join } from "node:path";
import type { AnySchema, ErrorObject, ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { isRecord, readJson } from "./json.js";
import { integrationContractsDir } from "./paths.js";
import type { ActivityEvent, FactoryEvent, Result, WorkRequest } from "./types.js";

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
// Node ESM default-imports this CJS plugin as the function. TypeScript models
// the same binding as the module namespace, whose default is that function.
addFormats.default(ajv);

const validateActivityEventSchema = compile("activity-event.v1.schema.json");
const validateWorkRequestSchema = compile("work-request.v1.schema.json");
const validateFactoryEventSchema = compile("factory-event.v1.schema.json");

function compile(fileName: string): ValidateFunction {
  return ajv.compile(loadSchema(fileName));
}

function loadSchema(fileName: string): AnySchema {
  const value = readJson(join(integrationContractsDir(), fileName));
  if (!isRecord(value)) {
    throw new Error(`${fileName} must be a JSON object`);
  }
  return value;
}

function schemaErrors(validate: ValidateFunction, input: unknown): string[] {
  if (validate(input)) {
    return [];
  }
  const errors = validate.errors ?? [];
  if (errors.length === 0) {
    return ["validation failed"];
  }
  return errors.map(formatAjvError);
}

function formatAjvError(error: ErrorObject): string {
  const where = error.instancePath.length > 0 ? error.instancePath : "/";
  const message = error.message ?? error.keyword;
  return `${where} ${message}`;
}

/**
 * JSON Schema cannot tie the Event Key prefix to Provenance, or require
 * actorId whenever actorKind is set. Those rules live here.
 * actorId and actorKind are filled only from an Identity Binding.
 */
function activityEventSemanticErrors(input: unknown): string[] {
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

export function validateActivityEvent(input: unknown): Result<ActivityEvent> {
  const errors = [
    ...schemaErrors(validateActivityEventSchema, input),
    ...activityEventSemanticErrors(input),
  ];
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: input as ActivityEvent };
}

export function validateWorkRequest(input: unknown): Result<WorkRequest> {
  const errors = schemaErrors(validateWorkRequestSchema, input);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: input as WorkRequest };
}

export function validateFactoryEvent(input: unknown): Result<FactoryEvent> {
  const errors = schemaErrors(validateFactoryEventSchema, input);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: input as FactoryEvent };
}
