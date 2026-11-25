/**
 * The only place the emitter starts programs (`gh` and `op`). Commands never go
 * through a shell, and the child gets a minimal environment plus only the
 * variables a call names.
 */
import { execFile } from "node:child_process";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Extra environment variables for this call only. */
  env?: Readonly<Record<string, string>>;
  timeoutMs?: number;
}

export type Runner = (
  command: string,
  args: readonly string[],
  options?: RunOptions,
) => Promise<RunResult>;

/** What `gh` and `op` need to find their own configuration, and nothing else. */
const PASSED_THROUGH = ["PATH", "HOME", "XDG_CONFIG_HOME", "GH_CONFIG_DIR", "GH_HOST"];
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export const nodeRunner: Runner = (command, args, options = {}) =>
  new Promise((resolve) => {
    const env: Record<string, string> = {};
    for (const name of PASSED_THROUGH) {
      const value = process.env[name];
      if (value !== undefined) env[name] = value;
    }
    execFile(
      command,
      [...args],
      {
        env: { ...env, ...options.env },
        shell: false,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : -1;
        resolve({ code, stdout, stderr });
      },
    );
  });
