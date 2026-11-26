import { openEventLedger, replayEffectiveHistory } from "@zs-home/event-ledger";
import type { EventLedgerObject } from "@zs-home/event-ledger/worker";
import {
  projectOpenKnowledgeFlags,
  projectProjectTimeline,
  type KnowledgeFlagQueueView,
} from "@zs-home/projections";
import {
  CONTEXT_PIN,
  resolveIdentityBinding,
  validateIdentityBindingSnapshot,
  validateRoutingPolicy,
} from "@zs-home/shared-contracts/workers";
import { adminHeaders } from "./admin-headers.js";

/**
 * The company read surfaces (company SDK spec): the Context Pin, Identity
 * Binding resolution, Project Timelines, Knowledge Flags and the routing
 * policy. People and agents read them with the read audience, `GET` only and
 * same-origin. One Project's timeline is matched by pattern.
 */
export interface CompanyReadBindings {
  EVENT_LEDGER?: DurableObjectNamespace<EventLedgerObject>;
  /** Reviewed `home.identity-bindings/v1` snapshot, parsed and validated on every read. */
  IDENTITY_BINDINGS_JSON?: string;
  /** Reviewed `home.routing-policy/v1` snapshot, parsed and validated on every read. */
  ROUTING_POLICY_JSON?: string;
}

/** The fixed company read paths; a Project Timeline is matched by pattern. */
export const companyReadPaths = new Set([
  "/v1/context-pin",
  "/v1/identities/resolve",
  "/v1/knowledge-flags",
  "/v1/routing-policy",
]);

const projectTimelinePath = /^\/v1\/projects\/([^/]+)\/timeline$/;
/** The same bound `/v1/calendar` applies: the complete prefix or an explicit refusal. */
const MAX_SEQUENCE = 2000;

/** The percent-decoded Project id in a Project Timeline path, or undefined. */
function projectIdOf(pathname: string): string | undefined {
  const segment = projectTimelinePath.exec(pathname)?.[1];
  if (segment === undefined) return undefined;
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/** Whether a path is one of the company read routes. */
export function companyReadPath(pathname: string): boolean {
  return companyReadPaths.has(pathname) || projectIdOf(pathname) !== undefined;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: adminHeaders("application/json") });
const failure = (error: string, status: number) => json({ error }, status);

/** The single-valued query parameters, or null when one is unknown or repeated. */
function parseQuery(url: URL, allowed: readonly string[]): URLSearchParams | null {
  for (const key of url.searchParams.keys())
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) return null;
  return url.searchParams;
}

/** The reviewed snapshot, or undefined when it is missing, unparseable or invalid. */
function identitySnapshot(env: CompanyReadBindings) {
  if (!env.IDENTITY_BINDINGS_JSON) return undefined;
  try {
    const snapshot = validateIdentityBindingSnapshot(JSON.parse(env.IDENTITY_BINDINGS_JSON));
    return snapshot.ok ? snapshot.value : undefined;
  } catch {
    return undefined;
  }
}

/** The reviewed policy, or undefined when it is missing, unparseable or invalid. */
function routingPolicySnapshot(env: CompanyReadBindings) {
  if (!env.ROUTING_POLICY_JSON) return undefined;
  try {
    const policy = validateRoutingPolicy(JSON.parse(env.ROUTING_POLICY_JSON));
    return policy.ok ? policy.value : undefined;
  } catch {
    return undefined;
  }
}

/** The complete effective history, bounded exactly as `/v1/calendar` bounds it. */
async function readEffective(env: CompanyReadBindings) {
  if (!env.EVENT_LEDGER) throw new Error("unavailable");
  const ledger = openEventLedger(env.EVENT_LEDGER);
  const head = await ledger.head();
  if (head && (!Number.isSafeInteger(head.sequence) || head.sequence < 1))
    throw new Error("invalid head");
  if (head && head.sequence > MAX_SEQUENCE) throw new Error("history_too_large");
  const events = replayEffectiveHistory(
    await ledger.readHistory({ throughSequence: head?.sequence ?? 0 }),
    head ?? undefined,
  );
  return { head, events };
}

const utcInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

