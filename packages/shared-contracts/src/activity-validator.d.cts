import type { ValidateFunction } from "ajv";
/**
 * Standalone validators for Activity Event contract versions 1 to 3, version
 * 3's Provenance on its own, and the Fleet Report.
 */
declare const validators: {
  v1: ValidateFunction;
  v2: ValidateFunction;
  v3: ValidateFunction;
  provenance: ValidateFunction;
  fleetReport: ValidateFunction;
};
export = validators;
