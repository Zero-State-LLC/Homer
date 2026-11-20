import type { EventLedgerObject } from "../src/ledger-object.js";
declare global {
  namespace Cloudflare {
    interface Env {
      EVENT_LEDGER: DurableObjectNamespace<EventLedgerObject>;
    }
  }
}
