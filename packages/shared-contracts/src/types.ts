/**
 * Hand-written types for the JSON Schemas in specs/integration-contracts.
 * The schema files are the authority. These names use the glossary terms.
 */

export type SourceSystem = "github" | "linear" | "control-room" | "software-factory";

export type ActorKind = "human" | "agent" | "system" | "unknown";

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
  | "factory.verdict_recorded";

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

export interface ActivityEvent {
  contract: "home.activity-event/v1";
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
