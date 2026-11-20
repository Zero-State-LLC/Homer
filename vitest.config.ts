import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: [
            "packages/shared-contracts/test/**/*.test.ts",
            "packages/event-ledger/test/canonical.test.ts",
            "packages/event-ledger/test/client.test.ts",
            "packages/event-ledger/test/validation.test.ts",
          ],
        },
      },
      "packages/event-ledger/vitest.config.ts",
    ],
  },
});
