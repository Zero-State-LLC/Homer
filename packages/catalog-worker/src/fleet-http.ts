import type { JWTVerifyGetKey } from "jose";
import { validateAccessConfig, verifyAccessIdentity } from "./access.js";
import { json, readBytes } from "./http.js";
import type { RunnerEnv } from "./runner-http.js";
import { parseFleetCollectorBinding } from "./runner-store.js";

/**
 * The admin side of fleet intake (fleet monitoring spec, "Intake"): an admin
 * binds the Fleet Collector's principal digest to the Machines it may report
 * on, with a revision precondition and an audit record. The report route
 * itself is `homer-intake`'s (ADR 013).
 */
export const fleetPaths = new Set(["/v1/admin/fleet/collector"]);

export async function handleFleetRequest(
  request: Request,
  env: RunnerEnv,
  key?: JWTVerifyGetKey,
): Promise<Response> {
  const url = new URL(request.url);
  if (!fleetPaths.has(url.pathname)) return json({ error: "not_found" }, 404);
  if (request.method !== "GET" && request.method !== "PUT")
    return json({ error: "method_not_allowed" }, 405);
  try {
    validateAccessConfig(env);
  } catch {
    return json({ error: "access_not_configured" }, 503);
  }
  const origin = request.headers.get("Origin");
  if ((origin && origin !== url.origin) || request.headers.get("Sec-Fetch-Site") === "cross-site")
    return json({ error: "cross_origin_denied" }, 403);
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || token.length > 16384) return json({ error: "unauthorized" }, 401);
  let principal: string;
  try {
    principal = (await verifyAccessIdentity(token, env, true, key)).principal;
  } catch {
    return json({ error: "unauthorized" }, 401);
  }
  if ([...url.searchParams.keys()].length > 0) return json({ error: "invalid_query" }, 400);
  if (!env.RUNNER_FLEET) return json({ error: "runner_fleet_unavailable" }, 503);
  const store = env.RUNNER_FLEET.get(env.RUNNER_FLEET.idFromName(env.CATALOG_NAME));
  try {
    if (request.method === "GET") {
      const result = await store.fleetCollectorBinding();
      return json(result, 200, result.revision);
    }
    const match = request.headers.get("If-Match");
    if (!match) return json({ error: "precondition_required" }, 428);
    if (!/^"(0|[1-9][0-9]*)"$/.test(match) || !Number.isSafeInteger(Number(match.slice(1, -1))))
      return json({ error: "invalid_precondition" }, 400);
    const expected = Number(match.slice(1, -1));
    if (
      request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !==
      "application/json"
    )
      return json({ error: "unsupported_media_type" }, 415);
    let input: unknown;
    try {
      input = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(await readBytes(request, 8192)),
      );
    } catch (error) {
      const large = error instanceof Error && error.message === "body_too_large";
      return json({ error: large ? "body_too_large" : "invalid_payload" }, large ? 413 : 400);
    }
    const parsed = parseFleetCollectorBinding(input);
    if (parsed.revision !== expected + 1) return json({ error: "invalid_next_revision" }, 400);
    const result = await store.bindFleetCollector(expected, parsed, principal);
    if (result !== "saved") return json({ error: result }, 409);
    const saved = await store.fleetCollectorBinding();
    return json(saved, 200, saved.revision);
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_config")
      return json({ error: "invalid_payload" }, 400);
    return json({ error: "runner_fleet_unavailable" }, 503);
  }
}
