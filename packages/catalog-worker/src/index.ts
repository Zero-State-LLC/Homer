import type { CatalogBindings } from "./bindings.js";
import type { JWTVerifyGetKey } from "jose";
import { parseMappingSnapshot } from "@zs-home/github-sync";
import { verifyAccess, validateAccessConfig, type AccessConfig } from "./access.js";
import { MappingCatalogObject, MAX_CATALOG_BYTES } from "./store.js";
import { json, readBytes } from "./http.js";
import { handleGitHubWebhook, type WebhookEnv } from "./webhook.js";
export { MappingCatalogObject };
export interface Env extends CatalogBindings, AccessConfig, WebhookEnv {}
/** Optional key resolver is a trusted test seam, never supplied from requests or bindings. */
export async function handleRequest(
  request: Request,
  env: Env,
  key?: JWTVerifyGetKey,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/v1/hooks/github") return handleGitHubWebhook(request, env);
  if (url.pathname !== "/v1/catalog" && url.pathname !== "/v1/admin/catalog")
    return json({ error: "not_found" }, 404);
  if (
    (url.pathname === "/v1/catalog" && request.method !== "GET") ||
    (url.pathname === "/v1/admin/catalog" && request.method !== "PUT")
  )
    return json({ error: "method_not_allowed" }, 405);
  try {
    validateAccessConfig(env);
  } catch {
    return json({ error: "access_not_configured" }, 503);
  }
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return json({ error: "cross_origin_denied" }, 403);
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || token.length > 16384) return json({ error: "unauthorized" }, 401);
  let principal: string;
  try {
    principal = await verifyAccess(token, env, request.method === "PUT", key);
  } catch {
    return json({ error: "unauthorized" }, 401);
  }
  const store = env.MAPPING_CATALOG.get(env.MAPPING_CATALOG.idFromName(env.CATALOG_NAME));
  if (request.method === "GET") {
    try {
      const snapshot = await store.read();
      return json(snapshot, 200, snapshot.revision);
    } catch {
      return json({ error: "catalog_unavailable" }, 503);
    }
  }
  const match = request.headers.get("If-Match");
  if (!match) return json({ error: "precondition_required" }, 428);
  if (!/^"(0|[1-9][0-9]*)"$/.test(match)) return json({ error: "invalid_precondition" }, 400);
  const expected = Number(match.slice(1, -1));
  if (!Number.isSafeInteger(expected)) return json({ error: "invalid_precondition" }, 400);
  if (
    request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
  )
    return json({ error: "unsupported_media_type" }, 415);
  let snapshot;
  try {
    snapshot = parseMappingSnapshot(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await readBytes(request, MAX_CATALOG_BYTES),
        ),
      ),
    );
    if (snapshot.revision !== expected + 1) return json({ error: "invalid_next_revision" }, 400);
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error && error.message === "body_too_large"
            ? "body_too_large"
            : "invalid_snapshot",
      },
      error instanceof Error && error.message === "body_too_large" ? 413 : 400,
    );
  }
  try {
    if (!(await store.replace(expected, snapshot, principal)))
      return json({ error: "revision_conflict" }, 409);
    return json(snapshot, 200, snapshot.revision);
  } catch {
    return json({ error: "catalog_unavailable" }, 503);
  }
}
export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
