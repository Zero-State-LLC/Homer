import { expect, it } from "vitest";
import type { FleetMachine } from "@zs-home/shared-contracts";
import {
  FLEET_FRESH_MS,
  projectFleetStatus,
  type FleetStatusSnapshot,
} from "../src/fleet-status.js";

const T0 = Date.parse("2026-11-25T18:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
const configured = [
  { id: "delphi", alias: "Delphi" },
  { id: "bosgame", alias: "Bosgame" },
  { id: "jetson", alias: "Jetson" },
];
function machine(over: Partial<FleetMachine> = {}): FleetMachine {
  return {
    machineId: "delphi",
    name: "Delphi",
    kind: "spark",
    source: "sparkdash",
    state: "up",
    lastSeenAt: iso(T0),
    firing: [],
    ...over,
  };
}
const bosgame = machine({
  machineId: "bosgame",
  name: "Bosgame",
  kind: "ssh",
  source: "reachability",
});
function snapshot(over: Partial<FleetStatusSnapshot> = {}): FleetStatusSnapshot {
  return {
    reportId: "6f1c2b9e-1d3a-4c5e-8f70-123456789abc",
    collectedAt: iso(T0),
    receivedAt: iso(T0 + 1_000),
    sparkdash: { state: "ok", version: "2.91.0", pinnedVersion: "2.91.0" },
    machines: [machine(), bosgame],
    diagnostics: [],
    ...over,
  };
}
const status = (s: FleetStatusSnapshot | null, now = T0 + 30_000) =>
  projectFleetStatus(s, configured, { now });

it("shows every configured machine as unknown before the first report", () => {
  const view = status(null);
  expect(view.state).toBe("none");
  expect(view.reason).toBe("No Fleet Report has arrived.");
  expect(view.machines.map((m) => [m.machineId, m.status])).toEqual([
    ["delphi", "unknown"],
    ["bosgame", "unknown"],
    ["jetson", "unknown"],
  ]);
  expect(view.machines.every((m) => m.telemetry === "unknown" && m.reported === null)).toBe(true);
});

it("shows a fresh report as reported, with names from the configuration", () => {
  const view = status(snapshot());
  expect(view.state).toBe("fresh");
  expect(view.collectedAt).toBe(iso(T0));
  const [delphi, box] = view.machines;
  expect(delphi).toMatchObject({
    name: "Delphi",
    status: "up",
    reason: null,
    telemetry: "sparkdash",
    configured: true,
  });
  // A reachability-only machine is up, but its telemetry is unknown.
  expect(box).toMatchObject({ status: "up", source: "reachability", telemetry: "unknown" });
});

it("makes every machine stale when no report has come for 2 minutes, and says when the last came", () => {
  const fresh = status(snapshot(), T0 + FLEET_FRESH_MS);
  expect(fresh.state).toBe("fresh");
  const view = status(snapshot(), T0 + FLEET_FRESH_MS + 1);
  expect(view.state).toBe("stale");
  expect(view.reason).toBe(`No report for 2 minutes. The last was collected at ${iso(T0)}.`);
  const reported = view.machines.filter((m) => m.reported !== null);
  expect(reported.map((m) => m.status)).toEqual(["stale", "stale"]);
  // What the last report said is kept beside the stale state, never shown as up.
  expect(reported.map((m) => m.reported)).toEqual(["up", "up"]);
});

it("makes one machine stale when its last read is 3 minutes before a fresh report", () => {
  const old = machine({ lastSeenAt: iso(T0 - 3 * 60_000) });
  const view = status(snapshot({ machines: [old, bosgame] }));
  expect(view.state).toBe("fresh");
  expect(view.machines[0]).toMatchObject({
    status: "stale",
    reported: "up",
    reason: `Last read 3 minutes before the latest report, at ${iso(T0 - 3 * 60_000)}.`,
  });
  expect(view.machines[1]?.status).toBe("up");
});

it("shows a machine with no last read as unknown, never up", () => {
  const view = status(snapshot({ machines: [machine({ lastSeenAt: null }), bosgame] }));
  expect(view.machines[0]).toMatchObject({ status: "unknown", reported: "up" });
});

it("says why a sparkDash machine is unknown while sparkDash is not read", () => {
  const view = status(
    snapshot({
      sparkdash: { state: "metrics_off", version: "2.91.0", pinnedVersion: "2.91.0" },
      machines: [machine({ state: "unknown" }), bosgame],
    }),
  );
  expect(view.machines[0]).toMatchObject({
    status: "unknown",
    reason: "sparkDash is metrics off, so this machine is not read.",
  });
  expect(view.machines[1]?.status).toBe("up");
});

it("shows a down machine as down, with its firing alerts named from the catalogue", () => {
  const since = iso(T0 - 60_000);
  const down = machine({
    state: "down",
    firing: [
      { rule: "offline", severity: "critical", since },
      { rule: "new-rule", severity: "warning", since },
    ],
  });
  const view = status(snapshot({ machines: [down, bosgame] }));
  expect(view.machines[0]?.status).toBe("down");
  expect(view.machines[0]?.firing).toEqual([
    { rule: "offline", name: "Unit offline", severity: "critical", since },
    { rule: "new-rule", name: "sparkDash rule new-rule", severity: "warning", since },
  ]);
});

it("lists a configured machine the report leaves out as unknown, and a reported one not configured last", () => {
  const lab = machine({ machineId: "lab-box", name: "Lab box", kind: "host" });
  const view = status(snapshot({ machines: [lab, machine(), bosgame] }));
  expect(view.machines.map((m) => m.machineId)).toEqual(["delphi", "bosgame", "jetson", "lab-box"]);
  expect(view.machines[2]).toMatchObject({
    status: "unknown",
    reason: "The latest Fleet Report does not name this machine.",
    configured: true,
  });
  expect(view.machines[3]).toMatchObject({ name: "Lab box", status: "up", configured: false });
});

it("does not trust a report collected more than a minute ahead of Homer's clock", () => {
  expect(status(snapshot({ collectedAt: iso(T0 + 30_000) }), T0).state).toBe("fresh");
  const ahead = status(snapshot({ collectedAt: iso(T0 + 61_000) }), T0);
  expect(ahead.state).toBe("stale");
  expect(ahead.machines[0]?.status).toBe("stale");
});
