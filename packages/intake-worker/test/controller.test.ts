import { env } from "cloudflare:workers";
import { abortAllDurableObjects } from "cloudflare:test";
import { beforeAll, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import {
  handleRequest as handleCatalogRequest,
  type Env as CatalogEnv,
} from "@zs-home/catalog-worker";
import { verifyAccessIdentity } from "@zs-home/catalog-worker/access";
import { handleRequest as handleIntakeRequest, type IntakeEnv } from "../src/index.js";

// The protocol spans both Workers (ADR 013): people enroll machines in the
// catalog, and machines poll and report to intake.
type ControllerEnv = CatalogEnv & IntakeEnv;
function handleControllerRequest(request: Request, e: ControllerEnv, k?: JWTVerifyGetKey) {
  return new URL(request.url).pathname.startsWith("/v1/runner-controller/")
    ? handleIntakeRequest(request, e, k)
    : handleCatalogRequest(request, e, k);
}
const handleRunnerRequest = handleControllerRequest;
let key: JWTVerifyGetKey;
let admin: string;
let host: string;
let human: string;
let mixed: string;
let singleton: string;
let deniedAudiences: string[];
let principalDigest: string;
let replacementHost: string;
let replacementDigest: string;
const config = {
  ACCESS_ISSUER: "https://synthetic.cloudflareaccess.com",
  ACCESS_ADMIN_AUD: "admin",
  ACCESS_READ_AUD: "read",
  RUNNER_CONTROLLER_AUD: "controller",
  CATALOG_NAME: "test",
  RUNNER_HEARTBEAT_BUDGET_SECONDS: "60",
};
beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  key = createLocalJWKSet({ keys: [{ ...(await exportJWK(keys.publicKey)), kid: "test" }] });
  const token = (aud: string | string[], workload = true, commonName = "host.access") =>
    new SignJWT({
      type: "app",
      sub: workload ? "" : "operator",
      ...(workload ? { common_name: commonName } : {}),
    })
      .setIssuer(config.ACCESS_ISSUER)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime("5m")
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .sign(keys.privateKey);
  admin = await token("admin", false);
  host = await token("controller");
  singleton = await token(["controller"]);
  deniedAudiences = await Promise.all(
    [[], ["admin"], ["controller", "read"], ["controller", "controller"]].map((aud) => token(aud)),
  );
  replacementHost = await token("controller", true, "replacement.access");
  replacementDigest = (
    await verifyAccessIdentity(await token("admin", true, "replacement.access"), config, true, key)
  ).principal;
  human = await token("controller", false);
  mixed = await token(["controller", "admin"]);
  principalDigest = (await verifyAccessIdentity(await token("admin"), config, true, key)).principal;
});
const machine = {
  id: "pc-one",
  alias: "PC",
  kind: "pc",
  os: "linux",
  architecture: "x64",
  runnerId: null,
  repository: "example/repo",
  labels: [],
  desiredState: "enabled",
};
function req(path: string, jwt = admin, method = "GET", body?: unknown, revision?: number) {
  return new Request(`https://homer.example${path}`, {
    method,
    headers: {
      "Cf-Access-Jwt-Assertion": jwt,
      "Content-Type": "application/json",
      ...(revision === undefined ? {} : { "If-Match": `"${revision}"` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const bindingPath = "/v1/admin/runners/binding?machineId=pc-one";
const pollPath = "/v1/runner-controller/poll?machineId=pc-one";
const reportPath = "/v1/runner-controller/report?machineId=pc-one";
const observationPath = "/v1/admin/runners/observation?machineId=pc-one";
const call = (
  e: ControllerEnv,
  path: string,
  jwt = admin,
  method = "GET",
  body?: unknown,
  revision?: number,
) => handleControllerRequest(req(path, jwt, method, body, revision), e, key);
async function setup() {
  const e = { ...env, ...config, CATALOG_NAME: crypto.randomUUID() };
  expect(
    (
      await handleRunnerRequest(
        req(
          "/v1/admin/runners/config",
          admin,
          "PUT",
          { version: 1, revision: 1, machines: [machine, { ...machine, id: "mac-two" }] },
          0,
        ),
        e,
        key,
      )
    ).status,
  ).toBe(200);
  return e;
}
const binding = (revision = 1, enabled = true) => ({
  revision,
  principalDigest,
  evidenceRef: "review:synthetic-enrollment",
  enabled,
});
it("enrolls with separate CAS and scopes exact workload authentication to one machine", async () => {
  const e = await setup();
  expect((await call(e, pollPath, host)).status).toBe(403);
  expect((await call(e, bindingPath, admin, "PUT", binding(), 0)).status).toBe(200);
  expect((await call(e, bindingPath, admin, "PUT", binding(), 0)).status).toBe(409);
  expect(await (await call(e, pollPath, host)).json()).toEqual({
    machineId: "pc-one",
    revision: 1,
    operationId: "pc-one:1",
    desiredState: "enabled",
  });
  for (const jwt of [admin, human, mixed]) expect((await call(e, pollPath, jwt)).status).toBe(401);
  expect((await call(e, pollPath.replace("pc-one", "mac-two"), host)).status).toBe(403);
  expect((await call({ ...e, RUNNER_CONTROLLER_AUD: "" }, pollPath, host)).status).toBe(503);
});
it("accepts only the exact controller audience in string or singleton-array form", async () => {
  const e = await setup();
  await call(e, bindingPath, admin, "PUT", binding(), 0);
  const original = await (await call(e, pollPath, host)).json();
  const response = await call(e, pollPath, singleton);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(original);
  expect((await call(e, pollPath.replace("pc-one", "mac-two"), singleton)).status).toBe(403);
  const input = report();
  const accepted = await call(e, reportPath, singleton, "POST", input);
  expect(accepted.status).toBe(200);
  const receipt = await accepted.json();
  expect(await (await call(e, reportPath, host, "POST", input)).json()).toEqual(receipt);
  for (const jwt of [admin, human, mixed, ...deniedAudiences]) {
    expect((await call(e, pollPath, jwt)).status).toBe(401);
    expect((await call(e, reportPath, jwt, "POST", input)).status).toBe(401);
  }
  expect(await (await call(e, observationPath)).json()).toMatchObject({
    history: [{ receipt }],
  });
});
const report = () => ({
  reportId: crypto.randomUUID(),
  operationId: "pc-one:1",
  revision: 1,
  observedAt: new Date().toISOString(),
  listener: "running",
  job: "idle",
  acceptingJobs: true,
});
it("preserves original report receipts and history across retry, intent advancement and restart", async () => {
  const e = await setup();
  await call(e, bindingPath, admin, "PUT", binding(), 0);
  const input = report();
  const response = await call(e, reportPath, host, "POST", input);
  expect(response.status).toBe(200);
  const receipt = await response.json();
  await abortAllDurableObjects();
  expect(await (await call(e, reportPath, host, "POST", input)).json()).toEqual(receipt);
  expect((await call(e, reportPath, host, "POST", { ...input, job: "busy" })).status).toBe(409);
  const observed = await (
    await call(e, observationPath)
  ).json<{
    freshness: string;
    operationState: string;
    history: unknown[];
    latest: { receipt: unknown };
  }>();
  expect(observed.freshness).toBe("fresh");
  expect(observed.operationState).toBe("complete");
  expect(observed.history).toHaveLength(1);
  expect(observed.latest.receipt).toEqual(receipt);
  await handleRunnerRequest(
    req(
      "/v1/admin/runners/config",
      admin,
      "PUT",
      {
        version: 1,
        revision: 2,
        machines: [
          { ...machine, desiredState: "maintenance" },
          { ...machine, id: "mac-two" },
        ],
      },
      1,
    ),
    e,
    key,
  );
  expect(await (await call(e, reportPath, host, "POST", input)).json()).toEqual(receipt);
  expect((await call(e, reportPath, host, "POST", report())).status).toBe(409);
  await call(e, bindingPath, admin, "PUT", binding(2, false), 1);
  expect((await call(e, reportPath, host, "POST", input)).status).toBe(403);
});
it("bounds evidence readback while retaining the newest observations", async () => {
  const e = await setup();
  await call(e, bindingPath, admin, "PUT", binding(), 0);
  for (let i = 0; i < 21; i++)
    expect((await call(e, reportPath, host, "POST", report())).status).toBe(200);
  const result = await (
    await call(e, observationPath)
  ).json<{ history: unknown[]; historyTruncated: boolean }>();
  expect(result.history).toHaveLength(20);
  expect(result.historyTruncated).toBe(true);
});
it("never treats absent, stale, future or unbudgeted host evidence as idle completion", async () => {
  const e = await setup();
  await call(e, bindingPath, admin, "PUT", binding(), 0);
  expect(await (await call(e, observationPath)).json()).toMatchObject({
    freshness: "unknown",
    operationState: "unknown",
    latest: null,
  });
  for (const observedAt of ["2020-01-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z"]) {
    expect((await call(e, reportPath, host, "POST", { ...report(), observedAt })).status).toBe(200);
    expect(await (await call(e, observationPath)).json()).toMatchObject({
      freshness: "stale",
      operationState: "unknown",
    });
  }
  await call(e, reportPath, host, "POST", report());
  expect(
    await (await call({ ...e, RUNNER_HEARTBEAT_BUDGET_SECONDS: "" }, observationPath)).json(),
  ).toMatchObject({ freshness: "unknown", operationState: "unknown" });
});
it("refuses malformed reports without appending free-form host content", async () => {
  const e = await setup();
  await call(e, bindingPath, admin, "PUT", binding(), 0);
  for (const change of [
    { observedAt: "2026-02-30T00:00:00.000Z" },
    { observedAt: "2026-01-01" },
    { observedAt: "2026-01-01T00:00:00+01:00" },
    { logs: "private" },
    { job: "offline" },
    { acceptingJobs: "false" },
    { reportId: "bad" },
    { revision: 1.5 },
  ])
    expect((await call(e, reportPath, host, "POST", { ...report(), ...change })).status).toBe(400);
  expect(
    (await call(e, reportPath, host, "POST", { ...report(), operationId: "mac-two:1" })).status,
  ).toBe(409);
  expect(await (await call(e, observationPath)).json()).toMatchObject({
    latest: null,
    history: [],
  });
});
it("revocation and replacement invalidate completion and forbid the previous workload", async () => {
  const e = await setup();
  await call(e, bindingPath, admin, "PUT", binding(), 0);
  await call(e, reportPath, host, "POST", report());
  const results = await Promise.all([
    call(e, bindingPath, admin, "PUT", binding(2, false), 1),
    call(e, bindingPath, admin, "PUT", { ...binding(2), principalDigest: "a".repeat(64) }, 1),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect((await call(e, pollPath, host)).status).toBe(403);
  expect((await call(e, reportPath, host, "POST", report())).status).toBe(403);
  expect(await (await call(e, observationPath)).json()).toMatchObject({
    operationState: "pending",
  });
  const result = await (
    await call(e, bindingPath)
  ).json<{ history: unknown[]; revision: number }>();
  expect(result.revision).toBe(2);
  expect(result.history).toHaveLength(2);
});
it("requires stopped idle closed admission for host-reported maintenance completion", async () => {
  const e = await setup();
  await call(e, bindingPath, admin, "PUT", binding(), 0);
  await handleRunnerRequest(
    req(
      "/v1/admin/runners/config",
      admin,
      "PUT",
      {
        version: 1,
        revision: 2,
        machines: [
          { ...machine, desiredState: "maintenance" },
          { ...machine, id: "mac-two" },
        ],
      },
      1,
    ),
    e,
    key,
  );
  for (const [job, operationState] of [
    ["busy", "blocked"],
    ["unknown", "blocked"],
    ["idle", "complete"],
  ]) {
    expect(
      (
        await call(e, reportPath, host, "POST", {
          ...report(),
          revision: 2,
          operationId: "pc-one:2",
          listener: "stopped",
          acceptingJobs: false,
          job,
        })
      ).status,
    ).toBe(200);
    expect(await (await call(e, observationPath)).json()).toMatchObject({ operationState });
  }
});
it("revokes both new reports and duplicate receipts without erasing accepted evidence", async () => {
  const e = await setup();
  expect((await call(e, bindingPath, admin, "PUT", binding(), 0)).status).toBe(200);
  const accepted = report();
  const receipt = await (await call(e, reportPath, host, "POST", accepted)).json();
  expect((await call(e, bindingPath, admin, "PUT", binding(2, false), 1)).status).toBe(200);
  await abortAllDurableObjects();
  expect((await call(e, pollPath, host)).status).toBe(403);
  expect((await call(e, reportPath, host, "POST", report())).status).toBe(403);
  expect((await call(e, reportPath, host, "POST", accepted)).status).toBe(403);
  expect(await (await call(e, observationPath)).json()).toMatchObject({
    operationState: "pending",
    latest: { receipt, principalDigest, bindingRevision: 1 },
    history: [{ receipt }],
  });
  expect(await (await call(e, bindingPath)).json()).toMatchObject({
    revision: 2,
    binding: { enabled: false },
    history: [
      { revision: 1, enabled: true },
      { revision: 2, enabled: false },
    ],
  });
});
it("replaces a workload binding and requires fresh evidence from its new principal", async () => {
  const e = await setup();
  expect((await call(e, bindingPath, admin, "PUT", binding(), 0)).status).toBe(200);
  const accepted = report();
  expect((await call(e, reportPath, host, "POST", accepted)).status).toBe(200);
  expect(
    (
      await call(
        e,
        bindingPath,
        admin,
        "PUT",
        { ...binding(2), principalDigest: replacementDigest },
        1,
      )
    ).status,
  ).toBe(200);
  await abortAllDurableObjects();
  expect((await call(e, pollPath, host)).status).toBe(403);
  expect((await call(e, reportPath, host, "POST", accepted)).status).toBe(403);
  expect((await call(e, reportPath, host, "POST", report())).status).toBe(403);
  expect(await (await call(e, observationPath)).json()).toMatchObject({
    operationState: "pending",
  });
  expect(await (await call(e, pollPath, replacementHost)).json()).toEqual({
    machineId: "pc-one",
    revision: 1,
    operationId: "pc-one:1",
    desiredState: "enabled",
  });
  expect((await call(e, reportPath, replacementHost, "POST", accepted)).status).toBe(409);
  expect((await call(e, reportPath, replacementHost, "POST", report())).status).toBe(200);
  const result = await (await call(e, observationPath)).json<{ history: unknown[] }>();
  expect(result).toMatchObject({
    operationState: "complete",
    latest: { principalDigest: replacementDigest, bindingRevision: 2 },
  });
  expect(result.history).toHaveLength(2);
});
