/**
 * The Knowledge Flag Projection: Knowledge Flags rebuilt from effective Event Ledger history,
 * with the software-factory Verdict and the Curator Run that touched each one. Contract:
 * specs/knowledge-loop/spec.md. It carries ids, hashes and links only, never a flag's text.
 */
import type { ActivityEvent, ActivityEventActor, TraceRef } from "@zs-home/shared-contracts";

export type KnowledgeFlagStatus = "open" | "stuck" | "needs_human" | "resolved";

/** The Verdict a Knowledge Flag links to, by id and link only. */
export interface LinkedVerdictSummary {
  readonly eventKey: string;
  /** The Work Packet, from the Verdict's own data or its Provenance object id. */
  readonly packetId: string;
  readonly repository: string;
  readonly headSha: string;
  readonly pr: number;
  readonly result: "pass" | "fail";
  /** Present only when the Verdict event carries it; the Activity Event schema does not require it. */
  readonly mode?: "online" | "offline";
  readonly judgeModel?: string;
  readonly authorModel?: string;
  readonly occurredAt: string;
  readonly traceRef?: TraceRef;
}

export interface ProjectedKnowledgeFlag {
  readonly eventKey: string;
  readonly sourceSystem: "buzz" | "github" | "linear" | "software-factory";
  readonly sourceUrl: string;
  readonly occurredAt: string;
  readonly actor: ActivityEventActor;
  readonly projectId?: string;
  readonly repository?: string;
  readonly taskId?: string;
  readonly gapKind: "missing" | "wrong" | "stale" | "unspecified";
  readonly targetRef: string | null;
  readonly observationHash: string | null;
  readonly traceRef: TraceRef | null;
  readonly linkedVerdict: LinkedVerdictSummary | null;
  readonly status: KnowledgeFlagStatus;
  readonly curatorAttempts: number;
  readonly needsHumanReason: "unclear" | "conflict" | null;
  readonly resolvedByPrUrl: string | null;
}

export interface KnowledgeFlagProjection {
  readonly stuckThreshold: number;
  readonly flags: readonly ProjectedKnowledgeFlag[];
  readonly warnings: readonly string[];
}

/** The Projection plus the ledger head it was rebuilt from, as homer-catalog serves it. */
export interface KnowledgeFlagQueueView extends KnowledgeFlagProjection {
  readonly state: "ready" | "empty";
  readonly head: { readonly sequence: number; readonly entryDigest: string } | null;
}

/** Three runs without a merge, from specs/knowledge-loop/spec.md. */
export const DEFAULT_STUCK_THRESHOLD = 3;

type FlagSource = ProjectedKnowledgeFlag["sourceSystem"];

/** The same fields, mutable while the Projection is built. */
type FlagState = { -readonly [K in keyof ProjectedKnowledgeFlag]: ProjectedKnowledgeFlag[K] };

