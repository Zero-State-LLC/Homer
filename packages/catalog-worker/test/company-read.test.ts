import { openEventLedger } from "@zs-home/event-ledger";
import { CONTEXT_PIN, type ActivityEvent } from "@zs-home/shared-contracts/workers";
import { env as bindings } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { event } from "../../event-ledger/test/fixture.js";
import { handleRequest, type Env } from "../src/index.js";

// The company read routes: Context Pin, Identity Bindings, Project Timelines,
// Knowledge Flags and the routing policy. Read audience, `GET` only, same-origin.
const config = {
  ACCESS_ISSUER: "https://synthetic.cloudflareaccess.com",
  ACCESS_READ_AUD: "synthetic-read",
  ACCESS_ADMIN_AUD: "synthetic-admin",
  CATALOG_NAME: "company-read-test",
};
const origin = "https://homer.example";
const companyPaths = [
  "/v1/context-pin",
  "/v1/identities/resolve?source=github&sourceAccount=github%3Aexample-dev",
  "/v1/projects/project%3Afixture/timeline",
  "/v1/knowledge-flags",
  "/v1/routing-policy",
];

/** The shared-contracts fixtures, inlined: a Workers test cannot read files. */
const identityBindings = {
  contract: "home.identity-bindings/v1",
  revision: 4,
  updatedAt: "2026-11-24T18:00:00Z",
  bindings: [
    {
      source: "github",
      sourceAccount: "github:example-dev",
      actorId: "actor:danny",
      actorKind: "human",
      evidenceRef: "https://github.com/Zero-State-LLC/Homer/pull/12",
    },
    {
      source: "linear",
      sourceAccount: "linear:usr_example",
      actorId: "actor:danny",
      actorKind: "human",
      evidenceRef: "https://github.com/Zero-State-LLC/Homer/pull/13",
    },
    {
      source: "buzz",
      sourceAccount: "buzz:npub1exampleexampleexampleexampleexample",
      actorId: "actor:prometheus",
      actorKind: "agent",
      accountableHumanId: "actor:danny",
      evidenceRef: "https://github.com/Zero-State-LLC/Homer/pull/14",
    },
  ],
};
/** An agent with no accountable human: the reviewed snapshot must be refused. */
const unaccountableBindings = {
  ...identityBindings,
  bindings: [
    {
      source: "buzz",
      sourceAccount: "buzz:npub1exampleexampleexampleexampleexample",
      actorId: "actor:prometheus",
      actorKind: "agent",
      evidenceRef: "https://github.com/Zero-State-LLC/Homer/pull/14",
    },
  ],
};

const routingPolicy = {
  contract: "home.routing-policy/v1",
  revision: 3,
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
    {
      provider: "cloudflare-workers-ai",
      endpointHost: null,
      maxUsdPerCall: 0,
      maxUsdPerPtDay: null,
      minCreditFloorUsd: null,
      credentialEnvName: null,
    },
    {
      provider: "qwen-studio",
      endpointHost: "qwen-studio.example",
      maxUsdPerCall: 0,
      maxUsdPerPtDay: null,
      minCreditFloorUsd: null,
      credentialEnvName: "QWEN_STUDIO_API_KEY",
    },
  ],
  routes: [
    {
      routeId: "coding-openrouter-deepseek",
      taskClass: "coding",
      priority: 1,
      provider: "openrouter",
      model: "deepseek/deepseek-v4.1-flash",
      reasoningEffort: "high",
      maxContextTokens: 131072,
      maxUsdPerCall: 0.5,
      requiresHumanApprovalOverUsd: 0.5,
    },
  ],
};
/** A negative per-call budget, which validation refuses. */
const negativeBudgetPolicy = {
  ...routingPolicy,
  providers: [
    {
      provider: "openrouter",
      endpointHost: "openrouter.ai",
      maxUsdPerCall: -1,
      maxUsdPerPtDay: 5,
      minCreditFloorUsd: 5,
      credentialEnvName: "OPENROUTER_API_KEY",
    },
  ],
};

