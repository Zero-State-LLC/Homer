import { env } from "cloudflare:workers";
import { abortAllDurableObjects, runInDurableObject } from "cloudflare:test";
import { beforeAll, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { handleRequest, type Env } from "../src/index.js";
import { verifyAccess } from "../src/access.js";

let privateKey: CryptoKey;
let key: JWTVerifyGetKey;
const config = {
  ACCESS_ISSUER: "https://synthetic.cloudflareaccess.com",
  ACCESS_READ_AUD: "synthetic-read",
  ACCESS_ADMIN_AUD: "synthetic-admin",
  CATALOG_NAME: "synthetic",
};
beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  const publicKey = await exportJWK(keys.publicKey);
  publicKey.kid = "test";
  key = createLocalJWKSet({ keys: [publicKey] });
});
function token(audience = config.ACCESS_ADMIN_AUD, claims: Record<string, unknown> = {}) {
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
function testEnv(): Env {
  return { ...env, ...config, CATALOG_NAME: crypto.randomUUID() };
}
function request(
  jwt: string | null,
  method = "GET",
  body?: string,
  extra: Record<string, string> = {},
) {
  return new Request(
    `https://homer.example${method === "PUT" ? "/v1/admin/catalog" : "/v1/catalog"}`,
    {
      method,
      headers: {
        ...(jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {}),
        "Content-Type": "application/json",
        ...extra,
      },
      ...(body !== undefined ? { body } : {}),
    },
  );
}
const next = {
  version: 1,
  revision: 1,
  repositories: [{ repositoryId: 123, repository: "Zero-State-LLC/example", enabled: true }],
};
it("authenticates reads and requires the separate admin audience for writes", async () => {
  const e = testEnv(),
    read = await token(config.ACCESS_READ_AUD),
    admin = await token();
  expect((await handleRequest(request(null), e, key)).status).toBe(401);
  expect((await handleRequest(request(read), e, key)).status).toBe(200);
  expect(
    (await handleRequest(request(read, "PUT", JSON.stringify(next), { "If-Match": '"0"' }), e, key))
      .status,
  ).toBe(401);
  const saved = await handleRequest(
    request(admin, "PUT", JSON.stringify(next), { "If-Match": '"0"' }),
    e,
    key,
  );
  expect(saved.status).toBe(200);
  expect(saved.headers.get("ETag")).toBe('"1"');
  const loaded = await handleRequest(request(read), e, key);
  expect(loaded.headers.get("Cache-Control")).toBe("no-store");
  expect(await loaded.json()).toEqual(next);
  expect(
    (
      await handleRequest(
        request(admin, "PUT", JSON.stringify(next), { "If-Match": '"0"' }),
        e,
        key,
      )
    ).status,
  ).toBe(409);
});
it.each([
  { iss: "https://wrong.cloudflareaccess.com" },
  { type: "org" },
  { aud: "wrong" },
  { exp: 1 },
  { sub: "" },
  { exp: undefined },
  { iat: undefined },
  { iat: Math.floor(Date.now() / 1000) + 1000 },
])("refuses invalid token claims %j", async (claims) => {
  await expect(
    verifyAccess(await token(config.ACCESS_ADMIN_AUD, claims), config, true, key),
  ).rejects.toThrow();
});
it("refuses forged signatures, unsigned tokens and misconfigured access", async () => {
  const other = await generateKeyPair("RS256");
  const forged = await new SignJWT({
    sub: "synthetic",
    iss: config.ACCESS_ISSUER,
    aud: config.ACCESS_ADMIN_AUD,
  })
    .setIssuedAt()
    .setExpirationTime("5m")
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .sign(other.privateKey);
  expect((await handleRequest(request(forged), testEnv(), key)).status).toBe(401);
  expect((await handleRequest(request("eyJhbGciOiJub25lIn0.e30."), testEnv(), key)).status).toBe(
    401,
  );
  expect(
    (
      await handleRequest(
        request(await token()),
        { ...testEnv(), ACCESS_ADMIN_AUD: config.ACCESS_READ_AUD },
        key,
      )
    ).status,
  ).toBe(503);
  expect(
    (
      await handleRequest(
        request(await token()),
        { ...testEnv(), ACCESS_ISSUER: "https://evil.example" },
        key,
      )
    ).status,
  ).toBe(503);
});
it("requires same origin, revision preconditions, bounded JSON and a valid full snapshot", async () => {
  const jwt = await token(),
    e = testEnv();
  for (const [body, headers, status] of [
    [JSON.stringify(next), {}, 428],
    [JSON.stringify(next), { "If-Match": "*" }, 400],
    [JSON.stringify(next), { "If-Match": '"0"', Origin: "https://evil.example" }, 403],
    [JSON.stringify(next), { "If-Match": '"0"', "Content-Type": "text/plain" }, 415],
    ["{", { "If-Match": '"0"' }, 400],
    [JSON.stringify({ ...next, revision: 9 }), { "If-Match": '"0"' }, 400],
    [
      JSON.stringify({ ...next, repositories: [next.repositories[0], next.repositories[0]] }),
      { "If-Match": '"0"' },
      400,
    ],
    [" ".repeat(256 * 1024 + 1), { "If-Match": '"0"' }, 413],
  ] as [string, Record<string, string>, number][]) {
    expect((await handleRequest(request(jwt, "PUT", body, headers), e, key)).status).toBe(status);
  }
  expect((await handleRequest(request(jwt), e, key)).status).toBe(200);
  const snapshot = await (await handleRequest(request(jwt), e, key)).json();
  expect(snapshot).toEqual({ version: 1, revision: 0, repositories: [] });
});
it("persists one concurrent winner across restart and forbids rewriting history", async () => {
  const id = env.MAPPING_CATALOG.newUniqueId();
  const a = env.MAPPING_CATALOG.get(id),
    b = env.MAPPING_CATALOG.get(id);
  const results = await Promise.all([
    a.replace(0, next, "a".repeat(64)),
    b.replace(0, { ...next, repositories: [] }, "b".repeat(64)),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  const saved = await a.read();
  await abortAllDurableObjects();
  const restored = env.MAPPING_CATALOG.get(id);
  expect(await restored.read()).toEqual(saved);
  let refusal: unknown;
  try {
    await restored.replace(1, { ...next, revision: 3 }, "a".repeat(64));
  } catch (error) {
    refusal = error;
  }
  expect(refusal).toBeInstanceOf(Error);
  expect((refusal as Error).message).toContain("invalid_catalog_update");
  await runInDurableObject(restored, (_object, state) => {
    expect(() => state.storage.sql.exec("DELETE FROM catalog_history")).toThrow();
    expect(() => state.storage.sql.exec("UPDATE catalog_history SET snapshot='{}'")).toThrow();
    const row = state.storage.sql
      .exec<{ principal_digest: string; recorded_at: string }>(
        "SELECT principal_digest, recorded_at FROM catalog_history",
      )
      .one();
    expect(row.principal_digest).toMatch(/^[ab]{64}$/);
    expect(row.recorded_at).toMatch(/Z$/);
  });
});

it("supports signed Access service principals without inferring a human identity", async () => {
  const digest = await verifyAccess(
    await token(config.ACCESS_ADMIN_AUD, { sub: "", common_name: "synthetic-client.access" }),
    config,
    true,
    key,
  );
  expect(digest).toMatch(/^[a-f0-9]{64}$/);
  expect(digest).not.toBe(await verifyAccess(await token(), config, true, key));
});

it("rolls back a failed insert and records only a digest of the authenticated principal", async () => {
  const e = testEnv();
  const store = e.MAPPING_CATALOG.get(e.MAPPING_CATALOG.idFromName(e.CATALOG_NAME));
  await runInDurableObject(store, (_object, state) => {
    state.storage.sql.exec(
      "CREATE TRIGGER injected_failure AFTER INSERT ON catalog_history BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
    );
  });
  const jwt = await token();
  const put = () =>
    handleRequest(request(jwt, "PUT", JSON.stringify(next), { "If-Match": '"0"' }), e, key);
  expect((await put()).status).toBe(503);
  expect((await store.read()).revision).toBe(0);
  await runInDurableObject(store, (_object, state) => {
    state.storage.sql.exec("DROP TRIGGER injected_failure");
  });
  expect((await put()).status).toBe(200);
  const expected = await verifyAccess(jwt, config, true, key);
  await runInDurableObject(store, (_object, state) => {
    const row = state.storage.sql
      .exec<{ principal_digest: string; snapshot: string }>(
        "SELECT principal_digest, snapshot FROM catalog_history",
      )
      .one();
    expect(row.principal_digest).toBe(expected);
    expect(JSON.stringify(row)).not.toContain(jwt);
    expect(JSON.stringify(row)).not.toContain("synthetic-principal");
  });
});
