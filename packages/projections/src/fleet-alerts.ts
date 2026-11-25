import {
  projectFleetStatus,
  type FleetStatusConfiguredMachine,
  type FleetStatusSnapshot,
} from "./fleet-status.js";

/**
 * The fleet's Alerts (fleet monitoring spec, "Alerts to Buzz"): the Alerts the latest Fleet
 * Report and the time raise now, for the Buzz Alert engine to post change-only. Pure. An Alert
 * the result no longer holds is cleared by the engine; while the fleet is stale, the last
 * report's machine Alerts are held as they were, never cleared.
 */

/** The Alert Key prefix the fleet owns. */
export const FLEET_ALERT_SCOPE = "fleet:";
/** `events_backlog` is raised only once it has lasted this long. */
export const EVENTS_BACKLOG_ALERT_MS = 10 * 60_000;
/** sparkDash's model-concurrency notice is not an Alert. */
const NOT_SENT = new Set(["concurrency"]);
const DISPLAY_NAME = /^[A-Za-z0-9 ._-]{1,40}$/;

/** One Alert for the engine: a key, a template id and its parameters. */
export interface FleetAlertRequest {
  key: string;
  template: string;
  params: Record<string, string>;
}

/**
 * A configured alias when it fits the display-name rule, otherwise the id, cut to the rule's
 * 40 characters. The Alert Key and the `machineId` parameter keep the whole id.
 */
function displayName(name: string, machineId: string): string {
  return DISPLAY_NAME.test(name) ? name : machineId.slice(0, 40);
}

/**
 * What the fleet raises now, and the Alert Key prefixes to hold: a machine whose alerts
 * sparkDash is not evaluating keeps its rule Alerts as they were, since an empty firing list
 * then says nothing.
 */
export interface FleetAlertPlan {
  alerts: FleetAlertRequest[];
  hold: string[];
}

/** sparkDash states in which its machines' firing lists say nothing. */
const ALERTS_UNSEEN = new Set(["unreachable", "metrics_off", "alerts_off", "shape_changed"]);

/** A held diagnostic occurrence, kept by the intake apart from the snapshot. */
export interface FleetHeldOccurrence {
  code: "collector_gap" | "sparkdash_restarted";
  since: string;
}

export interface FleetAlertOptions {
  now: number;
  /**
   * Held diagnostic occurrences the intake recorded. A report carries one only until the
   * Collector's next acknowledged post, so the latest snapshot alone can miss it.
   */
  held?: readonly FleetHeldOccurrence[];
}

export function projectFleetAlerts(
  snapshot: FleetStatusSnapshot | null,
  configured: readonly FleetStatusConfiguredMachine[],
  options: FleetAlertOptions,
): FleetAlertPlan {
  // Before the first report there is nothing to be stale against.
  if (!snapshot) return { alerts: [], hold: [] };
  const alerts: FleetAlertRequest[] = [];
  const hold: string[] = [];
  const unseen = ALERTS_UNSEEN.has(snapshot.sparkdash.state);
  const collected = Date.parse(snapshot.collectedAt);
  // Each machine as the report itself saw it, so a stale fleet holds its machine Alerts.
  const asReported = projectFleetStatus(snapshot, configured, { now: collected });
  for (const machine of asReported.machines) {
    if (machine.reported === null) continue;
    const name = displayName(machine.name, machine.machineId);
    if (unseen && machine.source === "sparkdash") hold.push(`fleet:${machine.machineId}:`);
    // A Reachability Check's alert is its down state: the Collector reports it as events
    // and lists no firing alerts for that machine.
    const unreachable = machine.source === "reachability" && machine.reported === "down";
    if (unreachable)
      alerts.push({
        key: `fleet:${machine.machineId}:reachability`,
        template: "fleet.machine_alert",
        params: { machineId: machine.machineId, name, rule: "reachability" },
      });
    for (const alert of machine.firing) {
      if (NOT_SENT.has(alert.rule)) continue;
      alerts.push({
        key: `fleet:${machine.machineId}:${alert.rule}`,
        template: "fleet.machine_alert",
        params: { machineId: machine.machineId, name, rule: alert.rule },
      });
    }
    // An unreachable machine's reading is stale by definition; its down Alert says so.
    if (machine.status === "stale" && machine.lastSeenAt && !unreachable)
      alerts.push({
        key: `fleet:${machine.machineId}:stale`,
        template: "fleet.machine_stale",
        params: { machineId: machine.machineId, name, since: machine.lastSeenAt },
      });
  }
  if (projectFleetStatus(snapshot, configured, options).state === "stale")
    alerts.push({
      key: "fleet:collector:stale",
      template: "fleet.collector_stale",
      params: { since: snapshot.collectedAt },
    });
  if (snapshot.sparkdash.state !== "ok")
    alerts.push({
      key: `fleet:collector:${snapshot.sparkdash.state}`,
      template: "fleet.sparkdash_state",
      params: { state: snapshot.sparkdash.state },
    });
  const occurrences = new Map<string, FleetHeldOccurrence>();
  for (const diagnostic of [...snapshot.diagnostics, ...(options.held ?? [])]) {
    const code = diagnostic.code;
    if (code === "version_changed")
      alerts.push({
        key: "fleet:collector:version_changed",
        template: "fleet.version_changed",
        params: {
          pinned: snapshot.sparkdash.pinnedVersion,
          seen: snapshot.sparkdash.version ?? "unknown",
        },
      });
    else if (code === "queue_full" || code === "events_backlog") {
      if (
        code === "events_backlog" &&
        collected - Date.parse(diagnostic.since) < EVENTS_BACKLOG_ALERT_MS
      )
        continue;
      alerts.push({
        key: `fleet:collector:${code}`,
        template: "fleet.collector_diagnostic",
        params: { code },
      });
    } else
      occurrences.set(`fleet:collector:${code}:${diagnostic.since}`, {
        code,
        since: diagnostic.since,
      });
  }
  for (const [key, held] of occurrences)
    alerts.push({ key, template: "fleet.held_diagnostic", params: { ...held } });
  // One Alert per key: the first rule that raises it wins.
  const keys = new Set<string>();
  return { alerts: alerts.filter((alert) => !keys.has(alert.key) && keys.add(alert.key)), hold };
}
