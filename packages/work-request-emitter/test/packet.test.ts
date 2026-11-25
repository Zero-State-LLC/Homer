import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asciiJson, judgePacket, PacketRefusedError, verdictComment } from "../src/packet.js";
import { runPacketCli } from "../src/packet-cli.js";
import { contractsFixture } from "./fixtures.js";

const now = new Date("2026-11-25T06:00:00Z");
function request(): Record<string, unknown> {
  return JSON.parse(readFileSync(contractsFixture("valid/work-request.json"), "utf8")) as Record<
    string,
    unknown
  >;
}
const verdict = {
  schema: "factory.verdict/v1",
  verdict: "pass",
  reasons: [],
  repo: "Zero-State-LLC/Homer",
  pr: 76,
  head_sha: "5de6a2ec12252fa84a7226d1686add75d3facb20",
  packet_id: "WP-2026-11-24-zer-91",
  author_model: "anthropic/claude-opus-5.5",
  judge_model: "z-ai/glm-5.3",
  mode: "online",
  items: [
    { index: 0, status: "met", evidence: "the diff adds ```code``` here", done_when: "a" },
    { index: 1, status: "met", evidence: "yes", done_when: "b" },
  ],
  findings: [{ severity: "low", summary: "a nit", file: "scripts/version.mjs" }],
  diff_sha256: "ab".repeat(32),
  reproduce: {
    ran: true,
    command: "bash -c 'npm ci && npm run check'",
    head_sha: "5de6a2ec12252fa84a7226d1686add75d3facb20",
    exit_code: 0,
    duration_s: 312.4,
    output_sha256: "cd".repeat(32),
  },
  created_at: "2026-11-25T06:10:00Z",
};

describe("judgePacket", () => {
  it("is toWorkPacket's packet plus the author model, still at intake", () => {
    const packet = judgePacket(request(), "anthropic/claude-opus-5.5", now) as Record<
      string,
      unknown
    >;
    expect(packet).toMatchObject({
      id: "WP-2026-11-18-home-contracts",
      source: "linear:ZER-9",
      stage: "intake",
      owner_agent: "GAP",
      test_command: "npm test",
      author_model: "anthropic/claude-opus-5.5",
      done_when: ["Activity Event contract validates", "Work Request maps to a Work Packet"],
    });
  });

  it("refuses a missing or floating author model", () => {
    for (const model of ["", "claude", "~anthropic/latest", "anthropic/", "Anthropic Claude"]) {
      expect(() => judgePacket(request(), model, now)).toThrow(PacketRefusedError);
    }
    expect(() => judgePacket(request(), "openrouter:anthropic/claude-opus-5.5", now)).not.toThrow();
  });

  it("refuses an invalid request, or one with no test command for the reproduce check", () => {
    expect(() => judgePacket({ ...request(), riskTier: "huge" }, "a/b", now)).toThrow(
      PacketRefusedError,
    );
    const withoutTest = request();
    delete withoutTest["testCommand"];
    expect(() => judgePacket(withoutTest, "a/b", now)).toThrow(/no testCommand/);
  });
});

describe("asciiJson", () => {
  it("escapes every character outside ASCII, and stays the same JSON", () => {
    const value = { pain: "Danny’s “calendar” — naïve 🗓️" };
    const text = asciiJson(value);
    expect([...text].every((c) => c.charCodeAt(0) < 128)).toBe(true);
    expect(JSON.parse(text)).toEqual(value);
  });
});

describe("verdictComment", () => {
  it("summarizes the Verdict and the gate, and carries the whole JSON", () => {
    const text = verdictComment(verdict, { merge_allowed: true, problems: [] }, "ef".repeat(32));
    expect(text).toMatch(/^## software-factory Verdict: \*\*PASS\*\* \(mode: \*\*online\*\*\)\n/);
    expect(text).toContain("- done_when: 2/2 met; findings: high 0, medium 0, low 1");
    expect(text).toContain("- reproduce: exit 0 in 312.4 s");
    expect(text).toContain("`merge_allowed: true`, no problems.");
    expect(text).toContain("- **low** `scripts/version.mjs`: a nit");
    const json = /````json\n([\s\S]*)\n````/.exec(text);
    expect(json).not.toBeNull();
    expect(JSON.parse(json?.[1] ?? "")).toEqual(verdict);
  });

  it("says why the gate refused", () => {
    const text = verdictComment(
      { ...verdict, verdict: "fail", reproduce: { ran: false, error: "head SHA moved" } },
      { merge_allowed: false, problems: ["verdict is not pass", "CI is not green"] },
      "ef".repeat(32),
    );
    expect(text).toContain("**FAIL**");
    expect(text).toContain("- reproduce: did not run (head SHA moved)");
    expect(text).toContain("`merge_allowed: false`: verdict is not pass; CI is not green.");
  });
});

describe("the packet CLI", () => {
  let dir: string;
  let stdout: string;
  let stderr: string;
  const out = {
    stdout: (t: string) => {
      stdout += t;
    },
    stderr: (t: string) => {
      stderr += t;
    },
  };
  const host = () => ({ cwd: dir, now: () => now });
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "homer-packet-"));
    stdout = "";
    stderr = "";
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("prints the packet for a recorded request", async () => {
    await writeFile(join(dir, "request.json"), JSON.stringify(request()));
    const code = await runPacketCli(
      ["packet", "request.json", "--author-model", "anthropic/claude-opus-5.5"],
      host(),
      out,
    );
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ author_model: "anthropic/claude-opus-5.5" });
  });

  it("refuses with exit 1, and exits 2 on usage or an unreadable file", async () => {
    await writeFile(join(dir, "request.json"), JSON.stringify(request()));
    expect(
      await runPacketCli(["packet", "request.json", "--author-model", "~x/latest"], host(), out),
    ).toBe(1);
    expect(stderr).toMatch(/^refused: /);
    expect(await runPacketCli(["packet", "request.json"], host(), out)).toBe(2);
    expect(
      await runPacketCli(["packet", "missing.json", "--author-model", "a/b"], host(), out),
    ).toBe(2);
    expect(await runPacketCli(["judge"], host(), out)).toBe(2);
    expect(stdout).toBe("");
  });

  it("prints the comment for a Verdict and the gate's answer", async () => {
    await writeFile(join(dir, "v.json"), JSON.stringify(verdict, null, 2) + "\n");
    await writeFile(join(dir, "gate.json"), JSON.stringify({ merge_allowed: true, problems: [] }));
    expect(await runPacketCli(["comment", "v.json", "gate.json"], host(), out)).toBe(0);
    expect(stdout).toContain("## software-factory Verdict: **PASS**");
    await writeFile(join(dir, "gate.json"), "{}");
    expect(await runPacketCli(["comment", "v.json", "gate.json"], host(), out)).toBe(1);
  });
});
