import type { JWTVerifyGetKey } from "jose";
import { validateAccessConfig, verifyAccessIdentity } from "./access.js";
import type { RunnerEnv } from "./runner-http.js";
import { json, readBytes } from "./http.js";
import { parseControllerBinding } from "./runner-store.js";
export interface ControllerBindings {
  RUNNER_CONTROLLER_AUD?: string;
  RUNNER_HEARTBEAT_BUDGET_SECONDS?: string;
}
export interface ControllerEnv extends RunnerEnv, ControllerBindings {}
export const controllerPaths = new Set([
  "/v1/runner-controller/poll",
  "/v1/runner-controller/report",
  "/v1/admin/runners/binding",
  "/v1/admin/runners/observation",
]);
export async function handleControllerRequest(
  request: Request,
  env: ControllerEnv,
  key?: JWTVerifyGetKey,
): Promise<Response> {
  const url = new URL(request.url);
  if (!controllerPaths.has(url.pathname)) return json({ error: "not_found" }, 404);
  const controller = url.pathname.startsWith("/v1/runner-controller/");
  const binding = url.pathname.endsWith("/binding");
  const report = url.pathname.endsWith("/report");
  if (
    !(report
      ? request.method === "POST"
      : binding
        ? ["GET", "PUT"].includes(request.method)
        : request.method === "GET")
  )
    return json({ error: "method_not_allowed" }, 405);
  try {
    validateAccessConfig(env);
    if (
      controller &&
      (!env.RUNNER_CONTROLLER_AUD?.trim() ||
        [env.ACCESS_ADMIN_AUD, env.ACCESS_READ_AUD].includes(env.RUNNER_CONTROLLER_AUD))
    )
      throw new Error();
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
    principal = (await verifyAccessIdentity(token, env, !controller, key, controller)).principal;
  } catch {
    return json({ error: "unauthorized" }, 401);
  }
  const machineId = url.searchParams.get("machineId");
  if (
    !machineId ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(machineId) ||
    [...url.searchParams.keys()].some((k) => k !== "machineId") ||
    url.searchParams.getAll("machineId").length !== 1
  )
    return json({ error: "invalid_machine" }, 400);
  if (!env.RUNNER_FLEET) return json({ error: "runner_fleet_unavailable" }, 503);
  const store = env.RUNNER_FLEET.get(env.RUNNER_FLEET.idFromName(env.CATALOG_NAME));
  try {
    if (controller && !report) {
      const command = await store.controllerPoll(machineId, principal);
      return command ? json(command) : json({ error: "forbidden" }, 403);
    }
    if (!controller && request.method === "GET") {
      if (binding) {
        const result = await store.controllerBinding(machineId);
        return json(result, 200, result.revision);
      }
      const raw = env.RUNNER_HEARTBEAT_BUDGET_SECONDS;
      const budget =
        raw &&
        /^[1-9][0-9]*$/.test(raw) &&
        Number.isSafeInteger(Number(raw)) &&
        Number(raw) <= 86400
          ? Number(raw) * 1000
          : null;
      return json(await store.controllerObservation(machineId, budget));
    }
    let expected = 0;
    if (binding) {
      const match = request.headers.get("If-Match");
      if (!match) return json({ error: "precondition_required" }, 428);
      if (!/^"(0|[1-9][0-9]*)"$/.test(match) || !Number.isSafeInteger(Number(match.slice(1, -1))))
        return json({ error: "invalid_precondition" }, 400);
      expected = Number(match.slice(1, -1));
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
    if (binding) {
      const parsed = parseControllerBinding(input);
      if (parsed.revision !== expected + 1) return json({ error: "invalid_next_revision" }, 400);
      const result = await store.enrollController(machineId, expected, parsed, principal);
      return result === "saved"
        ? json(await store.controllerBinding(machineId), 200, parsed.revision)
        : json({ error: result }, 409);
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
