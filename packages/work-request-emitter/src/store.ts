import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, link, lstat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The request store (specs/work-requests/spec.md, "The request store"): one file
 * per requestId holding the recorded request exactly as first emitted, beside it
 * the risk-tier decision, and after a delivery the receipt.
 *
 * A record is created atomically and never overwritten, renamed or deleted: the
 * request is written to a temporary file and hard-linked into place, and `link`
 * fails when the name exists. The request file is written last, so a decision
 * file without its request is not a record and the next emission replaces it.
 */

export class StoreUnavailableError extends Error {
  constructor(reason: string) {
    super(`The Work Request store is unavailable: ${reason}`);
    this.name = "StoreUnavailableError";
  }
}

export interface StoredRecord {
  /** The request file's bytes, exactly as recorded. A retry prints these. */
  bytes: string;
  request: unknown;
  /** The risk-tier decision, when its file is present and parses. */
  risk?: unknown;
}

const REQUEST_ID = /^WR-\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,48}$/;

export class RequestStore {
  private constructor(readonly directory: string) {}

  /** Open an existing store. A missing, non-directory or unwritable store stops here. */
  static async open(directory: string): Promise<RequestStore> {
    let isDirectory: boolean;
    try {
      isDirectory = (await lstat(directory)).isDirectory();
      await access(directory, constants.R_OK | constants.W_OK);
    } catch {
      throw new StoreUnavailableError("it does not exist or cannot be read and written.");
    }
    if (!isDirectory) {
      throw new StoreUnavailableError("it is not a directory.");
    }
    return new RequestStore(directory);
  }

  async read(requestId: string): Promise<StoredRecord | undefined> {
    const requestPath = this.path(requestId, ".json");
    let bytes: string;
    try {
      bytes = await readFile(requestPath, "utf8");
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw new StoreUnavailableError(`the record ${requestId} cannot be read.`);
    }
    let request: unknown;
    try {
      request = JSON.parse(bytes) as unknown;
    } catch {
      // A record never changes, so a broken one is an incident, not something to replace.
      throw new StoreUnavailableError(`the record ${requestId} is not JSON.`);
    }
    const risk = await this.readOptionalJson(this.path(requestId, ".risk.json"));
    return { bytes, request, ...(risk === undefined ? {} : { risk }) };
  }

  /**
   * Record a new request with its risk decision. Returns `"exists"`, and writes
   * nothing over it, when a record for the id is already there.
   */
  async record(
    requestId: string,
    requestBytes: string,
    riskBytes: string,
  ): Promise<"recorded" | "exists"> {
    const requestPath = this.path(requestId, ".json");
    const riskPath = this.path(requestId, ".risk.json");
    // One emission per id at a time, so a racing emission cannot pair its
    // decision with another's request.
    const lockPath = join(this.directory, `.${requestId}.lock`);
    try {
      await writeFile(lockPath, "", { flag: "wx" });
    } catch {
      throw new StoreUnavailableError(
        `another emission of ${requestId} is running, or a stale lock file remains: remove .${requestId}.lock if no emitter is running.`,
      );
    }
    try {
      if (await exists(requestPath)) {
        return "exists";
      }
      // The decision first, by atomic replacement: alone, it is not a record.
      const riskTemp = this.temporary(requestId);
      await writeFile(riskTemp, riskBytes, { encoding: "utf8", flag: "wx" });
      await rename(riskTemp, riskPath);
      // Then the request, last, linked into place so an existing record is never replaced.
      const requestTemp = this.temporary(requestId);
      await writeFile(requestTemp, requestBytes, { encoding: "utf8", flag: "wx" });
      try {
        await link(requestTemp, requestPath);
        return "recorded";
      } catch (error) {
        if (isCode(error, "EEXIST")) return "exists";
        throw new StoreUnavailableError(`the record ${requestId} could not be written.`);
      } finally {
        await unlink(requestTemp).catch(() => undefined);
      }
    } finally {
      await unlink(lockPath).catch(() => undefined);
    }
  }

  private path(requestId: string, suffix: string): string {
    if (!REQUEST_ID.test(requestId)) {
      throw new Error("not a requestId");
    }
    return join(this.directory, `${requestId}${suffix}`);
  }

  private temporary(requestId: string): string {
    return join(this.directory, `.${requestId}.${randomUUID()}.tmp`);
  }

  private async readOptionalJson(path: string): Promise<unknown> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as unknown;
    } catch {
      return undefined;
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw new StoreUnavailableError("a record cannot be checked.");
  }
}

function isMissing(error: unknown): boolean {
  return isCode(error, "ENOENT");
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}
