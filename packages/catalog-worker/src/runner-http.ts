import type { JWTVerifyGetKey } from "jose";
import { verifyAccess, validateAccessConfig, type AccessConfig } from "./access.js";
import { json, readBytes } from "./http.js";
import { RunnerFleetObject, parseRunnerConfig, MAX_RUNNER_BYTES } from "./runner-store.js";
import { runnerAsset } from "./runner-ui.js";
import { machineAsset, machinePaths } from "./machine-ui.js";
export interface RunnerBindings {
  RUNNER_FLEET: DurableObjectNamespace<RunnerFleetObject>;
}
export interface RunnerEnv extends RunnerBindings, AccessConfig {}
export const runnerPaths = new Set([
  "/v1/admin/runners",
  "/v1/admin/runners/app.js",
  "/v1/admin/runners/style.css",
  "/v1/admin/runners/config",
  ...machinePaths,
]);
export async function handleRunnerRequest(
  request: Request,
  env: RunnerEnv,
  key?: JWTVerifyGetKey,
): Promise<Response> {
  const url = new URL(request.url);
  if (!runnerPaths.has(url.pathname)) return json({ error: "not_found" }, 404);
  if (request.method !== "GET" && !(url.pathname.endsWith("/config") && request.method === "PUT"))
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
    principal = await verifyAccess(token, env, true, key);
  } catch {
    return json({ error: "unauthorized" }, 401);
  }
  if (machinePaths.has(url.pathname)) return machineAsset(url.pathname);
  if (!url.pathname.endsWith("/config")) return runnerAsset(url.pathname);
  if (!env.RUNNER_FLEET) return json({ error: "runner_fleet_unavailable" }, 503);
  const store = env.RUNNER_FLEET.get(env.RUNNER_FLEET.idFromName(env.CATALOG_NAME));
  if (request.method === "GET") {
    try {
      const result = await store.read();
      return json(result, 200, result.config.revision);
    } catch {
      return json({ error: "runner_fleet_unavailable" }, 503);
    }
  }
  const match = request.headers.get("If-Match");
  if (!match) return json({ error: "precondition_required" }, 428);
  if (!/^"(0|[1-9][0-9]*)"$/.test(match) || !Number.isSafeInteger(Number(match.slice(1, -1))))
    return json({ error: "invalid_precondition" }, 400);
  const expected = Number(match.slice(1, -1));
  if (
    request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
  )
    return json({ error: "unsupported_media_type" }, 415);
  let config;
  try {
    config = parseRunnerConfig(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await readBytes(request, MAX_RUNNER_BYTES),
        ),
      ),
    );
    if (config.revision !== expected + 1) return json({ error: "invalid_next_revision" }, 400);
  } catch (error) {
    const large = error instanceof Error && error.message === "body_too_large";
    return json({ error: large ? "body_too_large" : "invalid_config" }, large ? 413 : 400);
  }
  try {
    const result = await store.replace(expected, config, principal);
    if (result !== "saved")
      return json({ error: result === "conflict" ? "revision_conflict" : result }, 409);
    const loaded = await store.read();
    return json(loaded, 200, loaded.config.revision);
  } catch {
    return json({ error: "runner_fleet_unavailable" }, 503);
  }
}
