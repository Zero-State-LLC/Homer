import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { handleRequest } from "../src/index.js";
let key: JWTVerifyGetKey;
let jwt: string;
let signingKey: CryptoKey;
const config = {
  ACCESS_ISSUER: "https://synthetic.cloudflareaccess.com",
  ACCESS_READ_AUD: "read",
  ACCESS_ADMIN_AUD: "admin",
  CATALOG_NAME: "directory-tests",
};
beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  signingKey = pair.privateKey;
  key = createLocalJWKSet({ keys: [await exportJWK(pair.publicKey)] });
  jwt = await new SignJWT({ type: "app", sub: "reader" })
    .setIssuer(config.ACCESS_ISSUER)
    .setAudience("read")
    .setIssuedAt()
    .setExpirationTime("5m")
    .setProtectedHeader({ alg: "RS256" })
    .sign(pair.privateKey);
});
function read(path = "/v1/credentials", bindings = {}) {
  return handleRequest(
    new Request("https://homer.example" + path, { headers: { "Cf-Access-Jwt-Assertion": jwt } }),
    { ...env, ...config, ...bindings },
    key,
  );
}
it("distinguishes an unconfigured directory from an empty authorized inventory", async () => {
  const response = await read();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "credential_directory_not_configured" });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});
async function directory() {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(config.ACCESS_ISSUER + "\nuser:reader"),
  );
  const digest = Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, "0")).join("");
  const credential = {
    credentialId: "cred_own",
    revision: 1,
    provider: "synthetic",
    purpose: "Own integration",
    ownershipClass: "developer-owned",
    ownerActorId: "human:reader",
    projectId: "project:homer",
    environment: "staging",
    consumers: [{ consumerId: "consumer_one", label: "Diagnostic" }],
    consumerDiscovery: "unknown",
    health: "unknown",
    healthEvidence: null,
    expiresAt: null,
    activeVersion: null,
    rotationState: "unknown",
  };
  return {
    version: 1,
    policyRevision: 1,
    metadataRevision: 2,
    observedAt: "2026-11-20T00:00:00Z",
    bindings: [
      {
        principalDigest: digest,
        principalKind: "human",
        actorId: "human:reader",
        actorKind: "human",
        evidenceRef: "binding_review",
      },
      {
        principalDigest: "a".repeat(64),
        principalKind: "human",
        actorId: "human:other",
        actorKind: "human",
        evidenceRef: "other_review",
      },
    ],
    grants: [
      {
        principalDigest: digest,
        capability: "metadata-read",
        ownerActorId: "human:reader",
        ownershipClass: "developer-owned",
        projectId: "project:homer",
        environment: "staging",
      },
    ],
    credentials: [
      credential,
      {
        ...credential,
        credentialId: "cred_other",
        purpose: "Private other",
        ownerActorId: "human:other",
      },
      { ...credential, credentialId: "cred_production", environment: "production" },
    ],
  };
}
function source(snapshot: unknown) {
  return { CREDENTIAL_DIRECTORY: { fetch: () => Promise.resolve(Response.json(snapshot)) } };
}
it("read audience sees only exact granted scope in inventory, search and detail", async () => {
  const data = await directory();
  const response = await read("/v1/credentials", source(data));
  expect(response.status).toBe(200);
  const body = await response.json<{ credentials: unknown[] }>();
  expect(body.credentials).toEqual([data.credentials[0]]);
  expect(JSON.stringify(body)).not.toMatch(
    /principalDigest|bindings|grants|Private other|production/,
  );
  expect((await read("/v1/credentials?q=Private", source(data))).status).toBe(200);
  expect(
    (
      await (
        await read("/v1/credentials?q=Private", source(data))
      ).json<{ credentials: unknown[] }>()
    ).credentials,
  ).toEqual([]);
  expect((await read("/v1/credentials?environment=production", source(data))).status).toBe(403);
  expect((await read("/v1/credentials?ownerActorId=human:other", source(data))).status).toBe(403);
  expect((await read("/v1/credentials?projectId=project:other", source(data))).status).toBe(403);
  for (const id of ["cred_other", "absent", "cred_production"]) {
    const detail = await read("/v1/credentials/" + id, source(data));
    expect(detail.status).toBe(404);
    expect(await detail.json()).toEqual({ error: "credential_not_found" });
  }
  expect((await read("/v1/credentials/cred_own", source(data))).status).toBe(200);
});
it("My setup binds the authenticated Actor and labels evidence gaps truthfully", async () => {
  const response = await read("/v1/my-setup", source(await directory()));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    actor: { actorId: "human:reader", actorKind: "human" },
    authorizedScopes: [
      {
        ownerActorId: "human:reader",
        ownershipClass: "developer-owned",
        projectId: "project:homer",
        environment: "staging",
      },
    ],
    connection: "unverified",
    instrumentation: "unknown",
    workSession: "unknown",
  });
});
it("fails closed for missing binding, absent grants, invalid sources, and distinguishes authorized empty", async () => {
  const data = await directory();
  expect(
    (
      await read(
        "/v1/credentials",
        source({ ...data, bindings: data.bindings.slice(1), grants: [], credentials: [] }),
      )
    ).status,
  ).toBe(403);
  expect((await read("/v1/credentials", source({ ...data, grants: [] }))).status).toBe(403);
  const empty = await read("/v1/credentials", source({ ...data, credentials: [] }));
  expect(empty.status).toBe(200);
  expect(await empty.json()).toMatchObject({ credentials: [] });
  for (const bad of [
    { ...data, version: 2 },
    { ...data, bindings: [...data.bindings, data.bindings[0]] },
    { ...data, observedAt: "2999-01-01T00:00:00Z" },
    { ...data, credentials: [{ ...data.credentials[0], backendRef: "private/path" }] },
    { ...data, credentials: [{ ...data.credentials[0], health: "healthy" }] },
    { ...data, credentials: [{ ...data.credentials[0], purpose: "/private/path" }] },
    { ...data, credentials: [{ ...data.credentials[0], expiresAt: "2026-02-30T00:00:00Z" }] },
  ]) {
    const response = await read("/v1/credentials", source(bad));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "credential_directory_unavailable" });
  }
  for (const fetch of [
    () => Promise.reject(new Error("PRIVATE SOURCE ERROR")),
    () =>
      Promise.resolve(
        new Response("x".repeat(1024 * 1024 + 1), {
          headers: { "Content-Type": "application/json" },
        }),
      ),
    () =>
      Promise.resolve(
        new Response(null, { status: 302, headers: { Location: "https://private.invalid" } }),
      ),
  ]) {
    const response = await read("/v1/credentials", { CREDENTIAL_DIRECTORY: { fetch } });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/PRIVATE|private/);
  }
});
it("never treats a mismatched personal grant as shared visibility", async () => {
  const data = await directory();
  data.grants.push({ ...data.grants[0]!, ownerActorId: "human:other" });
  expect(
    (await (await read("/v1/credentials", source(data))).json<{ credentials: unknown[] }>())
      .credentials,
  ).toEqual([data.credentials[0]]);
});
it("read audience can open Credentials and My setup without catalog-admin assets", async () => {
  for (const path of ["/v1/workspace/credentials", "/v1/workspace/my-setup"]) {
    const response = await read(path);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Scope: directory authorization");
    expect(html).not.toMatch(/\/v1\/admin\/[^"]+\.(css|js)/);
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  }
  expect((await read("/v1/workspace/directory.js")).status).toBe(200);
  expect((await read("/v1/workspace/directory.css")).status).toBe(200);
});
it("expired health evidence becomes stale rather than retaining healthy status", async () => {
  const data = await directory();
  const healthy = {
    ...data.credentials[0],
    health: "healthy",
    healthEvidence: {
      evidenceRef: "probe_1",
      checkedAt: "2026-11-19T00:00:00Z",
      freshUntil: "2026-11-20T00:00:00Z",
    },
  };
  const response = await read(
    "/v1/credentials/cred_own",
    source({ ...data, credentials: [healthy] }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ credential: { health: "stale", expiresAt: null } });
});

async function asPrincipal(
  subject: string,
  audience: string,
  claims: Record<string, unknown> = {},
) {
  return new SignJWT({ type: "app", sub: subject, ...claims })
    .setIssuer(config.ACCESS_ISSUER)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .setProtectedHeader({ alg: "RS256" })
    .sign(signingKey);
}
async function authenticated(
  jwt: string,
  path: string,
  bindings = {},
  method = "GET",
  extra: Record<string, string> = {},
) {
  return handleRequest(
    new Request("https://homer.example" + path, {
      method,
      headers: { "Cf-Access-Jwt-Assertion": jwt, ...extra },
    }),
    { ...env, ...config, ...bindings },
    key,
  );
}
it("catalog admin has no credential grant and read identity cannot mutate catalog or credentials", async () => {
  const data = await directory();
  const response = await authenticated(
    await asPrincipal("catalog-admin", "admin"),
    "/v1/credentials",
    source(data),
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "identity_binding_required" });
  expect((await authenticated(jwt, "/v1/admin/catalog", {}, "PUT")).status).toBe(401);
  for (const method of ["POST", "PUT", "DELETE"])
    expect(
      (await authenticated(jwt, "/v1/credentials/cred_own", source(data), method)).status,
    ).toBe(405);
  expect(
    (
      await authenticated(jwt, "/v1/credentials", source(data), "GET", {
        Origin: "https://evil.invalid",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await handleRequest(
        new Request("https://homer.example/v1/credentials"),
        { ...env, ...config },
        key,
      )
    ).status,
  ).toBe(401);
});
it("shared-service and local-only grants stay exact and local-only never resolves values", async () => {
  const data = await directory();
  const shared = {
    ...data.credentials[1],
    credentialId: "cred_shared",
    ownershipClass: "shared-service",
  };
  const local = {
    ...data.credentials[0],
    credentialId: "cred_local",
    ownershipClass: "local-only",
  };
  const snapshot = {
    ...data,
    credentials: [shared, local],
    grants: [
      { ...data.grants[0], ownerActorId: "human:other", ownershipClass: "shared-service" },
      { ...data.grants[0], ownershipClass: "local-only" },
    ],
  };
  const response = await read("/v1/credentials", source(snapshot));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ credentials: [shared, local] });
  const setup = await read("/v1/my-setup", source(snapshot));
  expect(await setup.json()).toMatchObject({ credentials: [local], sharedCredentials: [shared] });
  expect((await read("/v1/credentials/cred_local/value", source(snapshot))).status).toBe(404);
  expect(
    (
      await read(
        "/v1/credentials?environment=staging&ownershipClass=local-only&ownerActorId=human:other",
        source(snapshot),
      )
    ).status,
  ).toBe(403);
});
it("workload identity requires explicit Agent and accountable Human bindings", async () => {
  const data = await directory();
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(config.ACCESS_ISSUER + "\nservice:synthetic-agent.access"),
  );
  const digest = Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, "0")).join("");
  const agent = {
    principalDigest: digest,
    principalKind: "workload",
    actorId: "agent:diagnostic",
    actorKind: "agent",
    accountableHumanId: "human:reader",
    evidenceRef: "agent_review",
  };
  const snapshot = {
    ...data,
    bindings: [...data.bindings, agent],
    grants: [
      ...data.grants,
      {
        ...data.grants[0],
        principalDigest: digest,
        ownerActorId: "human:reader",
        ownershipClass: "shared-service",
      },
    ],
    credentials: [{ ...data.credentials[0], ownershipClass: "shared-service" }],
  };
  const token = await asPrincipal("", "read", { common_name: "synthetic-agent.access" });
  expect(await (await authenticated(token, "/v1/my-setup", source(snapshot))).json()).toMatchObject(
    {
      actor: {
        actorId: "agent:diagnostic",
        actorKind: "agent",
        accountableHumanId: "human:reader",
      },
      connection: "missing",
    },
  );
  const invalid = {
    ...snapshot,
    bindings: [...data.bindings, { ...agent, accountableHumanId: "human:absent" }],
  };
  expect((await authenticated(token, "/v1/credentials", source(invalid))).status).toBe(503);
  const disguised = {
    ...snapshot,
    bindings: [
      ...data.bindings,
      {
        principalDigest: digest,
        principalKind: "human",
        actorId: "human:imposter",
        actorKind: "human",
        evidenceRef: "wrong_review",
      },
    ],
  };
  expect((await authenticated(token, "/v1/credentials", source(disguised))).status).toBe(403);
});
it("source timeout is unavailable instead of an empty inventory", async () => {
  const response = await read("/v1/credentials", {
    CREDENTIAL_DIRECTORY: { fetch: () => new Promise(() => {}) },
  });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "credential_directory_unavailable" });
});
