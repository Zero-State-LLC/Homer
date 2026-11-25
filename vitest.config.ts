import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: [
            "packages/shared-contracts/test/**/*.test.ts",
            "packages/curator-runner/test/**/*.test.ts",
            "packages/curator-host-docker/test/**/*.test.ts",
            "packages/buzz-collector/test/**/*.test.ts",
            "packages/work-request-emitter/test/**/*.test.ts",
            "packages/event-ledger/test/canonical.test.ts",
            "packages/projections/test/**/*.test.ts",
            "packages/github-sync/test/**/*.test.ts",
            "packages/event-ledger/test/client.test.ts",
            "packages/event-ledger/test/validation.test.ts",
          ],
        },
      },
      "packages/event-ledger/vitest.config.ts",
      "packages/catalog-worker/vitest.config.ts",
    ],
  },
});
