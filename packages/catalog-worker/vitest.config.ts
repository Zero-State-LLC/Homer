import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  plugins: [
    cloudflareTest({ wrangler: { configPath: "./packages/catalog-worker/test/wrangler.jsonc" } }),
  ],
  test: {
    name: "catalog-workers",
    fileParallelism: false,
    include: [
      "packages/catalog-worker/test/**/*.test.ts",
      "packages/company-sdk/test/integration.test.ts",
    ],
    testTimeout: 30000,
  },
});
