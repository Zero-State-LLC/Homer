import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isRecord, readJson } from "../src/json.js";
import { integrationContractsDir } from "./fixture.js";

const fileNamePattern = /^([a-z0-9-]+)\.v(\d+)\.schema\.json$/;

describe("contract versioning guard", () => {
  it("requires every HOME schema $id and contract const to match its .vN file name", () => {
    // The upstream Work Packet snapshot is not a HOME contract. It lives under
    // upstream/ and is outside this directory listing.
    const dir = integrationContractsDir();
    const files = readdirSync(dir).filter((name) => name.endsWith(".schema.json"));
    expect(files.length).toBeGreaterThan(0);

    for (const fileName of files) {
      const match = fileNamePattern.exec(fileName);
      expect(match, `${fileName} must be named <name>.vN.schema.json`).not.toBeNull();
      if (match === null) {
        continue;
      }
      const name = match[1];
      const version = match[2];
      if (name === undefined || version === undefined) {
        throw new Error(`unparsed contract file name ${fileName}`);
      }
      const schema = readJson(join(dir, fileName));
      if (!isRecord(schema)) {
        throw new Error(`${fileName} must be a JSON object`);
      }
      const id = schema["$id"];
      expect(typeof id, fileName).toBe("string");
      if (typeof id !== "string") {
        continue;
      }
      expect(id.endsWith(`/v${version}`), fileName).toBe(true);
      const properties = schema["properties"];
      if (!isRecord(properties)) {
        throw new Error(`${fileName} must declare properties`);
      }
      const contract = properties["contract"];
      if (!isRecord(contract)) {
        throw new Error(`${fileName} must declare a contract const`);
      }
      expect(contract["const"], fileName).toBe(`home.${name}/v${version}`);
    }
  });
});
