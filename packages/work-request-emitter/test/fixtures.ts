import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** A fixture from `@zs-home/shared-contracts`, shared rather than copied. */
export function contractsFixture(name: string): string {
  return join(here, "../../shared-contracts/test/fixtures", name);
}

/** The repository root, whose `docs/work-requests/policy.json` is Homer's policy. */
export const repositoryRoot = join(here, "../../..");
