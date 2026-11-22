export { mapMergedPullRequest } from "./mapping.js";
export type { GitHubCollectionContext, MappingResult } from "./mapping.js";
export { GitHubMappingCatalog, parseMappingSnapshot } from "./catalog.js";
export type { MappingSnapshot, MappingStore, RepositoryMapping } from "./catalog.js";

export { mapWorkflowJobWebhook, enrichWorkflowJob } from "./workflow-job.js";
export type {
  GitHubJobContext,
  GitHubJobObservation,
  GitHubJobMappingResult,
  GitHubJobEnrichmentResult,
  GitHubProviderActor,
} from "./workflow-job.js";
