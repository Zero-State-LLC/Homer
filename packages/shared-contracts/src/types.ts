/**
 * Hand-written types for the JSON Schemas in specs/integration-contracts.
 * The schema files are the authority. These names use the glossary terms.
 */

/** `buzz` and `homer` exist from Activity Event contract version 2, and `sparkdash` from version 3. */
export type SourceSystem =
  "github" | "linear" | "control-room" | "software-factory" | "buzz" | "homer" | "sparkdash";

export type ActorKind = "human" | "agent" | "system" | "unknown";

/**
 * The message, knowledge and curator Kinds exist from Activity Event contract
 * version 2, and the machine alert Kinds from version 3.
 */
export type EventKind =
  | "commit.pushed"
  | "pull_request.opened"
  | "pull_request.reviewed"
  | "pull_request.merged"
  | "pull_request.closed"
  | "ci.completed"
  | "deployment.completed"
  | "task.created"
  | "task.status_changed"
  | "task.assigned"
  | "work_session.started"
  | "work_session.ended"
  | "handoff.recorded"
  | "milestone.planned"
  | "milestone.completed"
  | "blocker.raised"
  | "blocker.cleared"
  | "factory.stage_changed"
  | "factory.verdict_recorded"
  | "message.posted"
  | "knowledge.flagged"
  | "curator.run_completed"
  | "curator.profile_switched"
  | "machine.alert_fired"
  | "machine.alert_cleared";

export type ActivityEventContract =
  | "home.activity-event/v1"
  | "home.activity-event/v2"
  | "home.activity-event/v3"
  | "home.activity-event/v4";

export interface ActivityEventActor {
  sourceAccount: string;
  actorId?: string;
  actorKind?: ActorKind;
}

export interface Provenance {
  sourceSystem: SourceSystem;
  sourceObjectId: string;
  sourceUrl: string;
  collector: string;
  collectorVersion: string;
  collectedAt: string;
}

/**
 * Any contract version. The schema for the version `contract` names is the authority on
 * which Source Systems, Kinds and links that version allows.
 */
export interface ActivityEvent {
  contract: ActivityEventContract;
  eventKey: string;
  kind: EventKind;
  occurredAt: string;
  actor: ActivityEventActor;
  projectId?: string;
  repository?: string;
  taskId?: string;
  subject: string;
  provenance: Provenance;
  evidence?: { label: string; url: string }[];
  data?: Record<string, unknown>;
}

export type RiskTier = "low" | "medium" | "high";

export interface WorkRequest {
  contract: "home.work-request/v1";
  requestId: string;
  source: string;
  pain: string;
  who: string;
  doneWhen: string[];
  repository: string;
  paths?: string[];
  outOfScope?: string[];
  riskTier: RiskTier;
  budgetUsd: number;
  requestedBy: {
    sourceAccount: string;
    actorId?: string;
  };
  requestedAt: string;
  testCommand?: string;
  links?: string[];
}

export type PacketStage =
  "intake" | "spec" | "implement" | "verify" | "merge" | "deploy" | "learn" | "done";

export interface FactoryEventStageChanged {
  contract: "home.factory-event/v1";
  packetId: string;
  type: "stage_changed";
  at: string;
  repository: string;
  from: PacketStage;
  to: PacketStage;
  reason?: string;
}

export interface FactoryEventVerdictRecorded {
  contract: "home.factory-event/v1";
  packetId: string;
  type: "verdict_recorded";
  at: string;
  repository: string;
  verdict: {
    result: "pass" | "fail";
    mode: "online" | "offline";
    headSha: string;
    judgeModel: string;
    authorModel: string;
    pr: number;
  };
}

export type FactoryEvent = FactoryEventStageChanged | FactoryEventVerdictRecorded;

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** A Machine in a Fleet Report: ids and fixed text only, never an address. */
export interface FleetMachine {
  machineId: string;
  name: string;
  kind: "spark" | "mac" | "host" | "ssh";
  source: "sparkdash" | "reachability";
  state: "up" | "down" | "unknown";
  lastSeenAt: string | null;
  firing: { rule: string; severity: "warning" | "critical"; since: string }[];
}

