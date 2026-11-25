import { activityEventSemanticErrors } from "./activity-semantics.js";
import { fleetReportSemanticErrors } from "./fleet-report.js";
import { join } from "node:path";
import type { AnySchema, ErrorObject, ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { isRecord, readJson } from "./json.js";
import { integrationContractsDir } from "./paths.js";
import type { ActivityEvent, FactoryEvent, FleetReport, Result, WorkRequest } from "./types.js";

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
// Node ESM default-imports this CJS plugin as the function. TypeScript models
// the same binding as the module namespace, whose default is that function.
addFormats.default(ajv);

const validateActivityEventV1Schema = compile("activity-event.v1.schema.json");
const validateActivityEventV2Schema = compile("activity-event.v2.schema.json");
const validateActivityEventV3Schema = compile("activity-event.v3.schema.json");
// After version 3, which a Fleet Report's events reference by $id.
const validateFleetReportSchema = compile("fleet-report.v1.schema.json");
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
 * Validates against the version the input's `contract` names. Anything else, including a
 * missing or unknown contract, is checked as version 1, so its errors stay as they were.
 */
export function validateActivityEvent(input: unknown): Result<ActivityEvent> {
  const contract = isRecord(input) ? input["contract"] : undefined;
  const schema =
    contract === "home.activity-event/v3"
      ? validateActivityEventV3Schema
      : contract === "home.activity-event/v2"
        ? validateActivityEventV2Schema
        : validateActivityEventV1Schema;
  const errors = [...schemaErrors(schema, input), ...activityEventSemanticErrors(input)];
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: input as ActivityEvent };
}

/** A Fleet Report, its events under Activity Event contract version 3. */
export function validateFleetReport(input: unknown): Result<FleetReport> {
  const errors = [
    ...schemaErrors(validateFleetReportSchema, input),
    ...fleetReportSemanticErrors(input),
  ];
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: input as FleetReport };
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
