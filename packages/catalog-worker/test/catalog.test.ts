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

it("requires admin Scope for archive exports and exposes no HTTP restore route", async () => {
  const e = testEnv();
  const source = e.MAPPING_CATALOG.get(e.MAPPING_CATALOG.idFromName(e.CATALOG_NAME));
  await source.replace(0, next, "a".repeat(64));
  const archiveRequest = (jwt: string | null, method = "GET") =>
    new Request("https://homer.example/v1/admin/catalog/archive", {
      method,
      headers: jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {},
    });
  expect((await handleRequest(archiveRequest(null), e, key)).status).toBe(401);
  expect(
    (await handleRequest(archiveRequest(await token(config.ACCESS_READ_AUD)), e, key)).status,
  ).toBe(401);
  const response = await handleRequest(archiveRequest(await token()), e, key);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("ETag")).toBe('"1"');
  expect(await response.json()).toEqual(await source.exportArchive());
  expect((await handleRequest(archiveRequest(await token(), "POST"), e, key)).status).toBe(405);
  expect(
    (
      await handleRequest(
        new Request("https://homer.example/v1/admin/catalog/restore", { method: "POST" }),
        e,
        key,
      )
    ).status,
  ).toBe(404);
});

it("protects the editor, assets and runtime snapshot with the admin audience", async () => {
  const e = testEnv(),
    admin = await token(),
    reader = await token(config.ACCESS_READ_AUD);
  const store = e.MAPPING_CATALOG.get(e.MAPPING_CATALOG.idFromName(e.CATALOG_NAME));
  await store.replace(0, next, "a".repeat(64));
  for (const suffix of ["editor", "editor.js", "editor.css", "snapshot"]) {
    const req = (jwt: string | null, method = "GET", origin?: string) =>
      new Request(`https://homer.example/v1/admin/catalog/${suffix}`, {
        method,
        headers: {
          ...(jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {}),
          ...(origin ? { Origin: origin } : {}),
        },
      });
    expect((await handleRequest(req(null), e, key)).status).toBe(401);
    expect((await handleRequest(req(reader), e, key)).status).toBe(401);
    expect((await handleRequest(req(admin, "POST"), e, key)).status).toBe(405);
    expect(
      (await handleRequest(req(admin, "GET", "https://elsewhere.example"), e, key)).status,
    ).toBe(403);
    const response = await handleRequest(req(admin), e, key);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    if (suffix === "snapshot") {
      expect(response.headers.get("ETag")).toBe('"1"');
      expect(await response.json()).toEqual(next);
    } else {
      expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
      const body = await response.text();
      expect(body).not.toContain(next.repositories[0]!.repository);
      expect(body).not.toContain(admin);
      expect(body).not.toContain("synthetic-principal");
    }
  }
  expect(await store.read()).toEqual(next);
});

it("shows authenticated observed catalog admission in Overview without claiming collection health", async () => {
  const e = testEnv(),
    admin = await token();
  await handleRequest(
    request(
      admin,
      "PUT",
      JSON.stringify({
        ...next,
        repositories: [{ ...next.repositories[0], projectId: "project:homer" }],
      }),
      { "If-Match": '"0"' },
    ),
    e,
    key,
  );
  const get = (jwt: string | null) =>
    handleRequest(
      new Request("https://homer.example/v1/admin/overview", {
        headers: jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {},
      }),
      e,
      key,
    );
  expect((await get(null)).status).toBe(401);
  expect((await get(await token(config.ACCESS_READ_AUD))).status).toBe(401);
  const result = await get(admin);
  expect(result.status).toBe(200);
  expect(result.headers.get("Cache-Control")).toBe("no-store");
  const page = await result.text();
  expect(page).toContain("Observed catalog revision 1");
  expect(page).toContain("Zero-State-LLC/example");
  expect(page).toContain("project:homer");
  expect(page).toContain("Enabled");
  expect(page).toContain("Collection health: Unknown");
  expect(page).toContain("/v1/admin/repositories");
});

it("offers a protected field-based Repository mapping review without granting other administration", async () => {
  const e = testEnv(),
    admin = await token(),
    reader = await token(config.ACCESS_READ_AUD);
  for (const path of ["repositories", "repositories.js", "admin.css"]) {
    const get = (jwt: string) =>
      handleRequest(
        new Request(`https://homer.example/v1/admin/${path}`, {
          headers: { "Cf-Access-Jwt-Assertion": jwt },
        }),
        e,
        key,
      );
    expect((await get(reader)).status).toBe(401);
    const response = await get(admin);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toContain("script-src 'self'");
    if (path === "repositories") {
      const page = await response.text();
      expect(page).toContain(
        'id="validation-summary" tabindex="-1" aria-labelledby="validation-title" hidden',
      );
      expect(page).toContain('<h2 id="validation-title">Correct Repository mapping fields</h2>');
      expect(page).toContain('<ul id="validation-errors"></ul>');
      expect(page).toContain("Add Repository mapping");
      expect(page).toContain("Review changes");
      expect(page).toContain("Read current mappings for reconciliation");
    }
  }
});

it("reconciles concurrent Repository admission through authenticated readback after restart", async () => {
  const e = testEnv(),
    admin = await token();
  const proposed = {
    ...next,
    repositories: [{ ...next.repositories[0], projectId: "project:proposed" }],
  };
  const competing = {
    ...next,
    repositories: [{ ...next.repositories[0], enabled: false, projectId: "project:other" }],
  };
  const results = await Promise.all(
    [proposed, competing].map((snapshot) =>
      handleRequest(request(admin, "PUT", JSON.stringify(snapshot), { "If-Match": '"0"' }), e, key),
    ),
  );
  expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  const winning = await results.find((result) => result.status === 200)!.json();
  await abortAllDurableObjects();
  const read = await handleRequest(
    new Request("https://homer.example/v1/admin/catalog/snapshot", {
      headers: { "Cf-Access-Jwt-Assertion": admin },
    }),
    e,
    key,
  );
  expect(read.headers.get("ETag")).toBe('"1"');
  expect(await read.json()).toEqual(winning);
  expect(
    (
      await handleRequest(
        request(admin, "PUT", JSON.stringify(proposed), { "If-Match": '"0"' }),
        e,
        key,
      )
    ).status,
  ).toBe(409);
});