const timelineCommit: ActivityEvent = event("timeline");
/** A Milestone planned with no source date, so its Planned Date is an Unknown Date. */
const milestone: ActivityEvent = {
  ...event("milestone"),
  eventKey: "linear:milestone.planned:synthetic-milestone",
  kind: "milestone.planned",
  occurredAt: "2026-11-18T09:00:00Z",
  actor: { sourceAccount: "linear:usr_example" },
  subject: "Synthetic milestone with no source date",
  data: { milestoneId: "milestone:synthetic" },
  provenance: {
    sourceSystem: "linear",
    sourceObjectId: "synthetic-milestone",
    sourceUrl: "https://linear.app/example/issue/SYN-1",
    collector: "linear-collector",
    collectorVersion: "0.1.0",
    collectedAt: "2026-11-18T09:01:00Z",
  },
};
const verdict: ActivityEvent = {
  contract: "home.activity-event/v4",
  eventKey: "software-factory:factory.verdict_recorded:WP-2026-11-18-home",
  kind: "factory.verdict_recorded",
  occurredAt: "2026-11-18T18:00:00.123456789Z",
  actor: { sourceAccount: "software-factory:gap", actorId: "actor:gap" },
  projectId: "project:fixture",
  repository: "Zero-State-LLC/home",
  subject: "Verdict recorded for the contracts packet",
  data: {
    result: "fail",
    mode: "online",
    headSha: "a1b2c3d",
    judgeModel: "judge-model-synthetic",
    authorModel: "author-model-synthetic",
    pr: 1,
    traceRef: {
      provider: "langfuse",
      traceId: "judge-2026-11-18.7",
      url: "https://langfuse.example.test/trace/judge-2026-11-18.7",
    },
  },
  provenance: {
    sourceSystem: "software-factory",
    sourceObjectId: "WP-2026-11-18-home",
    sourceUrl: "https://github.com/Zero-State-LLC/home/pull/1",
    collector: "software-factory-collector",
    collectorVersion: "0.1.0",
    collectedAt: "2026-11-18T18:00:01Z",
  },
};
/** A Verdict-linked flag: it cites the Verdict and carries no trace of its own. */
const flag: ActivityEvent = {
  contract: "home.activity-event/v4",
  eventKey: "software-factory:knowledge.flagged:WP-2026-11-18-home:a1b2c3d",
  kind: "knowledge.flagged",
  occurredAt: "2026-11-18T18:04:00Z",
  actor: { sourceAccount: "software-factory:gap" },
  projectId: "project:fixture",
  repository: "Zero-State-LLC/home",
  subject: "Knowledge flag: the Verdict failed for WP-2026-11-18-home",
  data: {
    gapKind: "missing",
    targetRef: "docs/map.md",
    observationHash: "3".repeat(64),
    verdictEventKey: "software-factory:factory.verdict_recorded:WP-2026-11-18-home",
  },
  provenance: {
    sourceSystem: "software-factory",
    sourceObjectId: "WP-2026-11-18-home:a1b2c3d",
    sourceUrl: "https://github.com/Zero-State-LLC/home/pull/1",
    collector: "software-factory-collector",
    collectorVersion: "0.1.0",
    collectedAt: "2026-11-18T18:05:00Z",
  },
};
/** A second flag on another Project and Repository, for the query filters. */
const otherFlag: ActivityEvent = {
  contract: "home.activity-event/v4",
  eventKey: "github:knowledge.flagged:synthetic/flag-two",
  kind: "knowledge.flagged",
  occurredAt: "2026-11-18T19:00:00Z",
  actor: { sourceAccount: "github:example-dev", actorId: "actor:danny", actorKind: "human" },
  projectId: "project:other",
  repository: "Zero-State-LLC/Homer",
  subject: "Knowledge flag: CONTEXT.md is stale",
  data: { gapKind: "stale", targetRef: "CONTEXT.md" },
  provenance: {
    sourceSystem: "github",
    sourceObjectId: "synthetic/flag-two",
    sourceUrl: "https://github.com/Zero-State-LLC/Homer/issues/21",
    collector: "github-collector",
    collectorVersion: "0.1.0",
    collectedAt: "2026-11-18T19:01:00Z",
  },
};

