import type { ActivityEvent, FleetMachine, FleetReport } from "@zs-home/shared-contracts";
import type { CollectorConfig } from "./config.js";
import { continuity, cursorOf, type Cursor } from "./continuity.js";
import { cleanName, iso, machineAlertEvent } from "./events.js";
import {
  SHAPE_CHANGED,
  parseAlerts,
  parseHealth,
  parseMetrics,
  type AlertsRead,
  type MetricsUnit,
  type ShapeChanged,
  type UnitKind,
} from "./sparkdash.js";

export type HeldCode = "collector_gap" | "sparkdash_restarted";
export type PresentCode = "version_changed" | "events_backlog" | "queue_full";

/**
 * What the Collector keeps between polls, on its own host. The queue of
 * undelivered events and the Reachability Check counters are the runtime's.
 */
export interface CollectorState {
  /** The newest history entry turned into events. */
  cursor: Cursor | null;
  /** The alerts active at the last poll. */
  active: { key: string; startsAt: number }[];
  /** `collector_gap` and `sparkdash_restarted`, kept until a `2xx` answers a report that carried them. */
  held: { code: HeldCode; since: string }[];
  /** Since when each present condition has held. */
  present: Partial<Record<PresentCode, string>>;
  /** The last time each Machine answered, in ms. */
  lastSeen: Record<string, number>;
  /** The last cleaned name of each sparkDash Machine. */
  names: Record<string, string>;
  /** The last kind sparkDash gave each Machine. */
  kinds: Record<string, UnitKind>;
}

export function initialState(): CollectorState {
  return {
    cursor: null,
    active: [],
    held: [],
    present: {},
    lastSeen: {},
    names: {},
    kinds: {},
  };
}

/** One response, or `unreachable` when no response came. */
export type HttpRead = { status: number; body: string } | "unreachable";

export interface SparkdashRead {
  health: HttpRead;
  metrics: HttpRead;
  alerts: HttpRead;
}

/** A Reachability Check result, from the runtime. */
export interface ReachabilityReading {
  state: "up" | "down" | "unknown";
  /** The last successful Check, in ms. */
  lastSeenAt: number | null;
}

export interface PollInput {
  config: CollectorConfig;
  state: CollectorState;
  read: SparkdashRead;
  reachability?: ReadonlyMap<string, ReachabilityReading>;
  /** The poll's time, in ms. The core has no clock of its own. */
  now: number;
  /** How many more events the queue holds. */
  queueRoom: number;
}

export interface Snapshot {
  sparkdash: FleetReport["sparkdash"];
  machines: FleetMachine[];
}

export interface PollResult {
  /** Save only after `events` are on the queue: the cursor already counts them. */
  state: CollectorState;
  snapshot: Snapshot;
  /** New events, oldest first. */
  events: ActivityEvent[];
}

type SparkdashState = FleetReport["sparkdash"]["state"];
const MAX_FIRING = 32;

/** A held diagnostic keeps its first `since` until a report that carries it is delivered. */
export function addHeld(
  held: CollectorState["held"],
  code: HeldCode,
  since: string,
): CollectorState["held"] {
  return held.some((d) => d.code === code) ? held : [...held, { code, since }];
}

/** A present condition's `since`: kept while it holds, dropped when it stops. */
export function setPresent(
  present: CollectorState["present"],
  code: PresentCode,
  on: boolean,
  now: string,
): CollectorState["present"] {
  const next = { ...present };
  if (on) next[code] ??= now;
  else delete next[code];
  return next;
}

interface Reads {
  state: SparkdashState;
  version: string | null;
  metrics: Map<string, MetricsUnit> | undefined;
  alerts: AlertsRead | undefined;
}

