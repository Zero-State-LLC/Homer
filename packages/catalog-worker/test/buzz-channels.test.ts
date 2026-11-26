import { env } from "cloudflare:workers";
import { abortAllDurableObjects, runInDurableObject } from "cloudflare:test";
import { beforeAll, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { handleRequest, type Env } from "../src/index.js";

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
function token(audience = config.ACCESS_ADMIN_AUD) {
  return new SignJWT({
    type: "app",
    sub: "synthetic-principal",
    iss: config.ACCESS_ISSUER,
    aud: audience,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .sign(privateKey);
}
function testEnv(): Env {
  return { ...env, ...config, CATALOG_NAME: crypto.randomUUID() };
}
function request(
  jwt: string | null,
  options: { method?: string; path?: string; body?: string; headers?: Record<string, string> } = {},
) {
  return new Request(`https://homer.example${options.path ?? "/v1/admin/buzz/channels"}`, {
    method: options.method ?? "GET",
    headers: {
      ...(jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {}),
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...(options.body !== undefined ? { body: options.body } : {}),
  });
}
const flag = "00000000-0000-4000-8000-000000000001";
const next = {
  version: 1,
  revision: 1,
  channels: [{ channel: flag, label: "homer", enabled: true, flagChannel: true }],
};
const put = (jwt: string, body: unknown, revision: string) =>
  request(jwt, { method: "PUT", body: JSON.stringify(body), headers: { "If-Match": revision } });

it("starts empty and requires the admin audience to read or write", async () => {
  const e = testEnv(),
    reader = await token(config.ACCESS_READ_AUD),
    admin = await token();
  expect((await handleRequest(request(null), e, key)).status).toBe(401);
  expect((await handleRequest(request(reader), e, key)).status).toBe(401);
  expect((await handleRequest(put(reader, next, '"0"'), e, key)).status).toBe(401);
  const empty = await handleRequest(request(admin), e, key);
  expect(empty.status).toBe(200);
  expect(empty.headers.get("ETag")).toBe('"0"');
  expect(await empty.json()).toEqual({ version: 1, revision: 0, channels: [] });
});

it("replaces by compare-and-swap and refuses a stale writer", async () => {
  const e = testEnv(),
    admin = await token();
  const saved = await handleRequest(put(admin, next, '"0"'), e, key);
  expect(saved.status).toBe(200);
  expect(saved.headers.get("ETag")).toBe('"1"');
  const loaded = await handleRequest(request(admin), e, key);
  expect(loaded.headers.get("Cache-Control")).toBe("no-store");
  expect(await loaded.json()).toEqual(next);
  expect((await handleRequest(put(admin, next, '"0"'), e, key)).status).toBe(409);
});

it("requires a precondition, JSON, a valid snapshot and the next revision", async () => {
  const e = testEnv(),
    admin = await token();
  const cases: [Request, number][] = [
    [request(admin, { method: "PUT", body: JSON.stringify(next) }), 428],
    [put(admin, next, "0"), 400],
    [put(admin, { ...next, revision: 2 }, '"0"'), 400],
    [put(admin, { ...next, channels: [{ ...next.channels[0], label: "" }] }, '"0"'), 400],
    [put(admin, { ...next, channels: [{ ...next.channels[0], channel: "dm" }] }, '"0"'), 400],
    [
      request(admin, {
        method: "PUT",
        body: JSON.stringify(next),
        headers: { "If-Match": '"0"', "Content-Type": "text/plain" },
      }),
      415,
    ],
    [put(admin, { ...next, pad: "x".repeat(70 * 1024) }, '"0"'), 413],
    [request(admin, { method: "POST" }), 405],
    [request(admin, { method: "PUT", path: "/v1/admin/buzz/channels/view" }), 405],
    [request(admin, { headers: { Origin: "https://elsewhere.example" } }), 403],
  ];
  for (const [req, status] of cases) expect((await handleRequest(req, e, key)).status).toBe(status);
  expect(await (await handleRequest(request(admin), e, key)).json()).toMatchObject({ revision: 0 });
});

it("lists channels read-only, escaping labels, behind strict headers", async () => {
  const e = testEnv(),
    admin = await token(),
    reader = await token(config.ACCESS_READ_AUD);
  const view = (jwt: string | null) =>
    handleRequest(request(jwt, { path: "/v1/admin/buzz/channels/view" }), e, key);
  expect((await view(reader)).status).toBe(401);
  const empty = await (await view(admin)).text();
  expect(empty).toContain("Homer reads nothing from Buzz");
  const label = `<script>alert("x")</script>`;
  await handleRequest(
    put(admin, { ...next, channels: [{ ...next.channels[0], label }] }, '"0"'),
    e,
    key,
  );
  const response = await view(admin);
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toContain("text/html");
  expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
  expect(response.headers.get("Content-Security-Policy")).not.toContain("script-src");
  expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  const html = await response.text();
  expect(html).not.toContain("<script>");
  expect(html).toContain("&#60;script&#62;");
  expect(html).toContain(flag);
  expect(html).not.toContain("<form");
});

it("keeps one concurrent winner and immutable history across restart", async () => {
  const id = env.BUZZ_CHANNELS.newUniqueId();
  const a = env.BUZZ_CHANNELS.get(id),
    b = env.BUZZ_CHANNELS.get(id);
  const results = await Promise.all([
    a.replace(0, next, "a".repeat(64)),
    b.replace(0, { ...next, channels: [] }, "b".repeat(64)),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  const saved = await a.read();
  await abortAllDurableObjects();
  const restored = env.BUZZ_CHANNELS.get(id);
  expect(await restored.read()).toEqual(saved);
  await runInDurableObject(restored, (_object, state) => {
    expect(() => state.storage.sql.exec("DELETE FROM buzz_channel_history")).toThrow();
    expect(() => state.storage.sql.exec("UPDATE buzz_channel_history SET snapshot='{}'")).toThrow();
    const row = state.storage.sql
      .exec<{ principal_digest: string }>("SELECT principal_digest FROM buzz_channel_history")
      .one();
    expect(row.principal_digest).toMatch(/^[ab]{64}$/);
  });
});
