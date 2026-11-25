// The Workers entry, so the catalog Worker can bundle this Projection.
import {
  fleetRuleName,
  type FleetMachine,
  type FleetReport,
} from "@zs-home/shared-contracts/workers";

/**
 * The fleet status Projection (fleet monitoring spec, "Status view"): every
 * Machine's state from the latest Fleet Report, with stale and unknown kept
 * apart from up. Pure: the caller supplies the snapshot, the configuration and
 * the time.
 */

/** A report, or a Machine's last read, older than this is stale. */
export const FLEET_FRESH_MS = 2 * 60_000;
/** How far a report's time may run ahead of Homer's clock before it is not trusted. */
export const FLEET_CLOCK_SKEW_MS = 60_000;

/** The parts of the latest Fleet Report that the intake keeps. */
export interface FleetStatusSnapshot {
  reportId: string;
  collectedAt: string;
  receivedAt: string;
  sparkdash: FleetReport["sparkdash"];
  machines: FleetMachine[];
  diagnostics: FleetReport["diagnostics"];
}

/** A Machine in the runner fleet configuration, in configuration order. */
export interface FleetStatusConfiguredMachine {
  id: string;
  alias: string;
}

export interface FleetStatusOptions {
  /** Milliseconds since the epoch. */
  now: number;
}

export type FleetMachineStatus = "up" | "down" | "stale" | "unknown";

export interface FleetStatusAlert {
  rule: string;
  name: string;
  severity: "warning" | "critical";
  since: string;
}

export interface FleetStatusMachine {
  machineId: string;
  /** The configuration's alias, or the report's name for a Machine not configured. */
  name: string;
  status: FleetMachineStatus;
  /** Why a Machine is stale or unknown, in words; null when it is up or down. */
  reason: string | null;
  /** What the latest report said, before freshness is applied; null when no report names it. */
  reported: FleetMachine["state"] | null;
  source: FleetMachine["source"] | null;
  /** Telemetry is read only by sparkDash; every other Machine's telemetry is unknown. */
  telemetry: "sparkdash" | "unknown";
  lastSeenAt: string | null;
  /** The alerts the latest report says are firing. When stale, they are the last known. */
  firing: FleetStatusAlert[];
  configured: boolean;
}

export interface FleetStatus {
  /** `none` before the first report; `stale` when the latest report is too old to trust. */
  state: "none" | "fresh" | "stale";
  reason: string | null;
  reportId: string | null;
  collectedAt: string | null;
  receivedAt: string | null;
  sparkdash: FleetReport["sparkdash"] | null;
  diagnostics: FleetReport["diagnostics"];
  machines: FleetStatusMachine[];
}

function minutes(ms: number): string {
  const whole = Math.floor(ms / 60_000);
  return whole === 1 ? "1 minute" : `${whole} minutes`;
}

function alerts(machine: FleetMachine): FleetStatusAlert[] {
  return machine.firing.map((alert) => ({
    rule: alert.rule,
    name: fleetRuleName(alert.rule) ?? alert.rule,
    severity: alert.severity,
    since: alert.since,
  }));
}

/** Why a reported `unknown` is unknown. */
function unknownReason(machine: FleetMachine, sparkdash: FleetReport["sparkdash"]): string {
  if (machine.source === "sparkdash" && sparkdash.state !== "ok")
    return `sparkDash is ${sparkdash.state.replaceAll("_", " ")}, so this machine is not read.`;
  return "The Fleet Collector reported this machine as unknown.";
}

