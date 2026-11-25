/** The Fleet Collector's runtime: everything that touches the network, the disk or the clock. */
export { FleetCollector, reportIdFor, type CollectorDeps, type LogLine } from "./collector.js";
export { intakeClient, type IntakeClient, type IntakeCredential } from "./intake-client.js";
export {
  applyCheck,
  checkSshBanner,
  initialReachability,
  type CheckResult,
  type ReachabilityState,
  type ReachabilityTransition,
  type SshCheck,
} from "./reachability.js";
export { SecretUnavailableError, readSecret, type OpRead } from "./secrets.js";
export {
  RefusedRequest,
  SPARKDASH_PATHS,
  checkRequest,
  sparkdashClient,
  type SparkdashClient,
  type SparkdashClientOptions,
  type SparkdashPath,
} from "./sparkdash-client.js";
export {
  MAX_QUEUE,
  StateUnreadable,
  fileStore,
  initialStored,
  memoryStore,
  type StateStore,
  type StoredState,
} from "./store.js";
