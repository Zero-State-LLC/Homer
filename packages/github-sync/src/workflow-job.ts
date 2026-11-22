/**
 * Pure mapping of GitHub workflow_job webhooks and read-only Actions enrichment.
 * The caller MUST authenticate the original webhook bytes before calling this.
 * No effects, API calls, Actor Identity Bindings, or runner assignments occur here.
 */
export interface GitHubJobContext {
  repositoryId: number;
  repository: string;
  collectedAt: string;
  deliveryId: string;
}

export interface GitHubProviderActor {
  id: number;
  login: string;
}

export interface GitHubJobObservation {
  version: 1;
  repositoryId: number;
  repository: string;
  workflowRunId: number;
  jobId: number;
  runAttempt: number | null;
  workflowId: number | null;
  jobName: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: string | null;
  headSha: string | null;
  runnerId: number | null;
  runnerGroupId: number | null;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  originalActor: GitHubProviderActor | null;
  triggeringActor: GitHubProviderActor | null;
  evidenceUrl: string;
  provenance: {
    sourceSystem: "github";
    sourceObjectId: string;
    sourceUrl: string;
    collector: "homer-github-workflow-job";
    collectorVersion: "0.1.0";
    collectedAt: string;
    deliveryId: string;
  };
}

export type GitHubJobMappingResult =
  | { outcome: "mapped"; observation: GitHubJobObservation }
  | { outcome: "ignored"; reason: "unsupported_action" }
  | { outcome: "refused"; reason: string };

export type GitHubJobEnrichmentResult =
  | { outcome: "enriched"; observation: GitHubJobObservation }
  | { outcome: "refused"; reason: string };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function id(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function utc(value: unknown): value is string {
  if (typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === value.slice(0, 19);
}
function optionalUtc(value: unknown): value is string | null {
  return value === null || utc(value);
}
function optionalId(value: unknown): value is number | null {
  return value === null || id(value);
}
function bounded(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max &&
    [...value].every((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    });
}
function validRepo(value: unknown): value is string {
  return typeof value === "string" && /^Zero-State-LLC\/[A-Za-z0-9._-]{1,100}$/.test(value);
}
function optionalSha(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^[a-f0-9]{40}$/i.test(value));
}
const conclusions = new Set([
  "success", "failure", "cancelled", "timed_out", "neutral",
  "skipped", "action_required", "stale"
]);
function optionalConclusion(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && conclusions.has(value));
}
function actor(value: unknown): GitHubProviderActor | null | undefined {
  if (value === null) return null;
  const v = object(value);
  if (!v || !id(v.id) ||
    typeof v.login !== "string" ||
    !/^[A-Za-z0-9-]+(?:\[bot\])?$/.test(v.login) ||
    v.login.length > 100) return undefined;
  return { id: v.id, login: v.login };
}
const refuse = (reason: string): GitHubJobMappingResult => ({ outcome: "refused", reason });

/** Only returns a candidate observation after transport authentication. */
export function mapWorkflowJobWebhook(input: unknown, context: GitHubJobContext): GitHubJobMappingResult {
  if (!id(context?.repositoryId) || !validRepo(context?.repository) ||
    !utc(context?.collectedAt) || !bounded(context?.deliveryId, 128))
    return refuse("invalid_context");
  const root = object(input);
  const repository = object(root?.repository);
  if (!root || !repository ||
    repository.id !== context.repositoryId ||
    repository.full_name !== context.repository)
    return refuse("repository_mismatch");
  if (!["queued", "in_progress", "completed"].includes(root.action as string))
    return { outcome: "ignored", reason: "unsupported_action" };
  const job = object(root.workflow_job);
  if (!job || !id(job.id) || !id(job.run_id) ||
    !(job.run_attempt === undefined || optionalId(job.run_attempt)) ||
    !bounded(job.name, 200) ||
    job.status !== root.action ||
    !optionalConclusion(job.conclusion ?? null) ||
    !optionalSha(job.head_sha ?? null) ||
    !optionalId(job.runner_id ?? null) ||
    !optionalId(job.runner_group_id ?? null) ||
    !optionalUtc(job.created_at ?? null) ||
    !optionalUtc(job.started_at ?? null) ||
    !optionalUtc(job.completed_at ?? null))
    return refuse("invalid_job_evidence");
  if (root.action !== "completed" && job.conclusion != null)
    return refuse("inconsistent_job_state");
  if (root.action === "completed" && job.completed_at == null)
    return refuse("missing_completion_time");
  const evidenceUrl = `https://github.com/${context.repository}/actions/runs/${job.run_id}/job/${job.id}`;
  if (job.html_url !== evidenceUrl) return refuse("job_url_mismatch");
  return {
    outcome: "mapped",
    observation: {
      version: 1,
      repositoryId: context.repositoryId,
      repository: context.repository,
      workflowRunId: job.run_id as number,
      jobId: job.id as number,
      runAttempt: id(job.run_attempt) ? job.run_attempt : null,
      workflowId: null,
      jobName: job.name as string,
      status: root.action as GitHubJobObservation["status"],
      conclusion: (job.conclusion ?? null) as string | null,
      headSha: (job.head_sha ?? null) as string | null,
      runnerId: (job.runner_id ?? null) as number | null,
      runnerGroupId: (job.runner_group_id ?? null) as number | null,
      createdAt: (job.created_at ?? null) as string | null,
      startedAt: (job.started_at ?? null) as string | null,
      completedAt: (job.completed_at ?? null) as string | null,
      originalActor: null,
      triggeringActor: null,
      evidenceUrl,
      provenance: {
        sourceSystem: "github",
        sourceObjectId: String(job.id),
        sourceUrl: evidenceUrl,
        collector: "homer-github-workflow-job",
        collectorVersion: "0.1.0",
        collectedAt: context.collectedAt,
        deliveryId: context.deliveryId,
      },
    },
  };
}

