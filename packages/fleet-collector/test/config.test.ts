import { describe, expect, it } from "vitest";
import { parseCollectorConfig } from "../src/index.js";
import { config } from "./fixture.js";

function errors(change: (c: Record<string, unknown>) => void): string {
  const value = structuredClone(config) as unknown as Record<string, unknown>;
  change(value);
  const result = parseCollectorConfig(value);
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.errors.join("\n");
}

describe("the Collector configuration", () => {
  it("accepts a loopback sparkDash, an https intake and a front door on a host name", () => {
    expect(parseCollectorConfig(config)).toEqual({ ok: true, value: config });
    expect(parseCollectorConfig({ ...config, sparkdashUrl: "http://[::1]:3000" }).ok).toBe(true);
  });

  it("reads sparkDash only on loopback", () => {
    for (const url of [
      "http://0.0.0.0:3000",
      "http://delphi.local:3000",
      "https://127.0.0.1:3000",
      "http://127.0.0.1:3000/api",
      "http://user:pw@127.0.0.1:3000",
    ]) {
      expect(
        errors((c) => (c["sparkdashUrl"] = url)),
        url,
      ).toContain("sparkdashUrl must be");
    }
  });

  it("needs an https intake and a front door that is not an address", () => {
    expect(errors((c) => (c["intakeUrl"] = "http://intake.example.test/"))).toContain(
      "intakeUrl must be",
    );
    expect(errors((c) => (c["frontDoorOrigin"] = "https://10.0.0.5"))).toContain(
      "frontDoorOrigin must be",
    );
    expect(errors((c) => (c["frontDoorOrigin"] = "https://sparkdash.example.test/page"))).toContain(
      "frontDoorOrigin must be",
    );
  });

  it("maps each machineId once, to exactly one sparkDash unit or SSH target", () => {
    const machines = (c: Record<string, unknown>) => c["machines"] as Record<string, unknown>[];
    expect(
      errors((c) => machines(c).push({ machineId: "delphi", sparkdashUnit: "other" })),
    ).toContain("listed twice");
    expect(
      errors((c) => machines(c).push({ machineId: "other", sparkdashUnit: "delphi" })),
    ).toContain("mapped twice");
    expect(
      errors((c) => machines(c).push({ machineId: "sparkdash:delphi", sparkdashUnit: "x" })),
    ).toContain("id rule");
    expect(
      errors((c) =>
        machines(c).push({ machineId: "both", sparkdashUnit: "b", ssh: { host: "b" } }),
      ),
    ).toContain("exactly one");
    expect(
      errors((c) => machines(c).push({ machineId: "p", ssh: { host: "p", port: 70000 } })),
    ).toContain("ssh.port");
    expect(errors((c) => (c["token"] = "secret"))).toContain(
      "config.token is not a configuration field",
    );
  });

  it("never echoes a value in its errors", () => {
    const text = errors((c) => {
      c["sparkdashUrl"] = "http://evil.example:1/?secret=s3cr3t";
      (c["machines"] as Record<string, unknown>[])[2] = {
        machineId: "pc-one",
        ssh: { host: "bad host!", port: 22 },
      };
    });
    expect(text).not.toContain("s3cr3t");
    expect(text).not.toContain("bad host!");
  });
});
