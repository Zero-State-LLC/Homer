// The same declarations as packages/catalog-worker/test/env.d.ts, which the
// root typecheck merges with these, plus job evidence.
import type { MappingCatalogObject } from "../../catalog-worker/src/store.js";
import type { EventLedgerObject } from "@zs-home/event-ledger/worker";
declare global {
  namespace Cloudflare {
    interface Env {
      RUNNER_FLEET: DurableObjectNamespace<
        import("../../catalog-worker/src/runner-store.js").RunnerFleetObject
      >;
      EVENT_LEDGER: DurableObjectNamespace<EventLedgerObject>;
      JOB_EVIDENCE: DurableObjectNamespace<
        import("../src/job-evidence-store.js").WorkflowJobEvidenceObject
      >;
      MAPPING_CATALOG: DurableObjectNamespace<MappingCatalogObject>;
    }
  }
}