let env: typeof bindings;
beforeEach(() => {
  const ledgerId = bindings.EVENT_LEDGER.newUniqueId();
  env = {
    ...bindings,
    EVENT_LEDGER: {
      get: (id, options) => bindings.EVENT_LEDGER.get(id, options),
      idFromName: () => ledgerId,
      newUniqueId: (options) => bindings.EVENT_LEDGER.newUniqueId(options),
      idFromString: (id) => bindings.EVENT_LEDGER.idFromString(id),
      getByName: () => bindings.EVENT_LEDGER.get(ledgerId),
      jurisdiction: (value) => bindings.EVENT_LEDGER.jurisdiction(value),
    },
  };
});

let key: JWTVerifyGetKey;
let jwt: string;
beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  const jwk = await exportJWK(keys.publicKey);
  jwk.kid = "company";
  key = createLocalJWKSet({ keys: [jwk] });
  jwt = await new SignJWT({ type: "app", sub: "synthetic-reader" })
    .setProtectedHeader({ alg: "RS256", kid: "company" })
    .setIssuer(config.ACCESS_ISSUER)
    .setAudience(config.ACCESS_READ_AUD)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(keys.privateKey);
});

const request = (
  path: string,
  e: Env = { ...env, ...config },
  extra: Record<string, string> = {},
) =>
  handleRequest(
    new Request(`${origin}${path}`, {
      headers: { "Cf-Access-Jwt-Assertion": jwt, ...extra },
    }),
    e,
    key,
  );
const anonymous = (path: string) =>
  handleRequest(new Request(`${origin}${path}`), { ...env, ...config }, key);
const post = (path: string) =>
  handleRequest(
    new Request(`${origin}${path}`, {
      method: "POST",
      headers: { "Cf-Access-Jwt-Assertion": jwt },
    }),
    { ...env, ...config },
    key,
  );

it("refuses anonymous, cross-origin and non-GET company reads", async () => {
  for (const path of companyPaths) {
    expect((await anonymous(path)).status, path).toBe(401);
    expect((await post(path)).status, path).toBe(405);
    const crossOrigin = await request(
      path,
      { ...env, ...config },
      {
        Origin: "https://evil.example",
      },
    );
    expect(crossOrigin.status, path).toBe(403);
    expect(await crossOrigin.json()).toEqual({ error: "cross_origin_denied" });
  }
});

it("serves the exact Context Pin and refuses any query parameter", async () => {
  const response = await request("/v1/context-pin");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(CONTEXT_PIN);
  expect((await request("/v1/context-pin?pin=latest")).status).toBe(400);
});

it("resolves bound source accounts and never guesses an unknown one", async () => {
  const e: Env = { ...env, ...config, IDENTITY_BINDINGS_JSON: JSON.stringify(identityBindings) };
  const resolve = (source: string, sourceAccount: string) =>
    request(
      `/v1/identities/resolve?source=${source}&sourceAccount=${encodeURIComponent(sourceAccount)}`,
      e,
    );
  expect(await (await resolve("github", "github:example-dev")).json()).toMatchObject({
    status: "attributed",
    source: "github",
    sourceAccount: "github:example-dev",
    actorId: "actor:danny",
    actorKind: "human",
    revision: 4,
  });
  expect(await (await resolve("linear", "linear:usr_example")).json()).toMatchObject({
    status: "attributed",
    actorId: "actor:danny",
    actorKind: "human",
  });
  expect(
    await (await resolve("buzz", "buzz:npub1exampleexampleexampleexampleexample")).json(),
  ).toMatchObject({
    status: "attributed",
    actorId: "actor:prometheus",
    actorKind: "agent",
    accountableHumanId: "actor:danny",
  });
  const unknown = await resolve("github", "github:unknown-dev");
  expect(unknown.status).toBe(200);
  expect(await unknown.json()).toMatchObject({
    status: "unattributed",
    source: "github",
    sourceAccount: "github:unknown-dev",
    revision: 4,
  });
});

