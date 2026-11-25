import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { asciiJson, judgePacket, PacketRefusedError, verdictComment } from "./packet.js";

/**
 * Two steps of docs/deployment/work-requests.md, between the emitter and the
 * judge, and between the judge and the pull request:
 *
 * `npm --silent run work-packet -- <request.json> --author-model <provider/model>`
 *   prints the judge's packet for a recorded Work Request, as ASCII JSON.
 * `npm --silent run verdict-comment -- <verdict.json> <gate.json>`
 *   prints the pull request comment for a Verdict and the gate's answer.
 *
 * Neither reads a credential, writes a file or calls the network. Exit 0:
 * printed. Exit 1: refused, with the reason. Exit 2: usage, or a file that
 * cannot be read as JSON.
 */

export interface PacketCliOutput {
  stdout(text: string): void;
  stderr(text: string): void;
}

const USAGE = [
  "usage: npm --silent run work-packet -- <request.json> --author-model <provider/model>",
  "       npm --silent run verdict-comment -- <verdict.json> <gate.json>",
  "",
].join("\n");

async function readJson(cwd: string, path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(cwd, path), "utf8")) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function runPacketCli(
  argv: readonly string[],
  host: { cwd: string; now(): Date },
  out: PacketCliOutput,
): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "packet") {
    const flag = rest.indexOf("--author-model");
    const authorModel = flag === -1 ? undefined : rest[flag + 1];
    const positional = rest.filter((_, i) => i !== flag && i !== flag + 1);
    if (authorModel === undefined || positional.length !== 1 || positional[0]?.startsWith("--")) {
      out.stderr(USAGE);
      return 2;
    }
    let request: unknown;
    try {
      request = await readJson(host.cwd, positional[0] as string);
    } catch {
      out.stderr(`error: ${positional[0]} is not a readable JSON file.\n`);
      return 2;
    }
    try {
      out.stdout(asciiJson(judgePacket(request, authorModel, host.now())));
      return 0;
    } catch (error) {
      if (error instanceof PacketRefusedError) {
        out.stderr(`refused: ${error.message}\n`);
        return 1;
      }
      throw error;
    }
  }
  if (command === "comment") {
    if (rest.length !== 2) {
      out.stderr(USAGE);
      return 2;
    }
    let verdictBytes: Buffer;
    let verdict: unknown;
    let gate: unknown;
    try {
      verdictBytes = await readFile(resolve(host.cwd, rest[0] as string));
      verdict = JSON.parse(verdictBytes.toString("utf8")) as unknown;
      gate = await readJson(host.cwd, rest[1] as string);
    } catch {
      out.stderr("error: the Verdict and the gate's answer must both be readable JSON files.\n");
      return 2;
    }
    if (
      !isRecord(verdict) ||
      verdict["schema"] !== "factory.verdict/v1" ||
      !isRecord(gate) ||
      typeof gate["merge_allowed"] !== "boolean"
    ) {
      out.stderr(
        "refused: expected a factory.verdict/v1 Verdict and the JSON that factory judge gate printed.\n",
      );
      return 1;
    }
    const sha256 = createHash("sha256").update(verdictBytes).digest("hex");
    out.stdout(verdictComment(verdict, gate, sha256));
    return 0;
  }
  out.stderr(USAGE);
  return 2;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPacketCli(
    process.argv.slice(2),
    { cwd: process.cwd(), now: () => new Date() },
    {
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    },
  ).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.stderr.write("error: unexpected failure.\n");
      process.exitCode = 2;
    },
  );
}
