import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { BUILD_VERSION, PRODUCT_VERSION } from "@zs-home/shared-contracts/workers";
import { handleRequest, type Env } from "../src/index.js";

let privateKey: CryptoKey;
let key: JWTVerifyGetKey;
const config = {
  ACCESS_ISSUER: "https://synthetic.cloudflareaccess.com",
  ACCESS_READ_AUD: "synthetic-read",
  ACCESS_ADMIN_AUD: "synthetic-admin",
  RUNNER_CONTROLLER_AUD: "synthetic-controller",
  CATALOG_NAME: "synthetic",
};
const metadata = {
  id: "00000000-0000-4000-8000-0000000000aa",
  tag: "v0.1.0",
  timestamp: "2026-11-24T00:00:00.000Z",
};
beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  const publicKey = await exportJWK(keys.publicKey);
  publicKey.kid = "test";
  key = createLocalJWKSet({ keys: [publicKey] });
});
function token(audience: string, claims: Record<string, unknown> = {}) {
  return new SignJWT({
    type: "app",
    sub: "synthetic-principal",
    iss: config.ACCESS_ISSUER,
    aud: audience,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .sign(privateKey);
}
function testEnv(binding: Env["CF_VERSION_METADATA"] | null = metadata): Env {
  const base: Env = { ...env, ...config };
  return binding ? { ...base, CF_VERSION_METADATA: binding } : base;
}
function get(jwt: string | null, method = "GET") {
  return new Request("https://homer.example/v1/version", {
    method,
    headers: jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {},
  });
}

it("answers the four version fields to a read token, and nothing else", async () => {
  const response = await handleRequest(get(await token(config.ACCESS_READ_AUD)), testEnv(), key);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const text = await response.text();
  expect(JSON.parse(text)).toEqual({
    productVersion: PRODUCT_VERSION,
    buildVersion: BUILD_VERSION,
    workerVersionId: metadata.id,
    workerVersionTag: "v0.1.0",
  });
  for (const leak of ["homer.example", "CF_VERSION_METADATA", "synthetic", metadata.timestamp]) {
    expect(text).not.toContain(leak);
  }
});

it("answers an admin token too, as every read route does", async () => {
  const response = await handleRequest(get(await token(config.ACCESS_ADMIN_AUD)), testEnv(), key);
  expect(response.status).toBe(200);
});

it("refuses a request without a valid read or admin token", async () => {
  expect((await handleRequest(get(null), testEnv(), key)).status).toBe(401);
  for (const jwt of [
    await token(config.RUNNER_CONTROLLER_AUD, { sub: "" }),
    await token("someone-else"),
    await token(config.ACCESS_READ_AUD, { iss: "https://other.cloudflareaccess.com" }),
    await token(config.ACCESS_READ_AUD, { exp: Math.floor(Date.now() / 1000) - 60 }),
  ]) {
    const response = await handleRequest(get(jwt), testEnv(), key);
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain(BUILD_VERSION);
  }
});

it("accepts only GET", async () => {
  const jwt = await token(config.ACCESS_READ_AUD);
  for (const method of ["POST", "PUT", "DELETE"]) {
    expect((await handleRequest(get(jwt, method), testEnv(), key)).status).toBe(405);
  }
});

it("answers null ids when the binding is missing, rather than guessing", async () => {
  const response = await handleRequest(
    get(await token(config.ACCESS_READ_AUD)),
    testEnv(null),
    key,
  );
  expect(await response.json()).toMatchObject({ workerVersionId: null, workerVersionTag: null });
});

it("answers 503 when Access is not configured", async () => {
  const response = await handleRequest(
    get(await token(config.ACCESS_READ_AUD)),
    { ...testEnv(), ACCESS_READ_AUD: "" },
    key,
  );
  expect(response.status).toBe(503);
});
