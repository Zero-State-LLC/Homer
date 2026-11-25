import type { ValidateFunction } from "ajv";
import { beforeAll, describe, expect, it } from "vitest";
import {
  admitWorkRequestSource,
  changedPacketFields,
  decideRiskTier,
  derivePain,
  extractDoneWhen,
  finishWorkRequest,
  loadUpstreamWorkPacketSchema,
  prepareWorkRequest,
  readGitHubIssue,
  readLinearIssue,
  readManualRequest,
  readWorkRequestPolicy,
  toWorkPacket,
  validateWorkRequest,
  workRequestId,
  workRequestSlug,
  type IdentityBindingLookup,
  type WorkRequest,
  type WorkRequestPolicy,
  type WorkRequestResult,
  type WorkRequestSource,
} from "../src/index.js";
import { isRecord } from "../src/json.js";
import { loadFixture } from "./fixture.js";

const NOW = new Date("2026-11-24T16:00:00Z");
const NO_BINDINGS: IdentityBindingLookup = () => undefined;
const SURE_LOW = { choice: "low", confidence: 0.95 };

let validatePacket: ValidateFunction;

beforeAll(async () => {
  validatePacket = await compileUpstream(loadUpstreamWorkPacketSchema());
});

describe("Work Request builder: the three source forms", () => {
  it("emits a valid request from a Linear Task", () => {
    const request = emit(linear());
    expect(request).toMatchObject({
      contract: "home.work-request/v1",
      requestId: "WR-2026-11-23-zer-62",
      source: "linear:ZER-62",
      pain: "Homer: emit Work Requests from its sources: Homer needs to emit Work Requests so code pull requests can get a software-factory Verdict. Today nothing emits them.",
      who: "linear:00000000-0000-4000-8000-000000000001",
      doneWhen: [
        "A Linear Task, a GitHub issue and a manual request each produce a valid Work Request.",
        "An invalid source is refused with a clear reason.",
        "A Homer Work Request carries `testCommand` so the reproduce check can run.",
      ],
      repository: "Zero-State-LLC/Homer",
      riskTier: "low",
      budgetUsd: 5,
      requestedBy: { sourceAccount: "agent:claude" },
      requestedAt: "2026-11-24T16:00:00.000Z",
      testCommand: "bash -c 'npm ci --no-audit --no-fund && npm run check'",
      links: ["https://linear.app/example/issue/ZER-62/homer-emit-work-requests-from-its-sources"],
    });
    expectValidPacket(request);
  });

  it("emits a valid request from a GitHub issue, with the source lowercased", () => {
    const request = emit(github());
    expect(request.requestId).toBe("WR-2026-11-20-github-zero-state-llc-homer-issue-59");
    expect(request.source).toBe("github:zero-state-llc/homer#59");
    expect(request.repository).toBe("Zero-State-LLC/Homer");
    expect(request.who).toBe("github:octocat");
    expect(request.doneWhen).toEqual([
      "A Knowledge Flag raised in a Linear comment appears in the next Curator Run's inputs.",
      "A flag with no evidence is reported as needing a human.",
    ]);
    expect(request.links).toEqual(["https://github.com/Zero-State-LLC/Homer/issues/59"]);
    expectValidPacket(request);
  });

  it("emits a valid request from a manual file, with no links", () => {
    const request = emit(manual());
    expect(request.requestId).toBe("WR-2026-11-24-manual-nightly-flags");
    expect(request.source).toBe("manual:nightly-flags");
    expect(request.who).toBe("Danny");
    expect(request.pain).toBe(
      "Knowledge Flags that nobody addressed pile up between Curator Runs.",
    );
    expect(request).not.toHaveProperty("links");
    expectValidPacket(request);
  });
});

