import type { EventLedgerObject } from "./ledger-object.js";
import { EventLedgerStorageError } from "./types.js";
import type { AppendOutcome, EventLedger, LedgerEntry } from "./types.js";
import { assertHistory } from "./history.js";

export interface LedgerRpc extends EventLedger {
  readHistory(options?: {
    fromSequence?: number;
    throughSequence?: number;
  }): Promise<LedgerEntry[]>;
}

export function openEventLedger(namespace: DurableObjectNamespace<EventLedgerObject>): EventLedger {
  // The RPC mapped type cannot represent ActivityEvent.data (unknown JSON).
  // Use the explicit wire contract; readHistory validates every returned entry.
  const getStub = () => namespace.get(namespace.idFromName("event-ledger")) as unknown as LedgerRpc;
  const call = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      throw new EventLedgerStorageError(error);
    }
  };
  return {
    appendActivityEvent: (input) => call<AppendOutcome>(() => getStub().appendActivityEvent(input)),
    appendCorrection: (input) => call<AppendOutcome>(() => getStub().appendCorrection(input)),
    head: () => call(() => getStub().head()),
    readHistory: (options) =>
      call(async () => {
        const stub = getStub();
        const head = await stub.head();
        const requested = options?.throughSequence;
        if (requested !== undefined && (!Number.isSafeInteger(requested) || requested < 0))
          throw new RangeError("Invalid throughSequence");
        const through = Math.min(requested ?? Number.MAX_SAFE_INTEGER, head?.sequence ?? 0);
        const entries: LedgerEntry[] = [];
        while (entries.length < through) {
          const page = await stub.readHistory({
            fromSequence: entries.length + 1,
            throughSequence: through,
          });
          if (
            !page.length ||
            page[0]?.sequence !== entries.length + 1 ||
            page.at(-1)!.sequence > through
          )
            throw new Error("Incomplete or invalid history page");
          entries.push(...page);
        }
        assertHistory(entries, through === head?.sequence ? head : undefined);
        return entries;
      }),
  };
}