const TRACE_ID = /^[A-Za-z0-9._-]{1,128}$/;
const OBSERVATION_HASH = /^[0-9a-f]{64}$/;
const PULL_REQUEST_URL = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/pull\/[0-9]+$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function itemsOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function dataOf(event: ActivityEvent): Record<string, unknown> {
  return record(event.data) ? event.data : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function isFlagSource(value: string): value is FlagSource {
  return (
    value === "buzz" || value === "github" || value === "linear" || value === "software-factory"
  );
}

function traceRefOf(value: unknown): TraceRef | null {
  if (!record(value) || value["provider"] !== "langfuse") return null;
  const traceId = value["traceId"];
  if (typeof traceId !== "string" || !TRACE_ID.test(traceId)) return null;
  const url = value["url"];
  return typeof url === "string" && url.startsWith("https://")
    ? { provider: "langfuse", traceId, url }
    : { provider: "langfuse", traceId };
}

function observationHashOf(value: unknown): string | null {
  return typeof value === "string" && OBSERVATION_HASH.test(value) ? value : null;
}

/** Null when the event cannot name a Verdict: a Verdict without its result, head or pull request is unusable. */
function verdictSummary(event: ActivityEvent): LinkedVerdictSummary | null {
  const data = dataOf(event);
  const result = data["result"];
  const headSha = text(data["headSha"]);
  const pr = data["pr"];
  const repository = text(event.repository);
  if (
    (result !== "pass" && result !== "fail") ||
    headSha === null ||
    repository === null ||
    typeof pr !== "number" ||
    !Number.isSafeInteger(pr) ||
    pr < 0
  ) {
    return null;
  }
  const mode = data["mode"];
  const judgeModel = text(data["judgeModel"]);
  const authorModel = text(data["authorModel"]);
  const traceRef = traceRefOf(data["traceRef"]);
  return {
    eventKey: event.eventKey,
    packetId: text(data["packetId"]) ?? event.provenance.sourceObjectId,
    repository,
    headSha,
    pr,
    result,
    ...(mode === "online" || mode === "offline" ? { mode } : {}),
    ...(judgeModel === null ? {} : { judgeModel }),
    ...(authorModel === null ? {} : { authorModel }),
    occurredAt: event.occurredAt,
    ...(traceRef === null ? {} : { traceRef }),
  };
}

/**
 * Rebuild the Knowledge Flag Projection from effective Event Ledger history. Flags come out in
 * ledger order with every status, so a caller filters. A merge resolves a flag; a run that
 * reported it needing a human outranks the stuck threshold, and three unmerged runs make it
 * stuck. The same replay order always yields the same Projection.
 */
export function projectOpenKnowledgeFlags(
  events: readonly ActivityEvent[],
  options: { stuckThreshold?: number } = {},
): KnowledgeFlagProjection {
  const stuckThreshold = options.stuckThreshold ?? DEFAULT_STUCK_THRESHOLD;
  if (!Number.isSafeInteger(stuckThreshold) || stuckThreshold < 0) {
    throw new RangeError("Invalid stuck threshold");
  }

  const verdicts = new Map<string, LinkedVerdictSummary>();
  const mergedPullRequests = new Set<string>();
  const runs: ActivityEvent[] = [];
  for (const event of events) {
    if (event.kind === "factory.verdict_recorded") {
      const summary = verdictSummary(event);
      if (summary !== null) verdicts.set(event.eventKey, summary);
    } else if (event.kind === "pull_request.merged") {
      mergedPullRequests.add(event.provenance.sourceUrl);
    } else if (event.kind === "curator.run_completed") {
      runs.push(event);
    }
  }

  const warnings: string[] = [];
  const flags: FlagState[] = [];
  const byEventKey = new Map<string, FlagState>();
  for (const event of events) {
    if (event.kind !== "knowledge.flagged") continue;
    const sourceSystem = event.provenance.sourceSystem;
    if (!isFlagSource(sourceSystem)) continue;
    const data = dataOf(event);
    const verdictEventKey = text(data["verdictEventKey"]);
    let linkedVerdict: LinkedVerdictSummary | null = null;
    if (verdictEventKey !== null) {
      linkedVerdict = verdicts.get(verdictEventKey) ?? null;
      if (linkedVerdict === null) {
        warnings.push(
          `${event.eventKey}: linked Verdict ${verdictEventKey} is missing or unusable`,
        );
      }
    }
    const gapKind = data["gapKind"];
    const flag: FlagState = {
      eventKey: event.eventKey,
      sourceSystem,
      sourceUrl: event.provenance.sourceUrl,
      occurredAt: event.occurredAt,
      actor: structuredClone(event.actor),
      ...(event.projectId === undefined ? {} : { projectId: event.projectId }),
      ...(event.repository === undefined ? {} : { repository: event.repository }),
      ...(event.taskId === undefined ? {} : { taskId: event.taskId }),
      gapKind:
        gapKind === "missing" || gapKind === "wrong" || gapKind === "stale"
          ? gapKind
          : "unspecified",
      targetRef: text(data["targetRef"]),
      observationHash: observationHashOf(data["observationHash"]),
      // A Verdict's trace stands in when the flag itself carries none.
      traceRef: traceRefOf(data["traceRef"]) ?? linkedVerdict?.traceRef ?? null,
      linkedVerdict,
      status: "open",
      curatorAttempts: 0,
      needsHumanReason: null,
      resolvedByPrUrl: null,
    };
    flags.push(flag);
    byEventKey.set(event.eventKey, flag);
  }

  for (const run of runs) {
    const data = dataOf(run);
    const merged = (run.evidence ?? [])
      .map((item) => item.url)
      .find((url) => PULL_REQUEST_URL.test(url) && mergedPullRequests.has(url));
    for (const key of itemsOf(data["addressedFlags"])) {
      const flag = typeof key === "string" ? byEventKey.get(key) : undefined;
      if (flag === undefined) continue;
      flag.curatorAttempts += 1;
      if (merged !== undefined && flag.status !== "resolved") {
        flag.status = "resolved";
        flag.resolvedByPrUrl = merged;
      }
    }
    for (const entry of itemsOf(data["needsHuman"])) {
      if (!record(entry)) continue;
      const key = entry["flag"];
      const result = entry["result"];
      if (typeof key !== "string") continue;
      if (result !== "unclear" && result !== "conflict") continue;
      const flag = byEventKey.get(key);
      if (flag === undefined || flag.status === "resolved") continue;
      if (flag.needsHumanReason === null) flag.needsHumanReason = result;
    }
  }

  return {
    stuckThreshold,
    flags: flags.map((flag) => {
      const status: KnowledgeFlagStatus =
        flag.status === "resolved"
          ? "resolved"
          : flag.needsHumanReason !== null
            ? "needs_human"
            : flag.curatorAttempts >= stuckThreshold
              ? "stuck"
              : "open";
      return {
        ...flag,
        status,
        needsHumanReason: status === "needs_human" ? flag.needsHumanReason : null,
      };
    }),
    warnings,
  };
}
