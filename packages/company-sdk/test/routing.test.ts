import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { validateRoutingPolicy } from "@zs-home/shared-contracts/workers";
import type {
  ModelRouteRule,
  ProviderBudgetLimits,
  RoutingPolicy,
} from "@zs-home/shared-contracts/workers";
import { resolveModelRoute, type ModelRouteRequest } from "../src/routing.js";

function policyOf(value: unknown): RoutingPolicy {
  const result = validateRoutingPolicy(value);
  if (!result.ok) throw new Error(`Not a routing policy: ${result.errors.join("; ")}`);
  return result.value;
}

const seed = policyOf(
  JSON.parse(
    readFileSync(
      new URL("../../shared-contracts/test/fixtures/valid/routing-policy.json", import.meta.url),
      "utf8",
    ),
  ) as unknown,
);

const openrouter: ProviderBudgetLimits = {
  provider: "openrouter",
  endpointHost: "openrouter.ai",
  maxUsdPerCall: 0.5,
  maxUsdPerPtDay: 5,
  minCreditFloorUsd: 5,
  credentialEnvName: "OPENROUTER_API_KEY",
};
const workersAi: ProviderBudgetLimits = {
  provider: "cloudflare-workers-ai",
  endpointHost: null,
  maxUsdPerCall: 0,
  maxUsdPerPtDay: null,
  minCreditFloorUsd: null,
  credentialEnvName: null,
};
const tightOpenrouter: ProviderBudgetLimits = { ...openrouter, maxUsdPerCall: 0.1 };
const looseOpenrouter: ProviderBudgetLimits = { ...openrouter, maxUsdPerCall: 1 };

interface RouteOverrides {
  readonly routeId: string;
  readonly priority?: number;
  readonly provider?: ModelRouteRule["provider"];
  readonly maxContextTokens?: number;
  readonly maxUsdPerCall?: number;
  readonly requiresHumanApprovalOverUsd?: number | null;
}

function route(overrides: RouteOverrides): ModelRouteRule {
  return {
    routeId: overrides.routeId,
    taskClass: "coding",
    priority: overrides.priority ?? 1,
    provider: overrides.provider ?? "openrouter",
    model: "synthetic/model",
    maxContextTokens: overrides.maxContextTokens ?? 131072,
    maxUsdPerCall: overrides.maxUsdPerCall ?? 0.5,
    requiresHumanApprovalOverUsd:
      overrides.requiresHumanApprovalOverUsd === undefined
        ? null
        : overrides.requiresHumanApprovalOverUsd,
  };
}

function policy(
  routes: ModelRouteRule[],
  providers: ProviderBudgetLimits[] = [openrouter],
): RoutingPolicy {
  return {
    contract: "home.routing-policy/v1",
    revision: 1,
    effectiveAt: "2026-11-25T00:00:00Z",
    timeZone: "America/Los_Angeles",
    providers,
    routes,
  };
}

it("validates the reviewed seed and routes it deterministically", () => {
  expect(validateRoutingPolicy(seed).ok).toBe(true);
  const first = resolveModelRoute(seed, { taskClass: "coding", estimatedCostUsd: 0.1 });
  const second = resolveModelRoute(seed, { taskClass: "coding", estimatedCostUsd: 0.1 });
  expect(first).toEqual(second);
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  expect(first).toMatchObject({
    outcome: "selected",
    policyRevision: 3,
    route: { routeId: "coding-openrouter-deepseek" },
    excluded: [],
    requiresHumanApproval: false,
  });
  expect(
    resolveModelRoute(seed, { taskClass: "general_local", estimatedCostUsd: 0 }),
  ).toMatchObject({
    outcome: "selected",
    route: { routeId: "general-local-qwen-studio" },
  });
  expect(
    resolveModelRoute(seed, { taskClass: "risk_classification", estimatedCostUsd: 0 }),
  ).toMatchObject({
    outcome: "selected",
    route: { routeId: "risk-classification-workers-ai-jev" },
  });
});