it("rejects invalid identity queries and fails closed without a reviewed snapshot", async () => {
  const e: Env = { ...env, ...config, IDENTITY_BINDINGS_JSON: JSON.stringify(identityBindings) };
  for (const query of [
    "",
    "?source=gitlab&sourceAccount=gitlab:example-dev",
    "?source=github",
    "?sourceAccount=github:example-dev",
    "?source=github&sourceAccount=linear:usr_example",
    "?source=github&sourceAccount=github:example-dev&limit=1",
    "?source=github&source=linear&sourceAccount=github:example-dev",
  ]) {
    const response = await request(`/v1/identities/resolve${query}`, e);
    expect(response.status, query).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_identity_query" });
  }
  const bound = "/v1/identities/resolve?source=github&sourceAccount=github%3Aexample-dev";
  expect((await request(bound)).status).toBe(503);
  expect(await (await request(bound)).json()).toEqual({ error: "identity_bindings_unavailable" });
  for (const json of [
    "{",
    JSON.stringify({ ...identityBindings, contract: "home.identity-bindings/v2" }),
    JSON.stringify(unaccountableBindings),
  ]) {
    const e2: Env = { ...env, ...config, IDENTITY_BINDINGS_JSON: json };
    const response = await request(bound, e2);
    expect(response.status, json).toBe(503);
    expect(await response.json()).toEqual({ error: "identity_bindings_unavailable" });
  }
});

it("serves the reviewed routing policy, or fails closed", async () => {
  const missing = await request("/v1/routing-policy");
  expect(missing.status).toBe(503);
  expect(await missing.json()).toEqual({ error: "routing_policy_unavailable" });
  for (const json of ["{", JSON.stringify(negativeBudgetPolicy)]) {
    const e: Env = { ...env, ...config, ROUTING_POLICY_JSON: json };
    const response = await request("/v1/routing-policy", e);
    expect(response.status, json).toBe(503);
    expect(await response.json()).toEqual({ error: "routing_policy_unavailable" });
  }
  const e: Env = { ...env, ...config, ROUTING_POLICY_JSON: JSON.stringify(routingPolicy) };
  const response = await request("/v1/routing-policy", e);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(routingPolicy);
  expect((await request("/v1/routing-policy?taskClass=coding", e)).status).toBe(400);
});

