import type { JWTVerifyGetKey } from "jose";
import { validateAccessConfig, verifyAccessIdentity } from "./access.js";
import type { RunnerEnv } from "./runner-http.js";
import { json, readBytes } from "./http.js";
import { machineIdFrom } from "./machine.js";
import { parseControllerBinding, parseLifecycleRequest } from "./runner-store.js";

/**
 * The admin side of the runner controller protocol: enrollment, observations
 * and lifecycle, for people with the admin audience. The machine side, poll
 * and report, is in `homer-intake` (ADR 013).
 */
export interface EnrollmentBindings {
  RUNNER_HEARTBEAT_BUDGET_SECONDS?: string;
}
export interface EnrollmentEnv extends RunnerEnv, EnrollmentBindings {}
export const enrollmentPaths = new Set([
  "/v1/admin/runners/binding",
  "/v1/admin/runners/observation",
  "/v1/admin/runners/lifecycle",
]);
export async function handleEnrollmentRequest(
  request: Request,
  env: EnrollmentEnv,
  key?: JWTVerifyGetKey,
): Promise<Response> {
  const url = new URL(request.url);
  if (!enrollmentPaths.has(url.pathname)) return json({ error: "not_found" }, 404);
  const binding = url.pathname.endsWith("/binding");
  const lifecycle = url.pathname.endsWith("/lifecycle");
  if (
    !(lifecycle
      ? ["GET", "POST"].includes(request.method)
      : binding
        ? ["GET", "PUT"].includes(request.method)
        : request.method === "GET")
  )
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
    const identity = await verifyAccessIdentity(token, env, true, key);
    if (lifecycle && identity.kind !== "human") return json({ error: "unauthorized" }, 401);
    principal = identity.principal;
  } catch {
    return json({ error: "unauthorized" }, 401);
  }
  const machineId = machineIdFrom(url);
  if (!machineId) return json({ error: "invalid_machine" }, 400);
  if (!env.RUNNER_FLEET) return json({ error: "runner_fleet_unavailable" }, 503);
  const store = env.RUNNER_FLEET.get(env.RUNNER_FLEET.idFromName(env.CATALOG_NAME));
  const raw = env.RUNNER_HEARTBEAT_BUDGET_SECONDS;
  const budget =
    raw && /^[1-9][0-9]*$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) <= 86400
      ? Number(raw) * 1000
      : null;
  try {
    if (request.method === "GET") {
      if (lifecycle) {
        const result = await store.lifecycle(machineId, budget);
        return typeof result === "string" ? json({ error: result }, 404) : json(result);
      }
      if (binding) {
        const result = await store.controllerBinding(machineId);
        return json(result, 200, result.revision);
      }
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
    if (lifecycle) {
      const result = await store.transitionLifecycle(
        machineId,
        parseLifecycleRequest(input),
        principal,
        budget,
      );
      return typeof result === "string"
        ? json(
            { error: result },
            result === "unknown_machine" || result === "not_a_runner" ? 404 : 409,
          )
        : json(result);
    }
    if (binding) {
      const parsed = parseControllerBinding(input);
      if (parsed.revision !== expected + 1) return json({ error: "invalid_next_revision" }, 400);
      const result = await store.enrollController(machineId, expected, parsed, principal);
      return result === "saved"
        ? json(await store.controllerBinding(machineId), 200, parsed.revision)
        : json({ error: result }, 409);
    }
    return json({ error: "method_not_allowed" }, 405);
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_config")
      return json({ error: "invalid_payload" }, 400);
    return json({ error: "runner_fleet_unavailable" }, 503);
  }
}