it("picks the lowest priority number, then the smallest routeId", () => {
  const byPriority = policy([
    route({ routeId: "later", priority: 2 }),
    route({ routeId: "sooner", priority: 1 }),
  ]);
  expect(
    resolveModelRoute(byPriority, { taskClass: "coding", estimatedCostUsd: 0.1 }),
  ).toMatchObject({ outcome: "selected", route: { routeId: "sooner" } });
  const tied = policy([route({ routeId: "b-route" }), route({ routeId: "a-route" })]);
  expect(resolveModelRoute(tied, { taskClass: "coding", estimatedCostUsd: 0.1 })).toMatchObject({
    outcome: "selected",
    route: { routeId: "a-route" },
  });
});

it("caps a call at the lower of the route and the provider", () => {
  const byRoute = policy([route({ routeId: "cheap-route", maxUsdPerCall: 0.1 })]);
  expect(resolveModelRoute(byRoute, { taskClass: "coding", estimatedCostUsd: 0.2 })).toMatchObject({
    outcome: "abstain",
    reason: "exceeds_per_call_budget",
    excluded: [{ routeId: "cheap-route", reason: "exceeds_per_call_budget" }],
  });
  expect(resolveModelRoute(byRoute, { taskClass: "coding", estimatedCostUsd: 0.1 })).toMatchObject({
    outcome: "selected",
  });
  const byProvider = policy([route({ routeId: "provider-capped" })], [tightOpenrouter]);
  expect(
    resolveModelRoute(byProvider, { taskClass: "coding", estimatedCostUsd: 0.2 }),
  ).toMatchObject({ outcome: "abstain", reason: "exceeds_per_call_budget" });
});

it("caps the Pacific Time day and the credit floor", () => {
  const daily = policy([route({ routeId: "daily" })]);
  expect(
    resolveModelRoute(daily, { taskClass: "coding", estimatedCostUsd: 0.2, ptDaySpendUsd: 4.9 }),
  ).toMatchObject({ outcome: "abstain", reason: "exceeds_daily_budget" });
  expect(
    resolveModelRoute(daily, { taskClass: "coding", estimatedCostUsd: 0.2, ptDaySpendUsd: 4.8 }),
  ).toMatchObject({ outcome: "selected" });
  expect(
    resolveModelRoute(daily, {
      taskClass: "coding",
      estimatedCostUsd: 0.2,
      providerCreditBalanceUsd: { openrouter: 4.99 },
    }),
  ).toMatchObject({ outcome: "abstain", reason: "below_credit_floor" });
  expect(
    resolveModelRoute(daily, {
      taskClass: "coding",
      estimatedCostUsd: 0.2,
      providerCreditBalanceUsd: { openrouter: 5 },
    }),
  ).toMatchObject({ outcome: "selected" });
});

it("caps the context window", () => {
  const context = policy([route({ routeId: "context" })]);
  expect(
    resolveModelRoute(context, {
      taskClass: "coding",
      estimatedCostUsd: 0.1,
      estimatedContextTokens: 131073,
    }),
  ).toMatchObject({ outcome: "abstain", reason: "exceeds_context_window" });
  expect(
    resolveModelRoute(context, {
      taskClass: "coding",
      estimatedCostUsd: 0.1,
      estimatedContextTokens: 131072,
    }),
  ).toMatchObject({ outcome: "selected" });
});

it("falls back to the next route when a provider is unavailable or undeclared", () => {
  const fallback = policy(
    [
      route({ routeId: "primary" }),
      route({ routeId: "secondary", provider: "cloudflare-workers-ai", maxUsdPerCall: 0 }),
    ],
    [openrouter, workersAi],
  );
  expect(
    resolveModelRoute(fallback, {
      taskClass: "coding",
      estimatedCostUsd: 0,
      unavailableProviders: ["openrouter"],
    }),
  ).toMatchObject({
    outcome: "selected",
    route: { routeId: "secondary" },
    excluded: [{ routeId: "primary", reason: "provider_unavailable" }],
  });
  const undeclared = policy([route({ routeId: "undeclared", provider: "anthropic" })]);
  expect(resolveModelRoute(undeclared, { taskClass: "coding", estimatedCostUsd: 0 })).toMatchObject(
    {
      outcome: "abstain",
      reason: "provider_unavailable",
      excluded: [{ routeId: "undeclared", reason: "provider_unavailable" }],
    },
  );
});

