/**
 * The pure core of the Fleet Collector (fleet monitoring spec, packet 2): it
 * turns sparkDash's responses and the Reachability Checks into Machines, alert
 * events and a Fleet Report. No network, no files, no clock of its own; the
 * runtime (packet 3) supplies all three.
 */
export {
  parseCollectorConfig,
  type CollectorConfig,
  type ConfigResult,
  type ConfiguredMachine,
  type SparkdashMachine,
  type SshMachine,
} from "./config.js";
export {
  baselineBefore,
  continuity,
  cursorOf,
  type Continuity,
  type Cursor,
} from "./continuity.js";
export { cleanName, iso, machineAlertEvent, type MachineAlert } from "./events.js";
export {
  addHeld,
  initialState,
  poll,
  setPresent,
  type CollectorState,
  type HeldCode,
  type HttpRead,
  type PollInput,
  type PollResult,
  type PresentCode,
  type ReachabilityReading,
  type Snapshot,
  type SparkdashRead,
} from "./poll.js";
export {
  MAX_REPORT_EVENTS,
  acknowledgeReport,
  buildFleetReport,
  type ReportBuilt,
  type ReportInput,
  type ReportRefused,
  type ReportResult,
} from "./report.js";
export {
  HISTORY_LIMIT,
  SHAPE_CHANGED,
  parseAlerts,
  parseHealth,
  parseMetrics,
  type ActiveAlert,
  type AlertsRead,
  type HistoryEntry,
  type MetricsUnit,
} from "./sparkdash.js";