describe("Work Request builder: admission", () => {
  it("admits a Done Linear Task, for after-the-fact Verdicts", () => {
    const done = read(readLinearIssue({ ...linearRaw(), state: { type: "completed" } }));
    expect(admitWorkRequestSource(done).ok).toBe(true);
    expectValidPacket(emit(done));
  });

  it.each([
    ["canceled", "source_canceled"],
    ["duplicate", "source_canceled"],
    ["triage", "source_not_ready"],
    ["something-new", "source_not_ready"],
  ])("refuses a Linear Task in state %s as %s", (type, code) => {
    const source = read(readLinearIssue({ ...linearRaw(), state: { type } }));
    expectRefusal(admitWorkRequestSource(source), code);
  });

  it("refuses a GitHub issue closed as completed", () => {
    const source = read(
      readGitHubIssue("github:Zero-State-LLC/Homer#59", {
        ...githubRaw(),
        state: "closed",
        state_reason: "completed",
      }),
    );
    expectRefusal(admitWorkRequestSource(source), "source_closed");
  });

  it("refuses a pull request named as an issue", () => {
    const result = readGitHubIssue("github:Zero-State-LLC/Homer#59", {
      ...githubRaw(),
      pull_request: { url: "https://api.github.com/repos/Zero-State-LLC/Homer/pulls/59" },
    });
    expectRefusal(result, "source_not_found", "number");
  });

  it("refuses a response for another issue or repository", () => {
    expectRefusal(
      readGitHubIssue("github:Zero-State-LLC/Homer#60", githubRaw()),
      "source_not_found",
      "number",
    );
    expectRefusal(
      readGitHubIssue("github:Zero-State-LLC/Other#59", githubRaw()),
      "source_not_found",
      "repository_url",
    );
  });

  it.each([
    [{ identifier: "ENG-5" }, "source_malformed", "identifier"],
    [{ title: "  " }, "source_malformed", "title"],
    [{ creator: null }, "source_malformed", "creator.id"],
    [{ state: "backlog" }, "source_malformed", "state.type"],
    [{ url: "http://linear.app/x" }, "source_malformed", "url"],
    [{ createdAt: "yesterday" }, "source_date_unknown", "createdAt"],
    [{ createdAt: "2026-11-23" }, "source_date_unknown", "createdAt"],
  ])("refuses a malformed Linear issue %o", (patch, code, field) => {
    expectRefusal(readLinearIssue({ ...linearRaw(), ...patch }), code, field);
  });

  it.each([
    [{ date: "2026-02-30" }, "source_date_unknown", "date"],
    [{ doneWhen: "one item" }, "source_malformed", "doneWhen"],
    [{ who: "" }, "source_malformed", "who"],
  ])("refuses a malformed manual file %o", (patch, code, field) => {
    expectRefusal(readManualRequest("nightly-flags", { ...manualRaw(), ...patch }), code, field);
  });

  it("refuses a manual slug outside lowercase letters, digits and hyphens", () => {
    expectRefusal(readManualRequest("Nightly_Flags", manualRaw()), "source_malformed", "slug");
  });

  it("refuses a Linear Task whose Project the policy does not map", () => {
    const other = read(readLinearIssue({ ...linearRaw(), project: { name: "SUAS" } }));
    expectRefusal(prepareWorkRequest(other, policy(), NO_BINDINGS), "source_not_mapped");
    const none = read(readLinearIssue({ ...linearRaw(), project: null }));
    expectRefusal(prepareWorkRequest(none, policy(), NO_BINDINGS), "source_not_mapped");
  });
});

describe("Work Request builder: requestId", () => {
  it.each([
    ["linear:ZER-62", "zer-62"],
    ["github:zero-state-llc/homer#59", "github-zero-state-llc-homer-issue-59"],
    ["manual:nightly-flags", "manual-nightly-flags"],
  ])("encodes %s exactly as %s", (source, slug) => {
    expect(workRequestSlug(source)).toBe(slug);
  });

  it("keeps repositories that differ only in . _ - apart", () => {
    const slugs = ["homer.v2", "homer_v2", "homer-v2"].map((repo) =>
      workRequestSlug(`github:zero-state-llc/${repo}#1`),
    );
    expect(new Set(slugs).size).toBe(3);
    expect(slugs[2]).toBe("github-zero-state-llc-homer-v2-issue-1");
    expect(slugs[0]).toMatch(/^github-zero-state-llc-homer-v2-issue-1-[0-9a-f]{8}$/);
  });

  it("keeps long manual slugs that share 39 characters apart", () => {
    const a = workRequestSlug(`manual:${"a".repeat(60)}`);
    const b = workRequestSlug(`manual:${"a".repeat(60)}b`);
    expect(a).not.toBe(b);
    expect(a).toHaveLength(48);
    expect(b).toHaveLength(48);
  });

  it("always fits the contract's slug pattern", () => {
    const sources = [
      "linear:ZER-1",
      `linear:ZER-${"9".repeat(60)}`,
      "github:zero-state-llc/homer#1",
      `github:zero-state-llc/${"x".repeat(90)}#123456`,
      "github:zero-state-llc/a.b_c#7",
      "manual:x",
      `manual:${"m".repeat(120)}`,
    ];
    for (const source of sources) {
      expect(workRequestSlug(source)).toMatch(/^[a-z0-9-]{1,48}$/);
    }
  });

  it("uses the source's own date in UTC, not the emission date", () => {
    const late = read(readLinearIssue({ ...linearRaw(), createdAt: "2026-11-23T23:59:59.999Z" }));
    expect(workRequestId(late)).toBe("WR-2026-11-23-zer-62");
    expect(emit(late, { now: new Date("2026-11-24T00:00:01Z") }).requestId).toBe(
      "WR-2026-11-23-zer-62",
    );
    const offset = read(
      readLinearIssue({ ...linearRaw(), createdAt: "2026-11-24T01:00:00+02:00" }),
    );
    expect(workRequestId(offset)).toBe("WR-2026-11-23-zer-62");
  });
});

