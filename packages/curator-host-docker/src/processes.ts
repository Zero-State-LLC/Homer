/**
 * The only place the adapter starts programs. Commands never go through a shell, and the
 * child gets a minimal environment plus only the variables a call names.
 */
import { spawn } from "node:child_process";

export interface ProcessResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunOptions {
  /** Extra environment variables for this call only. */
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

/** A long-running child with piped standard input and output. */
export interface InteractiveProcess {
  write(chunk: string): void;
  endInput(): void;
  onStdout(listener: (chunk: string) => void): void;
  /** Resolves with the exit code once the child has exited. */
  readonly exited: Promise<number>;
  kill(): void;
}

export interface Processes {
  run(command: string, args: readonly string[], options?: RunOptions): Promise<ProcessResult>;
  start(command: string, args: readonly string[], options?: RunOptions): InteractiveProcess;
}

/** Output kept per stream. Anything past it is dropped, so a noisy child cannot exhaust memory. */
export const MAX_CAPTURE_CHARS = 1024 * 1024;

const PASSED_THROUGH = ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"];

function childEnv(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of PASSED_THROUGH) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...extra };
}

/** Real processes, for the host. */
export const nodeProcesses: Processes = {
  run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, [...args], {
        env: childEnv(options.env),
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (stdout.length < MAX_CAPTURE_CHARS) stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        if (stderr.length < MAX_CAPTURE_CHARS) stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    });
  },

  start(command, args, options = {}) {
    const child = spawn(command, [...args], {
      env: childEnv(options.env),
      stdio: ["pipe", "pipe", "ignore"],
      shell: false,
    });
    child.stdout.setEncoding("utf8");
    const exited = new Promise<number>((resolve) => {
      child.on("error", () => resolve(-1));
      child.on("close", (code) => resolve(code ?? -1));
    });
    // A closed pipe surfaces as an error event; the exit code already reports the failure.
    child.stdin.on("error", () => undefined);
    return {
      write: (chunk) => {
        if (child.stdin.writable) child.stdin.write(chunk);
      },
      endInput: () => child.stdin.end(),
      onStdout: (listener) => child.stdout.on("data", listener),
      exited,
      kill: () => {
        child.kill("SIGKILL");
      },
    };
  },
};
