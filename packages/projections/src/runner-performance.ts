/** Source-linked, read-only GitHub Job Attempt measurements. No runner mutation or dispatch. */
export type RunnerJobStatus = "queued" | "in_progress" | "completed" | "unknown";
export type RunnerJobConclusion =
  | "success"
  | "failure"
  | "cancelled"
  | "timed_out"
  | "neutral"
  | "skipped"
  | "action_required"
  | "stale";
export type RunnerCacheMode = "cold" | "warm" | "unknown";

export interface RunnerBenchmarkEnvironment {
  os: "linux" | "windows" | "macos" | "unknown";
  architecture: "x64" | "arm64" | "unknown";
  cacheMode: RunnerCacheMode;
  workflowRevision: string | null;
  toolchainRevision: string | null;
  imageRevision: string | null;
}
export interface RunnerMeasurementProvenance {
  sourceSystem: "github";
  sourceObjectId: string;
  sourceUrl: string;
  collector: string;
  collectorVersion: string;
  deliveryId: string;
}
export interface RunnerJobSample {
  version: 1;
  repositoryId: number;
  workflowRunId: number;
  workflowId: number | null;
  jobId: number;
  runAttempt: number;
  jobName: string;
  headSha: string | null;
  runnerId: number | null;
  runnerGroupId: number | null;
  status: RunnerJobStatus;
  conclusion: RunnerJobConclusion | null;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  collectedAt: string;
  evidenceUrl: string;
  environment: RunnerBenchmarkEnvironment | null;
  provenance: RunnerMeasurementProvenance;
}
export interface RunnerJobTiming {
  creationToStartMs: number | null;
  executionMs: number | null;
  endToEndMs: number | null;
  warnings: string[];
}
export interface RunnerTimingOptions {
  asOf: string;
  lastSuccessAt: string | null;
  maxAgeSeconds: number | null;
  minP50?: number;
  minP95?: number;
}
export interface RunnerTimingSummary {
  key: string;
  repositoryId: number;
  workflowId: number | null;
  jobName: string;
  headSha: string | null;
  runnerId: number | null;
  environment: RunnerBenchmarkEnvironment | null;
  distinctAttempts: number;
  successfulTimings: number;
  failedAttempts: number;
  /** Completed as `skipped` or `neutral`: neither a success nor a failure. */
  skippedOrNeutralAttempts: number;
  /** Completed with no conclusion, or as `action_required` or `stale`. */
  unknownOutcomeAttempts: number;
  cancelledAttempts: number;
  pendingAttempts: number;
  missingTiming: number;
  p50ExecutionMs: number | null;
  p95ExecutionMs: number | null;
  freshness: "fresh" | "stale" | "unknown";
  status: "ready" | "insufficient_samples" | "incomparable" | "stale";
  warnings: string[];
  evidenceUrls: string[];
}

