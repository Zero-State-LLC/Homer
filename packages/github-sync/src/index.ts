import { validateActivityEvent, type ActivityEvent } from "@zs-home/shared-contracts";

export interface GitHubCollectionContext {
  repositoryId: number;
  repository: string;
  projectId?: string;
  collectedAt: string;
}
export type MappingResult =
  | { outcome: "mapped"; event: ActivityEvent }
  | { outcome: "skipped"; reason: "not_merged" }
  | { outcome: "refused"; reason: string };

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function positiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
const refuse = (reason: string): MappingResult => ({ outcome: "refused", reason });

/** Pure mapping of parsed GitHub JSON. The caller owns transport authentication. */
export function mapMergedPullRequest(
  input: unknown,
  context: GitHubCollectionContext,
): MappingResult {
  if (
    !context ||
    !positiveId(context.repositoryId) ||
    typeof context.repository !== "string" ||
    !/^Zero-State-LLC\/[A-Za-z0-9._-]+$/.test(context.repository) ||
    (context.projectId !== undefined &&
      (typeof context.projectId !== "string" || !/^project:[a-z0-9-]+$/.test(context.projectId)))
  )
    return refuse("invalid_context");
  const pr = record(input);
  const repo = record(record(pr?.base)?.repo);
  if (!pr || !repo) return refuse("invalid_payload");
  if (repo.id !== context.repositoryId || repo.full_name !== context.repository)
    return refuse("repository_mismatch");
  if (!positiveId(pr.id) || !positiveId(pr.number)) return refuse("invalid_pr_identity");
  if (pr.state !== "open" && pr.state !== "closed") return refuse("invalid_state");
  if (typeof pr.merged !== "boolean") return refuse("missing_merge_status");
  if (!pr.merged) {
    if (pr.merged_at !== null) return refuse("inconsistent_merge_status");
    return { outcome: "skipped", reason: "not_merged" };
  }
  if (pr.state !== "closed") return refuse("inconsistent_merge_status");
  if (typeof pr.merge_commit_sha !== "string" || !/^[a-f0-9]{40}$/.test(pr.merge_commit_sha))
    return refuse("invalid_merge_sha");
  const merger = record(pr.merged_by);
  if (
    !merger ||
    !positiveId(merger.id) ||
    typeof merger.login !== "string" ||
    !/^[A-Za-z0-9-]+(?:\[bot\])?$/.test(merger.login) ||
    merger.login.length > 100
  )
    return refuse("missing_merge_account");
  const url = `https://github.com/${context.repository}/pull/${pr.number}`;
  if (pr.html_url !== url) return refuse("source_url_mismatch");
  if (typeof pr.merged_at !== "string") return refuse("missing_merge_time");
  const event: ActivityEvent = {
    contract: "home.activity-event/v1",
    eventKey: `github:pull_request.merged:${context.repositoryId}/${pr.id}/${pr.merge_commit_sha}`,
    kind: "pull_request.merged",
    occurredAt: pr.merged_at,
    actor: { sourceAccount: `github:${merger.login}` },
    repository: context.repository,
    ...(context.projectId !== undefined ? { projectId: context.projectId } : {}),
    subject: `Pull request #${pr.number} merged`,
    provenance: {
      sourceSystem: "github",
      sourceObjectId: String(pr.id),
      sourceUrl: url,
      collector: "homer-github-merged-pr",
      collectorVersion: "1.0.0",
      collectedAt: context.collectedAt,
    },
    evidence: [{ label: "Merged pull request", url }],
    data: {
      pullRequestNumber: pr.number,
      mergeCommitSha: pr.merge_commit_sha,
      sourceAccountId: merger.id,
    },
  };
  if (!validateActivityEvent(event).ok) return refuse("invalid_activity_event");
  return { outcome: "mapped", event };
}

export { GitHubMappingCatalog, parseMappingSnapshot } from "./catalog.js";
export type { MappingSnapshot, MappingStore, RepositoryMapping } from "./catalog.js";
