import { parseMappingSnapshot, type MappingSnapshot } from "@zs-home/github-sync";

export const MAX_ARCHIVE_BYTES = 768 * 1024;
export const MAX_ARCHIVE_REVISIONS = 1000;
export interface CatalogHistoryEntry {
  snapshot: MappingSnapshot;
  principalDigest: string;
  recordedAt: string;
}
export interface CatalogArchive {
  version: 1;
  headRevision: number;
  entries: CatalogHistoryEntry[];
  digest: string;
}
export function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}
function exactKeys(value: object, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error("invalid_catalog_archive");
}
export function parseHistoryEntry(input: unknown, revision: number): CatalogHistoryEntry {
  const value = input as CatalogHistoryEntry | null;
  if (!value || typeof value !== "object") throw new Error("invalid_catalog_archive");
  exactKeys(value, ["snapshot", "principalDigest", "recordedAt"]);
  const snapshot = parseMappingSnapshot(value.snapshot);
  exactKeys(value.snapshot, ["version", "revision", "repositories"]);
  for (const repository of value.snapshot.repositories)
    exactKeys(repository, ["repositoryId", "repository", "enabled", "projectId"]);
  if (
    snapshot.revision !== revision ||
    encodedBytes(snapshot) > 256 * 1024 ||
    typeof value.principalDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.principalDigest) ||
    typeof value.recordedAt !== "string" ||
    !Number.isFinite(Date.parse(value.recordedAt)) ||
    new Date(value.recordedAt).toISOString() !== value.recordedAt
  )
    throw new Error("invalid_catalog_archive");
  return { snapshot, principalDigest: value.principalDigest, recordedAt: value.recordedAt };
}
async function digest(payload: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function createArchive(entries: CatalogHistoryEntry[]): Promise<CatalogArchive> {
  if (entries.length > MAX_ARCHIVE_REVISIONS) throw new Error("archive_too_large");
  const normalized = entries.map((entry, index) => parseHistoryEntry(entry, index + 1));
  const payload = { version: 1 as const, headRevision: normalized.length, entries: normalized };
  if (encodedBytes({ ...payload, digest: "0".repeat(64) }) > MAX_ARCHIVE_BYTES)
    throw new Error("archive_too_large");
  return { ...payload, digest: await digest(payload) };
}
export async function verifyArchive(
  input: unknown,
  expectedDigest: string,
): Promise<CatalogArchive> {
  if (encodedBytes(input) > MAX_ARCHIVE_BYTES) throw new Error("archive_too_large");
  const value = input as CatalogArchive | null;
  if (!value || typeof value !== "object") throw new Error("invalid_catalog_archive");
  exactKeys(value, ["version", "headRevision", "entries", "digest"]);
  if (
    value.version !== 1 ||
    !Array.isArray(value.entries) ||
    value.headRevision !== value.entries.length
  )
    throw new Error("invalid_catalog_archive");
  const archive = await createArchive(value.entries);
  if (archive.digest !== value.digest || archive.digest !== expectedDigest)
    throw new Error("archive_digest_mismatch");
  return archive;
}
