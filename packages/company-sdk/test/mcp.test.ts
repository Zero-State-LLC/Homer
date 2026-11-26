import { projectFleetStatus, projectProjectTimeline } from "@zs-home/projections";
import type { KnowledgeFlagQueueView } from "@zs-home/projections";
import type {
  ContextPinSnapshot,
  IdentityResolution,
  IdentitySource,
  RoutingPolicy,
} from "@zs-home/shared-contracts/workers";
import { expect, it, vi } from "vitest";
import { COMPANY_SDK_MCP_TOOLS, dispatchMcpTool } from "../src/mcp.js";
import {
  CompanySdkError,
  type CompanyClient,
  type FleetHealthView,
  type ProjectStatusResponse,
} from "../src/types.js";

const asOf = "2026-11-19T00:00:00Z";

const contextPin: ContextPinSnapshot = {
  repository: "Zero-State-LLC/agent-context",
  commit: "a".repeat(40),
  pinnedAt: "2026-11-24",
  files: {},
};

const policy: RoutingPolicy = {
  contract: "home.routing-policy/v1",
  revision: 1,
  effectiveAt: "2026-11-25T00:00:00Z",
  timeZone: "America/Los_Angeles",
  providers: [
    {
      provider: "openrouter",
      endpointHost: "openrouter.ai",
      maxUsdPerCall: 0.5,
      maxUsdPerPtDay: 5,
      minCreditFloorUsd: 5,
      credentialEnvName: "OPENROUTER_API_KEY",
    },
  ],
  routes: [
    {
      routeId: "coding-openrouter",
      taskClass: "coding",
      priority: 1,
      provider: "openrouter",
      model: "synthetic/model",
      maxContextTokens: 131072,
      maxUsdPerCall: 0.5,
      requiresHumanApprovalOverUsd: null,
    },
  ],
};

const queue: KnowledgeFlagQueueView = {
  state: "empty",
  head: null,
  stuckThreshold: 3,
  flags: [],
  warnings: [],
};

const fleet: FleetHealthView = {
  ...projectFleetStatus(null, [], { now: 0 }),
  sparkdashUrl: null,
  configRevision: 0,
};

function stubClient() {
  const resolveIdentity = vi.fn((query: { source: IdentitySource; sourceAccount: string }) =>
    Promise.resolve<IdentityResolution>({ status: "unattributed", ...query, revision: 1 }),
  );
  const getProjectStatus = vi.fn((query: { projectId: string; asOf?: string }) =>
    Promise.resolve<ProjectStatusResponse>({
      state: "empty",
      head: null,
      asOf: query.asOf ?? asOf,
      timeline: projectProjectTimeline([], {
        projectId: query.projectId,
        asOf: query.asOf ?? asOf,
      }),
    }),
  );
  const getFleetHealth = vi.fn(() => Promise.resolve<FleetHealthView>(fleet));
  const getContextPin = vi.fn(() => Promise.resolve<ContextPinSnapshot>(contextPin));
  const listKnowledgeFlags = vi.fn(() => Promise.resolve<KnowledgeFlagQueueView>(queue));
  const getRoutingPolicy = vi.fn(() => Promise.resolve<RoutingPolicy>(policy));
  const client: CompanyClient = {
    resolveIdentity,
    getProjectStatus,
    getFleetHealth,
    getContextPin,
    listKnowledgeFlags,
    getRoutingPolicy,
  };
  return {
    client,
    resolveIdentity,
    getProjectStatus,
    getFleetHealth,
    getContextPin,
    listKnowledgeFlags,
    getRoutingPolicy,
  };
}

it("offers six read-only tools whose names carry no write verb", () => {
  expect(COMPANY_SDK_MCP_TOOLS).toHaveLength(6);
  for (const tool of COMPANY_SDK_MCP_TOOLS) {
    expect(tool.scope).toBe("read");
    expect(tool.name).toMatch(/^homer_(get|list|resolve)_/);
    expect(tool.name).not.toMatch(
      /(create|update|delete|write|append|claim|admin|set|put|post|mutate)/i,
    );
    expect(tool.description).not.toBe("");
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.additionalProperties).toBe(false);
  }
});

