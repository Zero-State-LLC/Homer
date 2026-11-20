import { readFileSync } from "node:fs";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readJson(filePath: string): unknown {
  return parseJson(readFileSync(filePath, "utf8"));
}

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}
