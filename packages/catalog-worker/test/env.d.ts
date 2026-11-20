import type { MappingCatalogObject } from "../src/store.js";
import type { EventLedgerObject } from "@zs-home/event-ledger/worker";
declare global {
  namespace Cloudflare {
    interface Env {
      EVENT_LEDGER: DurableObjectNamespace<EventLedgerObject>;
      MAPPING_CATALOG: DurableObjectNamespace<MappingCatalogObject>;
    }
  }
}
