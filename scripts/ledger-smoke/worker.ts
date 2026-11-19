// Local-only smoke harness. Production entry has no fetch handler.
export { EventLedgerObject } from "../../packages/event-ledger/src/ledger-object.js";
import type { Env } from "../../packages/event-ledger/src/ledger-object.js";
import { openEventLedger, verifyHistory } from "../../packages/event-ledger/src/index.js";
import { event } from "../../packages/event-ledger/test/fixture.js";
export default {
  async fetch(_request: Request, env: Env): Promise<Response> {
    const ledger = openEventLedger(env.EVENT_LEDGER);
    const first = await ledger.appendActivityEvent(event());
    const retry = await ledger.appendActivityEvent(event());
    const invalid = await ledger.appendActivityEvent({ ...event(), occurredAt: "invalid" });
    const history = await ledger.readHistory();
    return Response.json({
      first: first.outcome,
      retry: retry.outcome,
      invalid: invalid.outcome,
      entries: history.length,
      integrity: verifyHistory(history).ok,
    });
  },
};
