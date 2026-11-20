import { DurableObject } from "cloudflare:workers";
import { parseMappingSnapshot, type MappingSnapshot } from "@zs-home/github-sync";

export const MAX_CATALOG_BYTES = 256 * 1024;
export class MappingCatalogObject extends DurableObject<unknown> {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS catalog_history (
        revision INTEGER PRIMARY KEY CHECK(revision > 0), snapshot TEXT NOT NULL,
        principal_digest TEXT NOT NULL, recorded_at TEXT NOT NULL
      ) STRICT;
      CREATE TRIGGER IF NOT EXISTS catalog_no_update BEFORE UPDATE ON catalog_history
        BEGIN SELECT RAISE(ABORT, 'Catalog history is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS catalog_no_delete BEFORE DELETE ON catalog_history
        BEGIN SELECT RAISE(ABORT, 'Catalog history is immutable'); END;
    `);
  }
  read(): MappingSnapshot {
    const row = this.ctx.storage.sql
      .exec<{ revision: number; snapshot: string }>(
        "SELECT revision, snapshot FROM catalog_history ORDER BY revision DESC LIMIT 1",
      )
      .toArray()[0];
    if (!row) return { version: 1, revision: 0, repositories: [] };
    const snapshot = parseMappingSnapshot(JSON.parse(row.snapshot));
    if (snapshot.revision !== row.revision) throw new Error("catalog_integrity_failure");
    return snapshot;
  }
  replace(expectedRevision: number, input: unknown, principalDigest: string): boolean {
    const snapshot = parseMappingSnapshot(input);
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 ||
      snapshot.revision !== expectedRevision + 1 ||
      !/^[a-f0-9]{64}$/.test(principalDigest)
    )
      throw new Error("invalid_catalog_update");
    const encoded = JSON.stringify(snapshot);
    if (new TextEncoder().encode(encoded).length > MAX_CATALOG_BYTES)
      throw new Error("catalog_too_large");
    return this.ctx.storage.transactionSync(() => {
      if (this.read().revision !== expectedRevision) return false;
      this.ctx.storage.sql.exec(
        "INSERT INTO catalog_history VALUES (?, ?, ?, ?)",
        snapshot.revision,
        encoded,
        principalDigest,
        new Date().toISOString(),
      );
      return true;
    });
  }
}
