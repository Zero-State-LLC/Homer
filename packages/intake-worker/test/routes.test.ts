import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { catalogRoutes } from "@zs-home/catalog-worker";
import { handleRequest, intakeRoutes, type IntakeEnv } from "../src/index.js";

// ADR 013: homer-intake serves machines only. Its caller table names every
// path, and the router refuses anything else, every person-facing catalog path
// included, before any handler runs.
const config = {
  ACCESS_ISSUER: "https://synthetic.cloudflareaccess.com",
  RUNNER_CONTROLLER_AUD: "synthetic-controller",
  CATALOG_NAME: "synthetic-routes",
  GITHUB_WEBHOOK_SECRET: "synthetic-webhook-secret",
};
let key: JWTVerifyGetKey;
let person: string;
let workload: string;
beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  key = createLocalJWKSet({ keys: [{ ...(await exportJWK(keys.publicKey)), kid: "test" }] });
  const token = (aud: string, claims: Record<string, unknown>) =>
    new SignJWT({ type: "app", ...claims })
      .setIssuer(config.ACCESS_ISSUER)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime("5m")
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .sign(keys.privateKey);
  // A person holding the controller audience is still refused: intake admits workloads.
  person = await token(config.RUNNER_CONTROLLER_AUD, { sub: "synthetic-person" });
  workload = await token(config.RUNNER_CONTROLLER_AUD, { sub: "", common_name: "host.access" });
});
const testEnv = (): IntakeEnv => ({ ...env, ...config });
function call(path: string, jwt: string | null, method = "GET") {
  return handleRequest(
    new Request(`https://intake.example${path}`, {
      method,
      headers: jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {},
    }),
    testEnv(),
    key,
  );
}

it("lists machine callers only: GitHub by HMAC, and workloads by the controller audience", () => {
  expect([...intakeRoutes.keys()].sort()).toEqual([
    "/v1/hooks/github",
    "/v1/runner-controller/poll",
    "/v1/runner-controller/report",
  ]);
  for (const [path, route] of intakeRoutes) {
    expect(route).toEqual(
      path === "/v1/hooks/github"
        ? { caller: "github", proof: "hmac" }
        : { caller: "workload", proof: "RUNNER_CONTROLLER_AUD" },
    );
  }
});

it("shares no path with homer-catalog, and serves no version or page", async () => {
  for (const path of intakeRoutes.keys()) expect(catalogRoutes.has(path)).toBe(false);
  for (const path of [
    ...catalogRoutes.keys(),
    "/v1/credentials/synthetic-id",
    "/v1/fleet/intake",
    "/",
    "/v1",
    "/v1/hooks",
    "/v1/hooks/github/",
    "/v1/runner-controller",
    "/v1/runner-controller/",
    "/v1/runner-controller/poll/",
  ]) {
    for (const jwt of [null, person, workload]) {
      for (const method of ["GET", "POST", "PUT"]) {
        const response = await call(path, jwt, method);
        expect(response.status, `${method} ${path}`).toBe(404);
        expect(await response.json()).toEqual({ error: "not_found" });
      }
    }
  }
});

it("refuses a person, and an unsigned or unauthenticated caller, on every listed path", async () => {
  for (const path of ["/v1/runner-controller/poll", "/v1/runner-controller/report"]) {
    const method = path.endsWith("/report") ? "POST" : "GET";
    for (const jwt of [null, person])
      expect((await call(`${path}?machineId=pc-one`, jwt, method)).status).toBe(401);
  }
  // The webhook takes no Access token; without GitHub's signature it is refused.
  for (const jwt of [null, person, workload]) {
    const response = await handleRequest(
      new Request("https://intake.example/v1/hooks/github", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Event": "ping",
          "X-GitHub-Delivery": "00000000-0000-4000-8000-000000000001",
          ...(jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {}),
        },
        body: "{}",
      }),
      testEnv(),
      key,
    );
    expect(response.status).toBe(401);
  }
});
