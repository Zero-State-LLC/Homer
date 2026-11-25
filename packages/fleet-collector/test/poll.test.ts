import { describe, expect, it } from "vitest";
import {
  acknowledgeReport,
  buildFleetReport,
  initialState,
  poll,
  type CollectorState,
  type PollInput,
  type PollResult,
} from "../src/index.js";
import { BUILD_VERSION } from "@zs-home/shared-contracts";
import {
  T0,
  activeAlert,
  alertsBody,
  config,
  entry,
  metricsText,
  ok,
  range,
  read,
  units,
} from "./fixture.js";

const NOW = Date.parse("2026-11-24T18:00:00Z");

function run(over: Partial<PollInput> = {}): PollResult {
  return poll({
    config,
    state: initialState(),
    read: read(),
    now: NOW,
    queueRoom: 10_000,
    ...over,
  });
}

function codes(state: CollectorState): string[] {
  return state.held.map((d) => d.code);
}

describe("each poll", () => {
  it("builds every configured Machine from sparkdash_up, and never an unmapped unit", () => {
    const { snapshot } = run({
      reachability: new Map([["pc-one", { state: "down" as const, lastSeenAt: T0 }]]),
    });
    expect(snapshot.sparkdash).toEqual({ state: "ok", version: "2.91.0", pinnedVersion: "2.91.0" });
    expect(snapshot.machines).toEqual([
      {
        machineId: "delphi",
        name: "Delphi",
        kind: "spark",
        source: "sparkdash",
        state: "up",
        lastSeenAt: "2026-11-24T18:00:00.000Z",
        firing: [],
      },
      {
        machineId: "mac-studio",
        name: "Mac Studio",
        kind: "mac",
        source: "sparkdash",
        state: "down",
        lastSeenAt: null,
        firing: [],
      },
      {
        machineId: "pc-one",
        name: "PC",
        kind: "ssh",
        source: "reachability",
        state: "down",
        lastSeenAt: "2026-11-24T17:58:00.000Z",
        firing: [],
      },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("lab-box");
  });

  it("reports metrics_off when /metrics answers 404, with every sparkDash Machine unknown", () => {
    const first = run();
    const off = run({ state: first.state, read: read({ metrics: { status: 404, body: "off" } }) });
    expect(off.snapshot.sparkdash.state).toBe("metrics_off");
    expect(
      off.snapshot.machines.filter((m) => m.source === "sparkdash").map((m) => m.state),
    ).toEqual(["unknown", "unknown"]);
    // What sparkDash last said of each unit is kept.
    expect(off.snapshot.machines[0]).toMatchObject({
      name: "Delphi",
      kind: "spark",
      lastSeenAt: "2026-11-24T18:00:00.000Z",
    });
  });

  it("reports alerts_off when sparkDash's alerts are off, never no problems", () => {
    const off = run({ read: read({ alerts: ok(alertsBody([], [], false)) }) });
    expect(off.snapshot.sparkdash.state).toBe("alerts_off");
    expect(off.snapshot.machines[0]?.state).toBe("up");
  });

  it("maps nothing from a response with a missing or renamed field", () => {
    const shaped = run({
      read: read({
        alerts: ok(JSON.stringify({ enabled: true, active: [], recents: [] })),
      }),
    });
    expect(shaped.snapshot.sparkdash.state).toBe("shape_changed");
    expect(shaped.events).toEqual([]);
    expect(
      shaped.snapshot.machines
        .filter((m) => m.source === "sparkdash")
        .every((m) => m.state === "unknown"),
    ).toBe(true);
    expect(shaped.state.cursor).toBeNull();
  });

  it("reports unreachable when sparkDash does not answer; the Reachability Checks still count", () => {
    const down = run({
      read: read({ alerts: "unreachable" }),
      reachability: new Map([["pc-one", { state: "up" as const, lastSeenAt: NOW }]]),
    });
    expect(down.snapshot.sparkdash).toEqual({
      state: "unreachable",
      version: null,
      pinnedVersion: "2.91.0",
    });
    expect(down.snapshot.machines.map((m) => m.state)).toEqual(["unknown", "unknown", "up"]);
  });

  it("turns a firing and then a resolved entry into one fired and one cleared event, keyed by the same startsAt", () => {
    const first = run({
      read: read({ alerts: ok(alertsBody([entry({ id: 1, status: "firing" })], [activeAlert()])) }),
    });
    expect(first.events.map((e) => e.kind)).toEqual(["machine.alert_fired"]);
    expect(first.snapshot.machines[0]?.firing).toEqual([
      { rule: "thermal", severity: "warning", since: "2026-11-24T17:58:00.000Z" },
    ]);
    const second = run({
      state: first.state,
      read: read({
        alerts: ok(
          alertsBody([entry({ id: 1, status: "firing" }), entry({ id: 2, status: "resolved" })]),
        ),
      }),
    });
    expect(second.events.map((e) => e.kind)).toEqual(["machine.alert_cleared"]);
    expect(second.events[0]?.eventKey).toBe(
      first.events[0]?.eventKey.replace("alert_fired", "alert_cleared"),
    );
    expect(first.events[0]).toMatchObject({
      eventKey: `sparkdash:machine.alert_fired:delphi:thermal:${T0}`,
      subject: "GPU temperature on Delphi",
      actor: { sourceAccount: "sparkdash:alerts" },
      provenance: {
        sourceObjectId: `delphi:thermal@${T0}`,
        sourceUrl: "https://sparkdash.example.test/",
        collectorVersion: BUILD_VERSION,
      },
      data: {
        machineId: "delphi",
        rule: "thermal",
        severity: "warning",
        startsAt: "2026-11-24T17:58:00.000Z",
        sparkdashVersion: "2.91.0",
      },
    });
    // The same entries on the next poll: no new events.
    const third = run({
      state: second.state,
      read: read({
        alerts: ok(
          alertsBody([entry({ id: 1, status: "firing" }), entry({ id: 2, status: "resolved" })]),
        ),
      }),
    });
    expect(third.events).toEqual([]);
    expect(codes(third.state)).toEqual([]);
  });

  it("keeps label, summary and every other untrusted text out of the report and the events", () => {
    const first = run({
      read: read({ alerts: ok(alertsBody([entry({ id: 1, status: "firing" })], [activeAlert()])) }),
    });
    const text = JSON.stringify({ snapshot: first.snapshot, events: first.events });
    for (const dropped of [
      "10.0.0.5",
      "fe80::1",
      "192.168.1.20",
      "<script>",
      "<b>",
      "Connection refused",
      "GPU0",
      "Xid 79",
    ]) {
      expect(text, dropped).not.toContain(dropped);
    }
  });

  it("adds collector_gap when an active alert vanishes from both active and recent, and invents no clear", () => {
    const first = run({
      read: read({ alerts: ok(alertsBody([entry({ id: 1, status: "firing" })], [activeAlert()])) }),
    });
    const gone = run({
      state: first.state,
      read: read({ alerts: ok(alertsBody([entry({ id: 1, status: "firing" })], [])) }),
    });
    expect(gone.events).toEqual([]);
    expect(codes(gone.state)).toEqual(["collector_gap"]);
  });

  it("turns ids 101 to 300 after cursor 90 into events with collector_gap", () => {
    const first = run({ read: read({ alerts: ok(alertsBody(range(1, 90))) }) });
    const next = run({
      state: first.state,
      read: read({ alerts: ok(alertsBody(range(101, 300))) }),
    });
    expect(next.events).toHaveLength(200);
    expect(codes(next.state)).toEqual(["collector_gap"]);
  });

  it("turns ids 91 to 290 after cursor 90 into events with no diagnostic", () => {
    const first = run({ read: read({ alerts: ok(alertsBody(range(1, 90))) }) });
    const next = run({
      state: first.state,
      read: read({ alerts: ok(alertsBody(range(91, 290))) }),
    });
    expect(next.events).toHaveLength(200);
    expect(codes(next.state)).toEqual([]);
  });

  it("adds sparkdash_restarted when the newest id is 4 and the cursor 250, and ids 1 to 4 become events", () => {
    const first = run({ read: read({ alerts: ok(alertsBody(range(51, 250))) }) });
    const next = run({ state: first.state, read: read({ alerts: ok(alertsBody(range(1, 4))) }) });
    expect(next.events.map((e) => e.data?.["startsAt"])).toEqual(
      [1, 2, 3, 4].map((i) => new Date(T0 + i * 60_000).toISOString()),
    );
    expect(codes(next.state)).toEqual(["sparkdash_restarted"]);
  });

  it("stops the cursor and adds queue_full when the queue is full", () => {
    const full = run({ read: read({ alerts: ok(alertsBody(range(1, 5))) }), queueRoom: 2 });
    expect(full.events).toHaveLength(2);
    expect(full.state.cursor?.id).toBe(2);
    expect(full.state.present.queue_full).toBe("2026-11-24T18:00:00.000Z");
    const later = run({
      state: full.state,
      read: read({ alerts: ok(alertsBody(range(1, 5))) }),
      now: NOW + 30_000,
    });
    expect(later.events).toHaveLength(3);
    expect(later.state.present.queue_full).toBeUndefined();
  });

  it("keeps following sparkDash's history through a restart while the queue is full", () => {
    const first = run({ read: read({ alerts: ok(alertsBody(range(51, 250))) }) });
    const restarted = run({
      state: first.state,
      read: read({ alerts: ok(alertsBody(range(1, 4))) }),
      queueRoom: 0,
    });
    expect(restarted.events).toEqual([]);
    expect(codes(restarted.state)).toEqual(["sparkdash_restarted"]);
    // sparkDash evicts ids 1 to 4 before the queue has room: a gap, not a silent loss.
    const evicted = run({
      state: restarted.state,
      read: read({ alerts: ok(alertsBody(range(5, 204))) }),
    });
    expect(evicted.events).toHaveLength(200);
    expect(codes(evicted.state)).toEqual(["sparkdash_restarted", "collector_gap"]);
    // Had nothing been evicted, it would have been contiguous, and the restart is not reported twice.
    const kept = run({
      state: restarted.state,
      read: read({ alerts: ok(alertsBody(range(1, 6))) }),
    });
    expect(kept.events).toHaveLength(6);
    expect(codes(kept.state)).toEqual(["sparkdash_restarted"]);
  });

  it("reports an empty history that stays empty as nothing new, and a restart only once", () => {
    const empty = run();
    const again = run({ state: empty.state });
    expect(again.events).toEqual([]);
    expect(codes(again.state)).toEqual([]);
    // A restart that empties the history is reported once; after delivery it does not come back.
    const before = run({ read: read({ alerts: ok(alertsBody(range(1, 3))) }) });
    const restarted = run({ state: before.state });
    expect(codes(restarted.state)).toEqual(["sparkdash_restarted"]);
    const delivered: CollectorState = { ...restarted.state, held: [] };
    expect(codes(run({ state: delivered }).state)).toEqual([]);
  });

  it("is shape_changed for a metrics timestamp no date can hold, and still builds a snapshot", () => {
    const text = metricsText().replace(/ 1795543200\n/, " 1e20\n");
    const shaped = run({ read: read({ metrics: ok(text) }) });
    expect(shaped.snapshot.sparkdash.state).toBe("shape_changed");
    expect(shaped.snapshot.machines.map((m) => m.lastSeenAt)).toEqual([null, null, null]);
  });

  it("holds a gap through a failed delivery, with its first since, until a report that carried it is answered", () => {
    const first = run({ read: read({ alerts: ok(alertsBody(range(1, 90))) }) });
    const gap = run({
      state: first.state,
      read: read({ alerts: ok(alertsBody(range(101, 300))) }),
      now: NOW + 30_000,
    });
    // The post fails. The next poll is contiguous.
    const next = run({
      state: gap.state,
      read: read({ alerts: ok(alertsBody(range(102, 301))) }),
      now: NOW + 60_000,
    });
    expect(next.state.held).toEqual([{ code: "collector_gap", since: "2026-11-24T18:00:30.000Z" }]);
    const built = buildFleetReport({
      reportId: "6f0b8a1e-2c3d-4e5f-8a9b-0c1d2e3f4a5b",
      collectedAt: NOW + 60_000,
      snapshot: next.snapshot,
      state: next.state,
      queue: [],
    });
    if (!built.ok) throw new Error(built.errors.join("\n"));
    expect(built.report.diagnostics).toEqual([
      { code: "collector_gap", since: "2026-11-24T18:00:30.000Z" },
    ]);
    expect(acknowledgeReport(built.state, built.report).held).toEqual([]);
  });

  it("replaces a name with control characters, more than 40 characters or an address by the machineId", () => {
    for (const name of ["Del\u0007phi", "x".repeat(41), "10.0.0.5", "fe80::1"]) {
      const { snapshot } = run({
        read: read({ metrics: ok(metricsText([{ ...units[0]!, name }])) }),
      });
      expect(snapshot.machines[0]?.name, name).toBe("delphi");
    }
  });

  it("names an unknown sparkDash rule by its id", () => {
    const named = run({
      read: read({
        alerts: ok(alertsBody([entry({ id: 1, status: "firing", ruleId: "new-rule" })])),
      }),
    });
    expect(named.events[0]?.subject).toBe("sparkDash rule new-rule on Delphi");
  });

  it("adds version_changed for another release, and keeps collecting", () => {
    const changed = run({
      read: read({
        health: ok(JSON.stringify({ version: "2.92.0" })),
        alerts: ok(alertsBody([entry({ id: 1, status: "firing" })])),
      }),
    });
    expect(changed.state.present.version_changed).toBe("2026-11-24T18:00:00.000Z");
    expect(changed.events).toHaveLength(1);
    expect(changed.events[0]?.data?.["sparkdashVersion"]).toBe("2.92.0");
  });

  it("reads machine-keyed state by its own entries only, for a machineId such as constructor", () => {
    const odd = { ...config, machines: [{ machineId: "constructor", sparkdashUnit: "delphi" }] };
    const first = run({ config: odd });
    expect(first.snapshot.machines[0]).toMatchObject({
      machineId: "constructor",
      name: "Delphi",
      kind: "spark",
      lastSeenAt: "2026-11-24T18:00:00.000Z",
    });
    const unseen = run({ config: odd, read: read({ metrics: ok(metricsText([])) }) });
    expect(unseen.snapshot.machines[0]).toMatchObject({
      name: "constructor",
      kind: "host",
      state: "unknown",
      lastSeenAt: null,
    });
  });

  it("passes the entries of a unit with no mapping without reporting them", () => {
    const skipped = run({
      read: read({
        alerts: ok(alertsBody([entry({ id: 1, status: "firing", unitId: "lab-box" })])),
      }),
    });
    expect(skipped.events).toEqual([]);
    expect(skipped.state.cursor?.id).toBe(1);
  });
});
