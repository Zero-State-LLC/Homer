import {
  BUILD_VERSION,
  MACHINE_NAME,
  hasIpAddress,
  machineAlertEventKey,
  machineAlertObjectId,
  machineAlertSubject,
  validateActivityEvent,
  type ActivityEvent,
  type MachineAlertKind,
} from "@zs-home/shared-contracts";

/**
 * A Machine's display name: letters, digits, space, `.`, `_` and `-`, at most
 * 40 characters, and no address. Anything else is replaced by the machineId.
 */
export function cleanName(raw: unknown, machineId: string): string {
  if (typeof raw === "string" && MACHINE_NAME.test(raw) && !hasIpAddress(raw)) return raw;
  return machineId.slice(0, 40);
}

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export interface MachineAlert {
  source: "sparkdash" | "homer";
  kind: MachineAlertKind;
  machineId: string;
  /** The cleaned display name. */
  name: string;
  rule: string;
  severity: "warning" | "critical";
  /** When the condition began, in ms: one occurrence, one pair of Event Keys. */
  startsAt: number;
  /** When the transition happened, in ms. */
  at: number;
  sparkdashVersion: string | null;
  frontDoorOrigin: string;
  /** When the Collector built the event, in ms. */
  collectedAt: number;
}

/**
 * One `machine.alert_fired` or `machine.alert_cleared` event under Activity
 * Event contract version 3, ids and fixed text only. Undefined when the event
 * would not validate, which the caller treats as `shape_changed`.
 */
export function machineAlertEvent(alert: MachineAlert): ActivityEvent | undefined {
  const startsAt = iso(alert.startsAt);
  const eventKey = machineAlertEventKey(
    alert.source,
    alert.kind,
    alert.machineId,
    alert.rule,
    startsAt,
  );
  const objectId = machineAlertObjectId(alert.machineId, alert.rule, startsAt);
  const subject = machineAlertSubject(alert.kind, alert.rule, alert.name);
  if (eventKey === undefined || objectId === undefined || subject === undefined) return undefined;
  const event: ActivityEvent = {
    contract: "home.activity-event/v3",
    eventKey,
    kind: alert.kind,
    occurredAt: iso(alert.at),
    actor: {
      sourceAccount: alert.source === "sparkdash" ? "sparkdash:alerts" : "homer:fleet-collector",
    },
    subject,
    provenance: {
      sourceSystem: alert.source,
      sourceObjectId: objectId,
      sourceUrl: `${alert.frontDoorOrigin}/`,
      collector: "fleet-collector",
      collectorVersion: BUILD_VERSION,
      collectedAt: iso(alert.collectedAt),
    },
    data: {
      machineId: alert.machineId,
      rule: alert.rule,
      severity: alert.severity,
      startsAt,
      sparkdashVersion: alert.sparkdashVersion,
    },
  };
  return validateActivityEvent(event).ok ? event : undefined;
}
