import { execFile } from "node:child_process";

/**
 * A credential comes from 1Password by reference (`<NAME>_REF=op://...`) or
 * from the environment (`<NAME>`), never from the configuration file. The value
 * is returned to the caller only: no message or log here ever holds it.
 */
export class SecretUnavailableError extends Error {
  constructor(readonly credential: string) {
    super(`${credential} is not configured, or 1Password could not read it.`);
    this.name = "SecretUnavailableError";
  }
}

/** Runs `op read <reference>` with no shell and a minimal environment. */
export type OpRead = (
  reference: string,
  env: Readonly<Record<string, string>>,
) => Promise<string | undefined>;

const OP_REFERENCE = /^op:\/\/[^\r\n\0]+$/;
const PASSED_THROUGH = ["PATH", "HOME", "XDG_CONFIG_HOME", "OP_SERVICE_ACCOUNT_TOKEN"];

export const opRead: OpRead = (reference, env) =>
  new Promise((resolve) => {
    execFile(
      "op",
      ["read", reference],
      { env: { ...env }, shell: false, timeout: 30_000, maxBuffer: 64 * 1024, encoding: "utf8" },
      // The CLI's own message is not passed on: it can quote the reference's item.
      (error, stdout) => resolve(error === null ? stdout : undefined),
    );
  });

export async function readSecret(
  name: string,
  env: Readonly<Record<string, string | undefined>>,
  read: OpRead = opRead,
): Promise<string> {
  const reference = env[`${name}_REF`];
  if (reference !== undefined && reference !== "") {
    if (!OP_REFERENCE.test(reference)) throw new SecretUnavailableError(name);
    const passed: Record<string, string> = {};
    for (const key of PASSED_THROUGH) {
      const value = env[key];
      if (value !== undefined) passed[key] = value;
    }
    const value = (await read(reference, passed))?.trim();
    if (value === undefined || value === "" || /[\r\n]/.test(value)) {
      throw new SecretUnavailableError(name);
    }
    return value;
  }
  const value = env[name]?.trim();
  if (value === undefined || value === "") throw new SecretUnavailableError(name);
  return value;
}
