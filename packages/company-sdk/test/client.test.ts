import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createCompanyClient } from "../src/client.js";
import { CompanySdkError } from "../src/types.js";

const origin = "https://homer-catalog.example";
const accessHeaders = { "Cf-Access-Client-Id": "synthetic-client-id" };
const asOf = "2026-11-19T00:00:00Z";

type Fetch = typeof globalThis.fetch;
type FetchInit = Parameters<Fetch>[1];

const contextPin = {
  repository: "Zero-State-LLC/agent-context",
  commit: "a".repeat(40),
  pinnedAt: "2026-11-24",
  files: {},
};
const routingPolicy = JSON.parse(
  readFileSync(
    new URL("../../shared-contracts/test/fixtures/valid/routing-policy.json", import.meta.url),
    "utf8",
  ),
) as unknown;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stub(respond: (url: string) => Response, timeoutMs = 5_000) {
  const calls: { url: string; init: FetchInit }[] = [];
  const fetch: Fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return Promise.resolve(respond(url));
  };
  const client = createCompanyClient({
    baseUrl: origin,
    getAccessHeaders: () => accessHeaders,
    fetch,
    timeoutMs,
  });
  return { calls, client };
}

const sample = (url: string): Response => {
  if (url.endsWith("/v1/routing-policy")) return json(routingPolicy);
  if (url.endsWith("/v1/context-pin")) return json(contextPin);
  return json({});
};

it("sends one GET with the caller's Access headers, and never follows a redirect", async () => {
  const { calls, client } = stub(sample);
  await client.getFleetHealth();
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe(`${origin}/v1/fleet`);
  expect(calls[0]?.init?.method).toBe("GET");
  expect(calls[0]?.init?.redirect).toBe("manual");
  expect(calls[0]?.init?.headers).toEqual({ ...accessHeaders, Accept: "application/json" });
});

it("requests every surface at its exact path and query", async () => {
  const { calls, client } = stub(sample);
  await client.resolveIdentity({ source: "github", sourceAccount: "github:example-dev" });
  await client.getProjectStatus({ projectId: "project:fixture", asOf });
  await client.getFleetHealth();
  await client.getContextPin();
  await client.listKnowledgeFlags({
    status: "open",
    projectId: "project:fixture",
    repository: "Zero-State-LLC/Homer",
  });
  await client.getRoutingPolicy();
  await client.getProjectStatus({ projectId: "project:fixture" });
  await client.listKnowledgeFlags();
  expect(calls.map((call) => call.url)).toEqual([
    `${origin}/v1/identities/resolve?source=github&sourceAccount=github%3Aexample-dev`,
    `${origin}/v1/projects/project%3Afixture/timeline?asOf=2026-11-19T00%3A00%3A00Z`,
    `${origin}/v1/fleet`,
    `${origin}/v1/context-pin`,
    `${origin}/v1/knowledge-flags?status=open&projectId=project%3Afixture&repository=Zero-State-LLC%2FHomer`,
    `${origin}/v1/routing-policy`,
    `${origin}/v1/projects/project%3Afixture/timeline`,
    `${origin}/v1/knowledge-flags`,
  ]);
});

it("reports a failure by status and code, and never leaks a body or a header", async () => {
  const body = "synthetic-body-marker";
  const { client } = stub(() => new Response(`<html>${body}</html>`, { status: 500 }));
  const error = await client.getFleetHealth().catch((thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(CompanySdkError);
  const sdkError = error as CompanySdkError;
  expect(sdkError.status).toBe(500);
  expect(sdkError.code).toBe("http_500");
  const text = `${String(error)} ${sdkError.message} ${JSON.stringify(error)}`;
  expect(text).not.toContain(body);
  expect(text).not.toContain("synthetic-client-id");
});

it("takes the catalog's own error code when it is well formed", async () => {
  const { client } = stub(() => json({ error: "routing_policy_unavailable" }, 503));
  await expect(client.getRoutingPolicy()).rejects.toMatchObject({
    status: 503,
    code: "routing_policy_unavailable",
    endpoint: "/v1/routing-policy",
  });
});

it("fails a slow request with code timeout", async () => {
  const fetch: Fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("synthetic abort")));
    });
  const client = createCompanyClient({
    baseUrl: origin,
    getAccessHeaders: () => accessHeaders,
    fetch,
    timeoutMs: 5,
  });
  await expect(client.getFleetHealth()).rejects.toMatchObject({ status: 0, code: "timeout" });
});

it("fails a fetch that throws with code network_error", async () => {
  const fetch: Fetch = () => Promise.reject(new Error("synthetic network failure"));
  const client = createCompanyClient({
    baseUrl: origin,
    getAccessHeaders: () => accessHeaders,
    fetch,
  });
  await expect(client.getFleetHealth()).rejects.toMatchObject({ status: 0, code: "network_error" });
});

it("refuses a redirect instead of following it", async () => {
  const moved = stub(() => new Response(null, { status: 302 }));
  await expect(moved.client.getFleetHealth()).rejects.toMatchObject({
    status: 302,
    code: "unexpected_redirect",
    endpoint: "/v1/fleet",
  });
  const opaque = stub(() => ({ type: "opaqueredirect", status: 0 }) as unknown as Response);
  await expect(opaque.client.getFleetHealth()).rejects.toMatchObject({
    status: 0,
    code: "unexpected_redirect",
    endpoint: "/v1/fleet",
  });
});

it("fails a response that is not JSON with code invalid_response", async () => {
  const { client } = stub(() => new Response("synthetic not json", { status: 200 }));
  await expect(client.getFleetHealth()).rejects.toMatchObject({ code: "invalid_response" });
});

it("refuses a baseUrl that is not a bare https origin", () => {
  for (const baseUrl of [
    "http://homer-catalog.example",
    "https://homer-catalog.example/",
    "https://homer-catalog.example/v1",
    "https://user:secret@homer-catalog.example",
    "https://homer-catalog.example?taskClass=coding",
    "https://homer-catalog.example#fragment",
    "homer-catalog.example",
  ]) {
    expect(() => createCompanyClient({ baseUrl, getAccessHeaders: () => ({}) }), baseUrl).toThrow(
      TypeError,
    );
  }
});

it("refuses a routing policy or a Context Pin that does not validate", async () => {
  const policy = stub(() => json({ contract: "home.routing-policy/v1" }));
  await expect(policy.client.getRoutingPolicy()).rejects.toMatchObject({
    code: "invalid_response",
  });
  const pin = stub(() => json({ ...contextPin, commit: "abc" }));
  await expect(pin.client.getContextPin()).rejects.toMatchObject({ code: "invalid_response" });
});