it("abstains with the first excluded route's reason, and with no route for the task class", () => {
  const allExcluded = policy([
    route({ routeId: "first", maxUsdPerCall: 0.1 }),
    route({ routeId: "second", maxContextTokens: 1 }),
  ]);
  expect(
    resolveModelRoute(allExcluded, {
      taskClass: "coding",
      estimatedCostUsd: 0.2,
      estimatedContextTokens: 2,
    }),
  ).toMatchObject({
    outcome: "abstain",
    reason: "exceeds_per_call_budget",
    excluded: [
      { routeId: "first", reason: "exceeds_per_call_budget" },
      { routeId: "second", reason: "exceeds_context_window" },
    ],
  });
  const empty = policy([]);
  expect(resolveModelRoute(empty, { taskClass: "coding", estimatedCostUsd: 0 })).toMatchObject({
    outcome: "abstain",
    reason: "no_route_for_task_class",
    excluded: [],
  });
  expect(
    resolveModelRoute(policy([route({ routeId: "coding-only" })]), {
      taskClass: "curator_run",
      estimatedCostUsd: 0,
    }),
  ).toMatchObject({ outcome: "abstain", reason: "no_route_for_task_class" });
});

it("asks for human approval above the route's threshold", () => {
  const approval = policy(
    [route({ routeId: "approval", maxUsdPerCall: 1, requiresHumanApprovalOverUsd: 0.5 })],
    [looseOpenrouter],
  );
  expect(resolveModelRoute(approval, { taskClass: "coding", estimatedCostUsd: 0.5 })).toMatchObject(
    { outcome: "selected", requiresHumanApproval: false },
  );
  expect(
    resolveModelRoute(approval, { taskClass: "coding", estimatedCostUsd: 0.75 }),
  ).toMatchObject({ outcome: "selected", requiresHumanApproval: true });
});

it("throws a RangeError for a request number a caller could not mean", () => {
  const daily = policy([route({ routeId: "daily" })]);
  expect(() => resolveModelRoute(daily, { taskClass: "coding", estimatedCostUsd: -1 })).toThrow(
    RangeError,
  );
  expect(() =>
    resolveModelRoute(daily, { taskClass: "coding", estimatedCostUsd: Number.NaN }),
  ).toThrow(RangeError);
  expect(() =>
    resolveModelRoute(daily, {
      taskClass: "coding",
      estimatedCostUsd: 0,
      estimatedContextTokens: -1,
    }),
  ).toThrow(RangeError);
  expect(() =>
    resolveModelRoute(daily, {
      taskClass: "coding",
      estimatedCostUsd: 0,
      ptDaySpendUsd: Number.POSITIVE_INFINITY,
    }),
  ).toThrow(RangeError);
  expect(() =>
    resolveModelRoute(daily, {
      taskClass: "coding",
      estimatedCostUsd: 0,
      providerCreditBalanceUsd: { openrouter: -1 },
    }),
  ).toThrow(RangeError);
});

it("has no user or developer identity field, and ignores one added at runtime", () => {
  const base: ModelRouteRequest = { taskClass: "coding", estimatedCostUsd: 0.1 };
  const withUser: ModelRouteRequest = {
    taskClass: "coding",
    estimatedCostUsd: 0.1,
    // @ts-expect-error ModelRouteRequest carries no user identity.
    userId: "user:x",
  };
  expect(resolveModelRoute(seed, withUser)).toEqual(resolveModelRoute(seed, base));
  const extended = { ...base, userId: "user:x", email: "x@example.test" } as ModelRouteRequest;
  expect(resolveModelRoute(seed, extended)).toEqual(resolveModelRoute(seed, base));
});
