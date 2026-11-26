/** Bounded archive primitive. No source completeness or Event Ledger claim. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_BATCH_BYTES = 16 * 1024 * 1024;
export const MAX_FILES = 32;
const encoder = new TextEncoder();
const digestPattern = /^[a-f0-9]{64}$/;
const slugPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface ArchiveFile {
  key: string;
  sha256: string;
  bytes: number;
  rows: number;
}
/** Internal normalized contract; this is NOT the Langfuse native manifest. */
export interface ArchiveBatch {
  version: 1;
  environment: "staging" | "production";
  sourceProject: string;
  sourceManifestDigest: string;
  windowStart: string;
  windowEnd: string;
  policyVersion: string;
  files: ArchiveFile[];
}
export interface ArchiveReceipt {
  version: 1;
  batchDigest: string;
  verifiedAt: string;
  integrity: "verified";
  sourceCoverage: "unknown";
  ledgerStatus: "pending";
  manifestKey: string;
}
export interface ObjectStore {
  /** Must reject oversize bodies before buffering them. Null means missing. */
  read(key: string, maxBytes: number): Promise<Uint8Array | null>;
  /** Atomic create-if-absent. False means an object already exists. Never overwrite. */
  create(key: string, bytes: Uint8Array): Promise<boolean>;
}
export interface ArchivePolicy {
  environment: ArchiveBatch["environment"];
  sourceProject: string;
  landingPrefix: string;
  version: string;
  /** Required reviewed validator: checks schema, privacy and expected row count.
   * Must throw on failure. No permissive default is supplied. */
  inspect(bytes: Uint8Array, expectedRows: number): Promise<void>;
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
function record(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("invalid_contract");
  const r = input as Record<string, unknown>;
  if (Object.keys(r).length !== keys.length || Object.keys(r).some((k) => !keys.includes(k)))
    throw new Error("invalid_contract");
  return r;
}
function timestamp(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))
    throw new Error("invalid_timestamp");
  const n = Date.parse(value);
  if (!Number.isFinite(n) || new Date(n).toISOString() !== value)
    throw new Error("invalid_timestamp");
  return n;
}
function safeKey(key: unknown): key is string {
  return (
    typeof key === "string" &&
    key.length <= 512 &&
    /^[a-zA-Z0-9_./-]+$/.test(key) &&
    !key.startsWith("/") &&
    key.split("/").every((p) => p !== "" && p !== "." && p !== "..")
  );
}
export function parseBatch(json: string, policy: ArchivePolicy): ArchiveBatch {
  if (encoder.encode(json).byteLength > 64 * 1024) throw new Error("manifest_too_large");
  const r = record(JSON.parse(json) as unknown, [
    "version",
    "environment",
    "sourceProject",
    "sourceManifestDigest",
    "windowStart",
    "windowEnd",
    "policyVersion",
    "files",
  ]);
  if (
    r.version !== 1 ||
    !["staging", "production"].includes(String(r.environment)) ||
    r.environment !== policy.environment ||
    r.sourceProject !== policy.sourceProject ||
    typeof r.sourceProject !== "string" ||
    !slugPattern.test(r.sourceProject) ||
    typeof r.sourceManifestDigest !== "string" ||
    !digestPattern.test(r.sourceManifestDigest) ||
    r.policyVersion !== policy.version ||
    !slugPattern.test(policy.version) ||
    !policy.landingPrefix.endsWith("/") ||
    !safeKey(policy.landingPrefix.slice(0, -1))
  )
    throw new Error("scope_or_policy_mismatch");
  if (timestamp(r.windowStart) > timestamp(r.windowEnd)) throw new Error("invalid_window");
  if (!Array.isArray(r.files) || r.files.length > MAX_FILES) throw new Error("invalid_files");
  const keys = new Set<string>();
  let total = 0;
  const files = r.files
    .map((input: unknown): ArchiveFile => {
      const f = record(input, ["key", "sha256", "bytes", "rows"]);
      if (
        !safeKey(f.key) ||
        !f.key.startsWith(policy.landingPrefix) ||
        keys.has(f.key) ||
        typeof f.sha256 !== "string" ||
        !digestPattern.test(f.sha256) ||
        typeof f.bytes !== "number" ||
        !Number.isSafeInteger(f.bytes) ||
        f.bytes < 0 ||
        f.bytes > MAX_FILE_BYTES ||
        typeof f.rows !== "number" ||
        !Number.isSafeInteger(f.rows) ||
        f.rows < 0
      )
        throw new Error("invalid_file");
      keys.add(f.key);
      total += f.bytes;
      return { key: f.key, sha256: f.sha256, bytes: f.bytes, rows: f.rows };
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (total > MAX_BATCH_BYTES) throw new Error("batch_too_large");
  return {
    version: 1,
    environment: policy.environment,
    sourceProject: policy.sourceProject,
    sourceManifestDigest: r.sourceManifestDigest,
    windowStart: r.windowStart as string,
    windowEnd: r.windowEnd as string,
    policyVersion: policy.version,
    files,
  };
}
async function readExact(
  store: ObjectStore,
  key: string,
  size: number,
  expected: string,
): Promise<Uint8Array> {
  const value = await store.read(key, size);
  if (!value) throw new Error("missing_object");
  if (value.byteLength !== size || (await sha256(value)) !== expected)
    throw new Error("integrity_mismatch");
  return value;
}
async function createVerified(store: ObjectStore, key: string, value: Uint8Array): Promise<void> {
  await store.create(key, value);
  await readExact(store, key, value.byteLength, await sha256(value));
}
export async function archiveBatch(
  json: string,
  policy: ArchivePolicy,
  landing: ObjectStore,
  archive: ObjectStore,
  now: string,
): Promise<ArchiveReceipt> {
  timestamp(now);
  const batch = parseBatch(json, policy);
  const batchBytes = encoder.encode(JSON.stringify(batch));
  const batchDigest = await sha256(batchBytes);
  const prefix = `archive/v1/${batch.environment}/${batch.sourceProject}/${batchDigest}`;
  // Verify all files and privacy before any archive write; bounded to MAX_BATCH_BYTES.
  const contents: Uint8Array[] = [];
  for (const file of batch.files) {
    const value = await readExact(landing, file.key, file.bytes, file.sha256);
    await policy.inspect(new Uint8Array(value), file.rows);
    contents.push(value);
  }
  for (let i = 0; i < batch.files.length; i++) {
    const file = batch.files[i]!;
    await createVerified(archive, `${prefix}/objects/${file.sha256}`, contents[i]!);
  }
  const manifestKey = `${prefix}/manifest.json`;
  await createVerified(archive, manifestKey, batchBytes);
  const receiptKey = `${prefix}/receipt.json`;
  const receipt: ArchiveReceipt = {
    version: 1,
    batchDigest,
    verifiedAt: now,
    integrity: "verified",
    sourceCoverage: "unknown",
    ledgerStatus: "pending",
    manifestKey,
  };
  await archive.create(receiptKey, encoder.encode(JSON.stringify(receipt)));
  const bytes = await archive.read(receiptKey, 2048);
  if (!bytes) throw new Error("missing_receipt");
  const previous = record(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown,
    [
      "version",
      "batchDigest",
      "verifiedAt",
      "integrity",
      "sourceCoverage",
      "ledgerStatus",
      "manifestKey",
    ],
  );
  timestamp(previous.verifiedAt);
  if (
    previous.version !== 1 ||
    previous.batchDigest !== batchDigest ||
    previous.integrity !== "verified" ||
    previous.sourceCoverage !== "unknown" ||
    previous.ledgerStatus !== "pending" ||
    previous.manifestKey !== manifestKey
  )
    throw new Error("receipt_conflict");
  return previous as unknown as ArchiveReceipt;
}

/** Entity expiry must come from source timestamps, never ingestion time. */
export function expiryRisk(
  now: string,
  earliestUnarchivedExpiry: string | null,
): "unknown" | "normal" | "incident" | "urgent" | "expired" {
  const at = timestamp(now);
  if (earliestUnarchivedExpiry === null) return "unknown";
  const remaining = timestamp(earliestUnarchivedExpiry) - at;
  if (remaining <= 0) return "expired";
  if (remaining < 72 * 3600_000) return "urgent";
  if (remaining < 7 * 24 * 3600_000) return "incident";
  return "normal";
}

/** Caller must authorize project scope before restore. No Langfuse or landing access. */
export async function restoreArchive(
  batchDigest: string,
  policy: ArchivePolicy,
  archive: ObjectStore,
): Promise<{ batch: ArchiveBatch; files: Uint8Array[] }> {
  if (
    !digestPattern.test(batchDigest) ||
    !slugPattern.test(policy.sourceProject) ||
    !["staging", "production"].includes(policy.environment)
  )
    throw new Error("invalid_restore_scope");
  const prefix = `archive/v1/${policy.environment}/${policy.sourceProject}/${batchDigest}`;
  const manifest = await archive.read(`${prefix}/manifest.json`, 64 * 1024);
  if (!manifest || (await sha256(manifest)) !== batchDigest)
    throw new Error("manifest_integrity_mismatch");
  const batch = parseBatch(new TextDecoder("utf-8", { fatal: true }).decode(manifest), policy);
  const files: Uint8Array[] = [];
  for (const file of batch.files) {
    const bytes = await readExact(
      archive,
      `${prefix}/objects/${file.sha256}`,
      file.bytes,
      file.sha256,
    );
    await policy.inspect(new Uint8Array(bytes), file.rows);
    files.push(bytes);
  }
  return { batch, files };
}
