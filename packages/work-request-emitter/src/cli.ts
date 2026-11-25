import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { askJevForRiskTier, readWorkRequestPolicy, type JevFetch } from "@zs-home/shared-contracts";
import { emitWorkRequest } from "./emit.js";
import { nodeRunner, type Runner } from "./run.js";
import {
  checkReviewedRef,
  DEFAULT_REVIEWED_REF,
  readReviewedFile,
  ReviewedRefUnreadableError,
} from "./reviewed.js";
import { readSecret, SecretUnavailableError } from "./secrets.js";
import { readSource, SourceUnreachableError } from "./sources.js";
import { RequestStore, StoreUnavailableError } from "./store.js";

/**
 * `npm --silent run work-request -- <source> [--requester agent:<name>]
 * [--store <dir>] [--repo <dir>] [--ref <branch>]`
 *
 * Prints the Work Request JSON on standard output, and what happened on
 * standard error. Use `--silent`: without it npm prints its own banner on
 * standard output, and `> request.json` would not hold JSON. Or run
 * `node packages/work-request-emitter/dist/cli.js <source>` after a build.
 *
 * The policy file and manual requests are read from `--ref` (default
 * `origin/main`) of the `--repo` checkout, never from its working tree: fetch
 * first. Exit 0: emitted, or a Duplicate that printed the recorded
 * request. Exit 1: refused with a reason code. Exit 2: usage or configuration,
 * such as a missing store or credential.
 *
 * Credentials, each by 1Password reference (`<NAME>_REF=op://...`) or in the
 * environment (`<NAME>`): HOMER_LINEAR_API_KEY (read-only, for Linear sources),
 * HOMER_CLOUDFLARE_API_TOKEN and HOMER_CLOUDFLARE_ACCOUNT_ID (Workers AI, for
 * Jev, only on a first emission). GitHub uses the machine's `gh` login.
 */

export interface CliHost {
  env: Readonly<Record<string, string | undefined>>;
  fetch: JevFetch;
  run: Runner;
  now(): Date;
  cwd: string;
}

export interface CliOutput {
  stdout(text: string): void;
  stderr(text: string): void;
}

const USAGE =
  "usage: npm --silent run work-request -- <linear:ZER-<n> | github:<owner>/<repo>#<n> | manual:<slug>> [--requester agent:<name>] [--store <dir>] [--repo <dir>] [--ref <branch>]\n";
const REQUESTER = /^agent:[A-Za-z0-9._-]+$/;
const FLAGS = new Set(["--requester", "--store", "--repo", "--ref"]);

export async function runCli(
  argv: readonly string[],
  host: CliHost,
  out: CliOutput,
): Promise<number> {
  const parsed = parseArguments(argv);
  if (parsed === undefined) {
    out.stderr(USAGE);
    return 2;
  }
  const requester = parsed.flags["--requester"] ?? host.env["HOMER_WORK_REQUEST_REQUESTER"];
  if (requester === undefined || !REQUESTER.test(requester)) {
    out.stderr(
      "error: name the emitting Agent with --requester agent:<name> or HOMER_WORK_REQUEST_REQUESTER.\n",
    );
    return 2;
  }
  const repositoryRoot = resolve(host.cwd, parsed.flags["--repo"] ?? ".");
  const storeDirectory =
    parsed.flags["--store"] ??
    host.env["HOMER_WORK_REQUEST_STORE"] ??
    (host.env["HOME"] === undefined
      ? undefined
      : join(host.env["HOME"], ".local", "state", "homer", "work-requests"));
  if (storeDirectory === undefined) {
    out.stderr("error: set HOMER_WORK_REQUEST_STORE or --store.\n");
    return 2;
  }

  const reviewedRef = parsed.flags["--ref"] ?? DEFAULT_REVIEWED_REF;

  try {
    // The ref and the store are checked before anything is read or derived.
    checkReviewedRef(reviewedRef);
    const store = await RequestStore.open(resolve(host.cwd, storeDirectory));
    const policy = readWorkRequestPolicy(
      parseJson(
        await readReviewedFile(
          host.run,
          repositoryRoot,
          reviewedRef,
          "docs/work-requests/policy.json",
        ),
      ),
    );
    if (!policy.ok) {
      out.stderr(`refused: ${policy.code} at ${policy.field}: ${policy.detail}\n`);
      return 1;
    }
    const outcome = await emitWorkRequest(parsed.source, {
      readSource: (source) =>
        readSource(source, {
          fetch: host.fetch,
          run: host.run,
          linearApiKey: () => readSecret("HOMER_LINEAR_API_KEY", host.env, host.run),
          repositoryRoot,
          reviewedRef,
        }),
      askJev: async (state, model) =>
        askJevForRiskTier({
          fetch: host.fetch,
          apiToken: await readSecret("HOMER_CLOUDFLARE_API_TOKEN", host.env, host.run),
          accountId: await readSecret("HOMER_CLOUDFLARE_ACCOUNT_ID", host.env, host.run),
          model,
          state,
        }),
      store,
      policy: policy.value,
      // No Identity Binding store exists yet (ZER-48): who is the raw account.
      bindings: () => undefined,
      requester,
      now: () => host.now(),
    });
    if (!outcome.ok) {
      out.stderr(`refused: ${outcome.code} at ${outcome.field}: ${outcome.detail}\n`);
      return 1;
    }
    out.stdout(outcome.json);
    for (const warning of outcome.warnings) out.stderr(`warning: ${warning}\n`);
    out.stderr(
      outcome.kind === "emitted"
        ? `emitted ${outcome.requestId}\n`
        : `duplicate ${outcome.requestId}: printed the recorded request\n`,
    );
    return 0;
  } catch (error) {
    if (
      error instanceof StoreUnavailableError ||
      error instanceof SourceUnreachableError ||
      error instanceof ReviewedRefUnreadableError ||
      error instanceof SecretUnavailableError
    ) {
      // These messages are built to name the failing part and never a credential.
      out.stderr(`error: ${error.message}\n`);
      return 2;
    }
    out.stderr(
      "error: the emitter failed unexpectedly; nothing was recorded unless it says so above.\n",
    );
    return 2;
  }
}

function parseArguments(
  argv: readonly string[],
): { source: string; flags: Record<string, string> } | undefined {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument.startsWith("--")) {
      const value = argv[index + 1];
      if (!FLAGS.has(argument) || value === undefined || value.startsWith("--")) return undefined;
      flags[argument] = value;
      index += 1;
    } else {
      positional.push(argument);
    }
  }
  const [source] = positional;
  return positional.length === 1 && source !== undefined ? { source, flags } : undefined;
}

/** Missing or broken JSON is `undefined`, which the policy reader refuses. */
function parseJson(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(
    process.argv.slice(2),
    {
      env: process.env,
      fetch: globalThis.fetch,
      run: nodeRunner,
      now: () => new Date(),
      cwd: process.cwd(),
    },
    {
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    },
  ).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.stderr.write("error: the emitter failed unexpectedly.\n");
      process.exitCode = 2;
    },
  );
}
