import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  plugins: [
    cloudflareTest({ wrangler: { configPath: "./packages/trace-archive/test/wrangler.jsonc" } }),
  ],
  test: {
    name: "trace-r2",
    include: ["packages/trace-archive/test/r2.test.ts"],
    fileParallelism: false,
  },
});
