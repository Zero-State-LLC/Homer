import type { JWTVerifyGetKey } from "jose";
import type { RunnerFleetObject } from "@zs-home/catalog-worker";
import { validAccessIssuer, verifyWorkloadIdentity } from "@zs-home/catalog-worker/access";
import { json, readBytes } from "@zs-home/catalog-worker/http";
import { machineIdFrom } from "@zs-home/catalog-worker/machine";

/**
 * The machine side of the runner controller protocol: a controller polls for
 * its machine's desired state and reports what the host observed. Only a
 * workload with exactly `RUNNER_CONTROLLER_AUD`, bound by an admin to that
 * machine in the catalog, gets through. Enrollment itself is a catalog route
 * for people (ADR 013).
 */
export interface ControllerEnv {
  ACCESS_ISSUER?: string;
  RUNNER_CONTROLLER_AUD?: string;
  CATALOG_NAME: string;
  /** The catalog's namespace, bound by `script_name` (ADR 013). */
  RUNNER_FLEET?: DurableObjectNamespace<RunnerFleetObject>;
}
export const controllerPaths = new Set([
  "/v1/runner-controller/poll",
  "/v1/runner-controller/report",
]);

export async function handleControllerRequest(
  request: Request,
  env: ControllerEnv,
  key?: JWTVerifyGetKey,
): Promise<Response> {
  const url = new URL(request.url);
  if (!controllerPaths.has(url.pathname)) return json({ error: "not_found" }, 404);
  const report = url.pathname.endsWith("/report");
  if (request.method !== (report ? "POST" : "GET"))
    return json({ error: "method_not_allowed" }, 405);
  const issuer = env.ACCESS_ISSUER ?? "";
  const audience = env.RUNNER_CONTROLLER_AUD ?? "";
  if (!validAccessIssuer(issuer) || !audience.trim() || !env.CATALOG_NAME?.trim())
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
  const machineId = machineIdFrom(url);
  if (!machineId) return json({ error: "invalid_machine" }, 400);
  if (!env.RUNNER_FLEET) return json({ error: "runner_fleet_unavailable" }, 503);
  const store = env.RUNNER_FLEET.get(env.RUNNER_FLEET.idFromName(env.CATALOG_NAME));
  try {
    if (!report) {
      const command = await store.controllerPoll(machineId, principal);
      return command ? json(command) : json({ error: "forbidden" }, 403);
    }
    if (
      request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !==
      "application/json"
    )
      return json({ error: "unsupported_media_type" }, 415);
    let input: unknown;
    try {
      input = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(await readBytes(request, 4096)),
      );
    } catch (error) {
      const large = error instanceof Error && error.message === "body_too_large";
      return json({ error: large ? "body_too_large" : "invalid_payload" }, large ? 413 : 400);
    }
    const result = await store.controllerReport(machineId, principal, input);
    return typeof result === "string"
      ? json({ error: result }, result === "forbidden" ? 403 : 409)
      : json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_config")
      return json({ error: "invalid_payload" }, 400);
    return json({ error: "runner_fleet_unavailable" }, 503);
  }
}
