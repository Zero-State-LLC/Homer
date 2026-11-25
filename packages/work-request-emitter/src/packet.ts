import { toWorkPacket, type WorkRequest } from "@zs-home/shared-contracts";

/**
 * The judge's packet for one recorded Work Request (docs/deployment/work-requests.md).
 *
 * `toWorkPacket` maps the request at intake. The judge also needs the model that
 * wrote the change, to refuse a judge of the same vendor family, so this adds
 * `author_model` and nothing else. The packet stays at `intake`: Homer never
 * advances a Work Packet.
 */
export class PacketRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PacketRefusedError";
  }
}

// `provider/model`, optionally with a gateway prefix such as `openrouter:`.
// A floating alias such as `~anthropic/latest` names no model, so the judge
// refuses it; refuse it here first.
const AUTHOR_MODEL = /^(?:[a-z0-9-]+:)?[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export function judgePacket(request: unknown, authorModel: string, now: Date): object {
  if (!AUTHOR_MODEL.test(authorModel)) {
    throw new PacketRefusedError(
      `author model "${authorModel}" is not provider/model, as in anthropic/claude-opus-5.5`,
    );
  }
  let packet: Record<string, unknown>;
  try {
    packet = toWorkPacket(request as WorkRequest, now) as Record<string, unknown>;
  } catch (error) {
    throw new PacketRefusedError(error instanceof Error ? error.message : "invalid Work Request");
  }
  if (typeof packet["test_command"] !== "string" || packet["test_command"] === "") {
    throw new PacketRefusedError(
      "the Work Request has no testCommand, so the judge's reproduce check cannot run",
    );
  }
  return { ...packet, author_model: authorModel };
}

/**
 * JSON with every character outside ASCII escaped. software-factory reads a
 * packet as ASCII, so a curly quote copied from a Linear Task would otherwise
 * stop the judge.
 */
export function asciiJson(value: unknown): string {
  return (
    JSON.stringify(value, null, 2).replace(
      /[\u0080-￿]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
    ) + "\n"
  );
}

interface VerdictItem {
  status?: unknown;
}
interface VerdictFinding {
  severity?: unknown;
  summary?: unknown;
  file?: unknown;
}

function code(value: unknown): string {
  return "`" + String(value ?? "").replace(/`/g, "'") + "`";
}

/**
 * The pull request comment that carries one Verdict, in the form Homer's
 * earlier Verdict comments use: a summary, the gate's answer, and the whole
 * Verdict JSON. It renders what the judge wrote and decides nothing.
 */
export function verdictComment(
  verdict: Record<string, unknown>,
  gate: { merge_allowed?: unknown; problems?: unknown },
  verdictSha256: string,
): string {
  const items = Array.isArray(verdict["items"]) ? (verdict["items"] as VerdictItem[]) : [];
  const findings = Array.isArray(verdict["findings"])
    ? (verdict["findings"] as VerdictFinding[])
    : [];
  const met = items.filter((i) => i.status === "met").length;
  const count = (s: string) => findings.filter((f) => f.severity === s).length;
  const rep = (verdict["reproduce"] ?? {}) as Record<string, unknown>;
  const problems = Array.isArray(gate.problems) ? gate.problems.map(String) : [];
  const lines = [
    `## software-factory Verdict: **${String(verdict["verdict"]).toUpperCase()}** (mode: **${String(verdict["mode"])}**)`,
    "",
    `- judge: ${code(verdict["judge_model"])}; author_model ${code(verdict["author_model"])}`,
    `- head: ${code(verdict["head_sha"])}; packet ${code(verdict["packet_id"])}; diff sha256 ${code(verdict["diff_sha256"])}`,
    `- done_when: ${met}/${items.length} met; findings: high ${count("high")}, medium ${count("medium")}, low ${count("low")}`,
    rep["ran"] === true
      ? `- reproduce: exit ${String(rep["exit_code"])} in ${String(rep["duration_s"])} s, command ${code(rep["command"])}, output sha256 ${code(rep["output_sha256"])}`
      : `- reproduce: did not run (${String(rep["error"] ?? "no reproduce check")})`,
    gate.merge_allowed === true
      ? "- `factory judge gate`: `merge_allowed: true`, no problems."
      : `- \`factory judge gate\`: \`merge_allowed: false\`: ${problems.join("; ") || "no reason given"}.`,
    `- verdict file sha256 ${code(verdictSha256)}`,
  ];
  if (findings.length > 0) {
    lines.push("", "### Findings", "");
    for (const f of findings) {
      const where = f.file ? ` ${code(f.file)}` : "";
      lines.push(`- **${String(f.severity)}**${where}: ${String(f.summary ?? "")}`);
    }
  }
  // A fence longer than any backtick run in the JSON, so quoted evidence
  // cannot close it.
  const json = JSON.stringify(verdict, null, 2);
  const longest = Math.max(0, ...(json.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  lines.push(
    "",
    "<details><summary>Verdict JSON</summary>",
    "",
    `${fence}json`,
    json,
    fence,
    "",
    "</details>",
    "",
  );
  return lines.join("\n");
}
