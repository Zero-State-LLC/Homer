import type { IdentitySource } from "@zs-home/shared-contracts/workers";
import { resolveModelRoute } from "./routing.js";
import {
  CompanySdkError,
  type CompanyClient,
  type CompanyMcpTool,
  type JsonSchemaObject,
  type KnowledgeFlagQuery,
  type McpDispatchResult,
} from "./types.js";

const SOURCES = ["github", "linear", "buzz"] as const;
const STATUSES = ["open", "stuck", "needs_human", "resolved", "all"] as const;
const TASK_CLASSES = [
  "coding",
  "repo_audit",
  "spec_design",
  "risk_classification",
  "curator_run",
  "general_local",
] as const;

const PROJECT_ID = /^project:[a-z0-9-]+$/;
const REPOSITORY = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const SOURCE_ACCOUNT = /^[a-z]+:[A-Za-z0-9._-]{1,200}$/;

function objectSchema(
  properties: Record<string, unknown>,
  required?: readonly string[],
): JsonSchemaObject {
  return {
    type: "object",
    properties,
    ...(required === undefined ? {} : { required: [...required] }),
    additionalProperties: false,
  };
}

/** The six read-only tools. Names, descriptions and JSON Schemas only; dispatch is transport-free. */
export const COMPANY_SDK_MCP_TOOLS: readonly CompanyMcpTool[] = [
  {
    name: "homer_resolve_identity",
    description: "Resolve one GitHub, Linear or Buzz source account to its Actor, or Unattributed.",
    scope: "read",
    inputSchema: objectSchema(
      {
        source: { type: "string", enum: [...SOURCES] },
        sourceAccount: { type: "string", pattern: "^[a-z]+:[A-Za-z0-9._-]{1,200}$" },
      },
      ["source", "sourceAccount"],
    ),
  },
  {
    name: "homer_get_project_status",
    description: "One Project's Milestones, Blockers and Release Gates as of a UTC instant.",
    scope: "read",
    inputSchema: objectSchema(
      {
        projectId: { type: "string", pattern: "^project:[a-z0-9-]+$" },
        asOf: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$" },
      },
      ["projectId"],
    ),
  },
  {
    name: "homer_get_fleet_health",
    description: "Fleet health: every Machine's status, the sparkDash state and firing alerts.",
    scope: "read",
    inputSchema: objectSchema({}),
  },
  {
    name: "homer_get_context_pin",
    description: "The pinned agent-context commit and the sha256 of each pinned file.",
    scope: "read",
    inputSchema: objectSchema({}),
  },
  {
    name: "homer_list_knowledge_flags",
    description: "Knowledge Flags with their linked Verdict and Langfuse trace, filtered.",
    scope: "read",
    inputSchema: objectSchema({
      status: { type: "string", enum: [...STATUSES] },
      projectId: { type: "string", pattern: "^project:[a-z0-9-]+$" },
      repository: { type: "string", pattern: "^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$" },
    }),
  },
  {
    name: "homer_get_routing_policy",
    description: "The versioned routing policy, and a deterministic route for one task class.",
    scope: "read",
    inputSchema: objectSchema({
      taskClass: { type: "string", enum: [...TASK_CLASSES] },
      maxBudgetUsd: { type: "number", minimum: 0 },
    }),
  },
];

type Parsed<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

function invalid(message: string): Parsed<never> {
  return { ok: false, message };
}

/** The argument object, or null when the caller sent something else. */
function argumentsOf(args: unknown): Record<string, unknown> | null {
  return typeof args === "object" && args !== null && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : null;
}

/** The first argument outside the tool's schema, or null. */
function unknownArgument(args: Record<string, unknown>, allowed: readonly string[]): string | null {
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key)) return `Unexpected argument "${key}".`;
  }
  return null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" ? allowed.find((candidate) => candidate === value) : undefined;
}

