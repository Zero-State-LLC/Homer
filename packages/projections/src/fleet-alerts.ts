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
/**
 * A held diagnostic occurrence is raised only within a day of the report that carried it,
 * as the intake offers them, so a Collector silent for a week cannot repeat an old one.
 */
export const HELD_OCCURRENCE_WINDOW_MS = 24 * 60 * 60_000;
/** `events_backlog` is raised only once it has lasted this long. */
export const EVENTS_BACKLOG_ALERT_MS = 10 * 60_000;
/**
 * sparkDash's model-concurrency notice is not an Alert, and `stale` is the machine's own
 * freshness Alert Key, which the Collector refuses as a sparkDash rule id.
 */
const NOT_SENT = new Set(["concurrency", "stale"]);
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
 * What the fleet raises now, and the Alert Key prefixes to hold: while the Collector does not
 * read sparkDash's alerts, a sparkDash machine keeps its rule Alerts as they were, since an
 * empty firing list then says nothing. Its stale Alert is excepted: freshness may still be read.
 */
export interface FleetAlertPlan {
  alerts: FleetAlertRequest[];
  hold: string[];
  holdExcept: string[];
}

/** sparkDash states in which the Collector reads no alerts (its `alertsRead` is false). */
const ALERTS_UNSEEN = new Set(["unreachable", "alerts_off", "shape_changed"]);

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
  if (!snapshot) return { alerts: [], hold: [], holdExcept: [] };
  const alerts: FleetAlertRequest[] = [];
  const hold: string[] = [];
  const holdExcept: string[] = [];
  const unseen = ALERTS_UNSEEN.has(snapshot.sparkdash.state);
  const collected = Date.parse(snapshot.collectedAt);
  // Each machine as the report itself saw it, so a stale fleet holds its machine Alerts.
  const asReported = projectFleetStatus(snapshot, configured, { now: collected });
  for (const machine of asReported.machines) {
    if (machine.reported === null) continue;
    const name = displayName(machine.name, machine.machineId);
    if (unseen && machine.source === "sparkdash") {
      hold.push(`fleet:${machine.machineId}:`);
      holdExcept.push(`fleet:${machine.machineId}:stale`);
    }
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
  const recent = options.now - Date.parse(snapshot.receivedAt) < HELD_OCCURRENCE_WINDOW_MS;
  const diagnostics = [
    ...snapshot.diagnostics.filter(
      (d) => recent || (d.code !== "collector_gap" && d.code !== "sparkdash_restarted"),
    ),
    ...(options.held ?? []),
  ];
  for (const diagnostic of diagnostics) {
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
  return {
    alerts: alerts.filter((alert) => !keys.has(alert.key) && keys.add(alert.key)),
    hold,
    holdExcept,
  };
}
