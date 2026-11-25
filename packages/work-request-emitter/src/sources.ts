import {
  readGitHubIssue,
  readLinearIssue,
  readManualRequest,
  type JevFetch,
  type WorkRequestResult,
  type WorkRequestSource,
} from "@zs-home/shared-contracts";
import { DEFAULT_REVIEWED_REF, readReviewedFile } from "./reviewed.js";
import type { Runner } from "./run.js";

/**
 * Read one source object from where it lives, then hand the raw response to
 * the builder's reader. Linear is read with a read-only API key, GitHub with
 * the machine's own `gh` authentication, and a manual request from the
 * reviewed ref of the checkout (see `reviewed.ts`), never its working tree.
 * A failure to reach a source says which source, never a credential.
 */

export class SourceUnreachableError extends Error {
  constructor(system: "Linear" | "GitHub" | "manual request", detail: string) {
    super(`${system} could not be read: ${detail}`);
    this.name = "SourceUnreachableError";
  }
}

const LINEAR_SOURCE = /^linear:(ZER-[0-9]+)$/;
const GITHUB_SOURCE = /^github:([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)#([0-9]+)$/;
const MANUAL_SOURCE = /^manual:([a-z0-9-]+)$/;

const LINEAR_QUERY = `query WorkRequestSource($id: String!) {
  issue(id: $id) {
    identifier
    title
    description
    createdAt
    url
    state { type }
    project { name }
    creator { id }
  }
}`;

export interface SourceReaders {
  fetch: JevFetch;
  run: Runner;
  /** Read only when a Linear source is emitted. */
  linearApiKey: () => Promise<string>;
  /** The checkout whose `docs/work-requests/` holds manual requests. */
  repositoryRoot: string;
  /** The reviewed ref manual requests are read from. Default `origin/main`. */
  reviewedRef?: string;
}

/** Read the source a `source` string names. An unknown form is refused. */
export async function readSource(
  source: string,
  readers: SourceReaders,
): Promise<WorkRequestResult<WorkRequestSource>> {
  const linear = LINEAR_SOURCE.exec(source);
  if (linear !== null) {
    const raw = await fetchLinearIssue(linear[1] ?? "", readers);
    return raw === undefined ? notFound() : readLinearIssue(raw);
  }
  const github = GITHUB_SOURCE.exec(source);
  if (github !== null) {
    const [, owner = "", repo = "", issue = ""] = github;
    const raw = await fetchGitHubIssue(owner, repo, issue, readers.run);
    return raw === undefined ? notFound() : readGitHubIssue(source, raw);
  }
  const manual = MANUAL_SOURCE.exec(source);
  if (manual !== null) {
    const slug = manual[1] ?? "";
    const ref = readers.reviewedRef ?? DEFAULT_REVIEWED_REF;
    const raw = await readManualFile(readers.run, readers.repositoryRoot, ref, slug);
    return raw === undefined
      ? {
          ok: false,
          code: "source_not_found",
          field: "source",
          detail: `docs/work-requests/${slug}.json is not on ${ref}.`,
        }
      : readManualRequest(slug, raw);
  }
  return {
    ok: false,
    code: "source_malformed",
    field: "source",
    detail: "The source is not linear:ZER-<n>, github:<owner>/<repo>#<n> or manual:<slug>.",
  };
}

async function fetchLinearIssue(identifier: string, readers: SourceReaders): Promise<unknown> {
  const apiKey = await readers.linearApiKey();
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 15_000);
  try {
    let response: Awaited<ReturnType<JevFetch>>;
    try {
      response = await readers.fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: { Authorization: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ query: LINEAR_QUERY, variables: { id: identifier } }),
        signal: controller.signal,
      });
    } catch {
      throw new SourceUnreachableError("Linear", "the request failed or timed out.");
    }
    if (!response.ok) {
      throw new SourceUnreachableError("Linear", `HTTP ${String(response.status)}.`);
    }
    const payload: unknown = await response.json().catch(() => undefined);
    if (typeof payload !== "object" || payload === null) {
      throw new SourceUnreachableError("Linear", "the response is not JSON.");
    }
    const data = (payload as { data?: unknown }).data;
    const issue =
      typeof data === "object" && data !== null ? (data as { issue?: unknown }).issue : undefined;
    // Linear answers an unknown identifier with a null issue and an error entry.
    return issue === null || issue === undefined ? undefined : issue;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGitHubIssue(
  owner: string,
  repo: string,
  issue: string,
  run: Runner,
): Promise<unknown> {
  const result = await run("gh", ["api", `repos/${owner}/${repo}/issues/${issue}`]);
  if (result.code !== 0) {
    if (/HTTP 404|Not Found/.test(result.stderr)) return undefined;
    throw new SourceUnreachableError("GitHub", "`gh api` failed; check `gh auth status`.");
  }
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch {
    throw new SourceUnreachableError("GitHub", "the response is not JSON.");
  }
}

async function readManualFile(
  run: Runner,
  repositoryRoot: string,
  ref: string,
  slug: string,
): Promise<unknown> {
  const path = `docs/work-requests/${slug}.json`;
  const text = await readReviewedFile(run, repositoryRoot, ref, path);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SourceUnreachableError("manual request", `${path} on ${ref} is not JSON.`);
  }
}

function notFound(): WorkRequestResult<never> {
  return {
    ok: false,
    code: "source_not_found",
    field: "source",
    detail: "The source does not exist.",
  };
}
