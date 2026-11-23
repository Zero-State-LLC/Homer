import type { BuzzChannelCatalogObject } from "../src/buzz-store.js";
import type { MappingCatalogObject } from "../src/store.js";
import type { EventLedgerObject } from "@zs-home/event-ledger/worker";
declare global {
  namespace Cloudflare {
    interface Env {
      EVENT_LEDGER: DurableObjectNamespace<EventLedgerObject>;
      MAPPING_CATALOG: DurableObjectNamespace<MappingCatalogObject>;
      BUZZ_CHANNELS: DurableObjectNamespace<BuzzChannelCatalogObject>;
    }
  }
}
