import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson } from "../src/json.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

export function loadFixture(name: string): unknown {
  return readJson(join(fixturesDir, name));
}

export function integrationContractsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../../specs/integration-contracts");
}
