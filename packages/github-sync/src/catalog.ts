import { mapMergedPullRequest, type MappingResult } from "./mapping.js";

export interface RepositoryMapping {
  repositoryId: number;
  repository: string;
  projectId?: string;
  enabled: boolean;
}
export interface MappingSnapshot {
  version: 1;
  revision: number;
  repositories: RepositoryMapping[];
}
/** Implementations must persist atomically and compare the revision in the same transaction. */
export interface MappingStore {
  read(): Promise<unknown>;
  compareAndSwap(expectedRevision: number, next: MappingSnapshot): Promise<boolean>;
}

export function parseMappingSnapshot(input: unknown): MappingSnapshot {
  const value = input as MappingSnapshot | null;
  if (
    !value ||
    value.version !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Array.isArray(value.repositories)
  )
    throw new Error("invalid_mapping_snapshot");
  const ids = new Set<number>();
  const names = new Set<string>();
  const repositories = value.repositories.map((entry) => {
    if (
      !entry ||
      !Number.isSafeInteger(entry.repositoryId) ||
      entry.repositoryId <= 0 ||
      typeof entry.repository !== "string" ||
      !/^Zero-State-LLC\/[A-Za-z0-9._-]+$/.test(entry.repository) ||
      typeof entry.enabled !== "boolean" ||
      (entry.projectId !== undefined &&
        (typeof entry.projectId !== "string" || !/^project:[a-z0-9-]+$/.test(entry.projectId)))
    )
      throw new Error("invalid_repository_mapping");
    const name = entry.repository.toLowerCase();
    if (ids.has(entry.repositoryId) || names.has(name))
      throw new Error("duplicate_repository_mapping");
    ids.add(entry.repositoryId);
    names.add(name);
    return {
      repositoryId: entry.repositoryId,
      repository: entry.repository,
      enabled: entry.enabled,
      ...(entry.projectId !== undefined ? { projectId: entry.projectId } : {}),
    };
  });
  return { version: 1, revision: value.revision, repositories };
}

/** Internal capability only. An authenticated admin adapter must guard replace(). */
export class GitHubMappingCatalog {
  constructor(private readonly store: MappingStore) {}

  async list(): Promise<MappingSnapshot> {
    return parseMappingSnapshot(await this.store.read());
  }

  async replace(
    expectedRevision: number,
    repositories: RepositoryMapping[],
  ): Promise<MappingSnapshot> {
    const next = parseMappingSnapshot({ version: 1, revision: expectedRevision + 1, repositories });
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      throw new Error("invalid_expected_revision");
    if (!(await this.store.compareAndSwap(expectedRevision, structuredClone(next))))
      throw new Error("mapping_revision_conflict");
    return next;
  }

  async map(
    input: unknown,
    repositoryId: number,
    collectedAt: string,
  ): Promise<{ revision: number; result: MappingResult }> {
    const snapshot = await this.list();
    const mapping = snapshot.repositories.find((entry) => entry.repositoryId === repositoryId);
    if (!mapping || !mapping.enabled)
      return {
        revision: snapshot.revision,
        result: { outcome: "refused", reason: "repository_not_enabled" },
      };
    return {
      revision: snapshot.revision,
      result: mapMergedPullRequest(input, { ...mapping, collectedAt }),
    };
  }
}
