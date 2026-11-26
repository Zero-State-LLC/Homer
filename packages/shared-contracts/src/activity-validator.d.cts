import type { ValidateFunction } from "ajv";
/**
 * Standalone validators for Activity Event contract versions 1 to 4, version
 * 3's Provenance on its own, the Fleet Report, the Identity Binding snapshot
 * and the Routing Policy.
 */
declare const validators: {
  v1: ValidateFunction;
  v2: ValidateFunction;
  v3: ValidateFunction;
  v4: ValidateFunction;
  provenance: ValidateFunction;
  fleetReport: ValidateFunction;
  identityBindings: ValidateFunction;
  routingPolicy: ValidateFunction;
};
export = validators;
