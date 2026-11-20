import type { CatalogBindings } from "./bindings.js";
import { mapMergedPullRequest, parseMappingSnapshot } from "@zs-home/github-sync";
import { openEventLedger } from "@zs-home/event-ledger";
import type { EventLedgerObject } from "@zs-home/event-ledger/worker";
import { json, readBytes } from "./http.js";

export interface WebhookEnv extends CatalogBindings {
  CATALOG_NAME: string;
  // Optional until an operator binds the existing ledger and provisions the secret.
  EVENT_LEDGER?: DurableObjectNamespace<EventLedgerObject>;
  GITHUB_WEBHOOK_SECRET?: string;
}
export const MAX_WEBHOOK_BYTES = 1024 * 1024;

export async function verifyGitHubSignature(
  bytes: Uint8Array<ArrayBuffer>,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (!/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const digest = Uint8Array.from(signature.slice(7).match(/../g)!, (hex) => parseInt(hex, 16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, digest, bytes);
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export async function handleGitHubWebhook(request: Request, env: WebhookEnv): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (
    !env.GITHUB_WEBHOOK_SECRET ||
    !env.EVENT_LEDGER ||
    !env.MAPPING_CATALOG ||
    !env.CATALOG_NAME?.trim()
  )
    return json({ error: "webhook_not_configured" }, 503);
  const signature = request.headers.get("X-Hub-Signature-256");
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature))
    return json({ error: "unauthorized" }, 401);
  if (
    request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !==
      "application/json" ||
    request.headers.has("Content-Encoding")
  )
    return json({ error: "unsupported_media_type" }, 415);
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await readBytes(request, MAX_WEBHOOK_BYTES);
  } catch (error) {
    const large = error instanceof Error && error.message === "body_too_large";
    return json({ error: large ? "body_too_large" : "invalid_body" }, large ? 413 : 400);
  }
  try {
    if (!(await verifyGitHubSignature(bytes, signature, env.GITHUB_WEBHOOK_SECRET)))
      return json({ error: "unauthorized" }, 401);
  } catch {
    return json({ error: "unauthorized" }, 401);
  }
  let payload: Record<string, unknown> | undefined;
  try {
    payload = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!payload) return json({ error: "invalid_envelope" }, 400);
  const eventType = request.headers.get("X-GitHub-Event");
  if (!eventType) return json({ error: "missing_event_type" }, 400);
  if (eventType === "ping") return json({ outcome: "pong" });
  if (eventType !== "pull_request") return json({ outcome: "ignored", reason: "event_type" });
  if (typeof payload.action !== "string") return json({ error: "invalid_action" }, 400);
  if (payload.action !== "closed") return json({ outcome: "ignored", reason: "action" });
  const pr = record(payload.pull_request);
  const repository = record(payload.repository);
  const baseRepo = record(record(pr?.base)?.repo);
  if (
    !pr ||
    pr.state !== "closed" ||
    !repository ||
    !baseRepo ||
    !Number.isSafeInteger(repository.id) ||
    Number(repository.id) <= 0 ||
    typeof repository.full_name !== "string" ||
    repository.id !== baseRepo.id ||
    repository.full_name !== baseRepo.full_name ||
    payload.number !== pr.number
  )
    return json({ error: "invalid_envelope" }, 400);
  let snapshot;
  try {
    const store = env.MAPPING_CATALOG.get(env.MAPPING_CATALOG.idFromName(env.CATALOG_NAME));
    snapshot = parseMappingSnapshot(await store.read());
  } catch {
    return json({ error: "catalog_unavailable" }, 503);
  }
  const revision = snapshot.revision;
  const mapping = snapshot.repositories.find((entry) => entry.repositoryId === repository.id);
  if (!mapping?.enabled)
    return json({ outcome: "ignored", reason: "repository_not_enabled", revision });
  const mapped = mapMergedPullRequest(pr, { ...mapping, collectedAt: new Date().toISOString() });
  if (mapped.outcome !== "mapped")
    return json({ ...mapped, revision }, mapped.outcome === "refused" ? 422 : 200);
  try {
    const result = await openEventLedger(env.EVENT_LEDGER).appendActivityEvent(mapped.event);
    if (result.outcome === "refused") return json({ error: "ledger_refused", revision }, 422);
    return json(
      { ...result, revision },
      result.outcome === "appended" ? 201 : result.outcome === "conflict" ? 409 : 200,
    );
  } catch {
    return json({ error: "ledger_unavailable", revision }, 503);
  }
}