function textOf(value: unknown, pattern: RegExp): string | null {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

function identityArguments(
  args: unknown,
): Parsed<{ source: IdentitySource; sourceAccount: string }> {
  const fields = argumentsOf(args);
  if (fields === null) return invalid("Arguments must be an object.");
  const extra = unknownArgument(fields, ["source", "sourceAccount"]);
  if (extra !== null) return invalid(extra);
  const source = oneOf(fields["source"], SOURCES);
  if (source === undefined) return invalid('"source" must be github, linear or buzz.');
  const sourceAccount = textOf(fields["sourceAccount"], SOURCE_ACCOUNT);
  if (sourceAccount === null || !sourceAccount.startsWith(`${source}:`)) {
    return invalid('"sourceAccount" must be a "<source>:<id>" account.');
  }
  return { ok: true, value: { source, sourceAccount } };
}

function projectStatusArguments(args: unknown): Parsed<{ projectId: string; asOf?: string }> {
  const fields = argumentsOf(args);
  if (fields === null) return invalid("Arguments must be an object.");
  const extra = unknownArgument(fields, ["projectId", "asOf"]);
  if (extra !== null) return invalid(extra);
  const projectId = textOf(fields["projectId"], PROJECT_ID);
  if (projectId === null) return invalid('"projectId" must match ^project:[a-z0-9-]+$.');
  const asOf = fields["asOf"];
  if (asOf === undefined) return { ok: true, value: { projectId } };
  const instant = textOf(asOf, UTC_INSTANT);
  if (instant === null) return invalid('"asOf" must be a UTC instant, like 2026-11-19T00:00:00Z.');
  return { ok: true, value: { projectId, asOf: instant } };
}

function knowledgeFlagArguments(args: unknown): Parsed<KnowledgeFlagQuery> {
  const fields = argumentsOf(args);
  if (fields === null) return invalid("Arguments must be an object.");
  const extra = unknownArgument(fields, ["status", "projectId", "repository"]);
  if (extra !== null) return invalid(extra);
  const query: { -readonly [K in keyof KnowledgeFlagQuery]: KnowledgeFlagQuery[K] } = {};
  const status = fields["status"];
  if (status !== undefined) {
    const chosen = oneOf(status, STATUSES);
    if (chosen === undefined) {
      return invalid('"status" must be open, stuck, needs_human, resolved or all.');
    }
    query.status = chosen;
  }
  const projectId = fields["projectId"];
  if (projectId !== undefined) {
    const chosen = textOf(projectId, PROJECT_ID);
    if (chosen === null) return invalid('"projectId" must match ^project:[a-z0-9-]+$.');
    query.projectId = chosen;
  }
  const repository = fields["repository"];
  if (repository !== undefined) {
    const chosen = textOf(repository, REPOSITORY);
    if (chosen === null) return invalid('"repository" must be "owner/name".');
    query.repository = chosen;
  }
  return { ok: true, value: query };
}

function routingPolicyArguments(
  args: unknown,
): Parsed<{ taskClass?: (typeof TASK_CLASSES)[number]; maxBudgetUsd?: number }> {
  const fields = argumentsOf(args);
  if (fields === null) return invalid("Arguments must be an object.");
  const extra = unknownArgument(fields, ["taskClass", "maxBudgetUsd"]);
  if (extra !== null) return invalid(extra);
  const parsed: { taskClass?: (typeof TASK_CLASSES)[number]; maxBudgetUsd?: number } = {};
  const taskClass = fields["taskClass"];
  if (taskClass !== undefined) {
    const chosen = oneOf(taskClass, TASK_CLASSES);
    if (chosen === undefined) return invalid('"taskClass" is not a known task class.');
    parsed.taskClass = chosen;
  }
  const maxBudgetUsd = fields["maxBudgetUsd"];
  if (maxBudgetUsd !== undefined) {
    if (typeof maxBudgetUsd !== "number" || !Number.isFinite(maxBudgetUsd) || maxBudgetUsd < 0) {
      return invalid('"maxBudgetUsd" must be a finite number of USD, 0 or more.');
    }
    parsed.maxBudgetUsd = maxBudgetUsd;
  }
  return { ok: true, value: parsed };
}

/** The first argument outside a tool that takes none, or null. */
function noArguments(args: unknown): string | null {
  const fields = argumentsOf(args);
  if (fields === null) return "Arguments must be an object.";
  return unknownArgument(fields, []);
}

const invalidArguments = (message: string): McpDispatchResult => ({
  ok: false,
  error: { code: "invalid_arguments", message },
});

function upstreamFailure(error: unknown): McpDispatchResult {
  if (error instanceof CompanySdkError) {
    return {
      ok: false,
      error: { code: "upstream_error", message: error.code, status: error.status },
    };
  }
  return {
    ok: false,
    error: { code: "upstream_error", message: "The homer-catalog request failed." },
  };
}

/**
 * Run one read-only tool against a CompanyClient. An unknown tool, an argument outside the tool's
 * schema and a failed catalog call each come back as `{ ok: false, error }`; nothing throws.
 */
export async function dispatchMcpTool(
  client: CompanyClient,
  toolName: string,
  args: unknown,
): Promise<McpDispatchResult> {
  try {
    switch (toolName) {
      case "homer_resolve_identity": {
        const parsed = identityArguments(args);
        return parsed.ok
          ? { ok: true, value: await client.resolveIdentity(parsed.value) }
          : invalidArguments(parsed.message);
      }
      case "homer_get_project_status": {
        const parsed = projectStatusArguments(args);
        return parsed.ok
          ? { ok: true, value: await client.getProjectStatus(parsed.value) }
          : invalidArguments(parsed.message);
      }
      case "homer_get_fleet_health": {
        const problem = noArguments(args);
        return problem === null
          ? { ok: true, value: await client.getFleetHealth() }
          : invalidArguments(problem);
      }
      case "homer_get_context_pin": {
        const problem = noArguments(args);
        return problem === null
          ? { ok: true, value: await client.getContextPin() }
          : invalidArguments(problem);
      }
      case "homer_list_knowledge_flags": {
        const parsed = knowledgeFlagArguments(args);
        return parsed.ok
          ? { ok: true, value: await client.listKnowledgeFlags(parsed.value) }
          : invalidArguments(parsed.message);
      }
      case "homer_get_routing_policy": {
        const parsed = routingPolicyArguments(args);
        if (!parsed.ok) return invalidArguments(parsed.message);
        const policy = await client.getRoutingPolicy();
        const { taskClass, maxBudgetUsd } = parsed.value;
        return {
          ok: true,
          value:
            taskClass === undefined
              ? { policy }
              : {
                  policy,
                  decision: resolveModelRoute(policy, {
                    taskClass,
                    estimatedCostUsd: maxBudgetUsd ?? 0,
                  }),
                },
        };
      }
      default:
        return {
          ok: false,
          error: { code: "unknown_tool", message: `Unknown tool "${toolName}".` },
        };
    }
  } catch (error) {
    return upstreamFailure(error);
  }
}
