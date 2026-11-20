import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { MappingCatalogObject } from "./store.js";
import { MAX_ARCHIVE_BYTES } from "./archive.js";
import { parseRecoveryParams, runCatalogRecovery, type RecoveryParams } from "./recovery-runner.js";
export { MappingCatalogObject };
interface RecoveryEnv {
  SOURCE_CATALOG?: DurableObjectNamespace<MappingCatalogObject>;
  RECOVERY_CATALOG: DurableObjectNamespace<MappingCatalogObject>;
  ARCHIVE_BUCKET: R2Bucket;
  SOURCE_CATALOG_NAME?: string;
  RECOVERY_ENABLED?: string;
}
export class CatalogRecoveryWorkflow extends WorkflowEntrypoint<RecoveryEnv, RecoveryParams> {
  async run(event: WorkflowEvent<RecoveryParams>, step: WorkflowStep) {
    if (
      this.env.RECOVERY_ENABLED !== "true" ||
      !this.env.SOURCE_CATALOG ||
      !this.env.SOURCE_CATALOG_NAME
    )
      throw new Error("recovery_disabled");
    const params = parseRecoveryParams(event.payload);
    const source = this.env.SOURCE_CATALOG.get(
      this.env.SOURCE_CATALOG.idFromName(this.env.SOURCE_CATALOG_NAME),
    );
    const target = this.env.RECOVERY_CATALOG.get(
      this.env.RECOVERY_CATALOG.idFromName(params.drillId),
    );
    return step.do(
      "verify catalog recovery",
      { retries: { limit: 0, delay: "1 second" }, timeout: "2 minutes" },
      () =>
        runCatalogRecovery(params, source, target, {
          load: async (key) => {
            const object = await this.env.ARCHIVE_BUCKET.get(key);
            if (!object) return null;
            if (object.size > MAX_ARCHIVE_BYTES) throw new Error("archive_too_large");
            return JSON.parse(await object.text()) as unknown;
          },
          saveIfAbsent: async (key, archive) => {
            await this.env.ARCHIVE_BUCKET.put(key, JSON.stringify(archive), {
              onlyIf: { etagDoesNotMatch: "*" },
              httpMetadata: { contentType: "application/json" },
            });
          },
        }),
    );
  }
}
export default {
  fetch() {
    return new Response(null, { status: 404 });
  },
};