it("replays a Project Timeline, keeps an Unknown Date, and refuses bad queries", async () => {
  const ledger = openEventLedger(env.EVENT_LEDGER);
  for (const e of [timelineCommit, milestone])
    expect((await ledger.appendActivityEvent(e)).outcome).toBe("appended");
  const response = await request(
    "/v1/projects/project%3Afixture/timeline?asOf=2026-11-19T00:00:00Z",
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({
    state: "ready",
    head: { sequence: 2 },
    asOf: "2026-11-19T00:00:00Z",
    timeline: {},
  });
  // A Milestone without a source date keeps an Unknown Date (`null`), never an invented one.
  expect(JSON.stringify(body)).toContain("null");
  for (const [path, error] of [
    ["/v1/projects/fixture/timeline", "invalid_project_query"],
    ["/v1/projects/project%3A/timeline", "invalid_project_query"],
    ["/v1/projects/project%3AFixture/timeline", "invalid_project_query"],
    ["/v1/projects/project%3Afixture/timeline?asOf=2026-11-19", "invalid_project_query"],
    ["/v1/projects/project%3Afixture/timeline?day=2026-11-19", "invalid_project_query"],
  ] as const) {
    const bad = await request(path);
    expect(bad.status, path).toBe(400);
    expect(await bad.json()).toEqual({ error });
  }
});

it("lists Knowledge Flags with a linked Verdict and an inherited Langfuse trace", async () => {
  const ledger = openEventLedger(env.EVENT_LEDGER);
  for (const e of [verdict, flag, otherFlag])
    expect((await ledger.appendActivityEvent(e)).outcome).toBe("appended");
  const response = await request("/v1/knowledge-flags");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    state: "ready",
    head: { sequence: 3 },
    stuckThreshold: 3,
    flags: [
      {
        eventKey: flag.eventKey,
        sourceSystem: "software-factory",
        status: "open",
        gapKind: "missing",
        targetRef: "docs/map.md",
        projectId: "project:fixture",
        repository: "Zero-State-LLC/home",
        traceRef: { provider: "langfuse", traceId: "judge-2026-11-18.7" },
        linkedVerdict: {
          eventKey: verdict.eventKey,
          repository: "Zero-State-LLC/home",
          headSha: "a1b2c3d",
          pr: 1,
          result: "fail",
          traceRef: { provider: "langfuse", traceId: "judge-2026-11-18.7" },
        },
      },
      { eventKey: otherFlag.eventKey, sourceSystem: "github", status: "open" },
    ],
  });
  expect(await (await request("/v1/knowledge-flags?status=open")).json()).toMatchObject({
    state: "ready",
    flags: [{}, {}],
  });
  expect(await (await request("/v1/knowledge-flags?status=all")).json()).toMatchObject({
    flags: [{}, {}],
  });
  expect(await (await request("/v1/knowledge-flags?status=stuck")).json()).toMatchObject({
    state: "empty",
    flags: [],
  });
  expect(
    await (await request("/v1/knowledge-flags?projectId=project%3Afixture")).json(),
  ).toMatchObject({ flags: [{ eventKey: flag.eventKey }] });
  expect(
    await (await request("/v1/knowledge-flags?repository=Zero-State-LLC%2FHomer")).json(),
  ).toMatchObject({ flags: [{ eventKey: otherFlag.eventKey }] });
  for (const query of [
    "?status=closed",
    "?projectId=fixture",
    "?repository=Homer",
    "?status=open&status=stuck",
    "?limit=1",
  ]) {
    const bad = await request(`/v1/knowledge-flags${query}`);
    expect(bad.status, query).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_knowledge_flag_query" });
  }
});

it("fails closed when the Event Ledger is unavailable or its history is too large", async () => {
  const unavailable: Env = { ...env, ...config };
  Reflect.deleteProperty(unavailable, "EVENT_LEDGER");
  for (const [path, error] of [
    ["/v1/projects/project%3Afixture/timeline", "timeline_unavailable"],
    ["/v1/knowledge-flags", "knowledge_flags_unavailable"],
  ] as const) {
    const response = await request(path, unavailable);
    expect(response.status, path).toBe(503);
    expect(await response.json()).toEqual({ error });
  }
  const oversized = {
    ...env,
    ...config,
    EVENT_LEDGER: {
      idFromName: () => "synthetic",
      get: () => ({
        head: () => Promise.resolve({ sequence: 2001, entryDigest: "a".repeat(64) }),
        readHistory: () => Promise.reject(new Error("must not read oversized ledger")),
      }),
    },
  } as unknown as Env;
  for (const [path, error] of [
    ["/v1/projects/project%3Afixture/timeline", "timeline_history_too_large"],
    ["/v1/knowledge-flags", "knowledge_flag_history_too_large"],
  ] as const) {
    const response = await request(path, oversized);
    expect(response.status, path).toBe(413);
    expect(await response.json()).toEqual({ error });
  }
});
