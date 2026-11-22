import { env } from "cloudflare:workers";
import { abortAllDurableObjects, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { handleRequest, type Env } from "../src/index.js";

const secret = "synthetic-workflow-job-secret";
const repo = { id: 123, full_name: "Zero-State-LLC/Homer" };
const d1 = "72d3162e-cc78-11e3-81ab-4c9367dc0958";
const d2 = "82d3162e-cc78-11e3-81ab-4c9367dc0958";
const d3 = "92d3162e-cc78-11e3-81ab-4c9367dc0958";

function payload(action: "queued" | "in_progress" | "completed" = "completed") {
  return {
    action,
    repository: repo,
    sender: { login: "untrusted-sender" },
    workflow_job: {
      id: 303,
      run_id: 202,
      name: "CI / build",
      status: action,
      conclusion: action === "completed" ? "success" : null,
      head_sha: "a".repeat(40),
      runner_id: action === "queued" ? null : 555,
      runner_group_id: action === "queued" ? null : 7,
      created_at: "2026-11-22T20:00:00Z",
      started_at: action === "queued" ? null : "2026-11-22T20:00:10Z",
      completed_at: action === "completed" ? "2026-11-22T20:00:30Z" : null,
      html_url: "https://github.com/Zero-State-LLC/Homer/actions/runs/202/job/303",
      steps: [{ name: "secret script", env: { TOKEN: "private-test-token" } }],
    },
  };
}
function testEnv(enabled = "true"): Env {
  return {
    ...env,
    CATALOG_NAME: crypto.randomUUID(),
    GITHUB_WEBHOOK_SECRET: secret,
    GITHUB_JOB_INGEST_ENABLED: enabled,
    ACCESS_ISSUER: "",
    ACCESS_READ_AUD: "",
    ACCESS_ADMIN_AUD: "",
  };
}
async function configure(e: Env) {
  return e.MAPPING_CATALOG.get(e.MAPPING_CATALOG.idFromName(e.CATALOG_NAME)).replace(
    0,
    {
      version: 1,
      revision: 1,
      repositories: [{ repositoryId: repo.id, repository: repo.full_name, enabled: true }],
    },
    "a".repeat(64),
  );
}
async function sign(body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return (
    "sha256=" + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
  );
}
async function request(
  value: unknown = payload(),
  delivery = d1,
  overrides: Record<string, string> = {},
): Promise<Request> {
  const body = JSON.stringify(value);
  return new Request("https://homer.example/v1/hooks/github", {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": "workflow_job",
      "X-GitHub-Delivery": delivery,
      "X-Hub-Signature-256": await sign(body),
      ...overrides,
    },
  });
}
function store(e: Env) {
  return e.JOB_EVIDENCE!.get(e.JOB_EVIDENCE!.idFromName(e.CATALOG_NAME));
}
it("defaults to disabled and never creates a job receipt", async () => {
  const e = testEnv("");
  await configure(e);
  const response = await handleRequest(await request(), e);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ outcome: "ignored", reason: "job_ingest_disabled" });
  expect((await store(e).readJob(repo.id, 202, 303)).receipts).toEqual([]);
});
it("authenticates original bytes before parsing, including when disabled", async () => {
  const e = testEnv("");
  await configure(e);
  const tampered = await request(payload(), d1, {
    "X-Hub-Signature-256": "sha256=" + "0".repeat(64),
  });
  expect((await handleRequest(tampered, e)).status).toBe(401);
  const missingBinding: Env = { ...e, GITHUB_JOB_INGEST_ENABLED: "true" };
  delete missingBinding.JOB_EVIDENCE;
  expect((await handleRequest(await request(), missingBinding)).status).toBe(503);
  expect((await store(e).readJob(repo.id, 202, 303)).receipts).toEqual([]);
});
it("requires an admitted repository and an exact delivery ID", async () => {
  const e = testEnv();
  expect(await (await handleRequest(await request(), e)).json()).toMatchObject({
    outcome: "ignored",
    reason: "repository_not_enabled",
  });
  await configure(e);
  const badId = await request(payload(), "not-a-uuid");
  expect((await handleRequest(badId, e)).status).toBe(400);
  const badRepo = { ...payload(), repository: { ...repo, id: 999 } };
  const denied = await handleRequest(await request(badRepo), e);
  expect(await denied.json()).toMatchObject({
    outcome: "ignored",
    reason: "repository_not_enabled",
  });
  expect((await store(e).readJob(repo.id, 202, 303)).receipts).toEqual([]);
});
it("persists one original receipt across concurrent identical signed delivery and restart", async () => {
  const e = testEnv();
  await configure(e);
  const answers = await Promise.all([
    handleRequest(await request(), e),
    handleRequest(await request(), e),
  ]);
  expect(answers.map((r) => r.status).sort()).toEqual([200, 201]);
  const bodies = await Promise.all(answers.map((r) => r.json<{ receipt: unknown }>()));
  expect(bodies[0]!.receipt).toEqual(bodies[1]!.receipt);
  const original = bodies[0]!.receipt;
  await abortAllDurableObjects();
  const repeated = await handleRequest(await request(), e);
  expect(repeated.status).toBe(200);
  expect((await repeated.json<{ receipt: unknown }>()).receipt).toEqual(original);
  const history = await store(e).readJob(repo.id, 202, 303);
  expect(history.receipts).toHaveLength(1);
  expect(history.state).toBe("completed");
  expect(history.observation?.conclusion).toBe("success");
});
it("refuses a changed signed body reusing an earlier delivery ID", async () => {
  const e = testEnv();
  await configure(e);
  expect((await handleRequest(await request(), e)).status).toBe(201);
  const different = payload();
  different.workflow_job.conclusion = "failure";
  const conflict = await handleRequest(await request(different), e);
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toMatchObject({ error: "delivery_payload_conflict" });
  const history = await store(e).readJob(repo.id, 202, 303);
  expect(history.receipts).toHaveLength(1);
  expect(history.observation?.conclusion).toBe("success");
});
it("retains late queued evidence without regressing a completed job", async () => {
  const e = testEnv();
  await configure(e);
  expect((await handleRequest(await request(payload("completed"), d1), e)).status).toBe(201);
  expect((await handleRequest(await request(payload("queued"), d2), e)).status).toBe(201);
  const history = await store(e).readJob(repo.id, 202, 303);
  expect(history.receipts.map((receipt) => receipt.sequence)).toEqual([1, 2]);
  expect(history.state).toBe("completed");
  expect(history.observation?.completedAt).toBe("2026-11-22T20:00:30Z");
});
it("marks contradictory terminal deliveries unknown rather than choosing a winner", async () => {
  const e = testEnv();
  await configure(e);
  expect((await handleRequest(await request(payload("completed"), d1), e)).status).toBe(201);
  const different = payload("completed");
  different.workflow_job.conclusion = "failure";
  expect((await handleRequest(await request(different, d3), e)).status).toBe(201);
  const history = await store(e).readJob(repo.id, 202, 303);
  expect(history.receipts).toHaveLength(2);
  expect(history.state).toBe("unknown");
  expect(history.conflicts).toContain("conflicting_terminal_evidence");
});
it("refuses malformed jobs without leaking untrusted steps or creating receipts", async () => {
  const e = testEnv();
  await configure(e);
  const bad = payload();
  bad.workflow_job.completed_at = null;
  const invalid = await handleRequest(await request(bad), e);
  expect(invalid.status).toBe(422);
  const history = await store(e).readJob(repo.id, 202, 303);
  expect(history.receipts).toEqual([]);
  expect(JSON.stringify(history)).not.toContain("secret script");
  expect(JSON.stringify(history)).not.toContain("private-test-token");
});
it("preserves sanitized job evidence and forbids an HTTP read endpoint", async () => {
  const e = testEnv();
  await configure(e);
  expect((await handleRequest(await request(), e)).status).toBe(201);
  const history = await store(e).readJob(repo.id, 202, 303);
  const encoded = JSON.stringify(history);
  expect(encoded).not.toContain("untrusted-sender");
  expect(encoded).not.toContain("secret script");
  expect(encoded).not.toContain("private-test-token");
  const read = await handleRequest(new Request("https://homer.example/v1/admin/jobs"), e);
  expect(read.status).toBe(404);
});
it("the durable store rejects invalid direct admissions and immutable row edits", async () => {
  const e = testEnv();
  const obj = store(e);
  expect(
    await obj.admit({
      deliveryId: "invalid",
      payloadSha256: "",
      receivedAt: "",
      observation: {},
    } as never),
  ).toEqual({
    outcome: "refused",
    reason: "invalid_job_evidence",
  });
  await configure(e);
  expect((await handleRequest(await request(), e)).status).toBe(201);
  await runInDurableObject(obj, (_object, state) => {
    expect(() => state.storage.sql.exec("DELETE FROM workflow_job_evidence")).toThrow();
    expect(() =>
      state.storage.sql.exec("UPDATE workflow_job_evidence SET action = 'queued'"),
    ).toThrow();
  });
  expect((await obj.readJob(repo.id, 202, 303)).receipts).toHaveLength(1);
});