/**
 * Bind read-only GET workflow-run and GET job API records to one exact webhook job.
 * Preserve unbound GitHub actor IDs, never infer Homer Attribution from display names.
 * The caller handles authorization, HTTP pagination/rate limits and append receipts.
 */
export function enrichWorkflowJob(
  observation: GitHubJobObservation,
  runInput: unknown,
  jobInput: unknown,
): GitHubJobEnrichmentResult {
  const run = object(runInput);
  const job = object(jobInput);
  const runRepo = object(run?.repository);
  if (!run || !job || !runRepo ||
    runRepo.id !== observation.repositoryId ||
    runRepo.full_name !== observation.repository ||
    run.id !== observation.workflowRunId ||
    job.run_id !== observation.workflowRunId ||
    job.id !== observation.jobId ||
    !id(run.run_attempt) ||
    !id(run.workflow_id))
    return { outcome: "refused", reason: "enrichment_identity_mismatch" };
  if (observation.runAttempt !== null && observation.runAttempt !== run.run_attempt)
    return { outcome: "refused", reason: "enrichment_attempt_mismatch" };
  if (job.run_attempt != null && job.run_attempt !== run.run_attempt)
    return { outcome: "refused", reason: "enrichment_attempt_mismatch" };
  const original = actor(run.actor ?? null);
  const triggering = actor(run.triggering_actor ?? null);
  if (original === undefined || triggering === undefined)
    return { outcome: "refused", reason: "invalid_enrichment_actor" };
  if (!optionalSha(run.head_sha ?? null) ||
    (observation.headSha !== null && run.head_sha !== observation.headSha))
    return { outcome: "refused", reason: "enrichment_sha_mismatch" };
  if (!optionalId(job.runner_id ?? null) ||
    !optionalId(job.runner_group_id ?? null) ||
    (observation.runnerId !== null && job.runner_id != null &&
      job.runner_id !== observation.runnerId) ||
    (observation.runnerGroupId !== null && job.runner_group_id != null &&
      job.runner_group_id !== observation.runnerGroupId))
    return { outcome: "refused", reason: "enrichment_runner_mismatch" };
  if (!optionalUtc(job.created_at ?? null) ||
      !optionalUtc(job.started_at ?? null) ||
      !optionalUtc(job.completed_at ?? null))
    return { outcome: "refused", reason: "invalid_enrichment_timestamps" };
  if (!["queued", "in_progress", "completed"].includes(job.status as string) ||
      !optionalConclusion(job.conclusion ?? null))
    return { outcome: "refused", reason: "invalid_enrichment_status" };
  if (job.status !== "completed" && job.conclusion != null)
    return { outcome: "refused", reason: "inconsistent_enrichment_state" };
  // Preserve webhook state/timestamps; API is a separate read that can be newer.
  // Do not silently overwrite already admitted immutable Activity Event evidence.
  return {
    outcome: "enriched",
    observation: {
      ...structuredClone(observation),
      runAttempt: run.run_attempt as number,
      workflowId: run.workflow_id as number,
      headSha: observation.headSha ?? ((run.head_sha ?? null) as string | null),
      originalActor: original,
      triggeringActor: triggering,
    },
  };
}
