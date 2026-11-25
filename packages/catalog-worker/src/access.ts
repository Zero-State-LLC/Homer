import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

/**
 * Cloudflare Access verification for both Workers (ADR 013). `homer-catalog`
 * verifies people and agents with the read or admin audience;
 * `homer-intake` verifies workloads only, each with its own audience. Both
 * derive the same principal digest, so an admin's enrollment in the catalog
 * names the workload that intake later admits.
 */
export interface AccessConfig {
  ACCESS_ISSUER: string;
  ACCESS_READ_AUD: string;
  ACCESS_ADMIN_AUD: string;
  CATALOG_NAME: string;
}
export interface Identity {
  principal: string;
  kind: "human" | "workload";
}
const ISSUER = /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/;
const resolvers = new Map<string, JWTVerifyGetKey>();

export function validAccessIssuer(issuer: string | undefined): boolean {
  return ISSUER.test(issuer ?? "");
}
export function validateAccessConfig(config: AccessConfig): void {
  if (
    !validAccessIssuer(config.ACCESS_ISSUER) ||
    !config.ACCESS_READ_AUD?.trim() ||
    !config.ACCESS_ADMIN_AUD?.trim() ||
    config.ACCESS_READ_AUD === config.ACCESS_ADMIN_AUD ||
    !config.CATALOG_NAME?.trim()
  )
    throw new Error("access_not_configured");
}

function resolverFor(issuer: string, key?: JWTVerifyGetKey): JWTVerifyGetKey {
  let resolver = key ?? resolvers.get(issuer);
  if (!resolver) {
    resolver = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    resolvers.set(issuer, resolver);
  }
  return resolver;
}

async function identityOf(payload: JWTPayload, issuer: string): Promise<Identity> {
  if (typeof payload.iat !== "number" || payload.iat > Math.floor(Date.now() / 1000))
    throw new Error("invalid_issued_at");
  if (payload["type"] !== "app") throw new Error("invalid_token_type");
  const commonName = payload["common_name"];
  const identity = payload.sub?.trim()
    ? `user:${payload.sub}`
    : payload.sub === "" &&
        typeof commonName === "string" &&
        /^[A-Za-z0-9.-]+\.access$/.test(commonName)
      ? `service:${commonName}`
      : undefined;
  if (!identity) throw new Error("missing_subject");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${issuer}\n${identity}`),
  );
  return {
    principal: Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join(""),
    kind: identity.startsWith("user:") ? "human" : "workload",
  };
}

/** A person or agent: with `admin`, the admin audience only; otherwise the read or the admin audience. */
export async function verifyAccessIdentity(
  token: string,
  config: AccessConfig,
  admin: boolean,
  key?: JWTVerifyGetKey,
): Promise<Identity> {
  validateAccessConfig(config);
  const { payload } = await jwtVerify(token, resolverFor(config.ACCESS_ISSUER, key), {
    issuer: config.ACCESS_ISSUER,
    audience: admin ? config.ACCESS_ADMIN_AUD : [config.ACCESS_READ_AUD, config.ACCESS_ADMIN_AUD],
    algorithms: ["RS256"],
    requiredClaims: ["sub", "exp", "iat"],
  });
  return identityOf(payload, config.ACCESS_ISSUER);
}

/**
 * A workload, and only a workload, with exactly `audience`: as a string or a
 * one-element array. Empty, mixed and repeated audiences are refused, and so
 * is a human subject.
 */
export async function verifyWorkloadIdentity(
  token: string,
  issuer: string,
  audience: string,
  key?: JWTVerifyGetKey,
): Promise<Identity> {
  if (!validAccessIssuer(issuer) || !audience.trim()) throw new Error("access_not_configured");
  const { payload } = await jwtVerify(token, resolverFor(issuer, key), {
    issuer,
    audience,
    algorithms: ["RS256"],
    requiredClaims: ["sub", "exp", "iat"],
  });
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (audiences.length !== 1 || audiences[0] !== audience || payload.sub !== "")
    throw new Error("invalid_workload_identity");
  const identity = await identityOf(payload, issuer);
  if (identity.kind !== "workload") throw new Error("invalid_workload_identity");
  return identity;
}

export async function verifyAccess(
  token: string,
  config: AccessConfig,
  admin: boolean,
  key?: JWTVerifyGetKey,
): Promise<string> {
  return (await verifyAccessIdentity(token, config, admin, key)).principal;
}
