import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function integrationContractsDir(): string {
  return join(here, "../../../specs/integration-contracts");
}

export function upstreamWorkPacketDir(): string {
  return join(integrationContractsDir(), "upstream", "software-factory");
}
