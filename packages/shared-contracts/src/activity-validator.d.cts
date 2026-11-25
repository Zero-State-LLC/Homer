import type { ValidateFunction } from "ajv";
/** Standalone validators for Activity Event contract versions 1 to 3, and the Fleet Report. */
declare const validators: {
  v1: ValidateFunction;
  v2: ValidateFunction;
  v3: ValidateFunction;
  fleetReport: ValidateFunction;
};
export = validators;