function identityResponse(url: URL, env: CompanyReadBindings): Response {
  if (!parseQuery(url, ["source", "sourceAccount"])) return failure("invalid_identity_query", 400);
  const source = url.searchParams.get("source");
  const sourceAccount = url.searchParams.get("sourceAccount");
  if ((source !== "github" && source !== "linear" && source !== "buzz") || !sourceAccount)
    return failure("invalid_identity_query", 400);
  if (!sourceAccount.startsWith(`${source}:`) || sourceAccount.length > 200)
    return failure("invalid_identity_query", 400);
  const snapshot = identitySnapshot(env);
  if (!snapshot) return failure("identity_bindings_unavailable", 503);
  return json(resolveIdentityBinding(snapshot, source, sourceAccount));
}

function routingPolicyResponse(url: URL, env: CompanyReadBindings): Response {
  if (!parseQuery(url, [])) return failure("invalid_routing_policy_query", 400);
  const policy = routingPolicySnapshot(env);
  return policy ? json(policy) : failure("routing_policy_unavailable", 503);
}

async function projectTimelineResponse(
  url: URL,
  env: CompanyReadBindings,
  projectId: string,
): Promise<Response> {
  if (!parseQuery(url, ["asOf"])) return failure("invalid_project_query", 400);
  if (!/^project:[a-z0-9-]+$/.test(projectId)) return failure("invalid_project_query", 400);
  const requested = url.searchParams.get("asOf");
  if (
    requested !== null &&
    (!utcInstant.test(requested) || !Number.isFinite(Date.parse(requested)))
  )
    return failure("invalid_project_query", 400);
  const asOf = requested ?? new Date().toISOString();
  try {
    const { head, events } = await readEffective(env);
    const options = { projectId, asOf };
    return json({
      state: events.some((event) => event.projectId === projectId) ? "ready" : "empty",
      head: head ?? null,
      asOf,
      timeline: projectProjectTimeline(events, options),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "history_too_large")
      return failure("timeline_history_too_large", 413);
    return failure("timeline_unavailable", 503);
  }
}

async function knowledgeFlagsResponse(url: URL, env: CompanyReadBindings): Promise<Response> {
  if (!parseQuery(url, ["status", "projectId", "repository"]))
    return failure("invalid_knowledge_flag_query", 400);
  const status = url.searchParams.get("status") ?? "all";
  if (
    status !== "open" &&
    status !== "stuck" &&
    status !== "needs_human" &&
    status !== "resolved" &&
    status !== "all"
  )
    return failure("invalid_knowledge_flag_query", 400);
  const projectId = url.searchParams.get("projectId");
  if (projectId && !/^project:[a-z0-9-]+$/.test(projectId))
    return failure("invalid_knowledge_flag_query", 400);
  const repository = url.searchParams.get("repository");
  if (repository && !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repository))
    return failure("invalid_knowledge_flag_query", 400);
  try {
    const { head, events } = await readEffective(env);
    const projection = projectOpenKnowledgeFlags(events);
    const flags = projection.flags.filter(
      (flag) =>
        (status === "all" || flag.status === status) &&
        (!projectId || flag.projectId === projectId) &&
        (!repository || flag.repository === repository),
    );
    const view: KnowledgeFlagQueueView = {
      state: flags.length ? "ready" : "empty",
      head: head ?? null,
      stuckThreshold: projection.stuckThreshold,
      flags,
      warnings: projection.warnings,
    };
    return json(view);
  } catch (error) {
    if (error instanceof Error && error.message === "history_too_large")
      return failure("knowledge_flag_history_too_large", 413);
    return failure("knowledge_flags_unavailable", 503);
  }
}

export async function companyReadResponse(url: URL, env: CompanyReadBindings): Promise<Response> {
  if (url.pathname === "/v1/context-pin")
    return parseQuery(url, []) ? json(CONTEXT_PIN) : failure("invalid_context_pin_query", 400);
  if (url.pathname === "/v1/identities/resolve") return identityResponse(url, env);
  if (url.pathname === "/v1/knowledge-flags") return knowledgeFlagsResponse(url, env);
  if (url.pathname === "/v1/routing-policy") return routingPolicyResponse(url, env);
  const projectId = projectIdOf(url.pathname);
  if (projectId === undefined) return failure("not_found", 404);
  return projectTimelineResponse(url, env, projectId);
}
