import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { catalogRoute, catalogRoutes, handleRequest, type Env } from "../src/index.js";

// ADR 013: homer-catalog serves people and agents only. Its caller table names
// every path, and the router refuses anything else before any handler runs.
const config = {
  ACCESS_ISSUER: "https://synthetic.cloudflareaccess.com",
  ACCESS_READ_AUD: "synthetic-read",
  ACCESS_ADMIN_AUD: "synthetic-admin",
  CATALOG_NAME: "synthetic-routes",
};
let key: JWTVerifyGetKey;
let read: string;
let admin: string;
let workload: string;
beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  key = createLocalJWKSet({ keys: [{ ...(await exportJWK(keys.publicKey)), kid: "test" }] });
  const token = (aud: string, claims: Record<string, unknown> = { sub: "synthetic-person" }) =>
    new SignJWT({ type: "app", ...claims })
      .setIssuer(config.ACCESS_ISSUER)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime("5m")
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .sign(keys.privateKey);
  read = await token(config.ACCESS_READ_AUD);
  admin = await token(config.ACCESS_ADMIN_AUD);
  workload = await token("synthetic-controller", { sub: "", common_name: "host.access" });
});
const testEnv = (): Env => ({ ...env, ...config });
function call(path: string, jwt: string | null, method = "GET") {
  return handleRequest(
    new Request(`https://homer.example${path}`, {
      method,
      headers: jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {},
    }),
    testEnv(),
    key,
  );
}
// The one admin path served only by PUT.
const methodFor = (path: string) => (path === "/v1/admin/catalog" ? "PUT" : "GET");

it("lists people only, and gives the admin audience exactly the admin paths", () => {
  expect(catalogRoutes.size).toBeGreaterThan(0);
  for (const [path, route] of catalogRoutes) {
    expect(route.caller).toBe("person");
    // The router verifies the admin audience for exactly the paths under /v1/admin/.
    expect(route.audience === "admin").toBe(path.startsWith("/v1/admin/"));
  }
  expect(catalogRoute("/v1/credentials/synthetic-id")).toEqual({
    caller: "person",
    audience: "read",
  });
  expect(catalogRoute("/v1/credentials/")).toBeUndefined();
  expect(catalogRoute("/v1/projects/project:fixture/timeline")).toEqual({
    caller: "person",
    audience: "read",
  });
  for (const path of [
    "/v1/projects",
    "/v1/projects/",
    "/v1/projects/project:fixture",
    "/v1/projects/project:fixture/timeline/extra",
    "/v1/projects//timeline",
  ])
    expect(catalogRoute(path), path).toBeUndefined();
});

it("refuses machine routes and unlisted paths before any handler runs", async () => {
  for (const path of [
    "/v1/hooks/github",
    "/v1/runner-controller/poll?machineId=pc-one",
    "/v1/runner-controller/report?machineId=pc-one",
    "/v1/fleet/intake",
    "/",
    "/v1",
    "/v1/admin",
    "/v1/admin/",
    "/v1/credentials/",
    "/v1/catalog/",
    "/v1/VERSION",
  ]) {
    for (const jwt of [null, read, admin, workload]) {
      for (const method of ["GET", "POST"]) {
        const response = await call(path, jwt, method);
        expect(response.status, `${method} ${path}`).toBe(404);
        expect(await response.json()).toEqual({ error: "not_found" });
      }
    }
  }
});

it("serves every listed path, to the audience its route names", async () => {
  for (const [path, route] of catalogRoutes) {
    const method = methodFor(path);
    for (const jwt of [admin, read]) {
      const status = (await call(path, jwt, method)).status;
      const label = `${jwt === admin ? "admin" : "read"} ${method} ${path}`;
      if (route.audience === "admin" && jwt === read) expect(status, label).toBe(401);
      else expect([401, 404], label).not.toContain(status);
    }
    expect((await call(path, workload, method)).status, `workload ${method} ${path}`).toBe(401);
    expect((await call(path, null, method)).status, `anonymous ${method} ${path}`).toBe(401);
  }
});
