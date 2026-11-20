// Local-only smoke harness. Production entry has no fetch handler.
export { EventLedgerObject } from "../../packages/event-ledger/src/ledger-object.js";
import type { Env } from "../../packages/event-ledger/src/ledger-object.js";
import { openEventLedger, verifyHistory } from "../../packages/event-ledger/src/index.js";
import { event } from "../../packages/event-ledger/test/fixture.js";
declare const __LOCAL_LEDGER_SMOKE__: boolean;
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Only the local smoke command injects this compile-time opt-in. A normal
    // deployment has no opt-in and cannot reach storage, even with a forged Host.
    if (typeof __LOCAL_LEDGER_SMOKE__ === "undefined" || !__LOCAL_LEDGER_SMOKE__)
      return new Response("Not found", { status: 404 });
    if (new URL(request.url).pathname === "/health") return new Response("ready");
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
