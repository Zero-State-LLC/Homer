import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface AccessConfig {
  ACCESS_ISSUER: string;
  ACCESS_READ_AUD: string;
  ACCESS_ADMIN_AUD: string;
  CATALOG_NAME: string;
  RUNNER_CONTROLLER_AUD?: string;
}
const resolvers = new Map<string, JWTVerifyGetKey>();
export function validateAccessConfig(config: AccessConfig): void {
  if (
    !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(config.ACCESS_ISSUER ?? "") ||
    !config.ACCESS_READ_AUD?.trim() ||
    !config.ACCESS_ADMIN_AUD?.trim() ||
    config.ACCESS_READ_AUD === config.ACCESS_ADMIN_AUD ||
    !config.CATALOG_NAME?.trim()
  )
    throw new Error("access_not_configured");
}
export async function verifyAccessIdentity(
  token: string,
  config: AccessConfig,
  admin: boolean,
  key?: JWTVerifyGetKey,
  controller = false,
): Promise<{ principal: string; kind: "human" | "workload" }> {
  validateAccessConfig(config);
  if (
    controller &&
    (!config.RUNNER_CONTROLLER_AUD?.trim() ||
      [config.ACCESS_READ_AUD, config.ACCESS_ADMIN_AUD].includes(config.RUNNER_CONTROLLER_AUD))
  )
    throw new Error("access_not_configured");
  let resolver = key ?? resolvers.get(config.ACCESS_ISSUER);
  if (!resolver) {
    resolver = createRemoteJWKSet(new URL(`${config.ACCESS_ISSUER}/cdn-cgi/access/certs`));
    resolvers.set(config.ACCESS_ISSUER, resolver);
  }
  const { payload } = await jwtVerify(token, resolver, {
    issuer: config.ACCESS_ISSUER,
    audience: controller
      ? (config.RUNNER_CONTROLLER_AUD as string)
      : admin
        ? config.ACCESS_ADMIN_AUD
        : [config.ACCESS_READ_AUD, config.ACCESS_ADMIN_AUD],
    algorithms: ["RS256"],
    requiredClaims: ["sub", "exp", "iat"],
  });
  if (controller && (payload.aud !== config.RUNNER_CONTROLLER_AUD || payload.sub !== ""))
    throw new Error("invalid_controller_identity");
  if (typeof payload.iat !== "number" || payload.iat > Math.floor(Date.now() / 1000))
    throw new Error("invalid_issued_at");
  if (payload.type !== "app") throw new Error("invalid_token_type");
  const identity = payload.sub?.trim()
    ? `user:${payload.sub}`
    : payload.sub === "" &&
        typeof payload.common_name === "string" &&
        /^[A-Za-z0-9.-]+\.access$/.test(payload.common_name)
      ? `service:${payload.common_name}`
      : undefined;
  if (!identity) throw new Error("missing_subject");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${config.ACCESS_ISSUER}\n${identity}`),
  );
  return {
    principal: Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join(""),
    kind: identity.startsWith("user:") ? "human" : "workload",
  };
}

export async function verifyAccess(
  token: string,
  config: AccessConfig,
  admin: boolean,
  key?: JWTVerifyGetKey,
): Promise<string> {
  return (await verifyAccessIdentity(token, config, admin, key)).principal;
}
