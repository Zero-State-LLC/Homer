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
  "home.activity-event/v1" | "home.activity-event/v2" | "home.activity-event/v3";

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
