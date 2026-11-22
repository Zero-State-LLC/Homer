import type { CatalogBindings } from "./bindings.js";
import {
  mapMergedPullRequest,
  mapWorkflowJobWebhook,
  parseMappingSnapshot,
} from "@zs-home/github-sync";
import { openEventLedger } from "@zs-home/event-ledger";
import type { EventLedgerObject } from "@zs-home/event-ledger/worker";
import { json, readBytes } from "./http.js";
import { WorkflowJobEvidenceObject } from "./job-evidence-store.js";

export interface WebhookEnv extends CatalogBindings {
  CATALOG_NAME: string;
  // Optional until an operator binds the existing ledger and provisions the secret.
  EVENT_LEDGER?: DurableObjectNamespace<EventLedgerObject>;
  GITHUB_WEBHOOK_SECRET?: string;
  /** Explicit activation gate. No workflow job collection when absent. */
  GITHUB_JOB_INGEST_ENABLED?: string;
  JOB_EVIDENCE?: DurableObjectNamespace<WorkflowJobEvidenceObject>;
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

/**
 * This branch adds a fail-closed workflow_job path behind an explicit flag.
 * The caller has already verified the original bytes with GitHub HMAC.
 * Durable delivery receipts are operational evidence, not Event Ledger Activity Events.
 */
async function handleWorkflowJobDelivery(
  payload: Record<string, unknown>,
  request: Request,
  bytes: Uint8Array<ArrayBuffer>,
  env: WebhookEnv,
): Promise<Response> {
  if (env.GITHUB_JOB_INGEST_ENABLED !== "true")
    return json({ outcome: "ignored", reason: "job_ingest_disabled" });
  if (!env.JOB_EVIDENCE) return json({ error: "job_evidence_not_configured" }, 503);
  const deliveryId = request.headers.get("X-GitHub-Delivery");
  if (
    !deliveryId ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(deliveryId)
  )
    return json({ error: "invalid_delivery_id" }, 400);
  const repository = record(payload.repository);
  if (
    !repository ||
    !Number.isSafeInteger(repository.id) ||
    (repository.id as number) <= 0 ||
    typeof repository.full_name !== "string"
  )
    return json({ error: "invalid_job_repository" }, 400);
  let snapshot;
  try {
    const store = env.MAPPING_CATALOG.get(env.MAPPING_CATALOG.idFromName(env.CATALOG_NAME));
    snapshot = parseMappingSnapshot(await store.read());
  } catch {
    return json({ error: "catalog_unavailable" }, 503);
  }
  const revision = snapshot.revision;
  const mapping = snapshot.repositories.find((entry) => entry.repositoryId === repository.id);
  if (!mapping?.enabled || mapping.repository !== repository.full_name)
    return json({ outcome: "ignored", reason: "repository_not_enabled", revision });
  const collectedAt = new Date().toISOString();
  const mapped = mapWorkflowJobWebhook(payload, {
    repositoryId: mapping.repositoryId,
    repository: mapping.repository,
    collectedAt,
    deliveryId,
  });
  if (mapped.outcome === "ignored") return json({ ...mapped, revision }, 200);
  if (mapped.outcome === "refused") return json({ error: mapped.reason, revision }, 422);
  try {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const payloadSha256 = Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
    const store = env.JOB_EVIDENCE.get(env.JOB_EVIDENCE.idFromName(env.CATALOG_NAME));
    const result = await store.admit({
      deliveryId,
      payloadSha256,
      receivedAt: collectedAt,
      observation: mapped.observation,
    });
    if ("receipt" in result)
      return json(
        { outcome: result.outcome, receipt: result.receipt, revision },
        result.outcome === "appended" ? 201 : 200,
      );
    if (result.outcome === "conflict") return json({ error: result.reason, revision }, 409);
    return json(
      { error: result.reason, revision },
      result.reason === "evidence_capacity_exhausted" ? 503 : 422,
    );
  } catch {
    return json({ error: "job_evidence_unavailable", revision }, 503);
  }
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
  if (eventType === "workflow_job") return handleWorkflowJobDelivery(payload, request, bytes, env);
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
