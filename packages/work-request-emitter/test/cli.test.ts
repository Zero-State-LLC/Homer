import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JevFetch } from "@zs-home/shared-contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli, type CliHost, type Runner } from "../src/index.js";
import { contractsFixture, repositoryRoot } from "./fixtures.js";

// Built at run time so no credential-shaped literal sits in the tree.
const LINEAR_KEY = ["linear", "test", "key"].join("-");
const CLOUDFLARE_TOKEN = ["cloudflare", "test", "token"].join("-");
const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";

const linearIssue: unknown = JSON.parse(
  readFileSync(contractsFixture("work-requests/linear-issue.json"), "utf8"),
);
const githubIssue: unknown = JSON.parse(
  readFileSync(contractsFixture("work-requests/github-issue.json"), "utf8"),
);
const manualRequest = readFileSync(contractsFixture("work-requests/manual-request.json"), "utf8");
const homerPolicy = readFileSync(join(repositoryRoot, "docs/work-requests/policy.json"), "utf8");
const MANUAL = "docs/work-requests/nightly-flags.json";
const POLICY = "docs/work-requests/policy.json";
const jevOutput = {
  model: "jev-1.13.0",
  answers: {
    risk_tier: { type: "choice", choice: "low", confidence: 0.97, probabilities: { low: 0.97 } },
  },
  usage: { input_tokens: 400, output_tokens: 0 },
};

let store: string;
let calls: { url: string; authorization: string | undefined }[];
let linearStatus: number;
let runs: string[][];
/** What `git show <ref>:<path>` answers, keyed by `<ref>:<path>`. */
let committed: Map<string, string>;

beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "work-request-cli-"));
  calls = [];
  linearStatus = 200;
  runs = [];
  committed = new Map([
    [`origin/main:${POLICY}`, homerPolicy],
    [`origin/main:${MANUAL}`, manualRequest],
  ]);
});

afterEach(async () => {
  await rm(store, { recursive: true, force: true });
});