function readAll(read: SparkdashRead): Reads {
  const { health, metrics, alerts } = read;
  if (health === "unreachable" || metrics === "unreachable" || alerts === "unreachable") {
    return { state: "unreachable", version: null, metrics: undefined, alerts: undefined };
  }
  const h = health.status === 200 ? parseHealth(health.body) : SHAPE_CHANGED;
  const version = h === SHAPE_CHANGED ? null : h.version;
  // sparkDash answers 404 while its Prometheus setting is off.
  const m =
    metrics.status === 404
      ? undefined
      : metrics.status === 200
        ? parseMetrics(metrics.body)
        : SHAPE_CHANGED;
  const a = alerts.status === 200 ? parseAlerts(alerts.body) : SHAPE_CHANGED;
  if (h === SHAPE_CHANGED || m === SHAPE_CHANGED || a === SHAPE_CHANGED) {
    // The Collector maps nothing from a response that does not match its schema.
    return { state: "shape_changed", version, metrics: undefined, alerts: undefined };
  }
  if (m === undefined) return { state: "metrics_off", version, metrics: undefined, alerts: a };
  return { state: a.enabled ? "ok" : "alerts_off", version, metrics: m, alerts: a };
}

interface History {
  events: ActivityEvent[];
  cursor: Cursor | null;
  held: CollectorState["held"];
  active: CollectorState["active"];
  queueFull: boolean;
}

/** Steps 4 to 6 of each poll: continuity, events oldest first, and active alerts that vanished. */
function history(
  alerts: AlertsRead,
  state: CollectorState,
  input: PollInput,
  machineOf: (unitId: string) => string | undefined,
  nameOf: (machineId: string) => string,
  version: string | null,
): History | ShapeChanged {
  const nowIso = iso(input.now);
  let held = state.held;
  const flow = continuity(state.cursor, alerts.recent);
  if (flow.kind === "gap") held = addHeld(held, "collector_gap", nowIso);
  if (flow.kind === "restart") {
    held = addHeld(held, "sparkdash_restarted", nowIso);
    if (flow.gap) held = addHeld(held, "collector_gap", nowIso);
  }
  const events: ActivityEvent[] = [];
  // After a restart the old cursor names nothing. If nothing new is queued, the
  // next poll starts afresh, without reporting the same restart twice.
  let cursor = flow.kind === "restart" ? null : state.cursor;
  let queueFull = false;
  for (const entry of flow.entries) {
    const machineId = machineOf(entry.unitId);
    if (machineId !== undefined) {
      if (events.length >= input.queueRoom) {
        // The cursor stops here; sparkDash's history keeps the rest.
        queueFull = true;
        break;
      }
      const event = machineAlertEvent({
        source: "sparkdash",
        kind: entry.status === "firing" ? "machine.alert_fired" : "machine.alert_cleared",
        machineId,
        name: nameOf(machineId),
        rule: entry.ruleId,
        severity: entry.severity,
        startsAt: entry.startsAt,
        at: entry.at,
        sparkdashVersion: version,
        frontDoorOrigin: input.config.frontDoorOrigin,
        collectedAt: input.now,
      });
      if (event === undefined) return SHAPE_CHANGED;
      events.push(event);
    }
    // A unit with no mapping is not reported, but its entries are passed.
    cursor = cursorOf(entry);
  }
  // An alert active at the last poll that is neither active now nor resolved in
  // the history was lost. The Collector never invents a clear. While sparkDash's
  // alerts are off it forgets its active alerts by design, and alerts_off says so.
  if (alerts.enabled) {
    for (const was of state.active) {
      const still = alerts.active.some((a) => a.key === was.key && a.startsAt === was.startsAt);
      const cleared = alerts.recent.some(
        (e) => e.status === "resolved" && e.key === was.key && e.startsAt === was.startsAt,
      );
      if (!still && !cleared) held = addHeld(held, "collector_gap", nowIso);
    }
  }
  const active = alerts.active.map((a) => ({ key: a.key, startsAt: a.startsAt }));
  return { events, cursor, held, active, queueFull };
}

/**
 * One poll (fleet monitoring spec, "Each poll"): sparkDash's three responses
 * and the Reachability Checks in; the next state, the snapshot and the new
 * events out. Pure: no network, no files, no clock.
 */
