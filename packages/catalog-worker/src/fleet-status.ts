import { projectFleetStatus, type FleetStatus } from "@zs-home/projections";
import { ipAddressIn } from "@zs-home/shared-contracts/workers";
import { adminHeaders } from "./admin-headers.js";
import { fleetStatusPage, fleetStatusStyle } from "./fleet-status-ui.js";
import type { RunnerBindings } from "./runner-http.js";

/**
 * The fleet status view (fleet monitoring spec, "Status view"): the read
 * audience, `GET` only. `/v1/fleet` answers JSON; `/v1/workspace/fleet` is the
 * page.
 */
export const fleetStatusPaths = new Set([
  "/v1/fleet",
  "/v1/workspace/fleet",
  "/v1/workspace/fleet.css",
]);

export interface FleetStatusBindings {
  /**
   * The front door's `https://` origin for the sparkDash page, the Collector's
   * `frontDoorOrigin`. Optional: without it, the view shows no link.
   */
  SPARKDASH_ORIGIN?: string;
}

export interface FleetStatusView extends FleetStatus {
  /** The sparkDash page through the front door, or null when not configured. */
  sparkdashUrl: string | null;
  configRevision: number;
}

/** The configured origin, if it is a bare `https://` origin with a host name. */
export function sparkdashUrl(value: string | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    value.replace(/\/$/, "") !== url.origin ||
    ipAddressIn(url.hostname) !== undefined
  )
    return null;
  return `${url.origin}/`;
}

export async function fleetStatusResponse(
  url: URL,
  env: RunnerBindings & FleetStatusBindings & { CATALOG_NAME: string },
): Promise<Response> {
  if (url.pathname.endsWith(".css")) return fleetStatusStyle();
  const html = url.pathname === "/v1/workspace/fleet";
  const failure = (error: string, status: number) =>
    html
      ? fleetStatusPage(undefined, error, status)
      : new Response(JSON.stringify({ error }), {
          status,
          headers: adminHeaders("application/json"),
        });
  if ([...url.searchParams.keys()].length > 0) return failure("invalid_query", 400);
  let view: FleetStatusView;
  try {
    if (!env.RUNNER_FLEET) throw new Error("unavailable");
    const store = env.RUNNER_FLEET.get(env.RUNNER_FLEET.idFromName(env.CATALOG_NAME));
    const [snapshot, runner] = await Promise.all([store.fleetSnapshot(), store.read()]);
    const configured = runner.config.machines.map((m) => ({ id: m.id, alias: m.alias }));
    view = {
      ...projectFleetStatus(snapshot, configured, { now: Date.now() }),
      sparkdashUrl: sparkdashUrl(env.SPARKDASH_ORIGIN),
      configRevision: runner.config.revision,
    };
  } catch {
    return failure("fleet_status_unavailable", 503);
  }
  if (html) return fleetStatusPage(view);
  return new Response(JSON.stringify(view), { headers: adminHeaders("application/json") });
}
