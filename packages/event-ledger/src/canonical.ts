import canonicalize from "canonicalize";
import { createHash } from "node:crypto";
import type { ActivityEvent } from "@zs-home/shared-contracts";
import type { Correction, LedgerEntry } from "./types.js";

// Check descriptors before reading values. JSON has no getters, sparse arrays,
// symbols, cycles, custom prototypes or properties that disappear on encoding.
function assertJson(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (/[\uD800-\uDFFF]/u.test(value)) throw new Error("JSON strings must contain valid Unicode");
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object") throw new Error("Value is outside the JSON domain");
  const array = Array.isArray(value);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (!array && prototype !== Object.prototype && prototype !== null)
    throw new Error("JSON requires plain objects");
  if (ancestors.has(value)) throw new Error("JSON cannot contain cycles");
  ancestors.add(value);
  const keys = Reflect.ownKeys(value);
  if (array && keys.length !== value.length + 1)
    throw new Error("JSON requires dense arrays without extra properties");
  for (const key of keys) {
    if (array && key === "length") continue;
    if (typeof key !== "string") throw new Error("JSON does not support symbol keys");
    if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))
      throw new Error("Invalid array key");
    assertJson(key, ancestors);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
      throw new Error("JSON requires enumerable data properties");
    assertJson(descriptor.value, ancestors);
  }
  ancestors.delete(value);
}
export function canonicalJson(value: unknown): string {
  assertJson(value);
  const result = canonicalize(value);
  if (typeof result !== "string") throw new Error("Value is outside the JSON domain");
  return result;
}
export function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
export function snapshot(value: unknown): unknown {
  return JSON.parse(canonicalJson(value)) as unknown;
}
export function comparisonDigest(payload: ActivityEvent | Correction): string {
  const copy = snapshot(payload) as ActivityEvent | Correction;
  const strip = (p: object): void => {
    for (const key of ["collectedAt", "collector", "collectorVersion"])
      Reflect.deleteProperty(p, key);
  };
  strip(copy.provenance);
  if (copy.contract === "home.correction/v1" && copy.action === "supersede")
    strip(copy.replacement.provenance);
  return digest(copy);
}
export function entryBody(entry: LedgerEntry): object {
  return {
    formatVersion: entry.formatVersion,
    sequence: entry.sequence,
    entryType: entry.entryType,
    previousDigest: entry.previousDigest,
    payload: entry.payload,
  };
}
