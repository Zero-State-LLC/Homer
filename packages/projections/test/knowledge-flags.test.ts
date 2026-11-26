import { expect, it } from "vitest";
import { validateActivityEvent, type ActivityEvent } from "@zs-home/shared-contracts";
import { DEFAULT_STUCK_THRESHOLD, projectOpenKnowledgeFlags } from "../src/index.js";

const REPOSITORY = "Zero-State-LLC/Homer";
const FLAG_KEY = "software-factory:knowledge.flagged:WP-2026-11-18-home:a1b2c3d";
const GITHUB_FLAG_KEY = "github:knowledge.flagged:Zero-State-LLC/Homer#60";
const OTHER_FLAG_KEY = "github:knowledge.flagged:Zero-State-LLC/Homer#61";
const VERDICT_KEY = "software-factory:factory.verdict_recorded:WP-2026-11-18-home";
const PR_URL = "https://github.com/Zero-State-LLC/Homer/pull/61";
const TRACE = {
  provider: "langfuse",
  traceId: "judge-2026-11-18.7",
  url: "https://langfuse.example.test/trace/judge-2026-11-18.7",
} as const;

type FlagSource = "buzz" | "github" | "linear" | "software-factory";

function baseEvent(
  eventKey: string,
  kind: ActivityEvent["kind"],
  sourceSystem: ActivityEvent["provenance"]["sourceSystem"],
): ActivityEvent {
  return {
    contract: "home.activity-event/v4",
    eventKey,
    kind,
    occurredAt: "2026-11-24T10:00:00Z",
    actor: { sourceAccount: "github:example-dev" },
    subject: "Synthetic event",
    provenance: {
      sourceSystem,
      sourceObjectId: "synthetic-object",
      sourceUrl: "https://example.test/synthetic-object",
      collector: "test-collector",
      collectorVersion: "0.0.0",
      collectedAt: "2026-11-24T10:00:01Z",
    },
  };
}

function knowledgeFlag(
  eventKey: string,
  options: { sourceSystem?: FlagSource; data?: Record<string, unknown> } = {},
): ActivityEvent {
  const sourceSystem = options.sourceSystem ?? "github";
  const event = baseEvent(eventKey, "knowledge.flagged", sourceSystem);
  return {
    ...event,
    subject: sourceSystem === "buzz" ? "Buzz knowledge flag" : "Synthetic knowledge flag",
    repository: REPOSITORY,
    ...(options.data === undefined ? {} : { data: options.data }),
  };
}

function verdict(data: Record<string, unknown>): ActivityEvent {
  const event = baseEvent(VERDICT_KEY, "factory.verdict_recorded", "software-factory");
  return {
    ...event,
    subject: "Verdict recorded for the contracts packet",
    repository: REPOSITORY,
    provenance: { ...event.provenance, sourceObjectId: "WP-2026-11-18-home" },
    data,
  };
}

function mergedPullRequest(url: string): ActivityEvent {
  const event = baseEvent(
    "github:pull_request.merged:Zero-State-LLC/Homer#61",
    "pull_request.merged",
    "github",
  );
  return {
    ...event,
    occurredAt: "2026-11-24T11:00:00Z",
    subject: "Pull request merged",
    repository: REPOSITORY,
    provenance: { ...event.provenance, sourceObjectId: "Zero-State-LLC/Homer#61", sourceUrl: url },
  };
}

function curatorRun(options: {
  eventKey: string;
  occurredAt: string;
  addressedFlags?: readonly string[];
  needsHuman?: readonly { readonly flag: string; readonly result: "unclear" | "conflict" }[];
  evidence?: readonly { readonly label: string; readonly url: string }[];
}): ActivityEvent {
  const event = baseEvent(options.eventKey, "curator.run_completed", "homer");
  return {
    ...event,
    occurredAt: options.occurredAt,
    subject: "Curator run opened a pull request",
    repository: REPOSITORY,
    data: {
      addressedFlags: [...(options.addressedFlags ?? [])],
      ...(options.needsHuman === undefined ? {} : { needsHuman: [...options.needsHuman] }),
    },
    ...(options.evidence === undefined ? {} : { evidence: [...options.evidence] }),
  };
}

