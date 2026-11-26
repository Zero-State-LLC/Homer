/**
 * Semantic rules for the reviewed snapshots homer-catalog serves. JSON Schema
 * cannot say that one entry of a snapshot agrees with another, so those rules
 * live here, where Node and Workers both run them and answer alike.
 */
import type { IdentityBindingSnapshot, IdentityResolution, IdentitySource } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function itemsOf(input: unknown, key: string): readonly unknown[] {
  if (!isRecord(input)) {
    return [];
  }
  const value = input[key];
  return Array.isArray(value) ? value : [];
}

/** Duplicate (source, sourceAccount) pairs, a prefix that is not the source, and the actorKind rules. */
export function identityBindingSemanticErrors(input: unknown): string[] {
  const bindings = itemsOf(input, "bindings");
  const errors: string[] = [];
  const humans = new Set<string>();
  for (const binding of bindings) {
    if (!isRecord(binding)) {
      continue;
    }
    const actorId = binding["actorId"];
    if (binding["actorKind"] === "human" && typeof actorId === "string") {
      humans.add(actorId);
    }
  }
  const accounts = new Set<string>();
  const kinds = new Map<string, string>();
  bindings.forEach((binding, index) => {
    if (!isRecord(binding)) {
      return;
    }
    const { source, sourceAccount, actorId, actorKind, accountableHumanId } = binding;
    if (typeof source === "string" && typeof sourceAccount === "string") {
      const key = `${source}:${sourceAccount}`;
      if (accounts.has(key)) {
        errors.push(`/bindings/${index} ${source} account ${sourceAccount} is a duplicate`);
      }
      accounts.add(key);
      if (!sourceAccount.startsWith(`${source}:`)) {
        errors.push(`/bindings/${index} sourceAccount must start with "${source}:"`);
      }
    }
    if (typeof actorId === "string" && typeof actorKind === "string") {
      const bound = kinds.get(actorId);
      if (bound !== undefined && bound !== actorKind) {
        errors.push(`/bindings/${index} ${actorId} is bound as both ${bound} and ${actorKind}`);
      }
      kinds.set(actorId, actorKind);
    }
    if (actorKind === "agent" && typeof accountableHumanId !== "string") {
      errors.push(`/bindings/${index} an agent binding needs an accountableHumanId`);
    } else if (
      actorKind === "agent" &&
      typeof accountableHumanId === "string" &&
      !humans.has(accountableHumanId)
    ) {
      errors.push(
        `/bindings/${index} accountableHumanId ${accountableHumanId} must name a human actor in this snapshot`,
      );
    } else if (actorKind === "human" && accountableHumanId !== undefined) {
      errors.push(`/bindings/${index} a human binding must not name an accountableHumanId`);
    }
  });
  return errors;
}

/** Duplicate provider ids, duplicate routeIds, duplicate (taskClass, priority) pairs, and undeclared providers. */
export function routingPolicySemanticErrors(input: unknown): string[] {
  const errors: string[] = [];
  const providers = itemsOf(input, "providers");
  const routes = itemsOf(input, "routes");
  const providerIds = new Set<string>();
  providers.forEach((provider, index) => {
    if (!isRecord(provider)) {
      return;
    }
    const id = provider["provider"];
    if (typeof id !== "string") {
      return;
    }
    if (providerIds.has(id)) {
      errors.push(`/providers/${index} provider ${id} is a duplicate`);
    }
    providerIds.add(id);
  });
  const routeIds = new Set<string>();
  const ordered = new Set<string>();
  routes.forEach((route, index) => {
    if (!isRecord(route)) {
      return;
    }
    const { routeId, taskClass, priority, provider } = route;
    if (typeof routeId === "string") {
      if (routeIds.has(routeId)) {
        errors.push(`/routes/${index} routeId ${routeId} is a duplicate`);
      }
      routeIds.add(routeId);
    }
    if (typeof taskClass === "string" && typeof priority === "number") {
      const key = `${taskClass}:${priority}`;
      if (ordered.has(key)) {
        errors.push(`/routes/${index} ${taskClass} priority ${priority} is a duplicate`);
      }
      ordered.add(key);
    }
    if (typeof provider === "string" && !providerIds.has(provider)) {
      errors.push(`/routes/${index} provider ${provider} is not declared in providers`);
    }
  });
  return errors;
}

/** Exact match only: an account with no binding stays Unattributed and is never guessed. */
export function resolveIdentityBinding(
  snapshot: IdentityBindingSnapshot,
  source: IdentitySource,
  sourceAccount: string,
): IdentityResolution {
  const binding = snapshot.bindings.find(
    (candidate) => candidate.source === source && candidate.sourceAccount === sourceAccount,
  );
  if (binding === undefined) {
    return { status: "unattributed", source, sourceAccount, revision: snapshot.revision };
  }
  return {
    status: "attributed",
    source,
    sourceAccount,
    actorId: binding.actorId,
    actorKind: binding.actorKind,
    ...(binding.accountableHumanId === undefined
      ? {}
      : { accountableHumanId: binding.accountableHumanId }),
    evidenceRef: binding.evidenceRef,
    revision: snapshot.revision,
  };
}
