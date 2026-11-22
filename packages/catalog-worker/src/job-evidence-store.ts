import { DurableObject } from "cloudflare:workers";
import type { GitHubJobObservation } from "@zs-home/github-sync";

/** Separate operational evidence store. These are not Activity Events. */
export interface JobEvidenceAdmission {
  deliveryId: string;
  payloadSha256: string;
  receivedAt: string;
  observation: GitHubJobObservation;
}
export interface JobEvidenceReceipt {
  deliveryId: string;
  sequence: number;
  receivedAt: string;
  payloadSha256: string;
  evidenceKey: string;
}
export type JobEvidenceOutcome =
  | { outcome: "appended" | "duplicate"; receipt: JobEvidenceReceipt }
  | { outcome: "conflict" | "refused"; reason: string };

export interface JobEvidenceHistory {
  state: "queued" | "in_progress" | "completed" | "unknown";
  observation: GitHubJobObservation | null;
  receipts: JobEvidenceReceipt[];
  conflicts: string[];
  historyTruncated: boolean;
}
export const MAX_JOB_EVIDENCE_ROWS = 10000;
const MAX_JOB_HISTORY = 200;

function validInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19) === value.slice(0, 19);
}
function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function validAdmission(value: unknown): value is JobEvidenceAdmission {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Partial<JobEvidenceAdmission>;
  const o = v.observation;
  return (
    typeof v.deliveryId === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v.deliveryId) &&
    typeof v.payloadSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(v.payloadSha256) &&
    validInstant(v.receivedAt) &&
    !!o &&
    o.version === 1 &&
    positive(o.repositoryId) &&
    positive(o.workflowRunId) &&
    positive(o.jobId) &&
    typeof o.repository === "string" &&
    /^Zero-State-LLC\/[A-Za-z0-9._-]{1,100}$/.test(o.repository) &&
    typeof o.evidenceUrl === "string" &&
    o.evidenceUrl.startsWith("https://github.com/" + o.repository + "/") &&
    ["queued", "in_progress", "completed"].includes(o.status) &&
    o.provenance?.sourceSystem === "github" &&
    o.provenance.deliveryId === v.deliveryId &&
    o.provenance.sourceUrl === o.evidenceUrl
  );
}
interface EvidenceRow {
  receipt: string;
  observation: string;
  payload_sha256: string;
}
const rank: Record<GitHubJobObservation["status"], number> = {
  queued: 1,
  in_progress: 2,
  completed: 3,
};

/**
 * Only invoked by a trusted Worker after HMAC verification and repository admission.
 * All accepted deliveries are immutable. A late webhook is retained as evidence,
 * but never overwrites a completed job in the read-only projection.
 */
