import type { JWTVerifyGetKey } from "jose";
import { json } from "@zs-home/catalog-worker/http";
import { controllerPaths, handleControllerRequest, type ControllerEnv } from "./controller.js";
import { handleGitHubWebhook, type WebhookEnv } from "./webhook.js";
export { WorkflowJobEvidenceObject } from "./job-evidence-store.js";

/**
 * `homer-intake`: every route a machine pushes to (ADR 013). It holds no read
 * or admin audience, and serves no page and no `GET /v1/version`.
 */
export interface IntakeEnv extends WebhookEnv, ControllerEnv {
  /** Cloudflare's `version_metadata` binding; read from Wrangler's output, not served. */
  CF_VERSION_METADATA?: { id: string; tag: string; timestamp: string };
}

/** Who calls each path, and how it proves who it is. A path not listed is refused. */
export interface IntakeRoute {
  caller: "github" | "workload";
  proof: "hmac" | "RUNNER_CONTROLLER_AUD";
}
export const intakeRoutes: ReadonlyMap<string, IntakeRoute> = new Map<string, IntakeRoute>([
  ["/v1/hooks/github", { caller: "github", proof: "hmac" }],
  ...[...controllerPaths].map((path): [string, IntakeRoute] => [
    path,
    { caller: "workload", proof: "RUNNER_CONTROLLER_AUD" },
  ]),
]);

/** Optional key resolver is a trusted test seam, never supplied from requests or bindings. */
export async function handleRequest(
  request: Request,
  env: IntakeEnv,
  key?: JWTVerifyGetKey,
): Promise<Response> {
  const route = intakeRoutes.get(new URL(request.url).pathname);
  if (!route) return json({ error: "not_found" }, 404);
  return route.proof === "hmac"
    ? handleGitHubWebhook(request, env)
    : handleControllerRequest(request, env, key);
}

export default {
  fetch(request: Request, env: IntakeEnv): Promise<Response> {
    return handleRequest(request, env);
  },
};