it("dispatches every tool to the client", async () => {
  const stub = stubClient();
  expect(
    await dispatchMcpTool(stub.client, "homer_resolve_identity", {
      source: "github",
      sourceAccount: "github:example-dev",
    }),
  ).toMatchObject({
    ok: true,
    value: { status: "unattributed", source: "github", sourceAccount: "github:example-dev" },
  });
  expect(stub.resolveIdentity).toHaveBeenCalledWith({
    source: "github",
    sourceAccount: "github:example-dev",
  });

  expect(
    await dispatchMcpTool(stub.client, "homer_get_project_status", {
      projectId: "project:fixture",
      asOf,
    }),
  ).toMatchObject({ ok: true, value: { state: "empty", asOf } });
  expect(stub.getProjectStatus).toHaveBeenCalledWith({ projectId: "project:fixture", asOf });

  expect(await dispatchMcpTool(stub.client, "homer_get_fleet_health", {})).toMatchObject({
    ok: true,
    value: { state: "none", configRevision: 0 },
  });
  expect(stub.getFleetHealth).toHaveBeenCalledWith();

  expect(await dispatchMcpTool(stub.client, "homer_get_context_pin", {})).toMatchObject({
    ok: true,
    value: { commit: contextPin.commit },
  });
  expect(stub.getContextPin).toHaveBeenCalledWith();

  expect(
    await dispatchMcpTool(stub.client, "homer_list_knowledge_flags", { status: "open" }),
  ).toMatchObject({ ok: true, value: { state: "empty", stuckThreshold: 3 } });
  expect(stub.listKnowledgeFlags).toHaveBeenCalledWith({ status: "open" });

  expect(
    await dispatchMcpTool(stub.client, "homer_get_routing_policy", {
      taskClass: "coding",
      maxBudgetUsd: 0.1,
    }),
  ).toMatchObject({
    ok: true,
    value: {
      policy: { revision: 1 },
      decision: { outcome: "selected", route: { routeId: "coding-openrouter" } },
    },
  });
  expect(stub.getRoutingPolicy).toHaveBeenCalledWith();
  expect(await dispatchMcpTool(stub.client, "homer_get_routing_policy", {})).toEqual({
    ok: true,
    value: { policy },
  });
});

it("refuses an unknown tool and arguments outside the schema", async () => {
  const stub = stubClient();
  expect(await dispatchMcpTool(stub.client, "homer_delete_everything", {})).toMatchObject({
    ok: false,
    error: { code: "unknown_tool" },
  });
  const refused = [
    ["homer_resolve_identity", { source: "github" }],
    ["homer_resolve_identity", { source: "gitlab", sourceAccount: "gitlab:example-dev" }],
    ["homer_resolve_identity", { source: "github", sourceAccount: "linear:usr_example" }],
    ["homer_resolve_identity", { source: "github", sourceAccount: "github:example-dev", limit: 1 }],
    ["homer_get_project_status", { projectId: "fixture" }],
    ["homer_get_project_status", { projectId: "project:fixture", asOf: "2026-11-19" }],
    ["homer_get_fleet_health", { machine: "synthetic" }],
    ["homer_get_context_pin", { pin: "latest" }],
    ["homer_list_knowledge_flags", { status: "closed" }],
    ["homer_list_knowledge_flags", { repository: "Homer" }],
    ["homer_get_routing_policy", { maxBudgetUsd: -1 }],
    ["homer_get_routing_policy", { taskClass: "synthesize" }],
  ] as const;
  for (const [name, args] of refused) {
    const result = await dispatchMcpTool(stub.client, name, args);
    expect(result, `${name} ${JSON.stringify(args)}`).toMatchObject({
      ok: false,
      error: { code: "invalid_arguments" },
    });
  }
  expect(
    await dispatchMcpTool(stub.client, "homer_get_fleet_health", "not an object"),
  ).toMatchObject({ ok: false, error: { code: "invalid_arguments" } });
});

it("maps a failed catalog call to upstream_error without the original message", async () => {
  const base = stubClient().client;
  const unavailable: CompanyClient = {
    ...base,
    getFleetHealth: () =>
      Promise.reject(new CompanySdkError(503, "fleet_status_unavailable", "/v1/fleet")),
  };
  expect(await dispatchMcpTool(unavailable, "homer_get_fleet_health", {})).toEqual({
    ok: false,
    error: { code: "upstream_error", message: "fleet_status_unavailable", status: 503 },
  });
  const broken: CompanyClient = {
    ...base,
    getContextPin: () => Promise.reject(new Error("synthetic upstream text")),
  };
  const result = await dispatchMcpTool(broken, "homer_get_context_pin", {});
  expect(result).toMatchObject({ ok: false, error: { code: "upstream_error" } });
  expect(JSON.stringify(result)).not.toContain("synthetic upstream text");
});