describe("work-request CLI", () => {
  it("emits a Linear Task, then prints the same bytes on a retry without asking Jev", async () => {
    const first = await cli(["linear:ZER-62"]);
    expect(first.code).toBe(0);
    expect(first.stderr).toContain("emitted WR-2026-11-23-zer-62");
    expect(JSON.parse(first.stdout)).toMatchObject({
      requestId: "WR-2026-11-23-zer-62",
      riskTier: "low",
    });
    expect(calls.filter((call) => call.url.includes("cloudflare"))).toHaveLength(1);

    const retry = await cli(["linear:ZER-62"]);
    expect(retry.code).toBe(0);
    expect(retry.stdout).toBe(first.stdout);
    expect(retry.stderr).toContain("duplicate WR-2026-11-23-zer-62");
    expect(calls.filter((call) => call.url.includes("cloudflare"))).toHaveLength(1);
  });

  it("emits a GitHub issue read through gh", async () => {
    const result = await cli(["github:Zero-State-LLC/Homer#59"]);
    expect(result.code).toBe(0);
    expect(runs).toContainEqual(["gh", "api", "repos/Zero-State-LLC/Homer/issues/59"]);
    expect(JSON.parse(result.stdout)).toMatchObject({ source: "github:zero-state-llc/homer#59" });
  });

  it("reads credentials by 1Password reference and never prints them", async () => {
    const result = await cli(["linear:ZER-62"], {
      HOMER_LINEAR_API_KEY: undefined,
      HOMER_LINEAR_API_KEY_REF: "op://homer/linear/credential",
    });
    expect(result.code).toBe(0);
    expect(runs).toContainEqual(["op", "read", "op://homer/linear/credential"]);
    expect(calls.find((call) => call.url.includes("linear"))?.authorization).toBe(LINEAR_KEY);
    expectNoCredential(result);
  });

  it("stops with exit 2 before reading anything when the store is missing", async () => {
    const result = await cli(["linear:ZER-62"], {
      HOMER_WORK_REQUEST_STORE: join(store, "missing"),
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/store is unavailable/);
    expect(calls).toEqual([]);
  });

  it("names a failing Linear read without the key", async () => {
    linearStatus = 401;
    const result = await cli(["linear:ZER-62"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Linear could not be read: HTTP 401.");
    expectNoCredential(result);
    expect(await readdir(store)).toEqual([]);
  });

  it("records nothing when Jev's credentials are missing", async () => {
    const result = await cli(["linear:ZER-62"], { HOMER_CLOUDFLARE_API_TOKEN: undefined });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("HOMER_CLOUDFLARE_API_TOKEN is not configured");
    expect(await readdir(store)).toEqual([]);
  });

  it("refuses with exit 1 and the reason code", async () => {
    const result = await cli(["manual:no-such-request"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("refused: source_not_found");
    expect(result.stderr).toContain(
      "docs/work-requests/no-such-request.json is not on origin/main",
    );
  });

  it("reads a manual request from origin/main, not the working tree", async () => {
    const result = await cli(["manual:nightly-flags"]);
    expect(result.code).toBe(0);
    expect(runs).toContainEqual(["git", "-C", repositoryRoot, "show", `origin/main:${MANUAL}`]);
    expect(JSON.parse(result.stdout)).toMatchObject({
      requestId: "WR-2026-11-24-manual-nightly-flags",
      source: "manual:nightly-flags",
    });
  });

  it("refuses a manual file that exists only in the working tree", async () => {
    committed.delete(`origin/main:${MANUAL}`);
    const checkout = join(store, "checkout");
    await mkdir(join(checkout, "docs", "work-requests"), { recursive: true });
    await writeFile(join(checkout, MANUAL), manualRequest);
    const result = await cli(["manual:nightly-flags", "--repo", checkout]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("refused: source_not_found");
    expect(runs).toContainEqual(["git", "-C", checkout, "show", `origin/main:${MANUAL}`]);
    expect((await readdir(store)).filter((name) => name.startsWith("WR-"))).toEqual([]);
  });

  it("reads the policy and the manual request from the ref --ref names", async () => {
    committed = new Map([
      [`upstream/main:${POLICY}`, homerPolicy],
      [`upstream/main:${MANUAL}`, manualRequest],
    ]);
    const result = await cli(["manual:nightly-flags", "--ref", "upstream/main"]);
    expect(result.code).toBe(0);
    expect(runs.filter(([command]) => command === "git").map((run) => run.at(-1))).toEqual([
      `upstream/main:${POLICY}`,
      `upstream/main:${MANUAL}`,
    ]);
  });

  it("uses the committed policy, not the working tree's", async () => {
    const committedPolicy = JSON.parse(homerPolicy) as {
      repositories: Record<string, { budgetUsd: number }>;
    };
    const homer = committedPolicy.repositories["Zero-State-LLC/Homer"];
    if (homer === undefined) throw new Error("Homer's policy names no Homer entry");
    homer.budgetUsd = 7;
    committed.set(`origin/main:${POLICY}`, JSON.stringify(committedPolicy));
    const result = await cli(["linear:ZER-62"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ budgetUsd: 7 });
  });

  it("refuses every source when the ref has no policy", async () => {
    committed.delete(`origin/main:${POLICY}`);
    const result = await cli(["linear:ZER-62"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("refused: policy_invalid");
    expect(calls).toEqual([]);
  });

  it.each(["-c", "main..topic", "main@{1}", "HEAD:docs"])(
    "refuses %s as the reviewed ref without running git",
    async (ref) => {
      const result = await cli(["manual:nightly-flags", "--ref", ref]);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("is not a plain branch name");
      expect(runs.filter(([command]) => command === "git")).toEqual([]);
    },
  );

  it("stops with exit 2 and a fetch hint when the checkout lacks the ref", async () => {
    const result = await cli(["manual:nightly-flags", "--ref", "upstream/main"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("fetch upstream/main first");
  });

  it("names npm --silent in its usage, so stdout stays JSON", async () => {
    const result = await cli([]);
    expect(result.stderr).toMatch(/^usage: npm --silent run work-request -- /);
  });

  it.each([
    [[]],
    [["linear:ZER-62", "linear:ZER-63"]],
    [["linear:ZER-62", "--store"]],
    [["--unknown", "x", "linear:ZER-62"]],
  ])("prints usage for %o", async (argv) => {
    const result = await cli(argv);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/^usage:/);
  });

  it("needs the requester to be an Agent", async () => {
    const result = await cli(["linear:ZER-62"], { HOMER_WORK_REQUEST_REQUESTER: "danny" });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("agent:<name>");
  });
});

async function cli(
  argv: readonly string[],
  env: Record<string, string | undefined> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const host: CliHost = {
    env: {
      HOME: store,
      HOMER_WORK_REQUEST_STORE: store,
      HOMER_WORK_REQUEST_REQUESTER: "agent:claude",
      HOMER_LINEAR_API_KEY: LINEAR_KEY,
      HOMER_CLOUDFLARE_API_TOKEN: CLOUDFLARE_TOKEN,
      HOMER_CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
      ...env,
    },
    fetch: stubFetch,
    run: stubRun,
    now: () => new Date("2026-11-24T16:00:00Z"),
    cwd: repositoryRoot,
  };
  const code = await runCli(argv, host, {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  return { code, stdout, stderr };
}

const stubFetch: JevFetch = (url, init) => {
  calls.push({ url, authorization: init.headers["Authorization"] });
  if (url.startsWith("https://api.linear.app/")) {
    return Promise.resolve(reply(linearStatus, { data: { issue: linearIssue } }));
  }
  return Promise.resolve(reply(200, { success: true, result: jevOutput }));
};

const stubRun: Runner = (command, args) => {
  runs.push([command, ...args]);
  if (command === "op") {
    return Promise.resolve({ code: 0, stdout: `${LINEAR_KEY}\n`, stderr: "" });
  }
  if (command === "gh") {
    return Promise.resolve({ code: 0, stdout: JSON.stringify(githubIssue), stderr: "" });
  }
  if (command === "git") {
    // git -C <root> show <ref>:<path>, answered the way git words its errors.
    const spec = args.at(-1) ?? "";
    const [ref = "", path = ""] = spec.split(/:(.*)/s);
    const file = committed.get(spec);
    if (file !== undefined) return Promise.resolve({ code: 0, stdout: file, stderr: "" });
    const known =
      [...committed.keys()].some((key) => key.startsWith(`${ref}:`)) || ref === "origin/main";
    return Promise.resolve({
      code: 128,
      stdout: "",
      stderr: known
        ? `fatal: path '${path}' does not exist in '${ref}'\n`
        : `fatal: invalid object name '${ref}'.\n`,
    });
  }
  return Promise.resolve({ code: 127, stdout: "", stderr: "not found" });
};

function reply(status: number, body: unknown): Awaited<ReturnType<JevFetch>> {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

function expectNoCredential(result: { stdout: string; stderr: string }): void {
  for (const secret of [LINEAR_KEY, CLOUDFLARE_TOKEN, ACCOUNT_ID]) {
    expect(result.stdout).not.toContain(secret);
    expect(result.stderr).not.toContain(secret);
  }
}
