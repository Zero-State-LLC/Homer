import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONTEXT_PIN,
  resolveIdentityBinding,
  validateIdentityBindingSnapshot,
  validateRoutingPolicy,
  type IdentityBindingSnapshot,
  type RoutingPolicy,
} from "../src/index.js";
import { readJson } from "../src/json.js";
import {
  validateIdentityBindingSnapshot as workerValidateIdentityBindingSnapshot,
  validateRoutingPolicy as workerValidateRoutingPolicy,
} from "@zs-home/shared-contracts/workers";
import { loadFixture } from "./fixture.js";

type Kind = "identity" | "routing";

const validatorsOf = {
  identity: {
    node: validateIdentityBindingSnapshot,
    workers: workerValidateIdentityBindingSnapshot,
  },
  routing: { node: validateRoutingPolicy, workers: workerValidateRoutingPolicy },
} as const;

/** Both validators refuse `input`, agree, and say `message`. */
function rejects(kind: Kind, input: unknown, message: string): void {
  const { node, workers } = validatorsOf[kind];
  const result = node(input);
  expect(result.ok).toBe(false);
  expect(workers(input)).toEqual(result);
  expect(result.ok ? "" : result.errors.join("\n")).toContain(message);
}

function bindingSnapshot(): IdentityBindingSnapshot {
  const result = validateIdentityBindingSnapshot(loadFixture("valid/identity-bindings.json"));
  if (!result.ok) {
    expect.fail(result.errors.join("\n"));
  }
  return result.value;
}

function routingPolicy(): RoutingPolicy {
  const result = validateRoutingPolicy(loadFixture("valid/routing-policy.json"));
  if (!result.ok) {
    expect.fail(result.errors.join("\n"));
  }
  return result.value;
}

function snapshot(bindings: unknown[]): Record<string, unknown> {
  return {
    contract: "home.identity-bindings/v1",
    revision: 4,
    updatedAt: "2026-11-24T18:00:00Z",
    bindings,
  };
}

function policy(changes: Record<string, unknown>): Record<string, unknown> {
  return { ...routingPolicy(), ...changes };
}

function first<T>(items: readonly T[]): T {
  const [head] = items;
  if (head === undefined) {
    expect.fail("the seed fixture is empty");
  }
  return head;
}

/** The seed's items with `edit` applied to the item at `index`, for one invalid case. */
function editAt<T>(items: readonly T[], index: number, edit: (item: T) => unknown): unknown[] {
  return items.map((item, current) => (current === index ? edit(item) : item));
}

const humanBinding = {
  source: "github",
  sourceAccount: "github:example-dev",
  actorId: "actor:danny",
  actorKind: "human",
  evidenceRef: "https://github.com/Zero-State-LLC/Homer/pull/12",
};

const agentBinding = {
  source: "buzz",
  sourceAccount: "buzz:npub1exampleexampleexampleexampleexample",
  actorId: "actor:prometheus",
  actorKind: "agent",
  accountableHumanId: "actor:danny",
  evidenceRef: "https://github.com/Zero-State-LLC/Homer/pull/14",
};

describe("home.identity-bindings/v1", () => {
  it("accepts the reviewed snapshot seed, and the Workers validator agrees", () => {
    const value = loadFixture("valid/identity-bindings.json");
    expect(validateIdentityBindingSnapshot(value)).toEqual(
      workerValidateIdentityBindingSnapshot(value),
    );
    expect(bindingSnapshot().bindings).toHaveLength(5);
  });

  it("refuses two bindings for one source account", () => {
    rejects(
      "identity",
      snapshot([humanBinding, { ...humanBinding, actorId: "actor:someone-else" }]),
      "is a duplicate",
    );
  });

  it("keeps the source account prefix equal to the source", () => {
    rejects(
      "identity",
      snapshot([{ ...humanBinding, source: "linear" }]),
      'sourceAccount must start with "linear:"',
    );
  });

  it("requires an agent to name a human in the same snapshot", () => {
    const withoutHuman = {
      source: "buzz",
      sourceAccount: "buzz:npub1exampleexampleexampleexampleexample",
      actorId: "actor:prometheus",
      actorKind: "agent",
      evidenceRef: "https://github.com/Zero-State-LLC/Homer/pull/14",
    };
    rejects("identity", snapshot([humanBinding, withoutHuman]), "needs an accountableHumanId");
    rejects(
      "identity",
      snapshot([humanBinding, { ...agentBinding, accountableHumanId: "actor:nobody" }]),
      "must name a human actor in this snapshot",
    );
  });

  it("forbids an accountable human on a human binding", () => {
    rejects(
      "identity",
      snapshot([{ ...humanBinding, accountableHumanId: "actor:danny" }]),
      "a human binding must not name an accountableHumanId",
    );
  });

  it("binds one actorId to one actorKind", () => {
    rejects(
      "identity",
      snapshot([humanBinding, { ...agentBinding, actorId: "actor:danny" }]),
      "is bound as both human and agent",
    );
  });

  it("refuses an unknown property", () => {
    rejects(
      "identity",
      { ...snapshot([humanBinding]), extra: true },
      "must NOT have additional properties",
    );
  });

  it("refuses a 32-hex account id in an evidence link", () => {
    rejects(
      "identity",
      snapshot([
        {
          ...humanBinding,
          evidenceRef: "https://example.test/runs/0123456789abcdef0123456789abcdef",
        },
      ]),
      "/bindings/0/evidenceRef must NOT be valid",
    );
  });
});

