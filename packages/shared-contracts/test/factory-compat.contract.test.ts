import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ValidateFunction } from "ajv";
import { describe, expect, it } from "vitest";
import {
  loadUpstreamWorkPacketSchema,
  toWorkPacket,
  validateWorkRequest,
  type WorkRequest,
} from "../src/index.js";
import { isRecord } from "../src/json.js";
import { loadFixture } from "./fixture.js";

const upstreamDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../specs/integration-contracts/upstream/software-factory",
);

describe("Work Packet compatibility", () => {
  it("maps a Work Request onto an intake Work Packet the upstream schema accepts", async () => {
    const request = validatedRequest(loadFixture("valid/work-request.json"));
    const packet = toWorkPacket(request, new Date("2026-11-18T16:00:00Z"));
    const schema = loadUpstreamWorkPacketSchema();
    const validate = await compileUpstream(schema);
    const accepted = validate(packet);
    expect(accepted, JSON.stringify(validate.errors ?? [])).toBe(true);
    expect(packet).toMatchObject({
      id: "WP-2026-11-18-home-contracts",
      owner_agent: "GAP",
      stage: "intake",
      done_when: request.doneWhen,
      scope: {
        repo: "Zero-State-LLC/home",
        paths: ["specs/integration-contracts", "packages/shared-contracts"],
        out_of_scope: ["production deploy"],
      },
      test_command: "npm test",
    });
    expect(packet).not.toHaveProperty("author_model");
    expect(packet).not.toHaveProperty("history");
  });

  it("omits optional Work Packet keys that the Work Request did not set", async () => {
    const request: WorkRequest = {
      contract: "home.work-request/v1",
      requestId: "WR-2026-11-18-min",
      source: "manual:contracts",
      pain: "Minimum Work Request still maps.",
      who: "HOME",
      doneWhen: ["Packet validates"],
      repository: "Zero-State-LLC/home",
      riskTier: "low",
      budgetUsd: 1,
      requestedBy: { sourceAccount: "github:octocat" },
      requestedAt: "2026-11-18T16:00:00Z",
    };
    const checked = validateWorkRequest(request);
    if (!checked.ok) {
      expect.fail(checked.errors.join("\n"));
    }
    const packet = toWorkPacket(checked.value, new Date("2026-11-18T16:00:00Z"));
    const validate = await compileUpstream(loadUpstreamWorkPacketSchema());
    expect(validate(packet), JSON.stringify(validate.errors ?? [])).toBe(true);
    expect(packet).toMatchObject({
      id: "WP-2026-11-18-min",
      scope: { repo: "Zero-State-LLC/home" },
    });
    expect(packet).not.toHaveProperty("test_command");
    expect(packet).not.toHaveProperty("links");
    expect(packet).not.toHaveProperty("author_model");
    expect(packet).not.toHaveProperty("history");
    if (!isRecord(packet) || !isRecord(packet["scope"])) {
      expect.fail("Work Packet scope must be an object");
    }
    expect(packet["scope"]).not.toHaveProperty("paths");
    expect(packet["scope"]).not.toHaveProperty("out_of_scope");
  });

  it("refuses an invalid intake clock", () => {
    const request = validatedRequest(loadFixture("valid/work-request.json"));
    expect(() => toWorkPacket(request, new Date("not-a-date"))).toThrow(/valid Date/);
  });

  it("loads the pinned upstream Work Packet schema", () => {
    const schema = loadUpstreamWorkPacketSchema();
    expect(isRecord(schema)).toBe(true);
    if (!isRecord(schema)) {
      return;
    }
    expect(schema["$schema"]).toBe("https://json-schema.org/draft/2020-12/schema");
  });

  it("throws when a tampered snapshot digest does not match the pin", () => {
    const dir = mkdtempSync(join(tmpdir(), "work-packet-pin-"));
    try {
      copyFileSync(
        join(upstreamDir, "work_packet.schema.json"),
        join(dir, "work_packet.schema.json"),
      );
      copyFileSync(join(upstreamDir, "PIN.json"), join(dir, "PIN.json"));
      const schemaPath = join(dir, "work_packet.schema.json");
      writeFileSync(schemaPath, readFileSync(schemaPath, "utf8") + "\n");
      expect(() => loadUpstreamWorkPacketSchema(dir)).toThrow(/sha256/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function validatedRequest(value: unknown): WorkRequest {
  const result = validateWorkRequest(value);
  if (!result.ok) {
    expect.fail(result.errors.join("\n"));
  }
  return result.value;
}

async function compileUpstream(schema: object): Promise<ValidateFunction> {
  const schemaId = schemaIdOf(schema);
  if (schemaId.includes("/2020-12/")) {
    const { Ajv2020 } = await import("ajv/dist/2020.js");
    return new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  }
  if (schemaId.includes("/2019-09/")) {
    const { Ajv2019 } = await import("ajv/dist/2019.js");
    return new Ajv2019({ allErrors: true, strict: true }).compile(schema);
  }
  const { Ajv } = await import("ajv");
  return new Ajv({ allErrors: true, strict: true }).compile(schema);
}

function schemaIdOf(schema: object): string {
  if (!isRecord(schema)) {
    return "";
  }
  const id = schema["$schema"];
  return typeof id === "string" ? id : "";
}

it("refuses malformed Work Requests at the packet boundary", () => {
  const request = validatedRequest(loadFixture("valid/work-request.json"));
  for (const patch of [{ requestId: "bad" }, { budgetUsd: 0 }, { doneWhen: [] }])
    expect(() => toWorkPacket({ ...request, ...patch }, new Date())).toThrow(/Work Request/);
});
it("detaches packet arrays from the Work Request", () => {
  const request = validatedRequest(loadFixture("valid/work-request.json"));
  const packet = toWorkPacket(request, new Date());
  const before = structuredClone(packet);
  request.doneWhen.push("later mutation");
  request.paths?.push("later-path");
  request.links?.push("https://example.test/later");
  request.outOfScope?.push("later scope");
  expect(packet).toEqual(before);
});