export class WorkflowJobEvidenceObject extends DurableObject<unknown> {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS workflow_job_evidence (
        sequence INTEGER PRIMARY KEY,
        delivery_id TEXT NOT NULL UNIQUE,
        repository_id INTEGER NOT NULL,
        workflow_run_id INTEGER NOT NULL,
        job_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL,
        observation TEXT NOT NULL,
        receipt TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS workflow_job_evidence_by_job
      ON workflow_job_evidence(repository_id, workflow_run_id, job_id, sequence);
      CREATE TRIGGER IF NOT EXISTS job_evidence_no_update
      BEFORE UPDATE ON workflow_job_evidence
      BEGIN SELECT RAISE(ABORT, 'Job evidence is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS job_evidence_no_delete
      BEFORE DELETE ON workflow_job_evidence
      BEGIN SELECT RAISE(ABORT, 'Job evidence is immutable'); END;
    `);
  }

  admit(input: JobEvidenceAdmission): JobEvidenceOutcome {
    if (!validAdmission(input)) return { outcome: "refused", reason: "invalid_job_evidence" };
    return this.ctx.storage.transactionSync(() => {
      const prior = this.ctx.storage.sql
        .exec<EvidenceRow>(
          "SELECT receipt, observation, payload_sha256 FROM workflow_job_evidence WHERE delivery_id = ?",
          input.deliveryId,
        )
        .toArray()[0];
      if (prior) {
        // Compare exact original-body digest, not the fresh collection timestamp.
        if (prior.payload_sha256 !== input.payloadSha256)
          return { outcome: "conflict", reason: "delivery_payload_conflict" };
        return {
          outcome: "duplicate",
          receipt: JSON.parse(prior.receipt) as JobEvidenceReceipt,
        };
      }
      const count = this.ctx.storage.sql
        .exec<{ n: number }>("SELECT COUNT(*) AS n FROM workflow_job_evidence")
        .one().n;
      if (count >= MAX_JOB_EVIDENCE_ROWS)
        return { outcome: "refused", reason: "evidence_capacity_exhausted" };
      const last = this.ctx.storage.sql
        .exec<{ n: number }>("SELECT COALESCE(MAX(sequence), 0) AS n FROM workflow_job_evidence")
        .one().n;
      const sequence = last + 1;
      const observation = structuredClone(input.observation);
      const receipt: JobEvidenceReceipt = {
        sequence,
        deliveryId: input.deliveryId,
        receivedAt: input.receivedAt,
        payloadSha256: input.payloadSha256,
        evidenceKey: `github:workflow_job:${observation.repositoryId}/${observation.workflowRunId}/${observation.jobId}/${input.deliveryId}`,
      };
      this.ctx.storage.sql.exec(
        "INSERT INTO workflow_job_evidence (sequence, delivery_id, repository_id, workflow_run_id, job_id, action, payload_sha256, observation, receipt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        sequence,
        input.deliveryId,
        observation.repositoryId,
        observation.workflowRunId,
        observation.jobId,
        observation.status,
        input.payloadSha256,
        JSON.stringify(observation),
        JSON.stringify(receipt),
      );
      return { outcome: "appended", receipt };
    });
  }

  /** Trusted internal RPC only. No public route is provided for this method. */
  readJob(repositoryId: number, workflowRunId: number, jobId: number): JobEvidenceHistory {
    if (![repositoryId, workflowRunId, jobId].every(positive))
      throw new RangeError("invalid_job_identity");
    const rows = this.ctx.storage.sql
      .exec<EvidenceRow>(
        "SELECT receipt, observation, payload_sha256 FROM workflow_job_evidence WHERE repository_id = ? AND workflow_run_id = ? AND job_id = ? ORDER BY sequence ASC LIMIT ?",
        repositoryId,
        workflowRunId,
        jobId,
        MAX_JOB_HISTORY + 1,
      )
      .toArray();
    const historyTruncated = rows.length > MAX_JOB_HISTORY;
    const selectedRows = rows.slice(0, MAX_JOB_HISTORY);
    const receipts = selectedRows.map((row) => JSON.parse(row.receipt) as JobEvidenceReceipt);
    if (historyTruncated)
      return {
        state: "unknown",
        observation: null,
        receipts,
        conflicts: ["history_limit"],
        historyTruncated,
      };
    const observations = selectedRows.map(
      (row) => JSON.parse(row.observation) as GitHubJobObservation,
    );
    let maxRank = 0;
    let selected: GitHubJobObservation | null = null;
    const conflicts = new Set<string>();
    for (const observation of observations) {
      const next = rank[observation.status];
      if (next > maxRank) {
        maxRank = next;
        selected = observation;
      } else if (next === maxRank && selected) {
        // Repeated state deliveries may provide distinct observation timestamps.
        // A contradictory terminal claim is not trustworthy.
        if (
          next === 3 &&
          (observation.conclusion !== selected.conclusion ||
            observation.runnerId !== selected.runnerId ||
            observation.headSha !== selected.headSha ||
            observation.completedAt !== selected.completedAt)
        )
          conflicts.add("conflicting_terminal_evidence");
      }
    }
    if (conflicts.size) selected = null;
    return {
      state: selected?.status ?? "unknown",
      observation: selected ? structuredClone(selected) : null,
      receipts,
      conflicts: [...conflicts],
      historyTruncated: false,
    };
  }
}
