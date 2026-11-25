import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  plugins: [
    cloudflareTest({ wrangler: { configPath: "./packages/intake-worker/test/wrangler.jsonc" } }),
  ],
  test: {
    name: "intake-workers",
    fileParallelism: false,
    include: ["packages/intake-worker/test/**/*.test.ts"],
    testTimeout: 30000,
  },
});
