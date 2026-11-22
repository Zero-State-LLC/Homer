import { json, readBytes } from "./http.js";

export interface DirectoryService {
  fetch(request: Request): Promise<Response>;
}
export interface DirectoryBindings {
  CREDENTIAL_DIRECTORY?: DirectoryService;
}
type OwnershipClass = "shared-service" | "developer-owned" | "local-only";
interface IdentityBinding {
  principalDigest: string;
  principalKind: "human" | "workload";
  actorId: string;
  actorKind: "human" | "agent";
  evidenceRef: string;
  accountableHumanId?: string;
}
interface Grant {
  principalDigest: string;
  capability: "metadata-read";
  ownerActorId: string;
  ownershipClass: OwnershipClass;
  projectId: string;
  environment: string;
}
export interface Credential {
  credentialId: string;
  revision: number;
  provider: string;
  purpose: string;
  ownershipClass: OwnershipClass;
  ownerActorId: string;
  projectId: string;
  environment: string;
  consumers: { consumerId: string; label: string }[];
  consumerDiscovery: "configured-only" | "unknown";
  health: "unverified" | "healthy" | "degraded" | "stale" | "unknown";
  healthEvidence: null | { evidenceRef: string; checkedAt: string; freshUntil: string };
  expiresAt: string | null;
  activeVersion: string | null;
  rotationState: "none" | "pending" | "partial" | "failed" | "complete" | "unknown";
}
interface Directory {
  version: 1;
  policyRevision: number;
  metadataRevision: number;
  observedAt: string;
  bindings: IdentityBinding[];
  grants: Grant[];
  credentials: Credential[];
}
const fail = (): never => {
  throw new Error("invalid_directory");
};
function object(
  value: unknown,
  required: string[],
  optional: string[] = [],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const result = value as Record<string, unknown>;
  if (
    required.some((k) => !Object.hasOwn(result, k)) ||
    Object.keys(result).some((k) => !required.includes(k) && !optional.includes(k))
  )
    return fail();
  return result;
}
function text(
  value: unknown,
  pattern = /^[A-Za-z0-9][A-Za-z0-9_:.@-]{0,95}$/,
): asserts value is string {
  if (typeof value !== "string" || !pattern.test(value)) fail();
}
function label(value: unknown) {
  text(value, /^[\p{L}\p{N}][\p{L}\p{N} .,():_@+-]{0,199}$/u);
}
function number(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail();
}
function one(value: unknown, options: string[]) {
  if (!options.includes(value as string)) fail();
}
function date(value: unknown) {
  text(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
  if (
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().replace(".000Z", "Z") !== value.replace(".000Z", "Z")
  )
    fail();
}
function array(value: unknown, maximum = 2000): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) return fail();
  return value;
}
const classes = ["shared-service", "developer-owned", "local-only"];
function scope(value: Record<string, unknown>) {
  one(value.ownershipClass, classes);
  text(value.ownerActorId);
  text(value.projectId, /^project:[a-z0-9][a-z0-9-]{0,79}$/);
  text(value.environment);
}
function parseDirectory(input: unknown): Directory {
  const d = object(input, [
    "version",
    "policyRevision",
    "metadataRevision",
    "observedAt",
    "bindings",
    "grants",
    "credentials",
  ]);
  if (d.version !== 1) fail();
  number(d.policyRevision);
  number(d.metadataRevision);
  date(d.observedAt);
  if (Date.parse(d.observedAt as string) > Date.now()) fail();
  const principals = new Set<string>();
  const actors = new Map<string, Record<string, unknown>>();
  for (const item of array(d.bindings)) {
    const b = object(
      item,
      ["principalDigest", "principalKind", "actorId", "actorKind", "evidenceRef"],
      ["accountableHumanId"],
    );
    text(b.principalDigest, /^[a-f0-9]{64}$/);
    text(b.actorId);
    text(b.evidenceRef);
    one(b.principalKind, ["human", "workload"]);
    one(b.actorKind, ["human", "agent"]);
    if (principals.has(b.principalDigest)) fail();
    principals.add(b.principalDigest);
    if (
      b.actorKind === "human" &&
      (b.principalKind !== "human" || b.accountableHumanId !== undefined)
    )
      fail();
    if (b.actorKind === "agent") {
      if (b.principalKind !== "workload") fail();
      text(b.accountableHumanId);
    }
    const prior = actors.get(b.actorId);
    if (
      prior &&
      (prior.actorKind !== b.actorKind || prior.accountableHumanId !== b.accountableHumanId)
    )
      fail();
    actors.set(b.actorId, b);
  }
  for (const b of actors.values())
    if (
      b.actorKind === "agent" &&
      actors.get(b.accountableHumanId as string)?.actorKind !== "human"
    )
      fail();
  for (const item of array(d.grants)) {
    const g = object(item, [
      "principalDigest",
      "capability",
      "ownerActorId",
      "ownershipClass",
      "projectId",
      "environment",
    ]);
    text(g.principalDigest, /^[a-f0-9]{64}$/);
    if (!principals.has(g.principalDigest) || g.capability !== "metadata-read") fail();
    scope(g);
    if (!actors.has(g.ownerActorId as string)) fail();
  }
  const ids = new Set<string>();
  for (const item of array(d.credentials)) {
    const c = object(item, [
      "credentialId",
      "revision",
      "provider",
      "purpose",
      "ownershipClass",
      "ownerActorId",
      "projectId",
      "environment",
      "consumers",
      "consumerDiscovery",
      "health",
      "healthEvidence",
      "expiresAt",
      "activeVersion",
      "rotationState",
    ]);
    text(c.credentialId, /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/);
    if (ids.has(c.credentialId)) fail();
    ids.add(c.credentialId);
    number(c.revision);
    label(c.provider);
    label(c.purpose);
    scope(c);
    if (!actors.has(c.ownerActorId as string)) fail();
    const consumers = new Set<string>();
    for (const item of array(c.consumers, 100)) {
      const consumer = object(item, ["consumerId", "label"]);
      text(consumer.consumerId);
      label(consumer.label);
      if (consumers.has(consumer.consumerId)) fail();
      consumers.add(consumer.consumerId);
    }
    one(c.consumerDiscovery, ["configured-only", "unknown"]);
    one(c.health, ["unverified", "healthy", "degraded", "stale", "unknown"]);
    if (c.healthEvidence !== null) {
      const evidence = object(c.healthEvidence, ["evidenceRef", "checkedAt", "freshUntil"]);
      text(evidence.evidenceRef);
      date(evidence.checkedAt);
      date(evidence.freshUntil);
      if (
        Date.parse(evidence.checkedAt as string) > Date.parse(d.observedAt as string) ||
        Date.parse(evidence.freshUntil as string) < Date.parse(evidence.checkedAt as string)
      )
        fail();
    } else if (["healthy", "degraded", "stale"].includes(c.health as string)) fail();
    if (c.expiresAt !== null) date(c.expiresAt);
    if (c.activeVersion !== null) text(c.activeVersion, /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/);
    one(c.rotationState, ["none", "pending", "partial", "failed", "complete", "unknown"]);
  }
  return d as unknown as Directory;
}
async function load(service: DirectoryService): Promise<Directory> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await service.fetch(
          new Request("https://credential-directory/v1/directory", {
            signal: controller.signal,
            redirect: "manual",
          }),
        );
        if (
          response.status !== 200 ||
          response.redirected ||
          response.headers.get("Content-Type")?.split(";")[0] !== "application/json"
        )
          fail();
        const bytes = await readBytes(
          new Request("https://credential-directory/read", { method: "POST", body: response.body }),
          1024 * 1024,
        );
        return parseDirectory(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("directory_timeout"));
        }, 3000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const matches = (
  g: Grant,
  c: Pick<Credential, "ownershipClass" | "ownerActorId" | "projectId" | "environment">,
) =>
  g.ownershipClass === c.ownershipClass &&
  g.ownerActorId === c.ownerActorId &&
  g.projectId === c.projectId &&
  g.environment === c.environment;
