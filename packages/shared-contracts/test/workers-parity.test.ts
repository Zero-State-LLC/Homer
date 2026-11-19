import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";
import { validateActivityEvent } from "../src/index.js";
import { validateActivityEvent as workerValidate } from "@zs-home/shared-contracts/workers";
for (const dir of ["valid", "invalid"]) {
  const root = new URL(`fixtures/${dir}/`, import.meta.url);
  for (const file of readdirSync(root).filter((f) => f.startsWith("activity-event"))) {
    it(`Workers validator matches Node for ${file}`, () => {
      const value: unknown = JSON.parse(readFileSync(new URL(file, root), "utf8"));
      expect(workerValidate(value)).toEqual(validateActivityEvent(value));
    });
  }
}
