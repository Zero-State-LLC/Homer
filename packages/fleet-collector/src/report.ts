import {
  BUILD_VERSION,
  validateFleetReport,
  type ActivityEvent,
  type FleetReport,
} from "@zs-home/shared-contracts";
import { iso } from "./events.js";
import { setPresent, type CollectorState, type PresentCode, type Snapshot } from "./poll.js";

/** A Fleet Report carries at most this many events. */
export const MAX_REPORT_EVENTS = 100;

export interface ReportInput {
  /** Kept across identical retries of one report. */
  reportId: string;
  /** In ms. */
  collectedAt: number;
  snapshot: Snapshot;
  state: CollectorState;
  /** Events waiting for delivery, oldest first. */
  queue: readonly ActivityEvent[];
}

export interface ReportBuilt {
  ok: true;
  report: FleetReport;
  /** With `events_backlog` worked out for this report. */
  state: CollectorState;
}
export interface ReportRefused {
  ok: false;
  errors: string[];
}
export type ReportResult = ReportBuilt | ReportRefused;

const PRESENT_ORDER: PresentCode[] = ["version_changed", "events_backlog", "queue_full"];

/**
 * The Fleet Report to deliver (fleet monitoring spec, "Deliver a report"): the
 * latest snapshot, the oldest 100 waiting events, every held diagnostic, and
 * the present ones. Refused, not sent, when it does not validate as
 * `home.fleet-report/v1`, an IP address anywhere included.
 */
export function buildFleetReport(input: ReportInput): ReportResult {
  const events = input.queue.slice(0, MAX_REPORT_EVENTS);
  const present = setPresent(
    input.state.present,
    "events_backlog",
    input.queue.length > MAX_REPORT_EVENTS,
    iso(input.collectedAt),
  );
  const report: FleetReport = {
    contract: "home.fleet-report/v1",
    reportId: input.reportId,
    collector: { name: "fleet-collector", version: BUILD_VERSION },
    collectedAt: iso(input.collectedAt),
    sparkdash: input.snapshot.sparkdash,
    machines: input.snapshot.machines,
    diagnostics: [
      ...input.state.held,
      ...PRESENT_ORDER.flatMap((code) => {
        const since = present[code];
        return since === undefined ? [] : [{ code, since }];
      }),
    ],
    events,
  };
  const result = validateFleetReport(report);
  if (!result.ok) return { ok: false, errors: result.errors };
  return { ok: true, report, state: { ...input.state, present } };
}

/**
 * After a `2xx` for `report`: the held diagnostics it carried are delivered.
 * Removing the events it carried from the queue is the runtime's.
 */
export function acknowledgeReport(state: CollectorState, report: FleetReport): CollectorState {
  const carried = new Set(report.diagnostics.map((d) => `${d.code}@${d.since}`));
  return { ...state, held: state.held.filter((d) => !carried.has(`${d.code}@${d.since}`)) };
}
