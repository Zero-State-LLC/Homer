import type { HttpRead, SparkdashRead } from "../poll.js";

/** The only requests the Collector ever sends to sparkDash. */
export const SPARKDASH_PATHS = ["/api/health", "/metrics", "/api/alerts"] as const;
export type SparkdashPath = (typeof SPARKDASH_PATHS)[number];

const LOOPBACK = new Set(["127.0.0.1", "[::1]"]);
const DEFAULT_TIMEOUT_MS = 10_000;
/** sparkDash's largest answer here is `/metrics` for 64 units; anything far larger is not its. */
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

/** A request the client refuses before anything is sent. */
export class RefusedRequest extends Error {
  constructor(readonly reason: "method" | "path" | "host") {
    super(`refused before sending: ${reason}`);
    this.name = "RefusedRequest";
  }
}

export interface SparkdashClient {
  /**
   * Sends a request only when it is a `GET`, to one of the three paths, on the
   * configured loopback origin. Anything else throws `RefusedRequest` and
   * sends nothing.
   */
  request(method: string, url: string): Promise<HttpRead>;
  /** `/api/health`, `/metrics` and `/api/alerts`, one after another. */
  readAll(): Promise<SparkdashRead>;
}

export interface SparkdashClientOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

/** Throws `RefusedRequest` for anything but a `GET` to one of the three paths on `origin`. */
export function checkRequest(method: string, url: string, origin: string): URL {
  if (method !== "GET") throw new RefusedRequest("method");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RefusedRequest("host");
  }
  if (
    parsed.protocol !== "http:" ||
    !LOOPBACK.has(parsed.hostname) ||
    parsed.origin !== new URL(origin).origin ||
    parsed.username ||
    parsed.password
  )
    throw new RefusedRequest("host");
  if (
    !(SPARKDASH_PATHS as readonly string[]).includes(parsed.pathname) ||
    parsed.search ||
    parsed.hash
  )
    throw new RefusedRequest("path");
  return parsed;
}

/** The body as UTF-8 text, or undefined past `maxBytes` or when it is not UTF-8. */
async function readLimited(response: Response, maxBytes: number): Promise<string | undefined> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * The Collector's only HTTP client for sparkDash: `GET`-only, three paths,
 * loopback only, no redirects followed, no credential sent. It takes no
 * instructions from Homer or from sparkDash's answers.
 */
export function sparkdashClient(
  origin: string,
  options: SparkdashClientOptions = {},
): SparkdashClient {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  let base: string;
  try {
    // `http://127.0.0.1:3000/` and `http://127.0.0.1:3000` are the same origin.
    base = new URL(origin).origin;
  } catch {
    throw new RefusedRequest("host");
  }
  checkRequest("GET", `${base}/api/health`, base);
  const request = async (method: string, url: string): Promise<HttpRead> => {
    const target = checkRequest(method, url, base);
    let response: Response;
    try {
      response = await doFetch(target, {
        method: "GET",
        redirect: "error",
        headers: { Accept: "application/json, text/plain" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return "unreachable";
    }
    let body: string | undefined;
    try {
      body = await readLimited(response, maxBytes);
    } catch {
      return "unreachable";
    }
    // An answer the Collector cannot read is not sparkDash's: shape_changed in the core.
    return body === undefined ? { status: -1, body: "" } : { status: response.status, body };
  };
  return {
    request,
    async readAll() {
      return {
        health: await request("GET", `${base}/api/health`),
        metrics: await request("GET", `${base}/metrics`),
        alerts: await request("GET", `${base}/api/alerts`),
      };
    },
  };
}