it("builds synthetic v4 Activity Events that the schema accepts", () => {
  const events = [
    knowledgeFlag(GITHUB_FLAG_KEY, {
      data: { gapKind: "wrong", targetRef: "CONTEXT.md", traceRef: TRACE },
    }),
    knowledgeFlag(FLAG_KEY, {
      sourceSystem: "software-factory",
      data: {
        gapKind: "missing",
        observationHash: "a".repeat(64),
        verdictEventKey: VERDICT_KEY,
      },
    }),
    verdict({ result: "fail", headSha: "a1b2c3d", pr: 1, traceRef: TRACE }),
    mergedPullRequest(PR_URL),
    curatorRun({
      eventKey: "homer:curator.run_completed:nightly-2026-11-24",
      occurredAt: "2026-11-24T10:31:00Z",
      addressedFlags: [FLAG_KEY],
      needsHuman: [{ flag: GITHUB_FLAG_KEY, result: "unclear" }],
      evidence: [{ label: "pull request", url: PR_URL }],
    }),
  ];
  for (const event of events) {
    const result = validateActivityEvent(event);
    expect(result.ok, result.ok ? "" : result.errors.join("; ")).toBe(true);
  }
});

it("joins a flag to its Verdict and inherits the Verdict's trace", () => {
  const flagEvent = knowledgeFlag(FLAG_KEY, {
    sourceSystem: "software-factory",
    data: {
      gapKind: "missing",
      targetRef: "docs/map.md",
      observationHash: "b".repeat(64),
      verdictEventKey: VERDICT_KEY,
    },
  });
  const projection = projectOpenKnowledgeFlags([
    verdict({ result: "fail", headSha: "a1b2c3d", pr: 1, traceRef: TRACE }),
    flagEvent,
  ]);
  expect(projection.stuckThreshold).toBe(DEFAULT_STUCK_THRESHOLD);
  expect(projection.warnings).toEqual([]);
  expect(projection.flags).toHaveLength(1);
  expect(projection.flags[0]).toMatchObject({
    eventKey: FLAG_KEY,
    sourceSystem: "software-factory",
    sourceUrl: flagEvent.provenance.sourceUrl,
    gapKind: "missing",
    targetRef: "docs/map.md",
    observationHash: "b".repeat(64),
    traceRef: TRACE,
    status: "open",
    curatorAttempts: 0,
    needsHumanReason: null,
    resolvedByPrUrl: null,
    linkedVerdict: {
      eventKey: VERDICT_KEY,
      packetId: "WP-2026-11-18-home",
      repository: REPOSITORY,
      headSha: "a1b2c3d",
      pr: 1,
      result: "fail",
    },
  });
  expect(projection.flags[0]).not.toHaveProperty("subject");
});

it("warns on a dangling verdictEventKey and keeps the flag's own trace", () => {
  const projection = projectOpenKnowledgeFlags([
    knowledgeFlag(GITHUB_FLAG_KEY, { data: { verdictEventKey: VERDICT_KEY, traceRef: TRACE } }),
  ]);
  expect(projection.flags[0]!.linkedVerdict).toBeNull();
  expect(projection.flags[0]!.traceRef).toEqual(TRACE);
  expect(projection.warnings).toEqual([
    `${GITHUB_FLAG_KEY}: linked Verdict ${VERDICT_KEY} is missing or unusable`,
  ]);
});

it("counts curator attempts and shows a flag stuck at the threshold", () => {
  const attempts = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      curatorRun({
        eventKey: `homer:curator.run_completed:run-${index + 1}`,
        occurredAt: `2026-11-2${index + 1}T10:00:00Z`,
        addressedFlags: [GITHUB_FLAG_KEY],
      }),
    );
  const flagEvent = knowledgeFlag(GITHUB_FLAG_KEY);
  expect(projectOpenKnowledgeFlags([flagEvent, ...attempts(2)]).flags[0]).toMatchObject({
    status: "open",
    curatorAttempts: 2,
  });
  expect(projectOpenKnowledgeFlags([flagEvent, ...attempts(3)]).flags[0]).toMatchObject({
    status: "stuck",
    curatorAttempts: 3,
  });
  expect(
    projectOpenKnowledgeFlags([flagEvent, ...attempts(2)], { stuckThreshold: 2 }).flags[0]!.status,
  ).toBe("stuck");
  expect(
    projectOpenKnowledgeFlags([flagEvent, ...attempts(3)], { stuckThreshold: 5 }).flags[0]!.status,
  ).toBe("open");
  expect(() => projectOpenKnowledgeFlags([], { stuckThreshold: -1 })).toThrow(RangeError);
});

