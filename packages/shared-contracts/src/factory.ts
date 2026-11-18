import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "./json.js";
import { upstreamWorkPacketDir } from "./paths.js";
import type { WorkRequest } from "./types.js";

/**
 * Map a Work Request to a software-factory Work Packet at stage intake.
 * HOME never advances a packet past intake, so this does not set author_model
 * or history. `now` is the caller's clock; an invalid Date is refused so a
 * later stage cannot inherit it. The packet itself does not store the instant.
 */
export function toWorkPacket(request: WorkRequest, now: Date): object {
  if (Number.isNaN(now.getTime())) {
    throw new Error("now must be a valid Date");
  }

  const scope: { repo: string; paths?: string[]; out_of_scope?: string[] } = {
    repo: request.repository,
  };
  if (request.paths !== undefined) {
    scope.paths = request.paths;
  }
  if (request.outOfScope !== undefined) {
    scope.out_of_scope = request.outOfScope;
  }

  const packet: {
    id: string;
    source: string;
    pain: string;
    who: string;
    done_when: string[];
    scope: { repo: string; paths?: string[]; out_of_scope?: string[] };
    risk_tier: WorkRequest["riskTier"];
    budget_usd: number;
    owner_agent: "GAP";
    stage: "intake";
    test_command?: string;
    links?: string[];
  } = {
    id: `WP-${request.requestId.slice(3)}`,
    source: request.source,
    pain: request.pain,
    who: request.who,
    done_when: request.doneWhen,
    scope,
    risk_tier: request.riskTier,
    budget_usd: request.budgetUsd,
    owner_agent: "GAP",
    stage: "intake",
  };

  if (request.testCommand !== undefined) {
    packet.test_command = request.testCommand;
  }
  if (request.links !== undefined) {
    packet.links = request.links;
  }

  return packet;
}

/**
 * Read the pinned software-factory Work Packet schema.
 * `directory` overrides the snapshot directory so a test can use a temp copy.
 * Throws when the file sha256 does not match PIN.json.
 */
export function loadUpstreamWorkPacketSchema(directory?: string): object {
  const dir = directory ?? upstreamWorkPacketDir();
  const bytes = readFileSync(join(dir, "work_packet.schema.json"));
  const digest = createHash("sha256").update(bytes).digest("hex");
  const pin = parsePin(readFileSync(join(dir, "PIN.json"), "utf8"));
  if (digest !== pin) {
    throw new Error(`upstream Work Packet schema sha256 ${digest} does not match PIN.json ${pin}`);
  }
  const schema: unknown = JSON.parse(bytes.toString("utf8")) as unknown;
  if (!isRecord(schema)) {
    throw new Error("upstream Work Packet schema must be a JSON object");
  }
  return schema;
}

function parsePin(text: string): string {
  const value: unknown = JSON.parse(text) as unknown;
  if (!isRecord(value) || typeof value["sha256"] !== "string") {
    throw new Error("PIN.json must contain a sha256 string");
  }
  return value["sha256"];
}