describe("home.routing-policy/v1", () => {
  it("accepts the reviewed policy seed, and the Workers validator agrees", () => {
    const value = loadFixture("valid/routing-policy.json");
    expect(validateRoutingPolicy(value)).toEqual(workerValidateRoutingPolicy(value));
    expect(routingPolicy().routes).toHaveLength(4);
  });

  it("refuses a duplicate provider", () => {
    const seed = routingPolicy();
    rejects(
      "routing",
      policy({ providers: [...seed.providers, { ...first(seed.providers) }] }),
      "provider openrouter is a duplicate",
    );
  });

  it("refuses a duplicate routeId and a duplicate task class priority", () => {
    const seed = routingPolicy();
    rejects(
      "routing",
      policy({ routes: [...seed.routes, { ...first(seed.routes), priority: 2 }] }),
      "is a duplicate",
    );
    rejects(
      "routing",
      policy({ routes: [...seed.routes, { ...first(seed.routes), routeId: "coding-secondary" }] }),
      "coding priority 1 is a duplicate",
    );
  });

  it("refuses a route whose provider is not declared", () => {
    const seed = routingPolicy();
    rejects(
      "routing",
      policy({ routes: editAt(seed.routes, 0, (route) => ({ ...route, provider: "xai" })) }),
      "provider xai is not declared in providers",
    );
  });

  it("refuses a negative budget", () => {
    const seed = routingPolicy();
    rejects(
      "routing",
      policy({
        providers: editAt(seed.providers, 0, (item) => ({ ...item, maxUsdPerCall: -0.5 })),
      }),
      "/providers/0/maxUsdPerCall must be >= 0",
    );
  });

  it("refuses an IP literal as an endpoint host", () => {
    const seed = routingPolicy();
    rejects(
      "routing",
      policy({
        providers: editAt(seed.providers, 0, (item) => ({ ...item, endpointHost: "10.0.0.5" })),
      }),
      "/providers/0/endpointHost",
    );
  });

  it("refuses an unknown property", () => {
    rejects("routing", policy({ extra: true }), "must NOT have additional properties");
  });
});

describe("resolveIdentityBinding", () => {
  it("resolves an exact match and leaves every other account Unattributed", () => {
    const seed = bindingSnapshot();
    expect(resolveIdentityBinding(seed, "github", "github:example-dev")).toEqual({
      status: "attributed",
      source: "github",
      sourceAccount: "github:example-dev",
      actorId: "actor:danny",
      actorKind: "human",
      evidenceRef: "https://github.com/Zero-State-LLC/Homer/pull/12",
      revision: 4,
    });
    expect(
      resolveIdentityBinding(seed, "buzz", "buzz:npub1exampleexampleexampleexampleexample"),
    ).toMatchObject({
      status: "attributed",
      actorKind: "agent",
      accountableHumanId: "actor:danny",
    });
    expect(resolveIdentityBinding(seed, "github", "github:Example-Dev")).toEqual({
      status: "unattributed",
      source: "github",
      sourceAccount: "github:Example-Dev",
      revision: 4,
    });
  });
});

describe("CONTEXT_PIN", () => {
  it("is the root agent-context pin, frozen", () => {
    const root = dirname(fileURLToPath(import.meta.url));
    expect(CONTEXT_PIN).toEqual(readJson(join(root, "../../../agent-context.pin.json")));
    expect(Object.isFrozen(CONTEXT_PIN)).toBe(true);
  });
});
