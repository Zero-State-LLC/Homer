import type { MappingCatalogObject } from "../src/store.js";
declare global {
  namespace Cloudflare {
    interface Env {
      MAPPING_CATALOG: DurableObjectNamespace<MappingCatalogObject>;
    }
  }
}
