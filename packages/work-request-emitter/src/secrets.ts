import type { Runner } from "./run.js";

/**
 * A credential comes from 1Password by reference (`<NAME>_REF=op://vault/item/field`)
 * or from the environment (`<NAME>`), never from a file in the repository. The
 * value is returned to the caller only: no message here ever holds it.
 */

export class SecretUnavailableError extends Error {
  constructor(readonly credential: string) {
    super(`${credential} is not configured, or 1Password could not read it.`);
    this.name = "SecretUnavailableError";
  }
}

const OP_REFERENCE = /^op:\/\/[^\r\n\0]+$/;

export async function readSecret(
  name: string,
  env: Readonly<Record<string, string | undefined>>,
  run: Runner,
): Promise<string> {
  const reference = env[`${name}_REF`];
  if (reference !== undefined && reference !== "") {
    if (!OP_REFERENCE.test(reference)) {
      throw new SecretUnavailableError(name);
    }
    const token = env["OP_SERVICE_ACCOUNT_TOKEN"];
    const result = await run(
      "op",
      ["read", reference],
      token === undefined ? {} : { env: { OP_SERVICE_ACCOUNT_TOKEN: token } },
    );
    const value = result.stdout.trim();
    // The CLI's own message is not passed on: it can quote the reference's item.
    if (result.code !== 0 || value === "" || /[\r\n]/.test(value)) {
      throw new SecretUnavailableError(name);
    }
    return value;
  }
  const value = env[name]?.trim();
  if (value === undefined || value === "") {
    throw new SecretUnavailableError(name);
  }
  return value;
}