export async function credentialResponse(
  url: URL,
  env: DirectoryBindings,
  principal: string,
  principalKind: "human" | "workload",
): Promise<Response> {
  if (!env.CREDENTIAL_DIRECTORY) return json({ error: "credential_directory_not_configured" }, 503);
  let directory: Directory;
  try {
    directory = await load(env.CREDENTIAL_DIRECTORY);
  } catch {
    return json({ error: "credential_directory_unavailable" }, 503);
  }
  const identity = directory.bindings.find(
    (b) => b.principalDigest === principal && b.principalKind === principalKind,
  );
  if (!identity) return json({ error: "identity_binding_required" }, 403);
  const grants = directory.grants.filter(
    (g) =>
      g.principalDigest === principal &&
      (g.ownershipClass === "shared-service" || g.ownerActorId === identity.actorId),
  );
  if (!grants.length) return json({ error: "credential_access_denied" }, 403);
  const selectors = ["ownerActorId", "ownershipClass", "projectId", "environment"] as const;
  if (
    [...url.searchParams.keys()].some((k) => ![...selectors, "q"].includes(k)) ||
    [...url.searchParams.keys()].some((k) => url.searchParams.getAll(k).length !== 1)
  )
    return json({ error: "invalid_query" }, 400);
  const selected = grants.filter((g) =>
    selectors.every((k) => !url.searchParams.has(k) || url.searchParams.get(k) === g[k]),
  );
  if (!selected.length) return json({ error: "credential_access_denied" }, 403);
  const query = url.searchParams.get("q") ?? "";
  if (query.length > 200) return json({ error: "invalid_query" }, 400);
  let credentials = directory.credentials
    .filter((c) => selected.some((g) => matches(g, c)))
    .map((c) => ({
      ...c,
      health:
        c.healthEvidence &&
        Date.parse(c.healthEvidence.freshUntil) <= Date.now() &&
        ["healthy", "degraded"].includes(c.health)
          ? ("stale" as const)
          : c.health,
    }));
  const metadata = {
    version: 1,
    metadataRevision: directory.metadataRevision,
    observedAt: directory.observedAt,
  };
  if (url.pathname === "/v1/my-setup") {
    const owned = credentials.filter(
      (c) => c.ownerActorId === identity.actorId && c.ownershipClass !== "shared-service",
    );
    const authorizedScopes = selected.map((g) => ({
      ownerActorId: g.ownerActorId,
      ownershipClass: g.ownershipClass,
      projectId: g.projectId,
      environment: g.environment,
    }));
    return json({
      ...metadata,
      actor: {
        actorId: identity.actorId,
        actorKind: identity.actorKind,
        ...(identity.accountableHumanId ? { accountableHumanId: identity.accountableHumanId } : {}),
      },
      authorizedScopes,
      credentials: owned,
      sharedCredentials: credentials.filter((c) => c.ownershipClass === "shared-service"),
      connection: owned.length ? "unverified" : "missing",
      instrumentation: "unknown",
      workSession: "unknown",
    });
  }
  if (url.pathname.startsWith("/v1/credentials/")) {
    const credential = credentials.find(
      (c) => c.credentialId === url.pathname.slice("/v1/credentials/".length),
    );
    return credential
      ? json({ ...metadata, credential })
      : json({ error: "credential_not_found" }, 404);
  }
  credentials = credentials.filter((c) =>
    [c.provider, c.purpose, c.ownerActorId, c.projectId, c.environment].some((s) =>
      s.toLowerCase().includes(query.toLowerCase()),
    ),
  );
  return json({ ...metadata, credentials });
}