const keys = [
  "version",
  "repositoryId",
  "workflowRunId",
  "workflowId",
  "jobId",
  "runAttempt",
  "jobName",
  "headSha",
  "runnerId",
  "runnerGroupId",
  "status",
  "conclusion",
  "createdAt",
  "startedAt",
  "completedAt",
  "collectedAt",
  "evidenceUrl",
  "environment",
  "provenance",
];
const environmentKeys = [
  "os",
  "architecture",
  "cacheMode",
  "workflowRevision",
  "toolchainRevision",
  "imageRevision",
];
const provenanceKeys = [
  "sourceSystem",
  "sourceObjectId",
  "sourceUrl",
  "collector",
  "collectorVersion",
  "deliveryId",
];
function exactObject(input: unknown, fields: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    throw new RangeError("invalid_runner_measurement");
  const record = input as Record<string, unknown>;
  if (
    Object.keys(record).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(record, key))
  )
    throw new RangeError("invalid_runner_measurement");
  return record;
}
function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function boundString(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  );
}
function utcMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{3}))?Z$/.exec(value);
  if (!m) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 19) !== m[1]) return null;
  return ms;
}
function validGithubUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1024) return false;
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      u.hostname === "github.com" &&
      u.username === "" &&
      u.password === "" &&
      u.port === "" &&
      u.pathname.length > 1
    );
  } catch {
    return false;
  }
}
/** Parse a new sample from an already verified source boundary. This does not verify webhook signatures. */
export function parseRunnerJobSample(input: unknown): RunnerJobSample {
  const v = exactObject(input, keys);
  if (
    v.version !== 1 ||
    !positive(v.repositoryId) ||
    !positive(v.workflowRunId) ||
    !positive(v.jobId) ||
    !positive(v.runAttempt) ||
    !(v.workflowId === null || positive(v.workflowId)) ||
    !(v.runnerId === null || positive(v.runnerId)) ||
    !(v.runnerGroupId === null || positive(v.runnerGroupId)) ||
    !boundString(v.jobName, 200) ||
    !(v.headSha === null || (typeof v.headSha === "string" && /^[a-f0-9]{40}$/i.test(v.headSha))) ||
    !["queued", "in_progress", "completed", "unknown"].includes(v.status as string) ||
    !(
      v.conclusion === null ||
      [
        "success",
        "failure",
        "cancelled",
        "timed_out",
        "neutral",
        "skipped",
        "action_required",
        "stale",
      ].includes(v.conclusion as string)
    ) ||
    utcMs(v.collectedAt) === null ||
    !validGithubUrl(v.evidenceUrl) ||
    [v.createdAt, v.startedAt, v.completedAt].some((x) => x !== null && utcMs(x) === null)
  )
    throw new RangeError("invalid_runner_measurement");
  if (v.environment !== null) {
    const e = exactObject(v.environment, environmentKeys);
    if (
      !["linux", "windows", "macos", "unknown"].includes(e.os as string) ||
      !["x64", "arm64", "unknown"].includes(e.architecture as string) ||
      !["cold", "warm", "unknown"].includes(e.cacheMode as string) ||
      [e.workflowRevision, e.toolchainRevision, e.imageRevision].some(
        (value) => !(value === null || boundString(value, 160)),
      )
    )
      throw new RangeError("invalid_runner_measurement");
  }
  const p = exactObject(v.provenance, provenanceKeys);
  if (
    p.sourceSystem !== "github" ||
    !boundString(p.sourceObjectId, 128) ||
    !validGithubUrl(p.sourceUrl) ||
    !boundString(p.collector, 128) ||
    !boundString(p.collectorVersion, 80) ||
    !boundString(p.deliveryId, 128)
  )
    throw new RangeError("invalid_runner_measurement");
  // Rebuild in a fixed field order, so equal evidence serializes equally however
  // the caller ordered its properties. Every leaf is a string, number or null.
  const environment =
    v.environment === null
      ? null
      : Object.fromEntries(
          environmentKeys.map((key) => [key, (v.environment as Record<string, unknown>)[key]]),
        );
  const provenance = Object.fromEntries(provenanceKeys.map((key) => [key, p[key]]));
  return Object.fromEntries(
    keys.map((key) => [
      key,
      key === "environment" ? environment : key === "provenance" ? provenance : v[key],
    ]),
  ) as unknown as RunnerJobSample;
}
export function deriveRunnerJobTiming(sample: RunnerJobSample): RunnerJobTiming {
  const v = parseRunnerJobSample(sample);
  const recorded = utcMs(v.collectedAt)!;
  const warnings: string[] = [];
  function at(value: string | null, field: string): number | null {
    if (value === null) {
      warnings.push("missing_" + field);
      return null;
    }
    const n = utcMs(value)!;
    if (n > recorded) {
      warnings.push("future_" + field);
      return null;
    }
    return n;
  }
  const created = at(v.createdAt, "created_at");
  const started = at(v.startedAt, "started_at");
  const completed = at(v.completedAt, "completed_at");
  function diff(a: number | null, b: number | null, field: string): number | null {
    if (a === null || b === null) return null;
    if (b < a) {
      warnings.push("reversed_" + field);
      return null;
    }
    return b - a;
  }
  return {
    creationToStartMs: diff(created, started, "creation_to_start"),
    executionMs: diff(started, completed, "execution"),
    endToEndMs: diff(created, completed, "end_to_end"),
    warnings,
  };
}
function freshness(options: RunnerTimingOptions): "fresh" | "stale" | "unknown" {
  const now = utcMs(options.asOf);
  if (now === null) throw new RangeError("invalid_as_of");
  if (
    options.lastSuccessAt === null ||
    options.maxAgeSeconds === null ||
    !Number.isSafeInteger(options.maxAgeSeconds) ||
    options.maxAgeSeconds < 0
  )
    return "unknown";
  const success = utcMs(options.lastSuccessAt);
  if (success === null || success > now) return "unknown";
  return now - success <= options.maxAgeSeconds * 1000 ? "fresh" : "stale";
}
function nearestRank(sorted: readonly number[], percent: number): number {
  return sorted[Math.max(0, Math.ceil(percent * sorted.length) - 1)]!;
}
function attemptId(s: RunnerJobSample): string {
  return JSON.stringify([s.repositoryId, s.workflowRunId, s.runAttempt, s.jobId]);
}
function groupId(s: RunnerJobSample): string {
  return JSON.stringify([
    s.repositoryId,
    s.workflowId,
    s.jobName,
    s.headSha,
    s.runnerId,
    s.environment,
  ]);
}
function comparable(s: RunnerJobSample): boolean {
  const e = s.environment;
  return (
    s.workflowId !== null &&
    s.headSha !== null &&
    s.runnerId !== null &&
    e !== null &&
    e.os !== "unknown" &&
    e.architecture !== "unknown" &&
    e.cacheMode !== "unknown" &&
    e.workflowRevision !== null &&
    e.toolchainRevision !== null &&
    e.imageRevision !== null
  );
}
/** Conservative reporting only: does not select, authorize or dispatch runners. */
export function projectRunnerTimings(
  input: readonly RunnerJobSample[],
  options: RunnerTimingOptions,
): RunnerTimingSummary[] {
  if (input.length > 10000) throw new RangeError("too_many_runner_samples");
  const fresh = freshness(options);
  const minP50 = options.minP50 ?? 20;
  const minP95 = options.minP95 ?? 100;
  if (![minP50, minP95].every((n) => Number.isSafeInteger(n) && n > 0))
    throw new RangeError("invalid_minimum_samples");
  const attempts = new Map<string, RunnerJobSample>();
  const conflicting = new Set<string>();
  for (const raw of input) {
    const s = parseRunnerJobSample(raw);
    const id = attemptId(s);
    const prior = attempts.get(id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(s)) conflicting.add(id);
    else if (!prior) attempts.set(id, s);
  }
  type Bucket = {
    sample: RunnerJobSample;
    total: number;
    durations: number[];
    failed: number;
    skippedOrNeutral: number;
    unknownOutcome: number;
    cancelled: number;
    pending: number;
    missing: number;
    warnings: Set<string>;
    urls: Set<string>;
  };
  const groups = new Map<string, Bucket>();
  for (const [id, s] of attempts) {
    const key = groupId(s);
    let b = groups.get(key);
    if (!b) {
      b = {
        sample: s,
        total: 0,
        durations: [],
        failed: 0,
        skippedOrNeutral: 0,
        unknownOutcome: 0,
        cancelled: 0,
        pending: 0,
        missing: 0,
        warnings: new Set(),
        urls: new Set(),
      };
      groups.set(key, b);
    }
    b.urls.add(s.evidenceUrl);
    if (conflicting.has(id)) {
      b.warnings.add("conflicting_attempt_evidence");
      continue;
    }
    b.total++;
    if (s.status !== "completed") {
      b.pending++;
      continue;
    }
    // Only `failure` is a failure. Skipped and neutral jobs did not fail, and an
    // unknown outcome is not evidence of one (specs/runner-scheduling/spec.md).
    if (s.conclusion === "cancelled" || s.conclusion === "timed_out") {
      b.cancelled++;
      continue;
    }
    if (s.conclusion === "failure") {
      b.failed++;
      continue;
    }
    if (s.conclusion === "skipped" || s.conclusion === "neutral") {
      b.skippedOrNeutral++;
      continue;
    }
    if (s.conclusion !== "success") {
      b.unknownOutcome++;
      continue;
    }
    const timing = deriveRunnerJobTiming(s);
    // Warnings about creation time still count when the execution time is valid.
    timing.warnings.forEach((warning) => b.warnings.add(warning));
    if (timing.executionMs === null) b.missing++;
    else b.durations.push(timing.executionMs);
  }
  const result: RunnerTimingSummary[] = [];
  for (const [key, b] of [...groups].sort(([a], [z]) => (a < z ? -1 : a > z ? 1 : 0))) {
    b.durations.sort((a, z) => a - z);
    const eligible = comparable(b.sample);
    const canReport = eligible && fresh === "fresh";
    if (!eligible) b.warnings.add("incomparable_environment");
    if (fresh !== "fresh") b.warnings.add("github_source_" + fresh);
    if (b.durations.length < minP50) b.warnings.add("insufficient_p50_samples");
    if (b.durations.length < minP95) b.warnings.add("insufficient_p95_samples");
    const status: RunnerTimingSummary["status"] = !eligible
      ? "incomparable"
      : fresh !== "fresh"
        ? "stale"
        : b.durations.length < minP50
          ? "insufficient_samples"
          : "ready";
    result.push({
      key,
      repositoryId: b.sample.repositoryId,
      workflowId: b.sample.workflowId,
      jobName: b.sample.jobName,
      headSha: b.sample.headSha,
      runnerId: b.sample.runnerId,
      environment: b.sample.environment ? structuredClone(b.sample.environment) : null,
      distinctAttempts: b.total,
      successfulTimings: b.durations.length,
      failedAttempts: b.failed,
      skippedOrNeutralAttempts: b.skippedOrNeutral,
      unknownOutcomeAttempts: b.unknownOutcome,
      cancelledAttempts: b.cancelled,
      pendingAttempts: b.pending,
      missingTiming: b.missing,
      p50ExecutionMs:
        canReport && b.durations.length >= minP50 ? nearestRank(b.durations, 0.5) : null,
      p95ExecutionMs:
        canReport && b.durations.length >= minP95 ? nearestRank(b.durations, 0.95) : null,
      freshness: fresh,
      status,
      warnings: [...b.warnings].sort(),
      evidenceUrls: [...b.urls].sort().slice(0, 50),
    });
  }
  return result;
}
