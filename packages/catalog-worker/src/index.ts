import {
  controllerPaths,
  handleControllerRequest,
  type ControllerBindings,
} from "./controller-http.js";
import { calendarPaths, calendarResponse } from "./calendar.js";
import { runnerPaths, handleRunnerRequest, type RunnerBindings } from "./runner-http.js";
export { RunnerFleetObject } from "./runner-store.js";
export { WorkflowJobEvidenceObject } from "./job-evidence-store.js";
import type { CatalogBindings } from "./bindings.js";
import type { JWTVerifyGetKey } from "jose";
import { parseMappingSnapshot } from "@zs-home/github-sync";
import { verifyAccessIdentity, validateAccessConfig, type AccessConfig } from "./access.js";
import { MappingCatalogObject, MAX_CATALOG_BYTES } from "./store.js";
import { json, readBytes } from "./http.js";
import { handleGitHubWebhook, type WebhookEnv } from "./webhook.js";
import { editorPaths, editorResponse } from "./editor.js";
import { adminPaths, adminAsset, overviewResponse } from "./admin.js";
import { directoryPaths, directoryPage } from "./directory-ui.js";
export { MappingCatalogObject };
import { credentialResponse, type DirectoryBindings } from "./credential-directory.js";
export interface Env
  extends
    CatalogBindings,
    AccessConfig,
    WebhookEnv,
    DirectoryBindings,
    RunnerBindings,
    ControllerBindings {}
/** Optional key resolver is a trusted test seam, never supplied from requests or bindings. */
export async function handleRequest(
  request: Request,
  env: Env,
  key?: JWTVerifyGetKey,
): Promise<Response> {
  const url = new URL(request.url);
  if (controllerPaths.has(url.pathname)) return handleControllerRequest(request, env, key);
  if (runnerPaths.has(url.pathname)) return handleRunnerRequest(request, env, key);
  const calendarRoute = calendarPaths.has(url.pathname);
  if (url.pathname === "/v1/hooks/github") return handleGitHubWebhook(request, env);
  const archiveRoute = url.pathname === "/v1/admin/catalog/archive";
  const editorRoute = editorPaths.has(url.pathname);
  const adminRoute = adminPaths.has(url.pathname);
  const credentialRoute =
    url.pathname === "/v1/credentials" ||
    url.pathname.startsWith("/v1/credentials/") ||
    url.pathname === "/v1/my-setup";
  const directoryUIRoute = directoryPaths.has(url.pathname);
  const snapshotRoute = url.pathname === "/v1/admin/catalog/snapshot";
  if (
    url.pathname !== "/v1/catalog" &&
    url.pathname !== "/v1/admin/catalog" &&
    !archiveRoute &&
    !editorRoute &&
    !snapshotRoute &&
    !adminRoute &&
    !credentialRoute &&
    !directoryUIRoute &&
    !calendarRoute
  )
    return json({ error: "not_found" }, 404);
  if (
    ((url.pathname === "/v1/catalog" ||
      archiveRoute ||
      editorRoute ||
      snapshotRoute ||
      adminRoute ||
      credentialRoute ||
      directoryUIRoute ||
      calendarRoute) &&
      request.method !== "GET") ||
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
  let principalKind: "human" | "workload";
  try {
    const identity = await verifyAccessIdentity(
      token,
      env,
      url.pathname.startsWith("/v1/admin/"),
      key,
    );
    principal = identity.principal;
    principalKind = identity.kind;
  } catch {
    return json({ error: "unauthorized" }, 401);
  }
  if (calendarRoute) return calendarResponse(url, env);
  if (directoryUIRoute) return directoryPage(url.pathname);
  if (credentialRoute) return credentialResponse(url, env, principal, principalKind);
  if (editorRoute) return editorResponse(url.pathname);
  if (adminRoute) {
    const asset = adminAsset(url.pathname);
    if (asset) return asset;
  }
  const store = env.MAPPING_CATALOG.get(env.MAPPING_CATALOG.idFromName(env.CATALOG_NAME));
  if (archiveRoute) {
    try {
      const archive = await store.exportArchive();
      return json(archive, 200, archive.headRevision);
    } catch (error) {
      if (error instanceof Error && error.message.includes("archive_too_large"))
        return json({ error: "archive_too_large" }, 413);
      return json({ error: "catalog_unavailable" }, 503);
    }
  }
  if (request.method === "GET") {
    try {
      const snapshot = await store.read();
      return adminRoute ? overviewResponse(snapshot) : json(snapshot, 200, snapshot.revision);
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