it("shows a flag as needing a human, in ledger order", () => {
  const projection = projectOpenKnowledgeFlags([
    knowledgeFlag(GITHUB_FLAG_KEY),
    knowledgeFlag(OTHER_FLAG_KEY),
    curatorRun({
      eventKey: "homer:curator.run_completed:nightly-2026-11-24",
      occurredAt: "2026-11-24T10:31:00Z",
      needsHuman: [
        { flag: GITHUB_FLAG_KEY, result: "unclear" },
        { flag: OTHER_FLAG_KEY, result: "conflict" },
      ],
    }),
  ]);
  expect(
    projection.flags.map((flag) => [flag.eventKey, flag.status, flag.needsHumanReason]),
  ).toEqual([
    [GITHUB_FLAG_KEY, "needs_human", "unclear"],
    [OTHER_FLAG_KEY, "needs_human", "conflict"],
  ]);
});

it("resolves a flag only when the cited pull request has merged", () => {
  const flagEvent = knowledgeFlag(GITHUB_FLAG_KEY);
  const run = curatorRun({
    eventKey: "homer:curator.run_completed:nightly-2026-11-24",
    occurredAt: "2026-11-24T10:31:00Z",
    addressedFlags: [GITHUB_FLAG_KEY],
    evidence: [{ label: "pull request", url: PR_URL }],
  });
  expect(projectOpenKnowledgeFlags([flagEvent, run]).flags[0]).toMatchObject({
    status: "open",
    resolvedByPrUrl: null,
    curatorAttempts: 1,
  });
  expect(
    projectOpenKnowledgeFlags([flagEvent, run, mergedPullRequest(PR_URL)]).flags[0],
  ).toMatchObject({ status: "resolved", resolvedByPrUrl: PR_URL });
});

it("lets a merge win over needs_human and the stuck threshold", () => {
  const projection = projectOpenKnowledgeFlags([
    knowledgeFlag(GITHUB_FLAG_KEY),
    mergedPullRequest(PR_URL),
    curatorRun({
      eventKey: "homer:curator.run_completed:run-1",
      occurredAt: "2026-11-21T10:00:00Z",
      addressedFlags: [GITHUB_FLAG_KEY],
    }),
    curatorRun({
      eventKey: "homer:curator.run_completed:run-2",
      occurredAt: "2026-11-22T10:00:00Z",
      addressedFlags: [GITHUB_FLAG_KEY],
    }),
    curatorRun({
      eventKey: "homer:curator.run_completed:run-3",
      occurredAt: "2026-11-23T10:00:00Z",
      addressedFlags: [GITHUB_FLAG_KEY],
      needsHuman: [{ flag: GITHUB_FLAG_KEY, result: "conflict" }],
      evidence: [{ label: "pull request", url: PR_URL }],
    }),
  ]);
  expect(projection.flags[0]).toMatchObject({
    status: "resolved",
    resolvedByPrUrl: PR_URL,
    curatorAttempts: 3,
    needsHumanReason: null,
  });
});

it("rebuilds the same Projection for the same replay order", () => {
  const events = [
    knowledgeFlag(GITHUB_FLAG_KEY, { data: { gapKind: "wrong", verdictEventKey: VERDICT_KEY } }),
    verdict({ result: "fail", headSha: "a1b2c3d", pr: 1, traceRef: TRACE }),
    mergedPullRequest(PR_URL),
    curatorRun({
      eventKey: "homer:curator.run_completed:run-1",
      occurredAt: "2026-11-24T10:31:00Z",
      addressedFlags: [GITHUB_FLAG_KEY],
      evidence: [{ label: "pull request", url: PR_URL }],
    }),
  ];
  const once = projectOpenKnowledgeFlags(events);
  expect(once.flags[0]!.status).toBe("resolved");
  expect(projectOpenKnowledgeFlags(structuredClone(events))).toEqual(once);
  expect(projectOpenKnowledgeFlags(events)).toEqual(once);
});
