import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const path = "packages/catalog-worker/src/bindings.d.ts";
execFileSync(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "types",
    path,
    "--config",
    "packages/catalog-worker/wrangler.jsonc",
    "--env-interface",
    "CatalogBindings",
    "--include-runtime=false",
    "--include-main-module=false",
  ],
  { cwd: root, stdio: "inherit" },
);
// Wrangler emits an extensionless import. NodeNext requires the emitted .js path.
const output = new URL(`../${path}`, import.meta.url);
writeFileSync(
  output,
  readFileSync(output, "utf8").replace('import("./index")', 'import("./index.js")') +
    "\nexport { CatalogBindings };\n",
);
