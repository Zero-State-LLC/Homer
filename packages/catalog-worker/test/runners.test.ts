import { env } from "cloudflare:workers";
import { abortAllDurableObjects } from "cloudflare:test";
import { beforeAll, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { handleRunnerRequest, type RunnerEnv } from "../src/runner-http.js";
let key: JWTVerifyGetKey;
let admin: string;
let read: string;
const config = {
  ACCESS_ISSUER: "https://synthetic.cloudflareaccess.com",
  ACCESS_ADMIN_AUD: "admin",
  ACCESS_READ_AUD: "read",
  CATALOG_NAME: "runner-test",
};
beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  key = createLocalJWKSet({ keys: [{ ...(await exportJWK(keys.publicKey)), kid: "test" }] });
  const token = (aud: string) =>
    new SignJWT({ type: "app", sub: "operator" })
      .setIssuer(config.ACCESS_ISSUER)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime("5m")
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .sign(keys.privateKey);
  admin = await token("admin");
  read = await token("read");
});
const machine = {
  id: "pc-one",
  alias: "Build PC",
  kind: "pc",
  os: "linux",
  architecture: "x64",
  runnerId: null,
  repository: "Zero-State-LLC/example",
  labels: ["trusted"],
  desiredState: "enabled",
};
function request(
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
  jwt = admin,
) {
  return new Request("https://homer.example/v1/admin/runners/config", {
    method,
    headers: { "Cf-Access-Jwt-Assertion": jwt, "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function environment(): RunnerEnv {
  return { ...env, ...config, CATALOG_NAME: crypto.randomUUID() };
}
it("saves desired configuration and reads it after restart without claiming observed control", async () => {
  const e = environment();
  const saved = await handleRunnerRequest(
    request("PUT", { version: 1, revision: 1, machines: [machine] }, { "If-Match": '"0"' }),
    e,
    key,
  );
  expect(saved.status).toBe(200);
  expect(saved.headers.get("ETag")).toBe('"1"');
  await abortAllDurableObjects();
  const loaded = await handleRunnerRequest(request(), e, key);
  const body = await loaded.json<{
    config: unknown;
    observedState: string;
    requestStatus: string;
    audit: { previousRevision: number; operatorDigest: string; requestedAt: string };
  }>();
  expect(body.config).toEqual({ version: 1, revision: 1, machines: [machine] });
  expect(body.observedState).toBe("unknown");
  expect(body.requestStatus).toBe("pending");
  expect(body.audit.previousRevision).toBe(0);
  expect(body.audit.operatorDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(Number.isNaN(Date.parse(body.audit.requestedAt))).toBe(false);
});
it("allows only one concurrent desired-state request and forbids deletion", async () => {
  const e = environment();
  const save = (machines: unknown[], revision = 1) =>
    handleRunnerRequest(
      request("PUT", { version: 1, revision, machines }, { "If-Match": `"${revision - 1}"` }),
      e,
      key,
    );
  const outcomes = await Promise.all([
    save([machine]),
    save([{ ...machine, desiredState: "maintenance" }]),
  ]);
  expect(outcomes.map((r) => r.status).sort()).toEqual([200, 409]);
  expect((await save([], 2)).status).toBe(409);
  expect((await save([{ ...machine, desiredState: "maintenance" }], 2)).status).toBe(200);
  const result = await (
    await handleRunnerRequest(request(), e, key)
  ).json<{
    audit: { previousRevision: number };
    config: { revision: number };
  }>();
  expect(result.config.revision).toBe(2);
  expect(result.audit.previousRevision).toBe(1);
});
it("denies unauthenticated, read-only and cross-origin operators and unsafe mutation methods", async () => {
  const e = environment();
  expect((await handleRunnerRequest(request("GET", undefined, {}, ""), e, key)).status).toBe(401);
  expect((await handleRunnerRequest(request("GET", undefined, {}, read), e, key)).status).toBe(401);
  expect(
    (
      await handleRunnerRequest(
        request("GET", undefined, { Origin: "https://evil.example" }),
        e,
        key,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await handleRunnerRequest(
        request("GET", undefined, { "Sec-Fetch-Site": "cross-site" }),
        e,
        key,
      )
    ).status,
  ).toBe(403);
  expect((await handleRunnerRequest(request("DELETE"), e, key)).status).toBe(405);
});
it("rejects unsupported machine records, extra fields and oversized bodies without mutation", async () => {
  const e = environment();
  for (const m of [
    { ...machine, os: "macos" },
    { ...machine, kind: "mac" },
    { ...machine, architecture: "unknown" },
    { ...machine, runnerId: -1 },
    { ...machine, token: "secret" },
    { ...machine, labels: ["same", "SAME"] },
    { ...machine, alias: "bad\nname" },
    { ...machine, repository: "https://github.com/org/repo" },
    { ...machine, desiredState: "stopped" },
  ]) {
    expect(
      (
        await handleRunnerRequest(
          request("PUT", { version: 1, revision: 1, machines: [m] }, { "If-Match": '"0"' }),
          e,
          key,
        )
      ).status,
    ).toBe(400);
  }
  expect(
    (
      await handleRunnerRequest(
        request("PUT", { version: 1, revision: 1, machines: [machine] }),
        e,
        key,
      )
    ).status,
  ).toBe(428);
  expect(
    (await handleRunnerRequest(request("PUT", "x".repeat(65536), { "If-Match": '"0"' }), e, key))
      .status,
  ).toBe(413);
  expect(
    (
      await handleRunnerRequest(
        request(
          "PUT",
          { version: 1, revision: 1, machines: Array(51).fill(machine) },
          { "If-Match": '"0"' },
        ),
        e,
        key,
      )
    ).status,
  ).toBe(400);
  const result = await (
    await handleRunnerRequest(request(), e, key)
  ).json<{
    config: { revision: number };
  }>();
  expect(result.config.revision).toBe(0);
});
it("accepts configured Windows PC and macOS Mac without inventing host identity", async () => {
  const e = environment();
  const machines = [
    { ...machine, os: "windows", runnerId: 42 },
    {
      ...machine,
      id: "mac-one",
      alias: "Build Mac",
      kind: "mac",
      os: "macos",
      architecture: "arm64",
      runnerId: 43,
    },
  ];
  expect(
    (
      await handleRunnerRequest(
        request("PUT", { version: 1, revision: 1, machines }, { "If-Match": '"0"' }),
        e,
        key,
      )
    ).status,
  ).toBe(200);
  const body = await (
    await handleRunnerRequest(request(), e, key)
  ).json<{
    config: { machines: unknown[] };
    observedState: string;
  }>();
  expect(body.config.machines).toEqual(machines);
  expect(body.observedState).toBe("unknown");
});
const spark = { id: "delphi", alias: "Delphi", kind: "spark", os: "linux", architecture: "arm64" };
/** The machine without the named fields. */
function without(fields: string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...machine };
  for (const field of fields) delete copy[field];
  return copy;
}
it("lists monitored machines and DGX Sparks in version 2 after version 1 history", async () => {
  const e = environment();
  const put = (body: unknown, expected: number) =>
    handleRunnerRequest(request("PUT", body, { "If-Match": `"${expected}"` }), e, key);
  expect((await put({ version: 1, revision: 1, machines: [machine] }, 0)).status).toBe(200);
  const jetson = { ...spark, id: "jetson", alias: "Jetson", kind: "jetson" };
  const host = { ...spark, id: "bosgame", alias: "Bosgame", kind: "pc", architecture: "x64" };
  const sparkRunner = { ...machine, ...spark, id: "morpheus", alias: "Morpheus" };
  const machines = [machine, spark, jetson, host, sparkRunner];
  expect((await put({ version: 2, revision: 2, machines }, 1)).status).toBe(200);
  await abortAllDurableObjects();
  const body = await (await handleRunnerRequest(request(), e, key)).json<{ config: unknown }>();
  expect(body.config).toEqual({ version: 2, revision: 2, machines });
  // A runner keeps its runner settings; a monitored machine may become a runner.
  const monitoredPc = without(["runnerId", "repository", "labels", "desiredState"]);
  const removal = await put(
    { version: 2, revision: 3, machines: [monitoredPc, ...machines.slice(1)] },
    2,
  );
  expect(removal.status).toBe(409);
  expect(await removal.json()).toEqual({ error: "runner_removal_forbidden" });
  const promoted = machines.map((m) => (m.id === "delphi" ? { ...machine, ...spark } : m));
  expect((await put({ version: 2, revision: 3, machines: promoted }, 2)).status).toBe(200);
});
it("refuses a new kind in version 1, a misfit Spark or Jetson, and partial runner fields", async () => {
  const e = environment();
  for (const body of [
    { version: 1, revision: 1, machines: [spark] },
    { version: 1, revision: 1, machines: [{ ...machine, ...spark }] },
    { version: 3, revision: 1, machines: [] },
    { version: 2, revision: 1, machines: [{ ...spark, architecture: "x64" }] },
    { version: 2, revision: 1, machines: [{ ...spark, kind: "jetson", os: "windows" }] },
    { version: 2, revision: 1, machines: [{ ...spark, kind: "host" }] },
    { version: 2, revision: 1, machines: [{ ...spark, repository: "Zero-State-LLC/example" }] },
    { version: 2, revision: 1, machines: [without(["desiredState"])] },
    { version: 2, revision: 1, machines: [spark, { ...machine, id: "delphi" }] },
  ]) {
    const response = await handleRunnerRequest(request("PUT", body, { "If-Match": '"0"' }), e, key);
    expect(response.status).toBe(400);
  }
});
it("serves authenticated fleet assets with safe headers and explicit desired-state boundaries", async () => {
  const e = environment();
  for (const path of ["", "/app.js", "/style.css"]) {
    const response = await handleRunnerRequest(
      new Request("https://homer.example/v1/admin/runners" + path, {
        headers: { "Cf-Access-Jwt-Assertion": admin },
      }),
      e,
      key,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    if (!path) {
      const html = await response.text();
      expect(html).toContain("Host execution requires enrollment");
      expect(html).toContain("Observed status is unknown");
    }
  }
});
it("serves Machine fleet setup to admins only, apart from the runner page", async () => {
  const e = environment();
  const get = (path: string, jwt: string) =>
    handleRunnerRequest(
      new Request("https://homer.example" + path, { headers: { "Cf-Access-Jwt-Assertion": jwt } }),
      e,
      key,
    );
  const page = await get("/v1/admin/machines", admin);
  expect(page.status).toBe(200);
  expect(page.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  const html = await page.text();
  expect(html).toContain("<h1>Machine fleet setup</h1>");
  expect(html).toContain('href="/v1/admin/runners"');
  const script = await get("/v1/admin/machines/app.js", admin);
  expect(script.headers.get("Content-Type")).toContain("text/javascript");
  expect(await script.text()).toContain("/v1/admin/runners/config");
  expect((await get("/v1/admin/machines", read)).status).toBe(401);
  // The runner page adds runners to configured machines; it no longer describes machines.
  const runners = await (await get("/v1/admin/runners", admin)).text();
  expect(runners).toContain('<label for="runner-machine">Machine</label>');
  expect(runners).not.toContain('name="kind"');
});
