import type { JWTVerifyGetKey } from "jose";
import type { RunnerFleetObject } from "@zs-home/catalog-worker";
import { validAccessIssuer, verifyWorkloadIdentity } from "@zs-home/catalog-worker/access";
import { json, readBytes } from "@zs-home/catalog-worker/http";
import { openEventLedger } from "@zs-home/event-ledger";
import type { EventLedgerObject } from "@zs-home/event-ledger/worker";
import { MAX_FLEET_REPORT_BYTES, validateFleetReport } from "@zs-home/shared-contracts/workers";

/**
 * Fleet intake (fleet monitoring spec, "Intake"): a second report type on the
 * runner controller protocol. Only a workload with exactly
 * `FLEET_COLLECTOR_AUD`, bound by an admin in the catalog to the Machines it
 * reports on, gets through. It records observations only and returns no
 * desired state.
 */
export interface FleetEnv {
  ACCESS_ISSUER?: string;
  FLEET_COLLECTOR_AUD?: string;
  /** Read only to refuse a fleet audience equal to the runner controller's. */
  RUNNER_CONTROLLER_AUD?: string;
  CATALOG_NAME: string;
  /** The catalog's namespace, bound by `script_name` (ADR 013). */
  RUNNER_FLEET?: DurableObjectNamespace<RunnerFleetObject>;
  EVENT_LEDGER?: DurableObjectNamespace<EventLedgerObject>;
}
export const fleetPaths = new Set(["/v1/fleet/report"]);

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
}

export async function handleFleetReport(
  request: Request,
  env: FleetEnv,
  key?: JWTVerifyGetKey,
): Promise<Response> {
  const url = new URL(request.url);
  if (!fleetPaths.has(url.pathname)) return json({ error: "not_found" }, 404);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const issuer = env.ACCESS_ISSUER ?? "";
  const audience = env.FLEET_COLLECTOR_AUD ?? "";
  if (
    !validAccessIssuer(issuer) ||
    !audience.trim() ||
    audience === env.RUNNER_CONTROLLER_AUD ||
    !env.CATALOG_NAME?.trim()
  )
    return json({ error: "access_not_configured" }, 503);
  const origin = request.headers.get("Origin");
  if ((origin && origin !== url.origin) || request.headers.get("Sec-Fetch-Site") === "cross-site")
    return json({ error: "cross_origin_denied" }, 403);
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || token.length > 16384) return json({ error: "unauthorized" }, 401);
  let principal: string;
  try {
    principal = (await verifyWorkloadIdentity(token, issuer, audience, key)).principal;
  } catch {
    return json({ error: "unauthorized" }, 401);
  }
  if ([...url.searchParams.keys()].length > 0) return json({ error: "invalid_query" }, 400);
  if (!env.RUNNER_FLEET || !env.EVENT_LEDGER)
    return json({ error: "fleet_intake_unavailable" }, 503);
  if (
    request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
  )
    return json({ error: "unsupported_media_type" }, 415);
  let input: unknown;
  try {
    input = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await readBytes(request, MAX_FLEET_REPORT_BYTES),
      ),
    );
  } catch (error) {
    const large = error instanceof Error && error.message === "body_too_large";
    return json({ error: large ? "body_too_large" : "invalid_report" }, large ? 413 : 400);
  }
  // A report that does not validate is refused whole: nothing is appended or stored.
  const checked = validateFleetReport(input);
  if (!checked.ok) return json({ error: "invalid_report" }, 400);
  const report = checked.value;
  const digest = await sha256(JSON.stringify(report));
  const machineIds = [
    ...new Set([
      ...report.machines.map((m) => m.machineId),
      ...report.events.flatMap((e) => {
        const id = e.data?.["machineId"];
        return typeof id === "string" ? [id] : [];
      }),
    ]),
  ];
  const store = env.RUNNER_FLEET.get(env.RUNNER_FLEET.idFromName(env.CATALOG_NAME));
  try {
    const admission = await store.fleetReportAdmission(
      principal,
      report.reportId,
      digest,
      machineIds,
    );
    if (typeof admission === "object") return json(admission.receipt);
    if (admission === "rate_limited") return json({ error: admission }, 429);
    if (admission === "report_conflict") return json({ error: admission }, 409);
    if (admission !== "admitted") return json({ error: admission }, 403);
  } catch {
    return json({ error: "fleet_intake_unavailable" }, 503);
  }
  // The events go to the ledger before the receipt exists, so a receipt always
  // means every event is recorded. A Duplicate counts as success.
  const ledger = openEventLedger(env.EVENT_LEDGER);
  for (const event of report.events) {
    let outcome: string;
    try {
      outcome = (await ledger.appendActivityEvent(event)).outcome;
    } catch {
      return json({ error: "ledger_unavailable" }, 503);
    }
    if (outcome === "conflict") return json({ error: "event_conflict" }, 409);
    if (outcome !== "appended" && outcome !== "duplicate")
      return json({ error: "ledger_refused" }, 422);
  }
  try {
    const committed = await store.fleetReportCommit(
      principal,
      report.reportId,
      digest,
      machineIds,
      report.events.length,
      {
        reportId: report.reportId,
        collectedAt: report.collectedAt,
        sparkdash: report.sparkdash,
        machines: report.machines,
        diagnostics: report.diagnostics,
      },
    );
    if (committed === "report_conflict") return json({ error: committed }, 409);
    if (typeof committed === "string") return json({ error: committed }, 403);
    return json(committed);
  } catch {
    return json({ error: "fleet_intake_unavailable" }, 503);
  }
}
