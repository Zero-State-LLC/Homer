import { openEventLedger } from "@zs-home/event-ledger";
import { CONTEXT_PIN, type ActivityEvent } from "@zs-home/shared-contracts/workers";
import { env as bindings } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { createCompanyClient } from "../../company-sdk/src/client.js";
import { event } from "../../event-ledger/test/fixture.js";
import { handleRequest, type Env } from "../../catalog-worker/src/index.js";

// The company SDK against homer-catalog in one workerd isolate: synthetic Access,
// a synthetic Event Ledger and reviewed snapshots, all inline.
const config = {
  ACCESS_ISSUER: "https://synthetic.cloudflareaccess.com",
  ACCESS_READ_AUD: "synthetic-read",
  ACCESS_ADMIN_AUD: "synthetic-admin",
  CATALOG_NAME: "company-sdk-integration",
};
const origin = "https://homer.example";

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

const timelineCommit: ActivityEvent = event("timeline");
const verdict: ActivityEvent = {
  contract: "home.activity-event/v4",
  eventKey: "software-factory:factory.verdict_recorded:WP-2026-11-18-home",
  kind: "factory.verdict_recorded",
  occurredAt: "2026-11-18T18:00:00Z",
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
  jwk.kid = "company-sdk";
  key = createLocalJWKSet({ keys: [jwk] });
  jwt = await new SignJWT({ type: "app", sub: "synthetic-reader" })
    .setProtectedHeader({ alg: "RS256", kid: "company-sdk" })
    .setIssuer(config.ACCESS_ISSUER)
    .setAudience(config.ACCESS_READ_AUD)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(keys.privateKey);
});

function companyEnv(): Env {
  return {
    ...env,
    ...config,
    IDENTITY_BINDINGS_JSON: JSON.stringify(identityBindings),
    ROUTING_POLICY_JSON: JSON.stringify(routingPolicy),
  };
}

function clientFor(e: Env) {
  return createCompanyClient({
    baseUrl: origin,
    getAccessHeaders: () => ({ "Cf-Access-Jwt-Assertion": jwt }),
    fetch: (input, init) => handleRequest(new Request(input, init), e, key),
  });
}

it("reads every company surface through homer-catalog", async () => {
  const ledger = openEventLedger(env.EVENT_LEDGER);
  for (const e of [timelineCommit, verdict, flag, otherFlag]) {
    expect((await ledger.appendActivityEvent(e)).outcome).toBe("appended");
  }
  const client = clientFor(companyEnv());

  expect(await client.getContextPin()).toMatchObject({
    repository: CONTEXT_PIN.repository,
    commit: CONTEXT_PIN.commit,
  });
  expect(
    await client.resolveIdentity({ source: "github", sourceAccount: "github:example-dev" }),
  ).toMatchObject({ status: "attributed", actorId: "actor:danny", actorKind: "human" });
  expect(
    await client.resolveIdentity({ source: "github", sourceAccount: "github:unknown-dev" }),
  ).toMatchObject({ status: "unattributed", revision: 4 });

  expect(
    await client.getProjectStatus({
      projectId: "project:fixture",
      asOf: "2026-11-19T00:00:00Z",
    }),
  ).toMatchObject({
    state: "ready",
    head: { sequence: 4 },
    asOf: "2026-11-19T00:00:00Z",
  });

  expect(await client.listKnowledgeFlags()).toMatchObject({
    state: "ready",
    stuckThreshold: 3,
    flags: [
      { eventKey: flag.eventKey, status: "open", linkedVerdict: { result: "fail" } },
      { eventKey: otherFlag.eventKey, status: "open" },
    ],
  });
  expect(
    await client.listKnowledgeFlags({ status: "open", repository: "Zero-State-LLC/home" }),
  ).toMatchObject({ flags: [{ eventKey: flag.eventKey }] });
  expect(await client.listKnowledgeFlags({ status: "stuck" })).toMatchObject({
    state: "empty",
    flags: [],
  });

  expect(await client.getRoutingPolicy()).toMatchObject({
    contract: "home.routing-policy/v1",
    revision: 3,
  });
  const fleet = await client.getFleetHealth();
  expect(fleet).toMatchObject({ sparkdashUrl: null });
  expect(typeof fleet.configRevision).toBe("number");
  expect(Array.isArray(fleet.machines)).toBe(true);
});

it("maps a catalog refusal to a CompanySdkError code", async () => {
  const client = clientFor(companyEnv());
  await expect(
    client.resolveIdentity({ source: "github", sourceAccount: "linear:usr_example" }),
  ).rejects.toMatchObject({ status: 400, code: "invalid_identity_query" });
  const unconfigured = clientFor({ ...env, ...config });
  await expect(unconfigured.getRoutingPolicy()).rejects.toMatchObject({
    status: 503,
    code: "routing_policy_unavailable",
  });
});
