import { describe, expect, it } from "vitest";
import { MAX_FLEET_REPORT_BYTES, validateFleetReport } from "@zs-home/shared-contracts";
import { buildFleetReport, initialState, poll } from "../src/index.js";
import { alertsBody, config, ok, range, read } from "./fixture.js";

const NOW = Date.parse("2026-11-24T18:00:00Z");
const REPORT_ID = "6f0b8a1e-2c3d-4e5f-8a9b-0c1d2e3f4a5b";

describe("building a Fleet Report", () => {
  it("carries the oldest 100 events, then the next 50, with events_backlog on the first", () => {
    const polled = poll({
      config,
      state: initialState(),
      read: read({ alerts: ok(alertsBody(range(1, 150))) }),
      now: NOW,
      queueRoom: 10_000,
    });
    expect(polled.events).toHaveLength(150);
    const first = buildFleetReport({
      reportId: REPORT_ID,
      collectedAt: NOW,
      snapshot: polled.snapshot,
      state: polled.state,
      queue: polled.events,
    });
    if (!first.ok) throw new Error(first.errors.join("\n"));
    expect(first.report.events).toEqual(polled.events.slice(0, 100));
    expect(first.report.diagnostics).toEqual([
      { code: "events_backlog", since: "2026-11-24T18:00:00.000Z" },
    ]);
    expect(validateFleetReport(first.report).ok).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(first.report)).length).toBeLessThan(
      MAX_FLEET_REPORT_BYTES,
    );
    const second = buildFleetReport({
      reportId: "6f0b8a1e-2c3d-4e5f-8a9b-0c1d2e3f4a5c",
      collectedAt: NOW + 1000,
      snapshot: polled.snapshot,
      state: first.state,
      queue: polled.events.slice(100),
    });
    if (!second.ok) throw new Error(second.errors.join("\n"));
    expect(second.report.events).toEqual(polled.events.slice(100));
    expect(second.report.diagnostics).toEqual([]);
  });

  it("refuses a report that carries an IPv4 or IPv6 address anywhere", () => {
    const polled = poll({
      config,
      state: initialState(),
      read: read(),
      now: NOW,
      queueRoom: 10_000,
    });
    for (const name of ["10.0.0.5", "fe80--1"]) {
      const machines = polled.snapshot.machines.map((m, i) => (i === 0 ? { ...m, name } : m));
      const built = buildFleetReport({
        reportId: REPORT_ID,
        collectedAt: NOW,
        snapshot: { ...polled.snapshot, machines },
        state: polled.state,
        queue: [],
      });
      expect(built.ok, name).toBe(name === "fe80--1");
    }
    const sneaky = {
      ...polled.snapshot,
      sparkdash: { ...polled.snapshot.sparkdash, version: "10.0.0.5" },
    };
    const refused = buildFleetReport({
      reportId: REPORT_ID,
      collectedAt: NOW,
      snapshot: sneaky,
      state: polled.state,
      queue: [],
    });
    expect(refused).toEqual({
      ok: false,
      errors: ["/sparkdash/version must not carry an IP address"],
    });
  });
});
