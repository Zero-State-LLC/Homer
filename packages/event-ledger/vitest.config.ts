import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  root: new URL("../..", import.meta.url).pathname,
  plugins: [cloudflareTest({ wrangler: { configPath: "./packages/event-ledger/wrangler.jsonc" } })],
  test: {
    name: "workers",
    fileParallelism: false,
    include: [
      "packages/event-ledger/test/ledger.test.ts",
      "packages/event-ledger/test/concurrency.test.ts",
    ],
    testTimeout: 30000,
  },
});
