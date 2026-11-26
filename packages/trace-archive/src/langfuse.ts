import { MAX_BATCH_BYTES, MAX_FILES, MAX_FILE_BYTES, parseBatch, sha256 } from "./index.js";
import type { ArchiveBatch, ArchivePolicy, ObjectStore } from "./index.js";

/** Native manifest adapter pinned in specs/trace-archive/langfuse-export.md.
 * Does not infer source completeness, redact content, or manufacture source hashes.
 * SHA-256 values below describe bytes read from the private landing bucket. */
export interface LangfuseSource {
  projectId: string;
  prefix: string;
  policy: ArchivePolicy;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_native_manifest");
  return value as Record<string, unknown>;
}
function iso(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new Error("invalid_native_timestamp");
  return value;
}
export function nativeManifestPrefix(source: LangfuseSource): string {
  if (
    !/^[a-zA-Z0-9_-]{1,128}$/.test(source.projectId) ||
    !/^(?:[a-zA-Z0-9_-]+\/)*$/.test(source.prefix) ||
    source.policy.landingPrefix !== `${source.prefix}${source.projectId}/`
  )
    throw new Error("invalid_source_scope");
  return `${source.policy.landingPrefix}manifests/`;
}
export async function normalizeLangfuseManifest(
  key: string,
  source: LangfuseSource,
  landing: ObjectStore,
): Promise<{ json: string; batch: ArchiveBatch }> {
  const prefix = nativeManifestPrefix(source);
  if (
    !key.startsWith(prefix) ||
    !/^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.json$/.test(key.slice(prefix.length))
  )
    throw new Error("invalid_manifest_key");
  const bytes = await landing.read(key, 64 * 1024);
  if (!bytes || bytes.byteLength > 64 * 1024) throw new Error("missing_or_oversize_manifest");
  const native = object(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown,
  );
  const window = object(native.window);
  const start = iso(window.minTimestamp),
    end = iso(window.maxTimestamp);
  iso(native.createdAt);
  if (
    native.version !== 1 ||
    native.projectId !== source.projectId ||
    native.exportSource !== "EVENTS" ||
    native.maxTimestamp !== end ||
    start > end ||
    key !== `${prefix}${end.replace(/:/g, "-").slice(0, 19)}.json`
  )
    throw new Error("unsupported_native_manifest");
  if (
    !Array.isArray(native.files) ||
    native.files.length > MAX_FILES ||
    !Array.isArray(native.tables)
  )
    throw new Error("invalid_native_files");
  const allowedTables = new Set(["observations_v2", "scores"]);
  const tables = new Set<string>();
  for (const t of native.tables) {
    if (typeof t !== "string" || !allowedTables.has(t) || tables.has(t))
      throw new Error("invalid_native_tables");
    tables.add(t);
  }
  const keys = new Set<string>();
  let total = 0;
  // Validate every declaration before reading any data object.
  const files = native.files.map((input: unknown) => {
    const f = object(input);
    if (
      typeof f.table !== "string" ||
      !tables.has(f.table) ||
      f.fileType !== "JSONL" ||
      f.format !== "jsonl-raw" ||
      f.compressed !== false ||
      typeof f.contentType !== "string" ||
      !/^application\/(x-ndjson|jsonl)(?:; charset=utf-8)?$/.test(f.contentType) ||
      typeof f.key !== "string" ||
      !f.key.startsWith(`${source.policy.landingPrefix}${f.table}/`) ||
      !/^[a-zA-Z0-9_./-]+\.jsonl$/.test(f.key) ||
      f.key.split("/").some((part) => part === ".." || part === "." || part === "") ||
      keys.has(f.key) ||
      typeof f.sizeBytes !== "number" ||
      !Number.isSafeInteger(f.sizeBytes) ||
      f.sizeBytes < 0 ||
      f.sizeBytes > MAX_FILE_BYTES ||
      typeof f.rowCount !== "number" ||
      !Number.isSafeInteger(f.rowCount) ||
      f.rowCount < 0
    )
      throw new Error("unsupported_native_file");
    keys.add(f.key);
    total += f.sizeBytes;
    return { key: f.key, bytes: f.sizeBytes, rows: f.rowCount, table: f.table };
  });
  if (total > MAX_BATCH_BYTES || tables.size !== new Set(files.map((f) => f.table)).size)
    throw new Error("invalid_native_inventory");
  const normalized = [];
  for (const file of files) {
    const data = await landing.read(file.key, file.bytes);
    if (!data || data.byteLength !== file.bytes) throw new Error("native_size_mismatch");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
    if (lines.length !== file.rows) throw new Error("native_row_count_mismatch");
    for (const line of lines) {
      const row = object(JSON.parse(line) as unknown);
      if (
        row.project_id !== source.projectId ||
        typeof row.id !== "string" ||
        !row.id ||
        row.id.length > 256
      )
        throw new Error("native_row_scope_mismatch");
    }
    normalized.push({
      key: file.key,
      bytes: file.bytes,
      rows: file.rows,
      sha256: await sha256(data),
    });
  }
  // A retry must never bind data to a changed completion manifest.
  const again = await landing.read(key, 64 * 1024);
  const sourceManifestDigest = await sha256(bytes);
  if (!again || (await sha256(again)) !== sourceManifestDigest)
    throw new Error("native_manifest_changed");
  const batch = parseBatch(
    JSON.stringify({
      version: 1,
      environment: source.policy.environment,
      sourceProject: source.policy.sourceProject,
      sourceManifestDigest,
      windowStart: start,
      windowEnd: end,
      policyVersion: source.policy.version,
      files: normalized,
    }),
    source.policy,
  );
  return { batch, json: JSON.stringify(batch) };
}
