import { _ } from "ajv/dist/compile/codegen/index.js";
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import standaloneCode from "ajv/dist/standalone/index.js";
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  code: { source: true, formats: _`require("ajv-formats/dist/formats").fullFormats` },
});
addFormats(ajv);
const schemas = ["v1", "v2"].map((version) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../../specs/integration-contracts/activity-event.${version}.schema.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  ),
);
for (const schema of schemas) ajv.addSchema(schema);
const [v1, v2] = schemas;
writeFileSync(
  new URL("../dist/activity-validator.cjs", import.meta.url),
  standaloneCode(ajv, { v1: v1.$id, v2: v2.$id }),
);
copyFileSync(
  new URL("../src/activity-validator.d.cts", import.meta.url),
  new URL("../dist/activity-validator.d.cts", import.meta.url),
);
