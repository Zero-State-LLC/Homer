import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCollectorConfig } from "./config.js";
import {
  FleetCollector,
  SecretUnavailableError,
  checkSshBanner,
  fileStore,
  intakeClient,
  readSecret,
  sparkdashClient,
  type OpRead,
} from "./runtime/index.js";

/**
 * `fleet-collector --config <file> --state <file> [--once]`
 *
 * Credentials, each by 1Password reference (`<NAME>_REF=op://...`) or in the
 * environment: `FLEET_COLLECTOR_CLIENT_ID` and `FLEET_COLLECTOR_CLIENT_SECRET`,
 * the Collector's Access service token. None is ever written to the log.
 */
export const CREDENTIALS = ["FLEET_COLLECTOR_CLIENT_ID", "FLEET_COLLECTOR_CLIENT_SECRET"] as const;

export interface CliIo {
  env: Readonly<Record<string, string | undefined>>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  opRead?: OpRead;
  /** For tests: the collector to run instead of the real one. */
  start?: (collector: FleetCollector, once: boolean) => Promise<void>;
}

const POLL_MS = 30_000;
const CHECK_MS = 60_000;

function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

/** Runs until stopped, or once with `--once`. Returns the exit code. */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const configPath = flag(argv, "--config");
  const statePath = flag(argv, "--state");
  if (!configPath || !statePath) {
    io.stderr("usage: fleet-collector --config <file> --state <file> [--once]");
    return 2;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    io.stderr("the configuration file cannot be read as JSON");
    return 2;
  }
  const config = parseCollectorConfig(raw);
  if (!config.ok) {
    for (const error of config.errors) io.stderr(`configuration: ${error}`);
    return 2;
  }
  const secrets: string[] = [];
  try {
    for (const name of CREDENTIALS) secrets.push(await readSecret(name, io.env, io.opRead));
  } catch (error) {
    // Names the variable, never a value.
    io.stderr(
      error instanceof SecretUnavailableError ? error.message : "a credential cannot be read",
    );
    return 1;
  }
  const [clientId, clientSecret] = secrets as [string, string];
  const collector = new FleetCollector({
    config: config.value,
    store: fileStore(statePath),
    sparkdash: sparkdashClient(config.value.sparkdashUrl),
    check: (host, port) => checkSshBanner(host, port),
    intake: intakeClient(config.value.intakeUrl, { clientId, clientSecret }),
    now: () => Date.now(),
    log: (line) => io.stdout(JSON.stringify({ at: new Date().toISOString(), ...line })),
  });
  const once = argv.includes("--once");
  await (io.start ?? startCollector)(collector, once);
  return 0;
}

/** Checks, then polls; then both on their intervals until SIGTERM or SIGINT. */
async function startCollector(collector: FleetCollector, once: boolean): Promise<void> {
  await collector.checkOnce();
  await collector.pollOnce();
  if (once) return;
  await new Promise<void>((resolve) => {
    let stopped = false;
    const report = (error: unknown) =>
      process.stderr.write(`${error instanceof Error ? error.name : "error"} in a scheduled run\n`);
    // Each run is scheduled after the last one finishes, never on a fixed tick,
    // so a slow sparkDash or intake cannot pile up runs.
    const every = (task: () => Promise<void>, ms: number) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const run = async () => {
        const started = Date.now();
        await task().catch(report);
        if (!stopped)
          timer = setTimeout(() => void run(), Math.max(0, ms - (Date.now() - started)));
      };
      timer = setTimeout(() => void run(), ms);
      return () => clearTimeout(timer);
    };
    const stopPolls = every(() => collector.pollOnce(), POLL_MS);
    const stopChecks = every(() => collector.checkOnce(), CHECK_MS);
    const stop = () => {
      stopped = true;
      stopPolls();
      stopChecks();
      resolve();
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  });
}

function isMain(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const code = await runCli(process.argv.slice(2), {
    env: process.env,
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  });
  process.exitCode = code;
}