export type FleetDiagnosticCode =
  "collector_gap" | "sparkdash_restarted" | "version_changed" | "events_backlog" | "queue_full";

/** A Source System an Identity Binding may cover. */
export type IdentitySource = "github" | "linear" | "buzz";

/** One reviewed mapping from a source account to one Actor, with the review's evidence. */
export interface SourceIdentityBinding {
  source: IdentitySource;
  sourceAccount: string;
  actorId: string;
  actorKind: "human" | "agent" | "system";
  /** Required for an agent, forbidden for a human. */
  accountableHumanId?: string;
  evidenceRef: string;
}

/** The reviewed snapshot homer-catalog serves, contract `home.identity-bindings/v1`. */
export interface IdentityBindingSnapshot {
  contract: "home.identity-bindings/v1";
  revision: number;
  updatedAt: string;
  bindings: SourceIdentityBinding[];
}

/** The Actor one source account resolves to, or Unattributed. */
export type IdentityResolution =
  | {
      status: "attributed";
      source: IdentitySource;
      sourceAccount: string;
      actorId: string;
      actorKind: "human" | "agent" | "system";
      accountableHumanId?: string;
      evidenceRef: string;
      revision: number;
    }
  | {
      status: "unattributed";
      source: IdentitySource;
      sourceAccount: string;
      revision: number;
    };

/** The pinned agent-context commit Homer consumes, and each file's sha256. */
export interface ContextPinSnapshot {
  repository: string;
  commit: string;
  pinnedAt: string;
  files: Readonly<Record<string, string>>;
}

/** A Langfuse run trace, by id and optional link only; the trace's payload stays in Langfuse. */
export interface TraceRef {
  provider: "langfuse";
  traceId: string;
  url?: string;
}

/** A Knowledge Flag's optional metadata: ids, hashes and links only, never the flag's text. */
export interface KnowledgeFlagData {
  gapKind?: "missing" | "wrong" | "stale";
  targetRef?: string;
  observationHash?: string;
  traceRef?: TraceRef;
  verdictEventKey?: string;
}

export type RoutingProviderId =
  "openrouter" | "qwen-studio" | "cloudflare-workers-ai" | "anthropic" | "openai" | "xai" | "local";

export type RoutingTaskClass =
  "coding" | "repo_audit" | "spec_design" | "risk_classification" | "curator_run" | "general_local";

/** One provider's budgets and where its credential's name is read from. Never a secret. */
export interface ProviderBudgetLimits {
  provider: RoutingProviderId;
  endpointHost: string | null;
  maxUsdPerCall: number;
  maxUsdPerPtDay: number | null;
  minCreditFloorUsd: number | null;
  credentialEnvName: string | null;
}

/** One route: the model a task class runs on, and what it may spend. */
export interface ModelRouteRule {
  routeId: string;
  taskClass: RoutingTaskClass;
  priority: number;
  provider: RoutingProviderId;
  model: string;
  reasoningEffort?: "low" | "medium" | "high";
  maxContextTokens: number;
  maxUsdPerCall: number;
  requiresHumanApprovalOverUsd: number | null;
}

/** The versioned, read-only routing policy, contract `home.routing-policy/v1`. */
export interface RoutingPolicy {
  contract: "home.routing-policy/v1";
  revision: number;
  effectiveAt: string;
  timeZone: "America/Los_Angeles";
  providers: ProviderBudgetLimits[];
  routes: ModelRouteRule[];
}

/** The Fleet Collector's report for one poll, contract `home.fleet-report/v1`. */
export interface FleetReport {
  contract: "home.fleet-report/v1";
  reportId: string;
  collector: { name: "fleet-collector"; version: string };
  collectedAt: string;
  sparkdash: {
    state: "ok" | "unreachable" | "metrics_off" | "alerts_off" | "shape_changed";
    version: string | null;
    pinnedVersion: string;
  };
  machines: FleetMachine[];
  diagnostics: { code: FleetDiagnosticCode; since: string }[];
  events: ActivityEvent[];
}
