import { describe, expect, it } from "vitest";
import { MAX_FLEET_REPORT_BYTES, validateFleetReport, type FleetReport } from "../src/index.js";
import { validateFleetReport as workerValidateFleetReport } from "@zs-home/shared-contracts/workers";
import { loadFixture } from "./fixture.js";

function report(): FleetReport {
  return loadFixture("valid/fleet-report.json") as FleetReport;
}

/** Each refusal in the spec's Machine and Fleet Report sections, as a change to a valid report. */
const refusals: [string, (r: FleetReport) => void, string][] = [
  [
    "a machineId outside the fleet configuration's id rule",
    (r) => (r.machines[0]!.machineId = "sparkdash:delphi"),
    "/machines/0/machineId must match pattern",
  ],
  [
    "a name with a control character",
    (r) => (r.machines[0]!.name = "Del\u0007phi"),
    "/machines/0/name must match pattern",
  ],
  [
    "a name over 40 characters",
    (r) => (r.machines[0]!.name = "x".repeat(41)),
    "/machines/0/name must match pattern",
  ],
  [
    "an unknown kind",
    (r) => ((r.machines[0] as { kind: string }).kind = "server"),
    "/machines/0/kind must be equal to one of the allowed values",
  ],
  [
    "a sparkDash machine of kind ssh",
    (r) => (r.machines[0]!.kind = "ssh"),
    "/machines/0/kind must be equal to one of the allowed values",
  ],
  [
    "a reachability-only machine of another kind",
    (r) => (r.machines[2]!.kind = "spark"),
    "/machines/2/kind must be equal to constant",
  ],
  [
    "an unknown state",
    (r) => ((r.machines[0] as { state: string }).state = "offline"),
    "/machines/0/state must be equal to one of the allowed values",
  ],
  [
    "an address field",
    (r) => Object.assign(r.machines[0]!, { host: "delphi.local" }),
    "/machines/0 must NOT have additional properties",
  ],
  [
    "an IPv4 address",
    (r) => (r.machines[0]!.name = "10.0.0.5"),
    "/machines/0/name must not carry an IP address",
  ],
  [
    "an IPv6 address",
    (r) => (r.events[0]!.provenance.sourceUrl = "https://[::1]:3000/"),
    "/events/0/provenance/sourceUrl must not carry an IP address",
  ],
  [
    "a lastSeenAt that is neither a UTC time nor null",
    (r) => (r.machines[0]!.lastSeenAt = "yesterday"),
    "/machines/0/lastSeenAt must match a schema in anyOf",
  ],
  [
    "another contract",
    (r) => ((r as { contract: string }).contract = "home.fleet-report/v2"),
    "/contract must be equal to constant",
  ],
  [
    "an unknown sparkdash.state",
    (r) => ((r.sparkdash as { state: string }).state = "degraded"),
    "/sparkdash/state must be equal to one of the allowed values",
  ],
  [
    "an unknown diagnostic code",
    (r) => ((r.diagnostics[0] as { code: string }).code = "disk_full"),
    "/diagnostics/0/code must be equal to one of the allowed values",
  ],
  [
    "a diagnostic code twice",
    (r) => r.diagnostics.push({ ...r.diagnostics[0]! }),
    "/diagnostics/1/code must be unique",
  ],
  [
    "a machine twice",
    (r) => (r.machines[1]!.machineId = "delphi"),
    "/machines/1/machineId must be unique",
  ],
  [
    "65 machines",
    (r) =>
      (r.machines = Array.from({ length: 65 }, (_, i) => ({
        ...r.machines[0]!,
        machineId: `m${i}`,
      }))),
    "/machines must NOT have more than 64 items",
  ],
  [
    "101 events",
    (r) => (r.events = Array.from({ length: 101 }, () => r.events[0]!)),
    "/events must NOT have more than 100 items",
  ],
  [
    "a body over 256 KiB",
    (r) => {
      const firing = {
        rule: "a".repeat(40),
        severity: "critical" as const,
        since: "2026-11-24T17:58:00.123456789Z",
      };
      r.machines = Array.from({ length: 64 }, (_, i) => ({
        ...r.machines[0]!,
        machineId: `m${i}`,
        firing: Array.from({ length: 32 }, () => firing),
      }));
      r.events = Array.from({ length: 100 }, () => r.events[0]!);
    },
    `/ must be at most ${MAX_FLEET_REPORT_BYTES} bytes of JSON`,
  ],
  [
    "a sparkDash machine up while sparkDash is unreachable",
    (r) => (r.sparkdash = { state: "unreachable", version: null, pinnedVersion: "2.91.0" }),
    "/machines/0/state must be unknown while sparkDash is not read",
  ],
  [
    "an event that is not a machine alert",
    (r) =>
      (r.events[0] = loadFixture("valid/activity-event-v3-github-commit-pushed.json") as never),
    "/events/0/kind must be equal to one of the allowed values",
  ],
  [
    "an event under contract version 2",
    (r) => ((r.events[0] as { contract: string }).contract = "home.activity-event/v2"),
    "/events/0/contract must be equal to constant",
  ],
  [
    "an event whose subject is not from the catalogue",
    (r) => (r.events[0]!.subject = "GPU too hot on Delphi"),
    '/events/0 subject must be "GPU temperature on <machine name>"',
  ],
  [
    "a report id that is not a UUID",
    (r) => (r.reportId = "not-a-uuid"),
    '/reportId must match format "uuid"',
  ],
];

describe("Fleet Report contract version 1", () => {
  it.each(["valid/fleet-report.json", "valid/fleet-report-sparkdash-unreachable.json"])(
    "accepts %s",
    (name) => {
      const result = validateFleetReport(loadFixture(name));
      if (!result.ok) {
        expect.fail(result.errors.join("\n"));
      }
      expect(result.value.contract).toBe("home.fleet-report/v1");
    },
  );

  it.each(refusals)("refuses %s", (_, change, message) => {
    const value = report();
    change(value);
    const result = validateFleetReport(value);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join("\n")).toContain(message);
    // Homer-intake runs the Workers validator; it must refuse the same way.
    expect(workerValidateFleetReport(value)).toEqual(result);
  });
});
