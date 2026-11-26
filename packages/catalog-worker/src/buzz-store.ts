import { DurableObject } from "cloudflare:workers";
import { parseBuzzChannelSnapshot, type BuzzChannelSnapshot } from "@zs-home/buzz-collector";

export const MAX_BUZZ_CATALOG_BYTES = 64 * 1024;

/**
 * The Buzz channel allowlist, with immutable history like the GitHub mapping catalog. Each
 * revision records only a digest of the authenticated principal who wrote it.
 */
export class BuzzChannelCatalogObject extends DurableObject<unknown> {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS buzz_channel_history (
        revision INTEGER PRIMARY KEY CHECK(revision > 0), snapshot TEXT NOT NULL,
        principal_digest TEXT NOT NULL, recorded_at TEXT NOT NULL
      ) STRICT;
      CREATE TRIGGER IF NOT EXISTS buzz_channel_no_update BEFORE UPDATE ON buzz_channel_history
        BEGIN SELECT RAISE(ABORT, 'Buzz channel history is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS buzz_channel_no_delete BEFORE DELETE ON buzz_channel_history
        BEGIN SELECT RAISE(ABORT, 'Buzz channel history is immutable'); END;
    `);
  }

  /** Revision 0, with no channels, until someone saves one: an empty catalog admits nothing. */
  read(): BuzzChannelSnapshot {
    const row = this.ctx.storage.sql
      .exec<{
        revision: number;
        snapshot: string;
      }>("SELECT revision, snapshot FROM buzz_channel_history ORDER BY revision DESC LIMIT 1")
      .toArray()[0];
    if (!row) return { version: 1, revision: 0, channels: [] };
    const snapshot = parseBuzzChannelSnapshot(JSON.parse(row.snapshot));
    if (snapshot.revision !== row.revision) throw new Error("catalog_integrity_failure");
    return snapshot;
  }

  replace(expectedRevision: number, input: unknown, principalDigest: string): boolean {
    const snapshot = parseBuzzChannelSnapshot(input);
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 ||
      snapshot.revision !== expectedRevision + 1 ||
      !/^[a-f0-9]{64}$/.test(principalDigest)
    )
      throw new Error("invalid_catalog_update");
    const encoded = JSON.stringify(snapshot);
    if (new TextEncoder().encode(encoded).length > MAX_BUZZ_CATALOG_BYTES)
      throw new Error("catalog_too_large");
    return this.ctx.storage.transactionSync(() => {
      if (this.read().revision !== expectedRevision) return false;
      this.ctx.storage.sql.exec(
        "INSERT INTO buzz_channel_history VALUES (?, ?, ?, ?)",
        snapshot.revision,
        encoded,
        principalDigest,
        new Date().toISOString(),
      );
      return true;
    });
  }
}