/** The fleet's freshness, judged by when the latest report was collected. */
function freshness(
  snapshot: FleetStatusSnapshot | null,
  now: number,
): { state: FleetStatus["state"]; reason: string | null } {
  if (!snapshot) return { state: "none", reason: "No Fleet Report has arrived." };
  const collected = Date.parse(snapshot.collectedAt);
  const age = now - collected;
  if (!Number.isFinite(collected))
    return { state: "stale", reason: "The latest report's time does not parse." };
  if (age < -FLEET_CLOCK_SKEW_MS)
    return {
      state: "stale",
      reason: `The latest report was collected at ${snapshot.collectedAt}, ahead of Homer's clock.`,
    };
  if (age > FLEET_FRESH_MS)
    return {
      state: "stale",
      reason: `No report for ${minutes(age)}. The last was collected at ${snapshot.collectedAt}.`,
    };
  return { state: "fresh", reason: null };
}

function machineStatus(
  machine: FleetMachine,
  snapshot: FleetStatusSnapshot,
  fleet: FleetStatus["state"],
  fleetReason: string | null,
): Pick<FleetStatusMachine, "status" | "reason"> {
  if (fleet === "stale") return { status: "stale", reason: fleetReason };
  if (machine.lastSeenAt === null)
    return { status: "unknown", reason: "The Fleet Collector has no successful read of it yet." };
  const behind = Date.parse(snapshot.collectedAt) - Date.parse(machine.lastSeenAt);
  if (behind > FLEET_FRESH_MS)
    return {
      status: "stale",
      reason: `Last read ${minutes(behind)} before the latest report, at ${machine.lastSeenAt}.`,
    };
  if (machine.state === "unknown")
    return { status: "unknown", reason: unknownReason(machine, snapshot.sparkdash) };
  return { status: machine.state, reason: null };
}

/**
 * Every configured Machine, in configuration order, then any reported Machine
 * the configuration does not hold. A Machine is up or down only when the latest
 * report is fresh and its own last read is too; otherwise it is stale or
 * unknown, never up.
 */
export function projectFleetStatus(
  snapshot: FleetStatusSnapshot | null,
  configured: readonly FleetStatusConfiguredMachine[],
  options: FleetStatusOptions,
): FleetStatus {
  const fleet = freshness(snapshot, options.now);
  const reported = new Map((snapshot?.machines ?? []).map((m) => [m.machineId, m]));
  const known = new Set(configured.map((m) => m.id));
  const rows: FleetStatusMachine[] = configured.map((entry) => {
    const machine = reported.get(entry.id);
    if (!snapshot || !machine)
      return {
        machineId: entry.id,
        name: entry.alias,
        status: "unknown",
        reason: snapshot ? "The latest Fleet Report does not name this machine." : fleet.reason,
        reported: null,
        source: null,
        telemetry: "unknown",
        lastSeenAt: null,
        firing: [],
        configured: true,
      };
    return row(machine, entry.alias, true, snapshot, fleet);
  });
  const extra = [...reported.values()]
    .filter((m) => !known.has(m.machineId))
    .sort((a, b) => (a.machineId < b.machineId ? -1 : a.machineId > b.machineId ? 1 : 0));
  if (snapshot)
    for (const machine of extra) rows.push(row(machine, machine.name, false, snapshot, fleet));
  return {
    state: fleet.state,
    reason: fleet.reason,
    reportId: snapshot?.reportId ?? null,
    collectedAt: snapshot?.collectedAt ?? null,
    receivedAt: snapshot?.receivedAt ?? null,
    sparkdash: snapshot?.sparkdash ?? null,
    diagnostics: snapshot?.diagnostics ?? [],
    machines: rows,
  };
}

function row(
  machine: FleetMachine,
  name: string,
  configured: boolean,
  snapshot: FleetStatusSnapshot,
  fleet: { state: FleetStatus["state"]; reason: string | null },
): FleetStatusMachine {
  return {
    machineId: machine.machineId,
    name,
    ...machineStatus(machine, snapshot, fleet.state, fleet.reason),
    reported: machine.state,
    source: machine.source,
    telemetry: machine.source === "sparkdash" ? "sparkdash" : "unknown",
    lastSeenAt: machine.lastSeenAt,
    firing: alerts(machine),
    configured,
  };
}
