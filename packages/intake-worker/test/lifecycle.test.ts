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
let read: string;
let mixed: string;
let principalDigest: string;

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
  read = await token("read", false);
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

const lifecyclePath = "/v1/admin/runners/lifecycle?machineId=pc-one";
const action = (
  name = "resume",
  configRevision = 1,
  bindingRevision = 1,
  operationRevision = 0,
) => ({ action: name, configRevision, bindingRevision, operationRevision });
it("reads unenrolled state and refuses lifecycle mutations without enrollment", async () => {
  const e = await setup();
  expect(await (await call(e, lifecyclePath)).json()).toMatchObject({
    machineId: "pc-one",
    configRevision: 1,
    bindingRevision: 0,
    operationRevision: 0,
    connectionState: "unenrolled",
    desiredState: "enabled",
    disconnectPending: false,
    binding: null,
    history: [],
    historyTruncated: false,
  });
  expect((await call(e, lifecyclePath, admin, "POST", action("resume", 1, 0))).status).toBe(409);
  expect((await call(e, lifecyclePath.replace("pc-one", "absent"))).status).toBe(404);
});
it("gives a monitored machine no lifecycle, no enrollment and no poll", async () => {
  const e = { ...env, ...config, CATALOG_NAME: crypto.randomUUID() };
  const spark = {
    id: "delphi",
    alias: "Delphi",
    kind: "spark",
    os: "linux",
    architecture: "arm64",
  };
  const machines = [machine, spark];
  expect(
    (
      await handleRunnerRequest(
        req("/v1/admin/runners/config", admin, "PUT", { version: 2, revision: 1, machines }, 0),
        e,
        key,
      )
    ).status,
  ).toBe(200);
  const sparkLifecycle = "/v1/admin/runners/lifecycle?machineId=delphi";
  const lifecycle = await call(e, sparkLifecycle);
  expect(lifecycle.status).toBe(404);
  expect(await lifecycle.json()).toEqual({ error: "not_a_runner" });
  const drain = await call(e, sparkLifecycle, admin, "POST", action("drain", 1, 0));
  expect(drain.status).toBe(404);
  expect(await drain.json()).toEqual({ error: "not_a_runner" });
  const sparkBinding = "/v1/admin/runners/binding?machineId=delphi";
  const enroll = await call(e, sparkBinding, admin, "PUT", binding(), 0);
  expect(enroll.status).toBe(409);
  expect(await enroll.json()).toEqual({ error: "not_a_runner" });
  const poll = await call(e, "/v1/runner-controller/poll?machineId=delphi", host);
  expect(poll.status).toBe(403);
  // The runner beside it keeps its lifecycle.
  expect((await call(e, lifecyclePath)).status).toBe(200);
});
it("requests drain and resume atomically with all revisions and durable operator history", async () => {
  const e = await setup();
  await call(e, bindingPath, admin, "PUT", binding(), 0);
  const responses = await Promise.all([
    call(e, lifecyclePath, admin, "POST", action("drain")),
    call(e, lifecyclePath, admin, "POST", action("resume")),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  const saved = await (
    await call(e, lifecyclePath)
  ).json<{ configRevision: number; operationRevision: number; history: unknown[] }>();
  expect(saved.operationRevision).toBe(1);
  expect(saved.history).toHaveLength(1);
  for (const mismatch of [{ configRevision: 0 }, { bindingRevision: 0 }, { operationRevision: 0 }])
    expect(
      (
        await call(e, lifecyclePath, admin, "POST", {
          ...action("drain", saved.configRevision, 1, 1),
          ...mismatch,
        })
      ).status,
    ).toBe(409);
  await abortAllDurableObjects();
  expect(await (await call(e, lifecyclePath)).json()).toEqual(saved);
  const resumed = await call(
    e,
    lifecyclePath,
    admin,
    "POST",
    action("resume", saved.configRevision, 1, 1),
  );
  expect(resumed.status).toBe(200);
  expect(await resumed.json()).toMatchObject({
    desiredState: "enabled",
    operationRevision: 2,
    disconnectPending: false,
    history: [
      {
        operationRevision: 1,
        operatorDigest: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown,
        requestedAt: expect.any(String) as unknown,
      },
      { action: "resume", outcome: "requested" },
    ],
  });
});
async function hostReport(
  e: ControllerEnv,
  revision: number,
  changes: Record<string, unknown> = {},
) {
  const response = await call(e, reportPath, host, "POST", {
    reportId: crypto.randomUUID(),
    operationId: `pc-one:${revision}`,
    revision,
    observedAt: new Date().toISOString(),
    listener: "stopped",
    job: "idle",
    acceptingJobs: false,
    ...changes,
  });
  expect(response.status).toBe(200);
}
it("keeps disconnect pending until a second request verifies fresh stopped evidence for current intent", async () => {
  const e = await setup();
  await call(e, bindingPath, admin, "PUT", binding(), 0);
  await hostReport(e, 1);
  expect(
    await (await call(e, lifecyclePath, admin, "POST", action("disconnect"))).json(),
  ).toMatchObject({
    configRevision: 2,
    bindingRevision: 1,
    operationRevision: 1,
    disconnectPending: true,
    binding: { enabled: true },
    history: [{ outcome: "pending" }],
  });
  // A stopped report for the old enabled intent cannot finish maintenance.
  expect(
    await (await call(e, lifecyclePath, admin, "POST", action("disconnect", 2, 1, 1))).json(),
  ).toMatchObject({ configRevision: 2, bindingRevision: 1, disconnectPending: true });
  let revision = 2;
  for (const changes of [
    { job: "busy" },
    { job: "unknown" },
    { listener: "unknown" },
    { acceptingJobs: true },
    { observedAt: "2020-01-01T00:00:00.000Z" },
  ]) {
    await hostReport(e, 2, changes);
    expect(
      await (
        await call(e, lifecyclePath, admin, "POST", action("disconnect", 2, 1, revision++))
      ).json(),
    ).toMatchObject({
      configRevision: 2,
      bindingRevision: 1,
      disconnectPending: true,
      binding: { enabled: true },
    });
  }
  await hostReport(e, 2);
  const finished = await call(
    e,
    lifecyclePath,
    admin,
    "POST",
    action("disconnect", 2, 1, revision),
  );
  expect(finished.status).toBe(200);
  expect(await finished.json()).toMatchObject({
    configRevision: 2,
    bindingRevision: 2,
    disconnectPending: false,
    connectionState: "revoked",
    binding: { enabled: false },
  });
  expect((await call(e, pollPath, host)).status).toBe(403);
  const before = await (await call(e, bindingPath)).json();
  await abortAllDurableObjects();
  expect(await (await call(e, bindingPath)).json()).toEqual(before);
  expect(await (await call(e, lifecyclePath)).json()).toMatchObject({
    history: expect.arrayContaining([
      {
        operationRevision: revision + 1,
        action: "disconnect",
        outcome: "revoked",
        operatorDigest: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown,
        requestedAt: expect.any(String) as unknown,
        configRevision: 2,
        bindingRevision: 2,
      },
    ]) as unknown,
  });
});
it("revokes immediately without asserting stopped execution or permitting implicit re-enrollment", async () => {
  const e = await setup();
  await call(e, bindingPath, admin, "PUT", binding(), 0);
  await hostReport(e, 1, { listener: "running", job: "busy", acceptingJobs: true });
  const revoked = await call(e, lifecyclePath, admin, "POST", action("revoke"));
  expect(revoked.status).toBe(200);
  expect(await revoked.json()).toMatchObject({
    connectionState: "revoked",
    bindingRevision: 2,
    observation: {
      operationState: "pending",
      latest: { report: { listener: "running", job: "busy" } },
    },
    history: [{ action: "revoke", outcome: "revoked" }],
  });
  for (const name of ["resume", "drain"])
    expect((await call(e, lifecyclePath, admin, "POST", action(name, 2, 2, 1))).status).toBe(409);
  expect((await call(e, pollPath, host)).status).toBe(403);
  expect(await (await call(e, bindingPath)).json()).toMatchObject({
    history: [
      { revision: 1, enabled: true },
      { revision: 2, enabled: false },
    ],
  });
});
it("requires admin same-origin access and bounded exact schemas without failed-request history", async () => {
  const e = await setup();
  await call(e, bindingPath, admin, "PUT", binding(), 0);
  for (const jwt of [read, host, human, mixed])
    for (const method of ["GET", "POST"])
      expect(
        (await call(e, lifecyclePath, jwt, method, method === "POST" ? action() : undefined))
          .status,
      ).toBe(401);
  for (const headers of [{ Origin: "https://other.example" }, { "Sec-Fetch-Site": "cross-site" }]) {
    const request = req(lifecyclePath, admin, "POST", action());
    for (const [name, value] of Object.entries(headers)) request.headers.set(name, value);
    expect((await handleControllerRequest(request, e, key)).status).toBe(403);
  }
  for (const body of [
    { ...action(), unexpected: true },
    { ...action(), action: "finish" },
    { action: "resume", configRevision: 1, bindingRevision: 1 },
    ...[-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "0", null].flatMap((value) =>
      ["configRevision", "bindingRevision", "operationRevision"].map((field) => ({
        ...action(),
        [field]: value,
      })),
    ),
  ])
    expect((await call(e, lifecyclePath, admin, "POST", body)).status).toBe(400);
  expect(
    (await call(e, lifecyclePath, admin, "POST", { ...action(), extra: "x".repeat(4096) })).status,
  ).toBe(413);
  expect((await call(e, lifecyclePath, admin, "PUT", action())).status).toBe(405);
  expect(
    (await call(e, lifecyclePath.replace("pc-one", "absent"), admin, "POST", action())).status,
  ).toBe(404);
  expect(await (await call(e, lifecyclePath)).json()).toMatchObject({
    operationRevision: 0,
    history: [],
    configRevision: 1,
    bindingRevision: 1,
  });
});
it("uses current binding evidence and lets explicit drain supersede pending disconnect", async () => {
  const e = await setup();
  await call(e, bindingPath, admin, "PUT", binding(), 0);
  expect(
    await (await call(e, lifecyclePath, admin, "POST", action("disconnect"))).json(),
  ).toMatchObject({ disconnectPending: true, connectionState: "unknown" });
  await hostReport(e, 2);
  await call(e, bindingPath, admin, "PUT", binding(2), 1);
  expect(await (await call(e, lifecyclePath)).json()).toMatchObject({ connectionState: "unknown" });
  expect(
    await (await call(e, lifecyclePath, admin, "POST", action("disconnect", 2, 2, 1))).json(),
  ).toMatchObject({ disconnectPending: true, bindingRevision: 2 });
  await hostReport(e, 2);
  expect(
    await (
      await call(
        { ...e, RUNNER_HEARTBEAT_BUDGET_SECONDS: "" },
        lifecyclePath,
        admin,
        "POST",
        action("disconnect", 2, 2, 2),
      )
    ).json(),
  ).toMatchObject({ disconnectPending: true, bindingRevision: 2, connectionState: "unknown" });
  expect(
    await (await call(e, lifecyclePath, admin, "POST", action("drain", 2, 2, 3))).json(),
  ).toMatchObject({ disconnectPending: false, configRevision: 2, bindingRevision: 2 });
  // Fresh stopped evidence without pending disconnect still requires the first review.
  expect(
    await (await call(e, lifecyclePath, admin, "POST", action("disconnect", 2, 2, 4))).json(),
  ).toMatchObject({ disconnectPending: true, bindingRevision: 2 });
});
it("bounds lifecycle readback to latest 20 immutable operations across restart", async () => {
  const e = await setup();
  await call(e, bindingPath, admin, "PUT", binding(), 0);
  for (let i = 0; i < 21; i++)
    expect((await call(e, lifecyclePath, admin, "POST", action("resume", 1, 1, i))).status).toBe(
      200,
    );
  const before = await (
    await call(e, lifecyclePath)
  ).json<{ history: { operationRevision: number }[]; historyTruncated: boolean }>();
  expect(before.history).toHaveLength(20);
  expect(before.history[0]?.operationRevision).toBe(2);
  expect(before.history.at(-1)?.operationRevision).toBe(21);
  expect(before.historyTruncated).toBe(true);
  await abortAllDurableObjects();
  expect(await (await call(e, lifecyclePath)).json()).toEqual(before);
});