export function poll(input: PollInput): PollResult {
  const { config, now } = input;
  const nowIso = iso(now);
  const reads = readAll(input.read);
  const state: CollectorState = {
    ...input.state,
    lastSeen: { ...input.state.lastSeen },
    names: { ...input.state.names },
    kinds: { ...input.state.kinds },
  };
  const unitToMachine = new Map<string, string>();
  for (const m of config.machines) {
    if ("sparkdashUnit" in m) unitToMachine.set(m.sparkdashUnit, m.machineId);
  }
  // What sparkDash says of each mapped unit: kept for polls when metrics are off.
  for (const m of config.machines) {
    if (!("sparkdashUnit" in m)) continue;
    const unit = reads.metrics?.get(m.sparkdashUnit);
    if (!unit) continue;
    state.names[m.machineId] = cleanName(unit.name, m.machineId);
    state.kinds[m.machineId] = unit.kind;
    const seen = unit.lastSuccessMs;
    if (seen !== undefined && seen > (state.lastSeen[m.machineId] ?? -1)) {
      state.lastSeen[m.machineId] = seen;
    }
  }
  const nameOf = (machineId: string) => state.names[machineId] ?? cleanName(undefined, machineId);

  let sparkdashState = reads.state;
  let events: ActivityEvent[] = [];
  if (reads.alerts) {
    const built = history(
      reads.alerts,
      state,
      input,
      (unitId) => unitToMachine.get(unitId),
      nameOf,
      reads.version,
    );
    if (built === SHAPE_CHANGED) {
      sparkdashState = "shape_changed";
    } else {
      events = built.events;
      state.cursor = built.cursor;
      state.held = built.held;
      state.active = built.active;
      state.present = setPresent(state.present, "queue_full", built.queueFull, nowIso);
    }
  }

  // The snapshot: while sparkDash is not read, or not trusted, every sparkDash Machine is unknown.
  const machinesRead = sparkdashState === "ok" || sparkdashState === "alerts_off";
  const alertsRead = sparkdashState === "ok" || sparkdashState === "metrics_off";
  const firing = (unitId: string): FleetMachine["firing"] =>
    alertsRead && reads.alerts
      ? reads.alerts.active
          .filter((a) => a.unitId === unitId)
          .slice(0, MAX_FIRING)
          .map((a) => ({ rule: a.ruleId, severity: a.severity, since: iso(a.startsAt) }))
      : [];
  const machines = config.machines.map((m): FleetMachine => {
    if ("sparkdashUnit" in m) {
      const unit = machinesRead ? reads.metrics?.get(m.sparkdashUnit) : undefined;
      const seen = state.lastSeen[m.machineId];
      return {
        machineId: m.machineId,
        name: nameOf(m.machineId),
        // Until sparkDash has described a unit, the generic kind.
        kind: state.kinds[m.machineId] ?? "host",
        source: "sparkdash",
        state: unit ? (unit.up ? "up" : "down") : "unknown",
        lastSeenAt: seen === undefined ? null : iso(seen),
        firing: firing(m.sparkdashUnit),
      };
    }
    const reading = input.reachability?.get(m.machineId);
    return {
      machineId: m.machineId,
      name: cleanName(m.name, m.machineId),
      kind: "ssh",
      source: "reachability",
      state: reading?.state ?? "unknown",
      lastSeenAt: reading?.lastSeenAt == null ? null : iso(reading.lastSeenAt),
      firing: [],
    };
  });

  // A release other than the pinned one; unknown while health is not read.
  if (reads.version !== null) {
    state.present = setPresent(
      state.present,
      "version_changed",
      reads.version !== config.pinnedVersion,
      nowIso,
    );
  }

  return {
    state,
    snapshot: {
      sparkdash: {
        state: sparkdashState,
        version: reads.version,
        pinnedVersion: config.pinnedVersion,
      },
      machines,
    },
    events,
  };
}
