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
      expect(html).toContain("Host controller unsupported");
      expect(html).toContain("Observed status is unknown");
    }
  }
});
