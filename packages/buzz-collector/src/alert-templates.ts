import { fleetRuleName } from "@zs-home/shared-contracts/workers";
import type { AlertTemplate, AlertTemplates } from "./alerts.js";

/**
 * Homer's fixed Alert templates. Every sentence is Homer's own text around checked ids, times
 * and enumerated codes; none carries text from a source system.
 */
const FLEET_RUNBOOK =
  "https://github.com/Zero-State-LLC/Homer/blob/main/specs/fleet-monitoring/spec.md#alerts-to-buzz";
const ALERTS_RUNBOOK =
  "https://github.com/Zero-State-LLC/Homer/blob/main/specs/buzz/spec.md#alerts-to-buzz";

const rule = (id: string) => fleetRuleName(id) ?? `sparkDash rule ${id}`;

const SPARKDASH_STATES = ["unreachable", "metrics_off", "alerts_off", "shape_changed"] as const;
const SPARKDASH_RAISED: Record<string, string> = {
  unreachable: "The Fleet Collector cannot reach sparkDash, so sparkDash machines are unknown.",
  metrics_off: "sparkDash's Prometheus metrics are off, so sparkDash machines are unknown.",
  alerts_off: "sparkDash's alert notifications are off, so it evaluates no alerts.",
  shape_changed:
    "sparkDash's responses no longer match the pinned release, so the Fleet Collector stopped mapping them.",
};
const SPARKDASH_CLEARED: Record<string, string> = {
  unreachable: "The Fleet Collector reaches sparkDash again.",
  metrics_off: "sparkDash's Prometheus metrics are on again.",
  alerts_off: "sparkDash's alert notifications are on again.",
  shape_changed: "sparkDash's responses match the pinned release again.",
};
const DIAGNOSTICS = ["events_backlog", "queue_full"] as const;
const DIAGNOSTIC_RAISED: Record<string, string> = {
  events_backlog:
    "The Fleet Collector has had more events than one report carries for over 10 minutes.",
  queue_full:
    "The Fleet Collector's queue of undelivered events is full, so it stopped turning sparkDash's history into events.",
};
const DIAGNOSTIC_CLEARED: Record<string, string> = {
  events_backlog: "The Fleet Collector has caught up on its events.",
  queue_full: "The Fleet Collector's queue has room again.",
};
const HELD = ["collector_gap", "sparkdash_restarted"] as const;
const HELD_RAISED: Record<string, string> = {
  collector_gap: "The Fleet Collector missed part of sparkDash's alert history",
  sparkdash_restarted: "sparkDash restarted, and its alert history started again",
};

const machineAlert: AlertTemplate = {
  params: { machineId: "id", name: "name", rule: "rule" },
  raised: (p) => `${rule(p["rule"]!)} on ${p["name"]!}`,
  cleared: (p) => `${rule(p["rule"]!)} on ${p["name"]!} cleared`,
  runbook: FLEET_RUNBOOK,
};

export const HOMER_ALERT_TEMPLATES: AlertTemplates = Object.freeze({
  /** `fleet:<machineId>:<rule>` */
  "fleet.machine_alert": machineAlert,
  /** `fleet:collector:stale` */
  "fleet.collector_stale": {
    params: { since: "time" },
    raised: (p) => `Fleet monitoring has not reported since ${p["since"]!}`,
    cleared: () => "Fleet monitoring is reporting again",
    runbook: FLEET_RUNBOOK,
  },
  /** `fleet:<machineId>:stale` */
  "fleet.machine_stale": {
    params: { machineId: "id", name: "name", since: "time" },
    raised: (p) => `No fresh reading from ${p["name"]!} since ${p["since"]!}`,
    cleared: (p) => `${p["name"]!} is fresh again`,
    runbook: FLEET_RUNBOOK,
  },
  /** `fleet:collector:<state>` */
  "fleet.sparkdash_state": {
    params: { state: SPARKDASH_STATES },
    raised: (p) => SPARKDASH_RAISED[p["state"]!]!,
    cleared: (p) => SPARKDASH_CLEARED[p["state"]!]!,
    runbook: FLEET_RUNBOOK,
  },
  /** `fleet:collector:version_changed` */
  "fleet.version_changed": {
    params: { pinned: "version", seen: "version" },
    raised: (p) =>
      `sparkDash runs ${p["seen"]!}, not the pinned ${p["pinned"]!}. The Fleet Collector maps its responses only while they match the pinned shape.`,
    cleared: (p) => `sparkDash runs the pinned ${p["pinned"]!} again.`,
    runbook: FLEET_RUNBOOK,
  },
  /** `fleet:collector:<code>` */
  "fleet.collector_diagnostic": {
    params: { code: DIAGNOSTICS },
    raised: (p) => DIAGNOSTIC_RAISED[p["code"]!]!,
    cleared: (p) => DIAGNOSTIC_CLEARED[p["code"]!]!,
    runbook: FLEET_RUNBOOK,
  },
  /** `fleet:collector:<code>:<since>`: one-shot, one per occurrence. */
  "fleet.held_diagnostic": {
    params: { code: HELD, since: "time" },
    raised: (p) => `${HELD_RAISED[p["code"]!]!} at ${p["since"]!}.`,
    runbook: FLEET_RUNBOOK,
  },
  /** The summary the hourly cap posts. */
  "homer.alerts_held": {
    params: { count: "count" },
    raised: (p) =>
      `Homer is holding ${p["count"]!} alert changes under its cap of 30 an hour. It posts each one's state as the cap frees.`,
    runbook: ALERTS_RUNBOOK,
  },
});
