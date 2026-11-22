import type { MappingCatalogObject } from "../src/store.js";
import type { EventLedgerObject } from "@zs-home/event-ledger/worker";
declare global {
  namespace Cloudflare {
    interface Env {
      RUNNER_FLEET: DurableObjectNamespace<import("../src/runner-store.js").RunnerFleetObject>;
      EVENT_LEDGER: DurableObjectNamespace<EventLedgerObject>;
      MAPPING_CATALOG: DurableObjectNamespace<MappingCatalogObject>;
    }
  }
}
