import type { KnowledgeFlagQueueView, FleetStatus, ProjectTimeline } from "@zs-home/projections";
import type {
  ContextPinSnapshot,
  IdentityResolution,
  IdentitySource,
  RoutingPolicy,
} from "@zs-home/shared-contracts/workers";

/** A failed homer-catalog request: status, code and path, never a body or a header. */
export class CompanySdkError extends Error {
  readonly status: number;
  readonly code: string;
  readonly endpoint: string;

  constructor(status: number, code: string, endpoint: string) {
    super(`${code} (status ${status}) at ${endpoint}`);
    this.name = "CompanySdkError";
    this.status = status;
    this.code = code;
    this.endpoint = endpoint;
  }
}

export interface CompanyClientOptions {
  /** The `https://` origin of homer-catalog: no path, query, credentials or trailing slash. */
  readonly baseUrl: string;
  /** Caller-supplied Access headers, read once per request and never logged. */
  readonly getAccessHeaders: () => Promise<Record<string, string>> | Record<string, string>;
  /** Injectable fetch, for tests and Workers service bindings. */
  readonly fetch?: typeof globalThis.fetch;
  /** Milliseconds before a request fails with code `timeout`. Defaults to 10_000. */
  readonly timeoutMs?: number;
}

/** The read-only company surfaces. Every method is a `GET` on homer-catalog. */
export interface CompanyClient {
  resolveIdentity(query: {
    readonly source: IdentitySource;
    readonly sourceAccount: string;
  }): Promise<IdentityResolution>;
  getProjectStatus(query: {
    readonly projectId: string;
    readonly asOf?: string;
  }): Promise<ProjectStatusResponse>;
  getFleetHealth(): Promise<FleetHealthView>;
  getContextPin(): Promise<ContextPinSnapshot>;
  listKnowledgeFlags(query?: KnowledgeFlagQuery): Promise<KnowledgeFlagQueueView>;
  getRoutingPolicy(): Promise<RoutingPolicy>;
}

/** `GET /v1/projects/:projectId/timeline`. */
export interface ProjectStatusResponse {
  readonly state: "ready" | "empty";
  readonly head: { readonly sequence: number; readonly entryDigest: string } | null;
  readonly asOf: string;
  readonly timeline: ProjectTimeline;
}

/** `GET /v1/fleet`: the fleet status, the sparkDash link and the configuration revision. */
export interface FleetHealthView extends FleetStatus {
  readonly sparkdashUrl: string | null;
  readonly configRevision: number;
}

/** The Knowledge Flag filters `GET /v1/knowledge-flags` accepts. No status means every status. */
export interface KnowledgeFlagQuery {
  readonly status?: "open" | "stuck" | "needs_human" | "resolved" | "all";
  readonly projectId?: string;
  readonly repository?: string;
}

/** The JSON Schema an MCP tool accepts: an object with no unknown properties. */
export interface JsonSchemaObject {
  readonly type: "object";
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
  readonly additionalProperties: false;
}

/** One read-only MCP tool: the name, the description and the input schema, nothing else. */
export interface CompanyMcpTool {
  readonly name: string;
  readonly description: string;
  readonly scope: "read";
  readonly inputSchema: JsonSchemaObject;
}

/** A tool call that failed, with a stable code. */
export interface McpToolError {
  readonly code: "unknown_tool" | "invalid_arguments" | "upstream_error";
  readonly message: string;
  readonly status?: number;
}

export type McpDispatchResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: McpToolError };
