import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { canonicalJson, digest } from "../src/canonical.js";
const fixtures = JSON.parse(
  readFileSync(new URL("fixtures/canonical.json", import.meta.url), "utf8"),
) as { vectors: { input: unknown; canonical: string; sha256: string }[] };
it.each(fixtures.vectors)("matches independently fixed RFC 8785 and SHA-256 bytes", (vector) => {
  expect(canonicalJson(vector.input)).toBe(vector.canonical);
  expect(digest(vector.input)).toBe(vector.sha256);
});
