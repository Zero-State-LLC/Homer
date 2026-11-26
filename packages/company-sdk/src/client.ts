import type { KnowledgeFlagQueueView } from "@zs-home/projections";
import type {
  ContextPinSnapshot,
  IdentityResolution,
  RoutingPolicy,
} from "@zs-home/shared-contracts/workers";
import { validateRoutingPolicy } from "@zs-home/shared-contracts/workers";
import {
  CompanySdkError,
  type CompanyClient,
  type CompanyClientOptions,
  type FleetHealthView,
  type KnowledgeFlagQuery,
  type ProjectStatusResponse,
} from "./types.js";

/** The default request timeout. */
const DEFAULT_TIMEOUT_MS = 10_000;
/** The codes homer-catalog sends in `{ "error": ... }`. */
const ERROR_CODE = /^[a-z_]{1,64}$/;
const COMMIT = /^[0-9a-f]{40}$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A bare `https://` origin: no path, query, credentials or trailing slash. */
function originOf(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new TypeError("baseUrl must be an https origin");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    baseUrl !== url.origin
  ) {
    throw new TypeError("baseUrl must be an https origin");
  }
  return url.origin;
}

/** The commit a Context Pin must name: 40 hex characters. */
function isContextPin(value: unknown): value is ContextPinSnapshot {
  return record(value) && typeof value["commit"] === "string" && COMMIT.test(value["commit"]);
}

/** The code homer-catalog sent, or a plain `http_<status>`. The body text is never read out. */
async function failureCode(response: Response): Promise<string> {
  const fallback = `http_${response.status}`;
  try {
    const body = await response.json<unknown>();
    const error = record(body) ? body["error"] : undefined;
    return typeof error === "string" && ERROR_CODE.test(error) ? error : fallback;
  } catch {
    return fallback;
  }
}

export function createCompanyClient(options: CompanyClientOptions): CompanyClient {
  const origin = originOf(options.baseUrl);
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /** One `GET`, with the caller's Access headers, an `Accept` header and a timeout. */
  async function read(
    path: string,
    search?: URLSearchParams,
  ): Promise<{ status: number; value: unknown }> {
    const query = search?.toString() ?? "";
    const endpoint = query === "" ? path : `${path}?${query}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(`${origin}${endpoint}`, {
        method: "GET",
        headers: { ...(await options.getAccessHeaders()), Accept: "application/json" },
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
        throw new CompanySdkError(response.status, "unexpected_redirect", endpoint);
      }
      if (!response.ok) {
        throw new CompanySdkError(response.status, await failureCode(response), endpoint);
      }
      try {
        return { status: response.status, value: await response.json<unknown>() };
      } catch {
        throw new CompanySdkError(response.status, "invalid_response", endpoint);
      }
    } catch (error) {
      if (error instanceof CompanySdkError) throw error;
      throw new CompanySdkError(
        0,
        controller.signal.aborted ? "timeout" : "network_error",
        endpoint,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async resolveIdentity(query) {
      const search = new URLSearchParams({
        source: query.source,
        sourceAccount: query.sourceAccount,
      });
      const { value } = await read("/v1/identities/resolve", search);
      return value as IdentityResolution;
    },
    async getProjectStatus(query) {
      const search = new URLSearchParams();
      if (query.asOf !== undefined) search.set("asOf", query.asOf);
      const path = `/v1/projects/${encodeURIComponent(query.projectId)}/timeline`;
      const { value } = await read(path, search);
      return value as ProjectStatusResponse;
    },
    async getFleetHealth() {
      const { value } = await read("/v1/fleet");
      return value as FleetHealthView;
    },
    async getContextPin() {
      const { status, value } = await read("/v1/context-pin");
      if (!isContextPin(value)) {
        throw new CompanySdkError(status, "invalid_response", "/v1/context-pin");
      }
      return value;
    },
    async listKnowledgeFlags(query: KnowledgeFlagQuery = {}) {
      const search = new URLSearchParams();
      if (query.status !== undefined) search.set("status", query.status);
      if (query.projectId !== undefined) search.set("projectId", query.projectId);
      if (query.repository !== undefined) search.set("repository", query.repository);
      const { value } = await read("/v1/knowledge-flags", search);
      return value as KnowledgeFlagQueueView;
    },
    async getRoutingPolicy() {
      const { status, value } = await read("/v1/routing-policy");
      const policy: RoutingPolicy | null = null;
      void policy;
      const validated = validateRoutingPolicy(value);
      if (!validated.ok) {
        throw new CompanySdkError(status, "invalid_response", "/v1/routing-policy");
      }
      return validated.value;
    },
  };
}
