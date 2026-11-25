import { expect, it } from "vitest";
import type { FleetMachine } from "@zs-home/shared-contracts";
import { projectFleetAlerts } from "../src/fleet-alerts.js";
import type { FleetStatusSnapshot } from "../src/fleet-status.js";

const T0 = Date.parse("2026-11-25T18:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
const configured = [
  { id: "delphi", alias: "Delphi" },
  { id: "bosgame", alias: "Bosgame <lab>" },
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
function snapshot(over: Partial<FleetStatusSnapshot> = {}): FleetStatusSnapshot {
  return {
    reportId: "6f1c2b9e-1d3a-4c5e-8f70-123456789abc",
    collectedAt: iso(T0),
    receivedAt: iso(T0 + 1_000),
    sparkdash: { state: "ok", version: "2.91.0", pinnedVersion: "2.91.0" },
    machines: [machine()],
    diagnostics: [],
    ...over,
  };
}
const alerts = (s: FleetStatusSnapshot | null, now = T0 + 30_000) =>
  projectFleetAlerts(s, configured, { now }).alerts;

it("raises nothing before the first report, or for a healthy fleet", () => {
  expect(alerts(null)).toEqual([]);
  expect(alerts(snapshot())).toEqual([]);
});

it("raises fleet:<machineId>:<rule> for each firing alert but concurrency", () => {
  const since = iso(T0 - 60_000);
  const hot = machine({
    firing: [
      { rule: "thermal", severity: "warning", since },
      { rule: "offline", severity: "critical", since },
      { rule: "concurrency", severity: "warning", since },
    ],
  });
  expect(alerts(snapshot({ machines: [hot] }))).toEqual([
    {
      key: "fleet:delphi:thermal",
      template: "fleet.machine_alert",
      params: { machineId: "delphi", name: "Delphi", rule: "thermal" },
    },
    {
      key: "fleet:delphi:offline",
      template: "fleet.machine_alert",
      params: { machineId: "delphi", name: "Delphi", rule: "offline" },
    },
  ]);
});

it("raises fleet:<machineId>:reachability for a Reachability Check machine that is down, named by its id when its alias is not a plain display name", () => {
  // Two failed checks make it down. Its last success is old, but the down Alert says that.
  const box = machine({
    machineId: "bosgame",
    name: "Bosgame",
    kind: "ssh",
    source: "reachability",
    state: "down",
    lastSeenAt: iso(T0 - 10 * 60_000),
  });
  expect(alerts(snapshot({ machines: [box] }))).toEqual([
    {
      key: "fleet:bosgame:reachability",
      template: "fleet.machine_alert",
      params: { machineId: "bosgame", name: "bosgame", rule: "reachability" },
    },
  ]);
  // Up again: nothing raised, so the engine clears it.
  expect(alerts(snapshot({ machines: [{ ...box, state: "up", lastSeenAt: iso(T0) }] }))).toEqual(
    [],
  );
});

it("cuts a long id to the 40-character display-name rule when it stands in for the name", () => {
  const id = "lab-" + "x".repeat(46);
  const box = machine({ machineId: id, kind: "ssh", source: "reachability", state: "down" });
  const plan = projectFleetAlerts(snapshot({ machines: [box] }), [{ id, alias: "Lab <box>" }], {
    now: T0 + 30_000,
  });
  const [alert] = plan.alerts;
  expect(alert?.key).toBe(`fleet:${id}:reachability`);
  expect(alert?.params).toEqual({ machineId: id, name: id.slice(0, 40), rule: "reachability" });
});

it("raises fleet:<machineId>:stale when a machine's last read is more than 2 minutes old", () => {
  const old = iso(T0 - 3 * 60_000);
  expect(alerts(snapshot({ machines: [machine({ lastSeenAt: old })] }))).toEqual([
    {
      key: "fleet:delphi:stale",
      template: "fleet.machine_stale",
      params: { machineId: "delphi", name: "Delphi", since: old },
    },
  ]);
  // No read at all is unknown, not stale.
  expect(alerts(snapshot({ machines: [machine({ lastSeenAt: null })] }))).toEqual([]);
});

it("raises fleet:collector:stale after 2 minutes without a report, and holds the machine Alerts", () => {
  const since = iso(T0 - 60_000);
  const hot = snapshot({
    machines: [machine({ firing: [{ rule: "thermal", severity: "warning", since }] })],
  });
  const fresh = alerts(hot, T0 + 120_000);
  const stale = alerts(hot, T0 + 120_001);
  expect(stale).toEqual([
    ...fresh,
    {
      key: "fleet:collector:stale",
      template: "fleet.collector_stale",
      params: { since: iso(T0) },
    },
  ]);
  // The machine's own Alert stays as the last report had it: neither cleared nor made stale.
  expect(stale.map((a) => a.key)).toEqual(["fleet:delphi:thermal", "fleet:collector:stale"]);
});

it("holds sparkDash machines' rule Alerts, not their stale Alert, while their alerts are unread", () => {
  const box = machine({ machineId: "bosgame", kind: "ssh", source: "reachability" });
  for (const state of ["unreachable", "alerts_off", "shape_changed"] as const) {
    const plan = projectFleetAlerts(
      snapshot({
        sparkdash: { state, version: null, pinnedVersion: "2.91.0" },
        machines: [machine({ state: "unknown" }), box],
      }),
      configured,
      { now: T0 + 30_000 },
    );
    expect(plan.hold.filter((p) => !p.startsWith("fleet:collector:"))).toEqual(["fleet:delphi:"]);
    expect(plan.holdExcept).toEqual(["fleet:delphi:stale"]);
  }
  // With metrics off, sparkDash's alerts are still read, so a recovery is real.
  for (const state of ["ok", "metrics_off"] as const)
    expect(
      projectFleetAlerts(
        snapshot({ sparkdash: { state, version: "2.91.0", pinnedVersion: "2.91.0" } }),
        configured,
        { now: T0 + 30_000 },
      ).hold,
    ).toEqual([]);
});

it("holds the Collector conditions an unreachable or reshaped sparkDash hides", () => {
  const plan = (state: "ok" | "unreachable" | "shape_changed" | "metrics_off") =>
    projectFleetAlerts(
      snapshot({
        sparkdash: { state, version: null, pinnedVersion: "2.91.0" },
        machines: [machine({ state: "unknown", source: "reachability", kind: "ssh" })],
      }),
      configured,
      { now: T0 + 30_000 },
    ).hold;
  expect(plan("unreachable")).toEqual([
    "fleet:collector:metrics_off",
    "fleet:collector:alerts_off",
    "fleet:collector:shape_changed",
    "fleet:collector:version_changed",
  ]);
  expect(plan("shape_changed")).toEqual([
    "fleet:collector:metrics_off",
    "fleet:collector:alerts_off",
    "fleet:collector:version_changed",
  ]);
  // Metrics off: alerts and the release are still read, so their recoveries are real.
  expect(plan("metrics_off")).toEqual([]);
  expect(plan("ok")).toEqual([]);
});

it("raises fleet:collector:<state> while sparkDash is not read", () => {
  for (const state of ["unreachable", "metrics_off", "alerts_off", "shape_changed"] as const)
    expect(
      alerts(
        snapshot({
          sparkdash: { state, version: null, pinnedVersion: "2.91.0" },
          machines: [machine({ state: "unknown" })],
        }),
      ),
    ).toEqual([
      {
        key: `fleet:collector:${state}`,
        template: "fleet.sparkdash_state",
        params: { state },
      },
    ]);
});

it("raises present diagnostics while reported, events_backlog only after 10 minutes", () => {
  const view = alerts(
    snapshot({
      sparkdash: { state: "ok", version: "2.92.0", pinnedVersion: "2.91.0" },
      diagnostics: [
        { code: "version_changed", since: iso(T0 - 60_000) },
        { code: "queue_full", since: iso(T0 - 60_000) },
        { code: "events_backlog", since: iso(T0 - 9 * 60_000) },
      ],
    }),
  );
  expect(view).toEqual([
    {
      key: "fleet:collector:version_changed",
      template: "fleet.version_changed",
      params: { pinned: "2.91.0", seen: "2.92.0" },
    },
    {
      key: "fleet:collector:queue_full",
      template: "fleet.collector_diagnostic",
      params: { code: "queue_full" },
    },
  ]);
  const later = alerts(
    snapshot({ diagnostics: [{ code: "events_backlog", since: iso(T0 - 10 * 60_000) }] }),
  );
  expect(later).toEqual([
    {
      key: "fleet:collector:events_backlog",
      template: "fleet.collector_diagnostic",
      params: { code: "events_backlog" },
    },
  ]);
});

it("raises held occurrences the intake kept after the report that carried them was replaced", () => {
  const since = iso(T0 - 5 * 60_000);
  const gap = { code: "collector_gap" as const, since };
  const expected = [
    {
      key: `fleet:collector:collector_gap:${since}`,
      template: "fleet.held_diagnostic",
      params: { code: "collector_gap", since },
    },
  ];
  expect(projectFleetAlerts(snapshot(), configured, { now: T0, held: [gap] }).alerts).toEqual(
    expected,
  );
  // Carried by the report and kept by the intake: still one Alert.
  expect(
    projectFleetAlerts(snapshot({ diagnostics: [gap] }), configured, { now: T0, held: [gap] })
      .alerts,
  ).toEqual(expected);
});

it("raises a held occurrence from the snapshot only within a day of the report", () => {
  const since = iso(T0 - 5 * 60_000);
  const old = snapshot({ diagnostics: [{ code: "sparkdash_restarted", since }] });
  const day = 24 * 60 * 60_000;
  expect(alerts(old, T0 + day - 2_000)).toHaveLength(2);
  // A Collector silent for a day: only its stale Alert, never the old occurrence again.
  expect(alerts(old, T0 + 1_000 + day).map((a) => a.key)).toEqual(["fleet:collector:stale"]);
});

it("raises one Alert per held diagnostic occurrence, keyed by its since", () => {
  const since = iso(T0 - 5 * 60_000);
  expect(
    alerts(
      snapshot({
        diagnostics: [
          { code: "collector_gap", since },
          { code: "sparkdash_restarted", since },
        ],
      }),
    ),
  ).toEqual([
    {
      key: `fleet:collector:collector_gap:${since}`,
      template: "fleet.held_diagnostic",
      params: { code: "collector_gap", since },
    },
    {
      key: `fleet:collector:sparkdash_restarted:${since}`,
      template: "fleet.held_diagnostic",
      params: { code: "sparkdash_restarted", since },
    },
  ]);
});
