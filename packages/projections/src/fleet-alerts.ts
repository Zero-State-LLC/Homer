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

/** A configured alias when it fits the display-name rule, otherwise the id. */
function displayName(name: string, machineId: string): string {
  return DISPLAY_NAME.test(name) ? name : machineId;
}

export function projectFleetAlerts(
  snapshot: FleetStatusSnapshot | null,
  configured: readonly FleetStatusConfiguredMachine[],
  options: { now: number },
): FleetAlertRequest[] {
  // Before the first report there is nothing to be stale against.
  if (!snapshot) return [];
  const alerts: FleetAlertRequest[] = [];
  const collected = Date.parse(snapshot.collectedAt);
  // Each machine as the report itself saw it, so a stale fleet holds its machine Alerts.
  const asReported = projectFleetStatus(snapshot, configured, { now: collected });
  for (const machine of asReported.machines) {
    if (machine.reported === null) continue;
    const name = displayName(machine.name, machine.machineId);
    for (const alert of machine.firing) {
      if (NOT_SENT.has(alert.rule)) continue;
      alerts.push({
        key: `fleet:${machine.machineId}:${alert.rule}`,
        template: "fleet.machine_alert",
        params: { machineId: machine.machineId, name, rule: alert.rule },
      });
    }
    if (machine.status === "stale" && machine.lastSeenAt)
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
  for (const diagnostic of snapshot.diagnostics) {
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
      alerts.push({
        key: `fleet:collector:${code}:${diagnostic.since}`,
        template: "fleet.held_diagnostic",
        params: { code, since: diagnostic.since },
      });
  }
  return alerts;
}
