import type {
  ModelRouteRule,
  ProviderBudgetLimits,
  RoutingPolicy,
  RoutingProviderId,
  RoutingTaskClass,
} from "@zs-home/shared-contracts/workers";

/** Why a route was excluded, or why the policy abstained. */
export type RoutingReasonCode =
  | "no_route_for_task_class"
  | "exceeds_per_call_budget"
  | "exceeds_daily_budget"
  | "below_credit_floor"
  | "exceeds_context_window"
  | "provider_unavailable";

/**
 * A request carries the task class and the money, and nothing about a person: no developer id, no
 * user id, no email, no session. The caller supplies current spend and credit.
 */
export interface ModelRouteRequest {
  readonly taskClass: RoutingTaskClass;
  readonly estimatedCostUsd: number;
  readonly estimatedContextTokens?: number;
  readonly ptDaySpendUsd?: number;
  readonly providerCreditBalanceUsd?: Readonly<Partial<Record<RoutingProviderId, number>>>;
  readonly unavailableProviders?: readonly RoutingProviderId[];
}

/** One route the evaluator passed over, and the one reason it did. */
export interface ModelRouteExclusion {
  readonly routeId: string;
  readonly reason: RoutingReasonCode;
}

export type ModelRouteDecision =
  | {
      readonly outcome: "selected";
      readonly policyRevision: number;
      readonly route: ModelRouteRule;
      readonly requiresHumanApproval: boolean;
      readonly excluded: readonly ModelRouteExclusion[];
    }
  | {
      readonly outcome: "abstain";
      readonly policyRevision: number;
      readonly reason: RoutingReasonCode;
      readonly excluded: readonly ModelRouteExclusion[];
    };

/** Every amount a caller supplies must be a finite, non-negative number. */
function checkAmount(value: number | undefined, name: string): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite, non-negative number`);
  }
}

/** The first reason this route cannot take the request, or null when it can. */
function exclusionOf(
  route: ModelRouteRule,
  provider: ProviderBudgetLimits | undefined,
  request: ModelRouteRequest,
  unavailable: ReadonlySet<RoutingProviderId>,
): RoutingReasonCode | null {
  if (provider === undefined || unavailable.has(route.provider)) return "provider_unavailable";
  if ((request.estimatedContextTokens ?? 0) > route.maxContextTokens) {
    return "exceeds_context_window";
  }
  if (request.estimatedCostUsd > Math.min(route.maxUsdPerCall, provider.maxUsdPerCall)) {
    return "exceeds_per_call_budget";
  }
  if (
    provider.maxUsdPerPtDay !== null &&
    (request.ptDaySpendUsd ?? 0) + request.estimatedCostUsd > provider.maxUsdPerPtDay
  ) {
    return "exceeds_daily_budget";
  }
  const balance = request.providerCreditBalanceUsd?.[route.provider];
  if (
    provider.minCreditFloorUsd !== null &&
    balance !== undefined &&
    balance < provider.minCreditFloorUsd
  ) {
    return "below_credit_floor";
  }
  return null;
}

/**
 * Pick the route for one task class, or abstain. Routes are tried in `(priority, routeId)` order, so
 * the same policy and request always decide the same way. Each excluded route keeps one stable
 * reason, and nothing about the caller can steer the choice.
 */
export function resolveModelRoute(
  policy: RoutingPolicy,
  request: ModelRouteRequest,
): ModelRouteDecision {
  checkAmount(request.estimatedCostUsd, "estimatedCostUsd");
  checkAmount(request.estimatedContextTokens, "estimatedContextTokens");
  checkAmount(request.ptDaySpendUsd, "ptDaySpendUsd");
  for (const provider of policy.providers) {
    checkAmount(request.providerCreditBalanceUsd?.[provider.provider], "providerCreditBalanceUsd");
  }

  const providers = new Map(policy.providers.map((provider) => [provider.provider, provider]));
  const unavailable = new Set(request.unavailableProviders ?? []);
  const candidates = policy.routes
    .filter((route) => route.taskClass === request.taskClass)
    .sort(
      (a, b) =>
        a.priority - b.priority || (a.routeId < b.routeId ? -1 : a.routeId > b.routeId ? 1 : 0),
    );

  const excluded: ModelRouteExclusion[] = [];
  for (const route of candidates) {
    const reason = exclusionOf(route, providers.get(route.provider), request, unavailable);
    if (reason === null) {
      return {
        outcome: "selected",
        policyRevision: policy.revision,
        route,
        requiresHumanApproval:
          route.requiresHumanApprovalOverUsd !== null &&
          request.estimatedCostUsd > route.requiresHumanApprovalOverUsd,
        excluded,
      };
    }
    excluded.push({ routeId: route.routeId, reason });
  }
  return {
    outcome: "abstain",
    policyRevision: policy.revision,
    reason: excluded[0]?.reason ?? "no_route_for_task_class",
    excluded,
  };
}
