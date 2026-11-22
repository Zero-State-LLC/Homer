import { expect, it } from "vitest";
import {
  deriveRunnerJobTiming,
  parseRunnerJobSample,
  projectRunnerTimings,
  type RunnerJobSample,
  type RunnerTimingOptions,
} from "../src/runner-performance.js";

const sha = "a".repeat(40);
const env: NonNullable<RunnerJobSample["environment"]> = {
  os: "linux",
  architecture: "x64",
  cacheMode: "warm",
  workflowRevision: sha,
  toolchainRevision: "node-24",
  imageRevision: "image-digest-001",
};
const options: RunnerTimingOptions = {
  asOf: "2026-11-22T16:00:00Z",
  lastSuccessAt: "2026-11-22T15:01:00Z",
  maxAgeSeconds: 7200,
};
function sample(overrides: Partial<RunnerJobSample> = {}): RunnerJobSample {
  return {
    version: 1,
    repositoryId: 123,
    workflowRunId: 456,
    workflowId: 789,
    jobId: 101,
    runAttempt: 1,
    jobName: "build",
    headSha: sha,
    runnerId: 555,
    runnerGroupId: 1,
    status: "completed",
    conclusion: "success",
    createdAt: "2026-11-22T14:00:00Z",
    startedAt: "2026-11-22T14:00:10Z",
    completedAt: "2026-11-22T14:00:30Z",
    collectedAt: "2026-11-22T15:00:00Z",
    evidenceUrl: "https://github.com/Zero-State-LLC/Homer/actions/runs/456/job/101",
    environment: { ...env },
    provenance: {
      sourceSystem: "github",
      sourceObjectId: "101",
      sourceUrl: "https://github.com/Zero-State-LLC/Homer/actions/runs/456",
      collector: "fixture",
      collectorVersion: "1",
      deliveryId: "test-delivery-1",
    },
    ...overrides,
  };
}
function batch(count: number): RunnerJobSample[] {
  return Array.from({ length: count }, (_, i) =>
    sample({
      workflowRunId: 1000 + i,
      jobId: 2000 + i,
      evidenceUrl: "https://github.com/Zero-State-LLC/Homer/actions/runs/" + (1000 + i),
      provenance: {
        ...sample().provenance,
        sourceObjectId: String(2000 + i),
        deliveryId: String(i),
      },
      completedAt: "2026-11-22T14:00:" + String(20 + (i % 30)).padStart(2, "0") + "Z",
    }),
  );
}
it("derives creation-to-start proxy, execution and end-to-end separately", () => {
  expect(deriveRunnerJobTiming(sample())).toEqual({
    creationToStartMs: 10000,
    executionMs: 20000,
    endToEndMs: 30000,
    warnings: [],
  });
});
it("refuses reversed or future-inconsistent source timestamps", () => {
  const reversed = deriveRunnerJobTiming(sample({ completedAt: "2026-11-22T13:59:00Z" }));
  expect(reversed.executionMs).toBeNull();
  expect(reversed.endToEndMs).toBeNull();
  expect(reversed.warnings).toContain("reversed_execution");
  const future = deriveRunnerJobTiming(sample({ startedAt: "2026-11-22T15:01:00Z" }));
  expect(future.creationToStartMs).toBeNull();
  expect(future.executionMs).toBeNull();
  expect(future.warnings).toContain("future_started_at");
  expect(deriveRunnerJobTiming(sample({ startedAt: null })).executionMs).toBeNull();
});
it("validates strict source evidence and refuses unsafe identity and URL values", () => {
  expect(parseRunnerJobSample(sample())).toEqual(sample());
  for (const wrong of [
    { ...sample(), repositoryId: Number.MAX_SAFE_INTEGER + 1 },
    { ...sample(), headSha: "short" },
    { ...sample(), jobName: "a\nsecret" },
    { ...sample(), evidenceUrl: "https://github.com.evil.test/action" },
    { ...sample(), evidenceUrl: "http://github.com/org/repo" },
    { ...sample(), createdAt: "2026-02-30T14:00:00Z" },
    { ...sample(), extra: "unsupported" },
    { ...sample(), environment: { ...env, unexpected: 1 } },
    { ...sample(), provenance: { ...sample().provenance, sourceSystem: "untrusted" } },
  ])
    expect(() => parseRunnerJobSample(wrong)).toThrow("invalid_runner_measurement");
});
it("tracks distinct reruns but deduplicates identical observations", () => {
  const a = sample();
  const b = sample({ runAttempt: 2 });
  const report = projectRunnerTimings([a, a, b], options);
  expect(report).toHaveLength(1);
  expect(report[0]).toMatchObject({ distinctAttempts: 2, successfulTimings: 2 });
});
it("refuses to pick a winner from conflicting evidence for one attempt", () => {
  const a = sample();
  const b = sample({ completedAt: "2026-11-22T14:00:50Z" });
  const report = projectRunnerTimings([a, b], options);
  expect(report[0]).toMatchObject({ distinctAttempts: 0, successfulTimings: 0 });
  expect(report[0]!.warnings).toContain("conflicting_attempt_evidence");
});
it("reports p50 only after 20 comparable samples and p95 only after 100", () => {
  for (const count of [0, 19, 20, 99, 100]) {
    const report = projectRunnerTimings(batch(count), options);
    if (count === 0) {
      expect(report).toEqual([]);
      continue;
    }
    expect(report[0]!.successfulTimings).toBe(count);
    expect(report[0]!.p50ExecutionMs === null).toBe(count < 20);
    expect(report[0]!.p95ExecutionMs === null).toBe(count < 100);
    expect(report[0]!.status).toBe(count >= 20 ? "ready" : "insufficient_samples");
  }
});
it("uses deterministic nearest-rank percentiles with ties", () => {
  const input = batch(5);
  const out = projectRunnerTimings(input, { ...options, minP50: 1, minP95: 1 })[0]!;
  // completion seconds: 20,21,22,23,24; start at 10 seconds
  expect(out.p50ExecutionMs).toBe(12000);
  expect(out.p95ExecutionMs).toBe(14000);
});
it("keeps failures, cancellations and queued jobs out of successful timing percentiles", () => {
  const xs = [
    sample({ jobId: 1, workflowRunId: 1 }),
    sample({ jobId: 2, workflowRunId: 2, conclusion: "failure" }),
    sample({ jobId: 3, workflowRunId: 3, conclusion: "cancelled" }),
    sample({
      jobId: 4,
      workflowRunId: 4,
      status: "queued",
      conclusion: null,
      startedAt: null,
      completedAt: null,
    }),
    sample({ jobId: 5, workflowRunId: 5, startedAt: null }),
  ];
  const out = projectRunnerTimings(xs, { ...options, minP50: 1, minP95: 1 })[0]!;
  expect(out).toMatchObject({
    distinctAttempts: 5,
    successfulTimings: 1,
    failedAttempts: 1,
    cancelledAttempts: 1,
    pendingAttempts: 1,
    missingTiming: 1,
    p50ExecutionMs: 20000,
  });
});
it("abstains when freshness is stale or missing instead of displaying percentiles", () => {
  const xs = batch(100);
  const stale = projectRunnerTimings(xs, { ...options, maxAgeSeconds: 1 })[0]!;
  expect(stale).toMatchObject({
    status: "stale",
    freshness: "stale",
    p50ExecutionMs: null,
    p95ExecutionMs: null,
  });
  const unknown = projectRunnerTimings(xs, { ...options, lastSuccessAt: null })[0]!;
  expect(unknown.freshness).toBe("unknown");
  expect(unknown.p50ExecutionMs).toBeNull();
});
it("does not compare unknown OS, toolchain, cache or runner IDs", () => {
  for (const override of [
    { environment: null },
    { runnerId: null },
    { environment: { ...env, cacheMode: "unknown" as const } },
    { environment: { ...env, workflowRevision: null } },
    { headSha: null },
  ]) {
    const xs = batch(100).map((x) => ({ ...x, ...override }));
    const report = projectRunnerTimings(xs, options)[0]!;
    expect(report.status).toBe("incomparable");
    expect(report.p50ExecutionMs).toBeNull();
    expect(report.p95ExecutionMs).toBeNull();
  }
});
it("separates cache modes and revisions and never modifies caller-owned evidence", () => {
  const a = sample({ workflowRunId: 1, jobId: 1 });
  const b = sample({ workflowRunId: 2, jobId: 2, environment: { ...env, cacheMode: "cold" } });
  const c = sample({
    workflowRunId: 3,
    jobId: 3,
    environment: { ...env, toolchainRevision: "node-26" },
  });
  const input = [a, b, c];
  const before = structuredClone(input);
  const result = projectRunnerTimings(input, { ...options, minP50: 1, minP95: 1 });
  expect(result).toHaveLength(3);
  expect(new Set(result.map((x) => x.key)).size).toBe(3);
  result[0]!.evidenceUrls.push("https://github.com/changed");
  expect(input).toEqual(before);
});
it("rejects unbounded batch sizes and invalid configured thresholds", () => {
  expect(() => projectRunnerTimings(batch(1), { ...options, minP50: 0 })).toThrow();
  expect(() => projectRunnerTimings(batch(1), { ...options, asOf: "bad" })).toThrow();
  expect(() => projectRunnerTimings(Array(10001).fill(sample()), options)).toThrow(
    "too_many_runner_samples",
  );
});
