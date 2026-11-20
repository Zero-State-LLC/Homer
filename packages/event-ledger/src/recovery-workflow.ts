import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { EventLedgerObject } from "./ledger-object.js";
import { MAX_LEDGER_ARCHIVE_BYTES } from "./archive.js";
import {
  parseLedgerRecoveryParams,
  runLedgerRecovery,
  type LedgerRecoveryParams,
  type LedgerRecoveryPort,
} from "./recovery-runner.js";
export { EventLedgerObject };
interface RecoveryEnv {
  SOURCE_LEDGER?: DurableObjectNamespace<EventLedgerObject>;
  RECOVERY_LEDGER: DurableObjectNamespace<EventLedgerObject>;
  ARCHIVE_BUCKET: R2Bucket;
  SOURCE_LEDGER_NAME?: string;
  RECOVERY_ENABLED?: string;
}
export class LedgerRecoveryWorkflow extends WorkflowEntrypoint<RecoveryEnv, LedgerRecoveryParams> {
  async run(event: WorkflowEvent<LedgerRecoveryParams>, step: WorkflowStep) {
    if (
      this.env.RECOVERY_ENABLED !== "true" ||
      !this.env.SOURCE_LEDGER ||
      !this.env.SOURCE_LEDGER_NAME
    )
      throw new Error("recovery_disabled");
    const params = parseLedgerRecoveryParams(event.payload);
    // Explicit wire contracts preserve the Activity Event's arbitrary JSON data.
    const source = this.env.SOURCE_LEDGER.get(
      this.env.SOURCE_LEDGER.idFromName(this.env.SOURCE_LEDGER_NAME),
    ) as unknown as LedgerRecoveryPort;
    const target = this.env.RECOVERY_LEDGER.get(
      this.env.RECOVERY_LEDGER.idFromName(params.drillId),
    ) as unknown as LedgerRecoveryPort;
    return step.do(
      "verify Event Ledger recovery",
      { retries: { limit: 0, delay: "1 second" }, timeout: "2 minutes" },
      () =>
        runLedgerRecovery(params, source, target, {
          load: async (key) => {
            const object = await this.env.ARCHIVE_BUCKET.get(key);
            if (!object) return null;
            if (object.size > MAX_LEDGER_ARCHIVE_BYTES) throw new Error("ledger_archive_too_large");
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