describe("Work Request builder: derived fields", () => {
  it("reads Done when items under any heading level and form", () => {
    const body = [
      "Intro.",
      "",
      "### Done when:",
      "",
      "The receipt shows that:",
      "",
      "- [ ] First item is checked",
      "1. Second item is numbered",
      "* Third item wraps",
      "  onto a second line",
      "- tiny",
      "- First item is checked",
      "",
      "## Context",
      "",
      "- Not a criterion",
    ].join("\n");
    expect(extractDoneWhen(body)).toEqual([
      "First item is checked",
      "Second item is numbered",
      "Third item wraps onto a second line",
    ]);
    expect(extractDoneWhen("#### Observable done\n\n- Works for issue forms")).toEqual([
      "Works for issue forms",
    ]);
    expect(extractDoneWhen("## Done when\n\n- Before notes\n\n>>> Agent notes\n\n- After")).toEqual(
      ["Before notes"],
    );
  });

  it("refuses a source with no Done when items", () => {
    for (const description of ["No criteria at all.", "## Done when\n\nJust prose."]) {
      const source = read(readLinearIssue({ ...linearRaw(), description }));
      expectRefusal(prepareWorkRequest(source, policy(), NO_BINDINGS), "acceptance_missing");
    }
  });

  it("takes pain from the title and the first paragraph only", () => {
    expect(derivePain("Title", "First line\nsecond line.\n\nSecond paragraph.")).toBe(
      "Title: First line second line.",
    );
    expect(derivePain("Title only here", "## Heading first\n\nText.")).toBe("Title only here");
    expect(derivePain("Title", "- a list comes first")).toBe("Title");
    const long = derivePain("Title", "word ".repeat(300));
    expect(long.length).toBeLessThanOrEqual(600);
    expect(long.endsWith("word…")).toBe(true);
  });

  it("refuses a pain shorter than 10 characters", () => {
    const source = read(
      readLinearIssue({
        ...linearRaw(),
        title: "Fix",
        description: "## Done when\n\n- Something works",
      }),
    );
    expectRefusal(prepareWorkRequest(source, policy(), NO_BINDINGS), "source_malformed", "pain");
  });

  it("names who by the creator's Identity Binding, never the assignee", () => {
    const bound: IdentityBindingLookup = (account) =>
      account === "linear:00000000-0000-4000-8000-000000000001"
        ? { actorId: "actor:danny", name: "Danny" }
        : undefined;
    expect(emit(linear(), { bindings: bound }).who).toBe("Danny");
    expect(emit(linear()).who).toBe("linear:00000000-0000-4000-8000-000000000001");
  });

  it("sets requestedBy.actorId only from the requester's Identity Binding", () => {
    const bound: IdentityBindingLookup = (account) =>
      account === "agent:claude" ? { actorId: "actor:claude", name: "Claude" } : undefined;
    expect(emit(linear(), { bindings: bound }).requestedBy).toEqual({
      sourceAccount: "agent:claude",
      actorId: "actor:claude",
    });
    expect(emit(linear()).requestedBy).toEqual({ sourceAccount: "agent:claude" });
    expect(() => emit(linear(), { requester: "claude" })).toThrow(/agent:<name>/);
  });

  it("refuses a secret-shaped string without repeating it", () => {
    const token = ["ghp", "_", "A1b2C3d4".repeat(5)].join("");
    const source = read(
      readLinearIssue({
        ...linearRaw(),
        description: `${linearRaw().description}\n\nkey ${token}`,
      }),
    );
    const result = prepareWorkRequest(source, policy(), NO_BINDINGS);
    expectRefusal(result, "secret_in_source", "body");
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("does not mistake ordinary words for secrets", () => {
    const description = [
      linearRaw().description,
      "",
      "desk-reservation-system-redesign-flow and devops_" + "x".repeat(45),
    ].join("\n");
    const source = read(readLinearIssue({ ...linearRaw(), description }));
    expect(prepareWorkRequest(source, policy(), NO_BINDINGS).ok).toBe(true);
  });
});

describe("Work Request builder: policy", () => {
  it("reads Homer's policy", () => {
    const result = readWorkRequestPolicy(loadFixture("work-requests/policy.json"));
    expect(result.ok).toBe(true);
  });

  it.each([
    ["schemaVersion", { schemaVersion: 2 }],
    ["missing riskDecider", { riskDecider: undefined }],
    ["minConfidence 0", { riskDecider: { model: "typesafe/jev", minConfidence: 0 } }],
    ["no repositories", { repositories: {} }],
    ["budget 0", repoPatch({ budgetUsd: 0 })],
    ["budget 600", repoPatch({ budgetUsd: 600 })],
    ["unwrapped testCommand", repoPatch({ testCommand: "npm test" })],
    ["unknown riskFloor", repoPatch({ riskFloor: "none" })],
    ["repository outside Zero-State-LLC", { repositories: { "Other/x": repoEntry() } }],
    ["Project to an unlisted repository", { linearProjects: { Homer: "Zero-State-LLC/Other" } }],
  ])("refuses a policy with %s", (_name, patch) => {
    expectRefusal(readWorkRequestPolicy({ ...policyRaw(), ...patch }), "policy_invalid");
  });
});

describe("Work Request builder: risk tier", () => {
  const risk = { floor: "low", model: "typesafe/jev", minConfidence: 0.8, state: "" } as const;

  it.each([
    [{ choice: "high", confidence: 0.9 }, "high"],
    [{ choice: "low", confidence: 0.6 }, "medium"],
    [{ choice: "medium", confidence: 0.5 }, "high"],
    [{ choice: "high", confidence: 0.1 }, "high"],
    [{ choice: "low", confidence: 0.8 }, "low"],
  ])("turns %o into %s", (answer, tier) => {
    const decision = read(decideRiskTier(answer, risk));
    expect(decision.tier).toBe(tier);
    expect(decision.choice).toBe(answer.choice);
  });

  it("never goes below the floor", () => {
    expect(read(decideRiskTier(SURE_LOW, { ...risk, floor: "medium" })).tier).toBe("medium");
  });

  it.each([
    [undefined],
    [{ choice: "critical", confidence: 0.9 }],
    [{ choice: "low", confidence: 1.5 }],
    [{ choice: "low" }],
  ])("refuses an unusable answer %o", (answer) => {
    expectRefusal(decideRiskTier(answer, risk), "risk_unavailable");
  });

  it("keeps numeric probabilities and drops anything else", () => {
    const withProbabilities = read(
      decideRiskTier({ ...SURE_LOW, probabilities: { low: 0.95, medium: 0.04, high: 0.01 } }, risk),
    );
    expect(withProbabilities.probabilities).toEqual({ low: 0.95, medium: 0.04, high: 0.01 });
    const garbled = read(decideRiskTier({ ...SURE_LOW, probabilities: { low: "most" } }, risk));
    expect(garbled).not.toHaveProperty("probabilities");
  });

  it("gives Jev the title and the body", () => {
    const prepared = read(prepareWorkRequest(linear(), policy(), NO_BINDINGS));
    expect(prepared.risk.state.startsWith("Homer: emit Work Requests from its sources\n\n")).toBe(
      true,
    );
    expect(prepared.risk.state).toContain("## Done when");
  });
});

describe("Work Request builder: retries compare packets", () => {
  it("sees no change when another Agent retries at another time", () => {
    const first = emit(linear());
    const retry = emit(linear(), {
      requester: "agent:hermes",
      now: new Date("2026-11-30T09:00:00Z"),
    });
    expect(retry.requestedBy).not.toEqual(first.requestedBy);
    expect(changedPacketFields(packetOf(first), packetOf(retry))).toEqual([]);
  });

  it("names done_when when the source's criteria were edited", () => {
    const first = emit(linear());
    const description = linearRaw().description.replace(
      "An invalid source is refused with a clear reason.",
      "An invalid source is refused with a reason code.",
    );
    const edited = emit(read(readLinearIssue({ ...linearRaw(), description })));
    expect(changedPacketFields(packetOf(first), packetOf(edited))).toEqual(["done_when"]);
  });
});

interface EmitOptions {
  bindings?: IdentityBindingLookup;
  requester?: string;
  now?: Date;
  jev?: unknown;
}

function emit(source: WorkRequestSource, options: EmitOptions = {}): WorkRequest {
  const bindings = options.bindings ?? NO_BINDINGS;
  const admitted = read(admitWorkRequestSource(source));
  const prepared = read(prepareWorkRequest(admitted, policy(), bindings));
  const decision = read(decideRiskTier(options.jev ?? SURE_LOW, prepared.risk));
  return finishWorkRequest(
    prepared,
    decision,
    options.requester ?? "agent:claude",
    bindings,
    options.now ?? NOW,
  );
}

function expectValidPacket(request: WorkRequest): void {
  const checked = validateWorkRequest(request);
  if (!checked.ok) {
    expect.fail(checked.errors.join("\n"));
  }
  const packet = toWorkPacket(checked.value, NOW);
  expect(validatePacket(packet), JSON.stringify(validatePacket.errors ?? [])).toBe(true);
}

function packetOf(request: WorkRequest): object {
  return toWorkPacket(request, NOW);
}

function read<T>(result: WorkRequestResult<T>): T {
  if (!result.ok) {
    expect.fail(`${result.code} at ${result.field}: ${result.detail}`);
  }
  return result.value;
}

function expectRefusal(result: WorkRequestResult<unknown>, code: string, field?: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe(code);
    if (field !== undefined) {
      expect(result.field).toBe(field);
    }
  }
}

function linearRaw(): Record<string, unknown> & { description: string } {
  const raw = loadFixture("work-requests/linear-issue.json");
  if (!isRecord(raw) || typeof raw["description"] !== "string") {
    throw new Error("linear-issue.json must hold a description");
  }
  return { ...raw, description: raw["description"] };
}

function githubRaw(): Record<string, unknown> {
  const raw = loadFixture("work-requests/github-issue.json");
  if (!isRecord(raw)) {
    throw new Error("github-issue.json must be an object");
  }
  return raw;
}

function manualRaw(): Record<string, unknown> {
  const raw = loadFixture("work-requests/manual-request.json");
  if (!isRecord(raw)) {
    throw new Error("manual-request.json must be an object");
  }
  return raw;
}

function policyRaw(): Record<string, unknown> {
  const raw = loadFixture("work-requests/policy.json");
  if (!isRecord(raw)) {
    throw new Error("policy.json must be an object");
  }
  return raw;
}

function repoEntry(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    riskFloor: "low",
    budgetUsd: 5,
    testCommand: "bash -c 'npm ci --no-audit --no-fund && npm run check'",
    ...patch,
  };
}

function repoPatch(patch: Record<string, unknown>): Record<string, unknown> {
  return { repositories: { "Zero-State-LLC/Homer": repoEntry(patch) } };
}

function policy(): WorkRequestPolicy {
  return read(readWorkRequestPolicy(policyRaw()));
}

function linear(): WorkRequestSource {
  return read(readLinearIssue(linearRaw()));
}

function github(): WorkRequestSource {
  return read(readGitHubIssue("github:Zero-State-LLC/Homer#59", githubRaw()));
}

function manual(): WorkRequestSource {
  return read(readManualRequest("nightly-flags", manualRaw()));
}

async function compileUpstream(schema: object): Promise<ValidateFunction> {
  const id = isRecord(schema) && typeof schema["$schema"] === "string" ? schema["$schema"] : "";
  if (id.includes("/2020-12/")) {
    const { Ajv2020 } = await import("ajv/dist/2020.js");
    return new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  }
  if (id.includes("/2019-09/")) {
    const { Ajv2019 } = await import("ajv/dist/2019.js");
    return new Ajv2019({ allErrors: true, strict: true }).compile(schema);
  }
  const { Ajv } = await import("ajv");
  return new Ajv({ allErrors: true, strict: true }).compile(schema);
}
