import { env } from "cloudflare:workers";
import { abortAllDurableObjects, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { openEventLedger } from "@zs-home/event-ledger";
import { handleRequest, type IntakeEnv as Env } from "../src/index.js";
import { MAX_WEBHOOK_BYTES, verifyGitHubSignature } from "../src/webhook.js";

const secret = "synthetic-webhook-test-secret";
const repo = { id: 123, full_name: "Zero-State-LLC/example" };
function payload(id = 456) {
  return {
    action: "closed",
    number: id,
    repository: repo,
    sender: { login: "not-the-merger" },
    pull_request: {
      id,
      number: id,
      base: { repo },
      state: "closed",
      merged: true,
      merged_at: "2026-11-20T20:00:00Z",
      merge_commit_sha: "a".repeat(40),
      merged_by: { id: 789, login: "synthetic-merger" },
      html_url: `https://github.com/${repo.full_name}/pull/${id}`,
      title: "Private title 🔐",
      body: "Private body",
      user: { login: "not-the-merger" },
    },
  };
}
async function sign(body: string, value = secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(value),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return (
    "sha256=" +
    Array.from(new Uint8Array(signed), (byte) => byte.toString(16).padStart(2, "0")).join("")
  );
}
async function request(body = JSON.stringify(payload()), headers: Record<string, string> = {}) {
  return new Request("https://homer.example/v1/hooks/github", {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": "pull_request",
      "X-Hub-Signature-256": await sign(body),
      ...headers,
    },
  });
}
function testEnv(): Env {
  // Each test has an isolated ledger while production retains its established singleton name.
  const ledgerId = env.EVENT_LEDGER.newUniqueId();
  return {
    ...env,
    CATALOG_NAME: crypto.randomUUID(),
    GITHUB_WEBHOOK_SECRET: secret,
    EVENT_LEDGER: {
      get: (id, options) => env.EVENT_LEDGER.get(id, options),
      idFromName: () => ledgerId,
      newUniqueId: (options) => env.EVENT_LEDGER.newUniqueId(options),
      idFromString: (id) => env.EVENT_LEDGER.idFromString(id),
      getByName: () => env.EVENT_LEDGER.get(ledgerId),
      jurisdiction: (value) => env.EVENT_LEDGER.jurisdiction(value),
    },
  };
}
async function configure(e: Env, revision = 1, enabled = true, projectId?: string) {
  return e.MAPPING_CATALOG.get(e.MAPPING_CATALOG.idFromName(e.CATALOG_NAME)).replace(
    revision - 1,
    {
      version: 1,
      revision,
      repositories: [
        {
          repositoryId: repo.id,
          repository: repo.full_name,
          enabled,
          ...(projectId ? { projectId } : {}),
        },
      ],
    },
    "a".repeat(64),
  );
}
it("matches GitHub's published signature vector and rejects altered bytes", async () => {
  const bytes = new TextEncoder().encode("Hello, World!");
  const signature = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";
  expect(await verifyGitHubSignature(bytes, signature, "It's a Secret to Everybody")).toBe(true);
  expect(
    await verifyGitHubSignature(
      new TextEncoder().encode("Hello, World?"),
      signature,
      "It's a Secret to Everybody",
    ),
  ).toBe(false);
});
it("authenticates exact UTF-8 bytes before parsing and accepts secret rotation", async () => {
  const e = testEnv();
  await configure(e);
  for (const signature of [
    "",
    "sha1=" + "a".repeat(40),
    "sha256=" + "0".repeat(64),
    "sha256=bad",
  ]) {
    expect(
      (await handleRequest(await request("{", { "X-Hub-Signature-256": signature }), e)).status,
    ).toBe(401);
  }
  const tampered = await request(JSON.stringify(payload()), {
    "X-Hub-Signature-256": await sign("{}"),
  });
  expect((await handleRequest(tampered, e)).status).toBe(401);
  e.GITHUB_WEBHOOK_SECRET = "synthetic-rotated-secret";
  expect((await handleRequest(await request(), e)).status).toBe(401);
  const body = JSON.stringify(payload());
  expect(
    (
      await handleRequest(
        await request(body, { "X-Hub-Signature-256": await sign(body, e.GITHUB_WEBHOOK_SECRET) }),
        e,
      )
    ).status,
  ).toBe(201);
});
it("appends once under concurrent delivery, preserves unknown Attribution and survives restart", async () => {
  const e = testEnv();
  await configure(e, 1, true, "project:synthetic");
  const responses = await Promise.all([
    handleRequest(await request(), e),
    handleRequest(await request(), e),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
  const results = await Promise.all(responses.map((r) => r.json<{ receipt: unknown }>()));
  expect(results[0]!.receipt).toEqual(results[1]!.receipt);
  await abortAllDurableObjects();
  expect((await handleRequest(await request(), e)).status).toBe(200);
  const history = await openEventLedger(e.EVENT_LEDGER!).readHistory();
  expect(history).toHaveLength(1);
  expect(history[0]!.payload).toMatchObject({
    actor: { sourceAccount: "github:synthetic-merger" },
    projectId: "project:synthetic",
  });
  const serialized = JSON.stringify(history);
  for (const forbidden of [
    "Private title",
    "Private body",
    "not-the-merger",
    "actorId",
    "actorKind",
    secret,
  ])
    expect(serialized).not.toContain(forbidden);
});
it("reloads runtime mappings, refuses retroactive remaps and immediately stops disabled repositories", async () => {
  const e = testEnv();
  expect(await (await handleRequest(await request(), e)).json()).toMatchObject({
    outcome: "ignored",
    revision: 0,
  });
  await configure(e, 1, true, "project:one");
  expect((await handleRequest(await request(), e)).status).toBe(201);
  await configure(e, 2, true, "project:two");
  expect((await handleRequest(await request(), e)).status).toBe(409);
  expect((await handleRequest(await request(JSON.stringify(payload(457))), e)).status).toBe(201);
  await configure(e, 3, false);
  expect(
    await (await handleRequest(await request(JSON.stringify(payload(458))), e)).json(),
  ).toEqual({ outcome: "ignored", reason: "repository_not_enabled", revision: 3 });
  const history = await openEventLedger(e.EVENT_LEDGER!).readHistory();
  expect(history).toHaveLength(2);
  expect(
    history.map((entry) => ("projectId" in entry.payload ? entry.payload.projectId : null)),
  ).toEqual(["project:one", "project:two"]);
});
it("checks envelopes and merge evidence without trusting sender, head repository or event headers", async () => {
  const e = testEnv();
  await configure(e);
  for (const change of [
    { number: 999 },
    { repository: { ...repo, id: 999 } },
    { repository: { ...repo, full_name: "Zero-State-LLC/other" } },
    { pull_request: null },
    { action: null },
  ])
    expect(
      (await handleRequest(await request(JSON.stringify({ ...payload(), ...change })), e)).status,
    ).toBe(400);
  const missingActor = payload();
  Reflect.deleteProperty(missingActor.pull_request, "merged_by");
  expect((await handleRequest(await request(JSON.stringify(missingActor)), e)).status).toBe(422);
  const unmerged = payload();
  unmerged.pull_request.merged = false;
  Object.assign(unmerged.pull_request, { merged_at: null });
  expect(
    await (await handleRequest(await request(JSON.stringify(unmerged)), e)).json(),
  ).toMatchObject({ outcome: "skipped" });
  expect((await handleRequest(await request("{"), e)).status).toBe(400);
  expect((await handleRequest(await request("null"), e)).status).toBe(400);
  expect((await handleRequest(await request("{}", { "X-GitHub-Event": "" }), e)).status).toBe(400);
  expect(
    await (await handleRequest(await request("{}", { "X-GitHub-Event": "ping" }), e)).json(),
  ).toEqual({ outcome: "pong" });
  expect(
    await (await handleRequest(await request("{}", { "X-GitHub-Event": "push" }), e)).json(),
  ).toMatchObject({ outcome: "ignored" });
  expect(
    await (
      await handleRequest(await request(JSON.stringify({ ...payload(), action: "opened" })), e)
    ).json(),
  ).toMatchObject({ outcome: "ignored" });
  expect(await openEventLedger(e.EVENT_LEDGER!).head()).toBeNull();
});
it("enforces actual byte limits, content type and complete runtime configuration", async () => {
  const e = testEnv();
  expect(
    (await handleRequest(new Request("https://homer.example/v1/hooks/github"), e)).status,
  ).toBe(405);
  for (const missing of ["GITHUB_WEBHOOK_SECRET", "EVENT_LEDGER"]) {
    const incomplete = { ...e };
    Reflect.deleteProperty(incomplete, missing);
    expect((await handleRequest(await request(), incomplete)).status).toBe(503);
  }
  expect((await handleRequest(await request(), { ...e, CATALOG_NAME: "" })).status).toBe(503);
  expect(
    (await handleRequest(await request("{}", { "Content-Type": "text/plain" }), e)).status,
  ).toBe(415);
  expect((await handleRequest(await request("{}", { "Content-Encoding": "gzip" }), e)).status).toBe(
    415,
  );
  const oversized = " ".repeat(MAX_WEBHOOK_BYTES + 1);
  expect((await handleRequest(await request(oversized, { "Content-Length": "2" }), e)).status).toBe(
    413,
  );
  expect((await handleRequest(await request(oversized), e)).status).toBe(413);
});
it("reports a failed append, leaves no partial entry and safely admits its redelivery", async () => {
  const e = testEnv();
  await configure(e);
  const stub = e.EVENT_LEDGER!.get(e.EVENT_LEDGER!.idFromName("event-ledger"));
  await runInDurableObject(stub, (_object, state) => {
    state.storage.sql.exec(
      "CREATE TRIGGER injected_failure AFTER INSERT ON entries BEGIN SELECT RAISE(ABORT, 'private storage detail'); END;",
    );
  });
  const failed = await handleRequest(await request(), e);
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({ error: "ledger_unavailable", revision: 1 });
  expect(await openEventLedger(e.EVENT_LEDGER!).head()).toBeNull();
  await runInDurableObject(stub, (_object, state) => {
    state.storage.sql.exec("DROP TRIGGER injected_failure");
  });
  expect((await handleRequest(await request(), e)).status).toBe(201);
});

it("fails closed on corrupt catalog storage without reusing a prior snapshot", async () => {
  const e = testEnv();
  await configure(e);
  expect((await handleRequest(await request(), e)).status).toBe(201);
  const store = e.MAPPING_CATALOG.get(e.MAPPING_CATALOG.idFromName(e.CATALOG_NAME));
  await runInDurableObject(store, (_object, state) => {
    state.storage.sql.exec(
      "INSERT INTO catalog_history VALUES (2, '{}', ?, ?)",
      "a".repeat(64),
      new Date().toISOString(),
    );
  });
  const response = await handleRequest(await request(JSON.stringify(payload(999))), e);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "catalog_unavailable" });
  expect(await openEventLedger(e.EVENT_LEDGER!).readHistory()).toHaveLength(1);
});
