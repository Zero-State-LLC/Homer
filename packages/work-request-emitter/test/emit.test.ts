import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readLinearIssue,
  readWorkRequestPolicy,
  validateWorkRequest,
  type JevChoiceAnswer,
  type WorkRequestPolicy,
  type WorkRequestResult,
} from "@zs-home/shared-contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emitWorkRequest, RequestStore, type EmitDependencies } from "../src/index.js";
import { contractsFixture } from "./fixtures.js";

const ID = "WR-2026-11-23-zer-62";
let directory: string;
let raw: Record<string, unknown> & { description: string };
let jevCalls: number;
let jevAnswer: WorkRequestResult<JevChoiceAnswer>;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "work-request-emit-"));
  raw = linearRaw();
  jevCalls = 0;
  jevAnswer = {
    ok: true,
    value: { choice: "medium", confidence: 0.9, modelVersion: "jev-1.13.0" },
  };
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("Work Request emitter", () => {
  it("records a new request with Jev's decision and prints the recorded bytes", async () => {
    const outcome = await emitWorkRequest("linear:ZER-62", await deps());
    expect(outcome).toMatchObject({ ok: true, kind: "emitted", requestId: ID, warnings: [] });
    if (!outcome.ok) return;
    expect(jevCalls).toBe(1);
    expect(outcome.json).toBe(await readFile(join(directory, `${ID}.json`), "utf8"));
    const request: unknown = JSON.parse(outcome.json);
    const checked = validateWorkRequest(request);
    expect(checked.ok).toBe(true);
    expect(request).toMatchObject({
      riskTier: "medium",
      requestedBy: { sourceAccount: "agent:claude" },
    });
    const risk: unknown = JSON.parse(await readFile(join(directory, `${ID}.risk.json`), "utf8"));
    expect(risk).toMatchObject({
      requestId: ID,
      model: "typesafe/jev",
      modelVersion: "jev-1.13.0",
      choice: "medium",
      tier: "medium",
      decidedAt: "2026-11-24T16:00:00.000Z",
    });
  });

  it("prints the recorded request byte for byte on a retry, without asking Jev", async () => {
    const first = await emitWorkRequest("linear:ZER-62", await deps());
    const retry = await emitWorkRequest(
      "linear:ZER-62",
      await deps({ requester: "agent:hermes", now: () => new Date("2026-12-01T09:00:00Z") }),
    );
    expect(retry).toMatchObject({ ok: true, kind: "duplicate", warnings: [] });
    if (!first.ok || !retry.ok) return;
    expect(retry.json).toBe(first.json);
    expect(jevCalls).toBe(1);
  });

  it("keeps the recorded request and warns when the criteria were edited", async () => {
    const first = await emitWorkRequest("linear:ZER-62", await deps());
    raw = {
      ...raw,
      description: raw.description.replace("with a clear reason", "with a reason code"),
    };
    const retry = await emitWorkRequest("linear:ZER-62", await deps());
    if (!first.ok || !retry.ok) return expect.fail("both emissions should succeed");
    expect(retry.json).toBe(first.json);
    expect(retry.warnings).toEqual([
      "source_changed: done_when differ from the source now; the recorded request stands.",
    ]);
  });

  it("keeps the recorded request when the edited source no longer derives at all", async () => {
    await emitWorkRequest("linear:ZER-62", await deps());
    raw = { ...raw, description: "The criteria were deleted." };
    const retry = await emitWorkRequest("linear:ZER-62", await deps());
    expect(retry).toMatchObject({ ok: true, kind: "duplicate" });
    if (!retry.ok) return;
    expect(retry.warnings[0]).toMatch(/^source_changed: .*acceptance_missing at doneWhen/);
    expect(jevCalls).toBe(1);
  });

  it("refuses a Task canceled after its request was recorded, and keeps the record", async () => {
    const first = await emitWorkRequest("linear:ZER-62", await deps());
    raw = { ...raw, state: { type: "canceled" } };
    const retry = await emitWorkRequest("linear:ZER-62", await deps());
    expect(retry).toMatchObject({ ok: false, code: "source_canceled" });
    if (!first.ok) return;
    expect(await readFile(join(directory, `${ID}.json`), "utf8")).toBe(first.json);
  });

  it("refuses an id recorded for a different source", async () => {
    const other = JSON.parse(
      await readFile(contractsFixture("valid/work-request.json"), "utf8"),
    ) as Record<string, unknown>;
    await writeFile(
      join(directory, `${ID}.json`),
      `${JSON.stringify({ ...other, requestId: ID, source: "manual:zer-62" })}\n`,
    );
    const outcome = await emitWorkRequest("linear:ZER-62", await deps());
    expect(outcome).toMatchObject({ ok: false, code: "id_collision" });
    if (outcome.ok) return;
    expect(outcome.detail).toContain("manual:zer-62");
    expect(outcome.detail).toContain("linear:ZER-62");
  });

  it("records nothing when Jev cannot answer", async () => {
    jevAnswer = { ok: false, code: "risk_unavailable", field: "request", detail: "down" };
    const outcome = await emitWorkRequest("linear:ZER-62", await deps());
    expect(outcome).toMatchObject({ ok: false, code: "risk_unavailable" });
    expect(await readdir(directory)).toEqual([]);
  });

  it("asks Jev nothing for a source the builder refuses", async () => {
    raw = { ...raw, description: "No criteria here." };
    const outcome = await emitWorkRequest("linear:ZER-62", await deps());
    expect(outcome).toMatchObject({ ok: false, code: "acceptance_missing" });
    expect(jevCalls).toBe(0);
  });
});

async function deps(overrides: Partial<EmitDependencies> = {}): Promise<EmitDependencies> {
  return {
    readSource: () => Promise.resolve(readLinearIssue(raw)),
    askJev: () => {
      jevCalls += 1;
      return Promise.resolve(jevAnswer);
    },
    store: await RequestStore.open(directory),
    policy: policy(),
    bindings: () => undefined,
    requester: "agent:claude",
    now: () => new Date("2026-11-24T16:00:00Z"),
    ...overrides,
  };
}

function linearRaw(): Record<string, unknown> & { description: string } {
  const value: unknown = JSON.parse(
    readFileSync(contractsFixture("work-requests/linear-issue.json"), "utf8"),
  );
  const record = value as Record<string, unknown>;
  if (typeof record["description"] !== "string") throw new Error("fixture needs a description");
  return { ...record, description: record["description"] };
}

function policy(): WorkRequestPolicy {
  const result = readWorkRequestPolicy(
    JSON.parse(readFileSync(contractsFixture("work-requests/policy.json"), "utf8")) as unknown,
  );
  if (!result.ok) throw new Error(result.detail);
  return result.value;
}
