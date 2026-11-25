import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RISK_TIER_QUESTION,
  admitWorkRequestSource,
  askJevForRiskTier,
  decideRiskTier,
  jevRiskRequest,
  prepareWorkRequest,
  readJevRiskAnswer,
  readLinearIssue,
  readWorkRequestPolicy,
  type JevFetch,
  type WorkRequestResult,
} from "../src/index.js";
import { loadFixture } from "./fixture.js";

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
// Built at run time so no token-shaped literal sits in the tree.
const API_TOKEN = ["test", "token", "not", "real"].join("-");
const policyPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/work-requests/policy.json",
);

const JEV_OUTPUT = {
  model: "jev-1.13.0",
  answers: {
    risk_tier: {
      type: "choice",
      choice: "high",
      confidence: 0.91,
      probabilities: { low: 0.02, medium: 0.07, high: 0.91 },
    },
  },
  usage: { input_tokens: 412, output_tokens: 0 },
};

describe("Homer's Work Request policy", () => {
  it("is the file Danny decided: Project Homer, floor low, 5 USD, Jev at 0.8", () => {
    const raw: unknown = JSON.parse(readFileSync(policyPath, "utf8"));
    const result = readWorkRequestPolicy(raw);
    if (!result.ok) {
      expect.fail(`${result.code} at ${result.field}`);
    }
    expect(result.value.linearProjects).toEqual({ Homer: "Zero-State-LLC/Homer" });
    expect(result.value.riskDecider).toEqual({ model: "typesafe/jev", minConfidence: 0.8 });
    expect(result.value.repositories["Zero-State-LLC/Homer"]).toEqual({
      riskFloor: "low",
      budgetUsd: 5,
      testCommand: "bash -c 'npm ci --no-audit --no-fund && npm run check'",
    });
  });
});

describe("Jev risk-tier client", () => {
  it("sends one choice question to Workers AI with the token only in the header", async () => {
    const calls: { url: string; init: Parameters<JevFetch>[1] }[] = [];
    const fetch: JevFetch = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(reply(200, JEV_OUTPUT));
    };
    const result = await askJevForRiskTier(options(fetch, "Task text"));
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run`);
    expect(call?.init.method).toBe("POST");
    expect(call?.init.headers["Authorization"]).toBe(`Bearer ${API_TOKEN}`);
    expect(call?.init.body).not.toContain(API_TOKEN);
    const sent: unknown = JSON.parse(call?.init.body ?? "");
    expect(sent).toEqual({
      model: "typesafe/jev",
      input: {
        state: "Task text",
        questions: {
          risk_tier: {
            type: "choice",
            instructions: RISK_TIER_QUESTION.instructions,
            criteria: RISK_TIER_QUESTION.criteria,
          },
        },
      },
    });
  });

  it("asks with the three tiers as the options, high in the upstream schema's words", () => {
    const { body } = jevRiskRequest(ACCOUNT_ID, "typesafe/jev", "x");
    const parsed: unknown = JSON.parse(body);
    expect(parsed).toMatchObject({
      input: {
        questions: {
          risk_tier: {
            criteria: { high: "Touches auth, money, secrets, data deletion, or prod infra." },
          },
        },
      },
    });
    expect(Object.keys(RISK_TIER_QUESTION.criteria)).toEqual(["low", "medium", "high"]);
  });

  it("reads Jev's output bare or in Cloudflare's envelope, with the version that answered", () => {
    const expected = {
      choice: "high",
      confidence: 0.91,
      probabilities: { low: 0.02, medium: 0.07, high: 0.91 },
      modelVersion: "jev-1.13.0",
    };
    expect(read(readJevRiskAnswer(JEV_OUTPUT))).toEqual(expected);
    expect(read(readJevRiskAnswer({ success: true, result: JEV_OUTPUT }))).toEqual(expected);
  });

  it.each([
    ["a failed envelope", { success: false, errors: [{ code: 5000 }] }],
    ["no answers", { model: "jev-1.13.0", usage: {} }],
    ["a noul answer", { answers: { risk_tier: { type: "noul", noul: 0.4 } } }],
    ["no confidence", { answers: { risk_tier: { type: "choice", choice: "low" } } }],
    ["a string", "high"],
  ])("refuses %s as risk_unavailable", (_name, payload) => {
    expectUnavailable(readJevRiskAnswer(payload));
  });

  it("refuses an HTTP error without echoing the body, the URL or the token", async () => {
    const body = { errors: [{ message: `bad token ${API_TOKEN} for ${ACCOUNT_ID}` }] };
    const result = await askJevForRiskTier(options(() => Promise.resolve(reply(403, body)), "x"));
    expectUnavailable(result, "response");
    expectNoCredential(result);
    if (!result.ok) {
      expect(result.detail).toBe("Jev returned HTTP 403.");
    }
  });

  it("refuses a thrown fetch without passing on its message", async () => {
    const fetch: JevFetch = (url) =>
      Promise.reject(new Error(`connect failed for ${url} with ${API_TOKEN}`));
    const result = await askJevForRiskTier(options(fetch, "x"));
    expectUnavailable(result, "request");
    expectNoCredential(result);
  });

  it("gives up after its timeout", async () => {
    const fetch: JevFetch = (_url, init) =>
      new Promise<Awaited<ReturnType<JevFetch>>>((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });
    const result = await askJevForRiskTier({ ...options(fetch, "x"), timeoutMs: 20 });
    expectUnavailable(result, "request");
  });

  it("refuses malformed credentials before any call, without repeating them", async () => {
    let called = false;
    const fetch: JevFetch = () => {
      called = true;
      return Promise.resolve(reply(200, JEV_OUTPUT));
    };
    for (const patch of [{ accountId: "not-an-account" }, { apiToken: "  " }]) {
      const result = await askJevForRiskTier({ ...options(fetch, "x"), ...patch });
      expectUnavailable(result, "credentials");
      expect(JSON.stringify(result)).not.toContain("not-an-account");
    }
    expect(called).toBe(false);
  });

  it("feeds decideRiskTier end to end, keeping Jev's version", async () => {
    const policy = read(readWorkRequestPolicy(loadFixture("work-requests/policy.json")));
    const source = read(
      admitWorkRequestSource(read(readLinearIssue(loadFixture("work-requests/linear-issue.json")))),
    );
    const prepared = read(prepareWorkRequest(source, policy, () => undefined));
    const answer = read(
      await askJevForRiskTier(
        options(() => Promise.resolve(reply(200, JEV_OUTPUT)), prepared.risk.state),
      ),
    );
    const decision = read(decideRiskTier(answer, prepared.risk));
    expect(decision).toMatchObject({
      model: "typesafe/jev",
      modelVersion: "jev-1.13.0",
      choice: "high",
      tier: "high",
      floor: "low",
    });
  });
});

function options(fetch: JevFetch, state: string) {
  return { fetch, accountId: ACCOUNT_ID, apiToken: API_TOKEN, model: "typesafe/jev", state };
}

function reply(status: number, body: unknown): Awaited<ReturnType<JevFetch>> {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

function read<T>(result: WorkRequestResult<T>): T {
  if (!result.ok) {
    expect.fail(`${result.code} at ${result.field}: ${result.detail}`);
  }
  return result.value;
}

function expectUnavailable(result: WorkRequestResult<unknown>, field?: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe("risk_unavailable");
    if (field !== undefined) {
      expect(result.field).toBe(field);
    }
  }
}

function expectNoCredential(result: WorkRequestResult<unknown>): void {
  const text = JSON.stringify(result);
  expect(text).not.toContain(API_TOKEN);
  expect(text).not.toContain(ACCOUNT_ID);
}
