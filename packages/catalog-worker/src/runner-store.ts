import { DurableObject } from "cloudflare:workers";
export const MAX_RUNNER_BYTES = 64 * 1024;
export interface RunnerMachine {
  id: string;
  alias: string;
  kind: "pc" | "mac";
  os: "windows" | "linux" | "macos";
  architecture: "x64" | "arm64";
  runnerId: number | null;
  repository: string;
  labels: string[];
  desiredState: "enabled" | "maintenance";
}
export interface RunnerConfig {
  version: 1;
  revision: number;
  machines: RunnerMachine[];
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_config");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((k) => !Object.hasOwn(record, k)))
    throw new Error("invalid_config");
  return record;
}
export function parseRunnerConfig(value: unknown): RunnerConfig {
  const v = object(value, ["version", "revision", "machines"]);
  if (
    v.version !== 1 ||
    !Number.isSafeInteger(v.revision) ||
    (v.revision as number) < 0 ||
    !Array.isArray(v.machines) ||
    v.machines.length > 50
  )
    throw new Error("invalid_config");
  const ids = new Set<string>();
  const runnerIds = new Set<number>();
  const machines = v.machines.map((value) => {
    const m = object(value, [
      "id",
      "alias",
      "kind",
      "os",
      "architecture",
      "runnerId",
      "repository",
      "labels",
      "desiredState",
    ]);
    if (
      typeof m.id !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(m.id) ||
      ids.has(m.id) ||
      typeof m.alias !== "string" ||
      m.alias.length < 1 ||
      m.alias.length > 80 ||
      m.alias.trim() !== m.alias ||
      [...m.alias].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      !(
        (m.kind === "pc" && (m.os === "windows" || m.os === "linux")) ||
        (m.kind === "mac" && m.os === "macos")
      ) ||
      !["x64", "arm64"].includes(m.architecture as string) ||
      !(m.runnerId === null || (Number.isSafeInteger(m.runnerId) && (m.runnerId as number) > 0)) ||
      typeof m.repository !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(m.repository) ||
      !Array.isArray(m.labels) ||
      m.labels.length > 20 ||
      m.labels.some((l) => typeof l !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(l)) ||
      new Set(m.labels.map((l) => (l as string).toLowerCase())).size !== m.labels.length ||
      !["enabled", "maintenance"].includes(m.desiredState as string)
    )
      throw new Error("invalid_config");
    ids.add(m.id);
    if (m.runnerId !== null) {
      if (runnerIds.has(m.runnerId as number)) throw new Error("invalid_config");
      runnerIds.add(m.runnerId as number);
    }
    return m as unknown as RunnerMachine;
  });
  return { version: 1, revision: v.revision as number, machines };
}
export interface ControllerBinding {
  revision: number;
  principalDigest: string;
  evidenceRef: string;
  enabled: boolean;
}
export function parseControllerBinding(value: unknown): ControllerBinding {
  const v = object(value, ["revision", "principalDigest", "evidenceRef", "enabled"]);
  if (
    !Number.isSafeInteger(v.revision) ||
    (v.revision as number) < 1 ||
    typeof v.principalDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(v.principalDigest) ||
    typeof v.evidenceRef !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9:/.#_-]{0,255}$/.test(v.evidenceRef) ||
    typeof v.enabled !== "boolean"
  )
    throw new Error("invalid_config");
  return v as unknown as ControllerBinding;
}
/**
 * Which Machines the Fleet Collector's principal may report on (fleet
 * monitoring spec, "Intake"). One binding for the fleet, revisioned and
 * audited like a controller's enrollment.
 */
export interface FleetCollectorBinding {
  revision: number;
  principalDigest: string;
  machineIds: string[];
  evidenceRef: string;
  enabled: boolean;
}
const FLEET_MACHINE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export function parseFleetCollectorBinding(value: unknown): FleetCollectorBinding {
  const v = object(value, ["revision", "principalDigest", "machineIds", "evidenceRef", "enabled"]);
  const ids: unknown[] = Array.isArray(v.machineIds) ? (v.machineIds as unknown[]) : [];
  if (
    !Number.isSafeInteger(v.revision) ||
    (v.revision as number) < 1 ||
    typeof v.principalDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(v.principalDigest) ||
    !Array.isArray(v.machineIds) ||
    ids.length > 64 ||
    ids.some((id) => typeof id !== "string" || !FLEET_MACHINE_ID.test(id)) ||
    new Set(ids).size !== ids.length ||
    typeof v.evidenceRef !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9:/.#_-]{0,255}$/.test(v.evidenceRef) ||
    typeof v.enabled !== "boolean"
  )
    throw new Error("invalid_config");
  return v as unknown as FleetCollectorBinding;
}
/** What the intake keeps of an accepted Fleet Report: its receipt, never its body. */
export interface FleetReceipt {
  reportId: string;
  receivedAt: string;
  digest: string;
  events: number;
}
/** The latest Fleet Report's snapshot, for the status view. */
export interface FleetSnapshot {
  reportId: string;
  collectedAt: string;
  receivedAt: string;
  sparkdash: unknown;
  machines: unknown[];
  diagnostics: unknown[];
}
export type FleetAdmission =
  | "admitted"
  | "forbidden"
  | "machine_not_bound"
  | "report_conflict"
  | "rate_limited"
  | { receipt: FleetReceipt };
/** At most this many new Fleet Reports a minute. */
export const FLEET_REPORTS_PER_MINUTE = 6;
/** A reservation that never committed lapses after this long. */
const FLEET_RESERVATION_MS = 60 * 60 * 1000;
/** A principal's reports received, or reserved and not yet committed, since a time. */
const RECENT_FLEET_REPORTS =
  "SELECT (SELECT count(*) FROM fleet_reports WHERE principal_digest=? AND received_ms>?) + (SELECT count(*) FROM fleet_reservations WHERE principal_digest=? AND reserved_ms>?) AS n";
export interface ControllerReport {
  reportId: string;
  operationId: string;
  revision: number;
  observedAt: string;
  listener: "running" | "stopped" | "unknown";
  job: "busy" | "idle" | "unknown";
  acceptingJobs: boolean | null;
}
function parseControllerReport(value: unknown): ControllerReport {
  const v = object(value, [
    "reportId",
    "operationId",
    "revision",
    "observedAt",
    "listener",
    "job",
    "acceptingJobs",
  ]);
  if (
    typeof v.reportId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v.reportId) ||
    typeof v.operationId !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,63}:[1-9][0-9]*$/.test(v.operationId) ||
    !Number.isSafeInteger(v.revision) ||
    (v.revision as number) < 1 ||
    typeof v.observedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.observedAt) ||
    !Number.isFinite(Date.parse(v.observedAt)) ||
    new Date(v.observedAt).toISOString() !== v.observedAt ||
    !["running", "stopped", "unknown"].includes(v.listener as string) ||
    !["busy", "idle", "unknown"].includes(v.job as string) ||
    !(v.acceptingJobs === null || typeof v.acceptingJobs === "boolean")
  )
    throw new Error("invalid_config");
  // Fixed field order is the wire receipt digest contract.
  return {
    reportId: v.reportId,
    operationId: v.operationId,
    revision: v.revision,
    observedAt: v.observedAt,
    listener: v.listener,
    job: v.job,
    acceptingJobs: v.acceptingJobs,
  } as ControllerReport;
}
interface ControllerReceipt {
  reportId: string;
  operationId: string;
  receivedAt: string;
  digest: string;
}
type ReportRow = {
  report: string;
  receipt: string;
  principal_digest: string;
  binding_revision: number;
};
export interface LifecycleRequest {
  action: "resume" | "drain" | "disconnect" | "revoke";
  configRevision: number;
  bindingRevision: number;
  operationRevision: number;
}
export function parseLifecycleRequest(value: unknown): LifecycleRequest {
  const v = object(value, ["action", "configRevision", "bindingRevision", "operationRevision"]);
  if (
    !["resume", "drain", "disconnect", "revoke"].includes(v.action as string) ||
    [v.configRevision, v.bindingRevision, v.operationRevision].some(
      (n) => !Number.isSafeInteger(n) || (n as number) < 0,
    )
  )
    throw new Error("invalid_config");
  return v as unknown as LifecycleRequest;
}
interface LifecycleOperation {
  operationRevision: number;
  action: LifecycleRequest["action"];
  operatorDigest: string;
  requestedAt: string;
  outcome: "requested" | "pending" | "revoked";
  configRevision: number;
  bindingRevision: number;
}
export class RunnerFleetObject extends DurableObject<unknown> {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    ctx.storage.sql
      .exec(`CREATE TABLE IF NOT EXISTS runner_operations (machine_id TEXT NOT NULL, revision INTEGER NOT NULL, operation TEXT NOT NULL, PRIMARY KEY(machine_id,revision)) STRICT;
 CREATE TRIGGER IF NOT EXISTS operation_no_update BEFORE UPDATE ON runner_operations BEGIN SELECT RAISE(ABORT,'Operation history is immutable'); END;
 CREATE TRIGGER IF NOT EXISTS operation_no_delete BEFORE DELETE ON runner_operations BEGIN SELECT RAISE(ABORT,'Operation history is immutable'); END;
 CREATE TABLE IF NOT EXISTS runner_history (revision INTEGER PRIMARY KEY, previous_revision INTEGER NOT NULL, config TEXT NOT NULL, operator_digest TEXT NOT NULL, requested_at TEXT NOT NULL) STRICT;
 CREATE TABLE IF NOT EXISTS controller_reports (sequence INTEGER PRIMARY KEY, machine_id TEXT NOT NULL, report_id TEXT NOT NULL UNIQUE, report TEXT NOT NULL, receipt TEXT NOT NULL, principal_digest TEXT NOT NULL, binding_revision INTEGER NOT NULL) STRICT;
 CREATE INDEX IF NOT EXISTS controller_reports_machine_sequence ON controller_reports(machine_id, sequence);
 CREATE TRIGGER IF NOT EXISTS report_no_update BEFORE UPDATE ON controller_reports BEGIN SELECT RAISE(ABORT,'Report history is immutable'); END;
 CREATE TRIGGER IF NOT EXISTS report_no_delete BEFORE DELETE ON controller_reports BEGIN SELECT RAISE(ABORT,'Report history is immutable'); END;
 CREATE TABLE IF NOT EXISTS controller_bindings (machine_id TEXT NOT NULL, revision INTEGER NOT NULL, binding TEXT NOT NULL, operator_digest TEXT NOT NULL, requested_at TEXT NOT NULL, PRIMARY KEY(machine_id,revision)) STRICT;
 CREATE TRIGGER IF NOT EXISTS binding_no_update BEFORE UPDATE ON controller_bindings BEGIN SELECT RAISE(ABORT,'Binding history is immutable'); END;
 CREATE TRIGGER IF NOT EXISTS binding_no_delete BEFORE DELETE ON controller_bindings BEGIN SELECT RAISE(ABORT,'Binding history is immutable'); END;
 CREATE TRIGGER IF NOT EXISTS runner_no_update BEFORE UPDATE ON runner_history BEGIN SELECT RAISE(ABORT,'Runner history is immutable'); END;
 CREATE TRIGGER IF NOT EXISTS runner_no_delete BEFORE DELETE ON runner_history BEGIN SELECT RAISE(ABORT,'Runner history is immutable'); END;
 CREATE TABLE IF NOT EXISTS fleet_collector_bindings (revision INTEGER PRIMARY KEY, binding TEXT NOT NULL, operator_digest TEXT NOT NULL, requested_at TEXT NOT NULL) STRICT;
 CREATE TRIGGER IF NOT EXISTS fleet_binding_no_update BEFORE UPDATE ON fleet_collector_bindings BEGIN SELECT RAISE(ABORT,'Fleet binding history is immutable'); END;
 CREATE TRIGGER IF NOT EXISTS fleet_binding_no_delete BEFORE DELETE ON fleet_collector_bindings BEGIN SELECT RAISE(ABORT,'Fleet binding history is immutable'); END;
 CREATE TABLE IF NOT EXISTS fleet_reports (sequence INTEGER PRIMARY KEY, report_id TEXT NOT NULL UNIQUE, digest TEXT NOT NULL, receipt TEXT NOT NULL, principal_digest TEXT NOT NULL, binding_revision INTEGER NOT NULL, received_ms INTEGER NOT NULL) STRICT;
 CREATE INDEX IF NOT EXISTS fleet_reports_principal_received ON fleet_reports(principal_digest, received_ms);
 CREATE TRIGGER IF NOT EXISTS fleet_report_no_update BEFORE UPDATE ON fleet_reports BEGIN SELECT RAISE(ABORT,'Fleet report receipts are immutable'); END;
 CREATE TRIGGER IF NOT EXISTS fleet_report_no_delete BEFORE DELETE ON fleet_reports BEGIN SELECT RAISE(ABORT,'Fleet report receipts are immutable'); END;
 CREATE TABLE IF NOT EXISTS fleet_snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), snapshot TEXT NOT NULL, collected_ms INTEGER NOT NULL) STRICT;
 CREATE TABLE IF NOT EXISTS fleet_reservations (report_id TEXT PRIMARY KEY, digest TEXT NOT NULL, principal_digest TEXT NOT NULL, reserved_ms INTEGER NOT NULL) STRICT;
 CREATE INDEX IF NOT EXISTS fleet_reservations_principal_reserved ON fleet_reservations(principal_digest, reserved_ms);`);
  }
  lifecycle(machineId: string, budgetMs: number | null) {
    const config = this.read().config;
    const machine = config.machines.find((m) => m.id === machineId);
    if (!machine) return null;
    const binding = this.controllerBinding(machineId).binding;
    const rows = this.ctx.storage.sql
      .exec<{ operation: string }>(
        "SELECT operation FROM runner_operations WHERE machine_id=? ORDER BY revision DESC LIMIT 21",
        machineId,
      )
      .toArray();
    const history = rows
      .slice(0, 20)
      .reverse()
      .map((row) => JSON.parse(row.operation) as LifecycleOperation);
    const latest = history.at(-1);
    const observation = this.controllerObservation(machineId, budgetMs);
    const current =
      observation.latest?.bindingRevision === binding?.revision &&
      observation.latest?.principalDigest === binding?.principalDigest;
    const connectionState = !binding
      ? "unenrolled"
      : !binding.enabled
        ? "revoked"
        : !current
          ? "unknown"
          : observation.freshness === "fresh"
            ? "connected"
            : observation.freshness === "stale"
              ? "stale"
              : "unknown";
    return {
      machineId,
      configRevision: config.revision,
      bindingRevision: binding?.revision ?? 0,
      operationRevision: latest?.operationRevision ?? 0,
      connectionState,
      desiredState: machine.desiredState,
      disconnectPending: latest?.action === "disconnect" && latest.outcome === "pending",
      observation,
      binding,
      history,
      historyTruncated: rows.length > 20,
    };
  }
  transitionLifecycle(
    machineId: string,
    input: unknown,
    operatorDigest: string,
    budgetMs: number | null,
  ) {
    const request = parseLifecycleRequest(input);
    if (!/^[a-f0-9]{64}$/.test(operatorDigest)) throw new Error("invalid_config");
    return this.ctx.storage.transactionSync(() => {
      const state = this.lifecycle(machineId, budgetMs);
      if (!state) return "unknown_machine";
      if (
        request.configRevision !== state.configRevision ||
        request.bindingRevision !== state.bindingRevision ||
        request.operationRevision !== state.operationRevision
      )
        return "revision_conflict";
      if (!state.binding?.enabled) return "missing_enrollment";
      if (state.operationRevision === Number.MAX_SAFE_INTEGER) return "revision_exhausted";
      const finalize =
        request.action === "revoke" ||
        (request.action === "disconnect" &&
          state.disconnectPending &&
          state.desiredState === "maintenance" &&
          state.observation.operationState === "complete");
      if (finalize && state.bindingRevision === Number.MAX_SAFE_INTEGER)
        return "revision_exhausted";
      const config = this.read().config;
      const desiredState = request.action === "resume" ? "enabled" : "maintenance";
      const requestedAt = new Date().toISOString();
      if (state.desiredState !== desiredState) {
        if (config.revision === Number.MAX_SAFE_INTEGER) return "revision_exhausted";
        config.revision += 1;
        config.machines = config.machines.map((m) =>
          m.id === machineId ? { ...m, desiredState } : m,
        );
        this.ctx.storage.sql.exec(
          "INSERT INTO runner_history VALUES (?,?,?,?,?)",
          config.revision,
          state.configRevision,
          JSON.stringify(config),
          operatorDigest,
          requestedAt,
        );
      }
      const operation: LifecycleOperation = {
        operationRevision: state.operationRevision + 1,
        action: request.action,
        operatorDigest,
        requestedAt,
        outcome: "requested",
        configRevision: config.revision,
        bindingRevision: state.bindingRevision,
      };
      if (request.action === "disconnect") operation.outcome = "pending";
      if (finalize) {
        const binding = parseControllerBinding({
          principalDigest: state.binding.principalDigest,
          evidenceRef: state.binding.evidenceRef,
          revision: state.bindingRevision + 1,
          enabled: false,
        });
        this.ctx.storage.sql.exec(
          "INSERT INTO controller_bindings VALUES (?,?,?,?,?)",
          machineId,
          binding.revision,
          JSON.stringify(binding),
          operatorDigest,
          requestedAt,
        );
        operation.bindingRevision = binding.revision;
        operation.outcome = "revoked";
      }
      this.ctx.storage.sql.exec(
        "INSERT INTO runner_operations VALUES (?,?,?)",
        machineId,
        operation.operationRevision,
        JSON.stringify(operation),
      );
      return this.lifecycle(machineId, budgetMs);
    });
  }
  controllerBinding(machineId: string) {
    const rows = this.ctx.storage.sql
      .exec<{ binding: string; operator_digest: string; requested_at: string }>(
        "SELECT binding,operator_digest,requested_at FROM controller_bindings WHERE machine_id=? ORDER BY revision DESC LIMIT 21",
        machineId,
      )
      .toArray();
    const historyTruncated = rows.length > 20;
    const history = rows
      .slice(0, 20)
      .reverse()
      .map((r) => ({
        ...parseControllerBinding(JSON.parse(r.binding)),
        operatorDigest: r.operator_digest,
        requestedAt: r.requested_at,
      }));
    return {
      machineId,
      revision: history.at(-1)?.revision ?? 0,
      binding: history.at(-1) ?? null,
      history,
      historyTruncated,
    };
  }
  enrollController(machineId: string, expected: number, input: unknown, operatorDigest: string) {
    const binding = parseControllerBinding(input);
    if (
      !Number.isSafeInteger(expected) ||
      expected < 0 ||
      binding.revision !== expected + 1 ||
      !/^[a-f0-9]{64}$/.test(operatorDigest)
    )
      throw new Error("invalid_config");
    return this.ctx.storage.transactionSync(() => {
      if (!this.read().config.machines.some((m) => m.id === machineId)) return "unknown_machine";
      if (this.controllerBinding(machineId).revision !== expected) return "revision_conflict";
      this.ctx.storage.sql.exec(
        "INSERT INTO controller_bindings VALUES (?,?,?,?,?)",
        machineId,
        binding.revision,
        JSON.stringify(binding),
        operatorDigest,
        new Date().toISOString(),
      );
      return "saved";
    });
  }
  controllerPoll(machineId: string, principal: string) {
    const binding = this.controllerBinding(machineId).binding;
    if (!binding?.enabled || binding.principalDigest !== principal) return null;
    const config = this.read().config;
    const machine = config.machines.find((m) => m.id === machineId);
    return machine
      ? {
          machineId,
          revision: config.revision,
          operationId: `${machineId}:${config.revision}`,
          desiredState: machine.desiredState,
        }
      : null;
  }
  async controllerReport(machineId: string, principal: string, input: unknown) {
    const report = parseControllerReport(input);
    const encoded = JSON.stringify(report);
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encoded))),
      (n) => n.toString(16).padStart(2, "0"),
    ).join("");
    return this.ctx.storage.transactionSync(() => {
      const command = this.controllerPoll(machineId, principal);
      if (!command) return "forbidden";
      const duplicate = this.ctx.storage.sql
        .exec<ReportRow & { machine_id: string }>(
          "SELECT * FROM controller_reports WHERE report_id=?",
          report.reportId,
        )
        .toArray()[0];
      if (duplicate)
        return duplicate.machine_id === machineId &&
          duplicate.principal_digest === principal &&
          duplicate.binding_revision === this.controllerBinding(machineId).revision &&
          duplicate.report === encoded
          ? (JSON.parse(duplicate.receipt) as ControllerReceipt)
          : "report_conflict";
      if (report.operationId !== command.operationId || report.revision !== command.revision)
        return "superseded_intent";
      const receipt = {
        reportId: report.reportId,
        operationId: report.operationId,
        receivedAt: new Date().toISOString(),
        digest,
      };
      this.ctx.storage.sql.exec(
        "INSERT INTO controller_reports(machine_id,report_id,report,receipt,principal_digest,binding_revision) VALUES (?,?,?,?,?,?)",
        machineId,
        report.reportId,
        encoded,
        JSON.stringify(receipt),
        principal,
        this.controllerBinding(machineId).revision,
      );
      return receipt;
    });
  }
  controllerObservation(machineId: string, budgetMs: number | null) {
    const history = this.ctx.storage.sql
      .exec<ReportRow>(
        "SELECT report,receipt,principal_digest,binding_revision FROM controller_reports WHERE machine_id=? ORDER BY sequence DESC LIMIT 21",
        machineId,
      )
      .toArray()
      .reverse()
      .map((row) => ({
        report: parseControllerReport(JSON.parse(row.report)),
        receipt: JSON.parse(row.receipt) as {
          reportId: string;
          operationId: string;
          receivedAt: string;
          digest: string;
        },
        principalDigest: row.principal_digest,
        bindingRevision: row.binding_revision,
      }));
    const historyTruncated = history.length > 20;
    if (historyTruncated) history.shift();
    const latest = history.at(-1) ?? null;
    const now = Date.now();
    const age = latest ? now - Date.parse(latest.report.observedAt) : null;
    const receiptAge = latest ? now - Date.parse(latest.receipt.receivedAt) : null;
    const freshness =
      budgetMs === null || !latest
        ? "unknown"
        : age === null ||
            receiptAge === null ||
            age < 0 ||
            receiptAge < 0 ||
            age > budgetMs ||
            receiptAge > budgetMs
          ? "stale"
          : "fresh";
    const config = this.read().config;
    const machine = config.machines.find((m) => m.id === machineId);
    const binding = this.controllerBinding(machineId).binding;
    let operationState = "unknown";
    if (latest && freshness === "fresh") {
      const r = latest.report;
      if (
        !binding?.enabled ||
        binding.revision !== latest.bindingRevision ||
        binding.principalDigest !== latest.principalDigest ||
        r.revision !== config.revision
      )
        operationState = "pending";
      else if (
        (machine?.desiredState === "enabled" &&
          r.listener === "running" &&
          r.acceptingJobs === true) ||
        (machine?.desiredState === "maintenance" &&
          r.listener === "stopped" &&
          r.job === "idle" &&
          r.acceptingJobs === false)
      )
        operationState = "complete";
      else operationState = r.job === "busy" || r.job === "unknown" ? "blocked" : "pending";
    }
    return {
      machineId,
      source: "host-reported",
      freshness,
      validForMs: freshness === "fresh" ? Math.max(0, budgetMs! - Math.max(age!, receiptAge!)) : 0,
      operationState,
      latest,
      history,
      historyTruncated,
    };
  }
  fleetCollectorBinding() {
    const rows = this.ctx.storage.sql
      .exec<{ binding: string; operator_digest: string; requested_at: string }>(
        "SELECT binding,operator_digest,requested_at FROM fleet_collector_bindings ORDER BY revision DESC LIMIT 21",
      )
      .toArray();
    const history = rows
      .slice(0, 20)
      .reverse()
      .map((r) => ({
        ...parseFleetCollectorBinding(JSON.parse(r.binding)),
        operatorDigest: r.operator_digest,
        requestedAt: r.requested_at,
      }));
    return {
      revision: history.at(-1)?.revision ?? 0,
      binding: history.at(-1) ?? null,
      history,
      historyTruncated: rows.length > 20,
    };
  }
  bindFleetCollector(expected: number, input: unknown, operatorDigest: string) {
    const binding = parseFleetCollectorBinding(input);
    if (
      !Number.isSafeInteger(expected) ||
      expected < 0 ||
      binding.revision !== expected + 1 ||
      !/^[a-f0-9]{64}$/.test(operatorDigest)
    )
      throw new Error("invalid_config");
    return this.ctx.storage.transactionSync(() => {
      if (this.fleetCollectorBinding().revision !== expected) return "revision_conflict";
      this.ctx.storage.sql.exec(
        "INSERT INTO fleet_collector_bindings VALUES (?,?,?,?)",
        binding.revision,
        JSON.stringify(binding),
        operatorDigest,
        new Date().toISOString(),
      );
      return "saved";
    });
  }
  private fleetReceipt(reportId: string, digest: string): FleetReceipt | "report_conflict" | null {
    const row = this.ctx.storage.sql
      .exec<{ digest: string; receipt: string }>(
        "SELECT digest,receipt FROM fleet_reports WHERE report_id=?",
        reportId,
      )
      .toArray()[0];
    if (!row) return null;
    return row.digest === digest ? (JSON.parse(row.receipt) as FleetReceipt) : "report_conflict";
  }
  private fleetRefusal(principal: string, machineIds: readonly string[]) {
    const binding = this.fleetCollectorBinding().binding;
    if (!binding?.enabled || binding.principalDigest !== principal) return "forbidden";
    if (machineIds.some((id) => !binding.machineIds.includes(id))) return "machine_not_bound";
    return null;
  }
  /**
   * Before the intake appends a report's events, in one transaction: the
   * principal's binding, the Machines it may report on, a seen `reportId`, and
   * the rate limit. An admitted report is reserved, so changed content under
   * its id is refused before any of its events are appended, and a reserved
   * report counts toward the limit until it commits. An identical retry is
   * answered with its original receipt, or resumes its reservation.
   */
  fleetReportAdmission(
    principal: string,
    reportId: string,
    digest: string,
    machineIds: string[],
  ): FleetAdmission {
    return this.ctx.storage.transactionSync((): FleetAdmission => {
      const refused = this.fleetRefusal(principal, machineIds);
      if (refused) return refused;
      const seen = this.fleetReceipt(reportId, digest);
      if (seen === "report_conflict") return seen;
      if (seen) return { receipt: seen };
      const now = Date.now();
      // A reservation left by a request that never committed lapses after an hour.
      this.ctx.storage.sql.exec(
        "DELETE FROM fleet_reservations WHERE reserved_ms<?",
        now - FLEET_RESERVATION_MS,
      );
      const reserved = this.ctx.storage.sql
        .exec<{ digest: string }>(
          "SELECT digest FROM fleet_reservations WHERE report_id=?",
          reportId,
        )
        .toArray()[0];
      if (reserved) return reserved.digest === digest ? "admitted" : "report_conflict";
      const since = now - 60_000;
      const recent = this.ctx.storage.sql
        .exec<{ n: number }>(RECENT_FLEET_REPORTS, principal, since, principal, since)
        .toArray()[0];
      if ((recent?.n ?? 0) >= FLEET_REPORTS_PER_MINUTE) return "rate_limited";
      this.ctx.storage.sql.exec(
        "INSERT INTO fleet_reservations VALUES (?,?,?,?)",
        reportId,
        digest,
        principal,
        now,
      );
      return "admitted";
    });
  }
  /**
   * After the events are in the Event Ledger: the receipt, and the snapshot
   * unless a later one is already stored. One transaction; an identical report
   * that got here first wins and is answered.
   */
  fleetReportCommit(
    principal: string,
    reportId: string,
    digest: string,
    machineIds: string[],
    events: number,
    snapshot: Omit<FleetSnapshot, "receivedAt">,
  ): FleetReceipt | "forbidden" | "machine_not_bound" | "report_conflict" {
    return this.ctx.storage.transactionSync(() => {
      const refused = this.fleetRefusal(principal, machineIds);
      if (refused) return refused;
      const seen = this.fleetReceipt(reportId, digest);
      if (seen) return seen;
      const reserved = this.ctx.storage.sql
        .exec<{ digest: string }>(
          "SELECT digest FROM fleet_reservations WHERE report_id=?",
          reportId,
        )
        .toArray()[0];
      if (reserved && reserved.digest !== digest) return "report_conflict";
      this.ctx.storage.sql.exec("DELETE FROM fleet_reservations WHERE report_id=?", reportId);
      const now = Date.now();
      const receipt: FleetReceipt = {
        reportId,
        receivedAt: new Date(now).toISOString(),
        digest,
        events,
      };
      this.ctx.storage.sql.exec(
        "INSERT INTO fleet_reports(report_id,digest,receipt,principal_digest,binding_revision,received_ms) VALUES (?,?,?,?,?,?)",
        reportId,
        digest,
        JSON.stringify(receipt),
        principal,
        this.fleetCollectorBinding().revision,
        now,
      );
      const collected = Date.parse(snapshot.collectedAt);
      const stored = this.ctx.storage.sql
        .exec<{ collected_ms: number }>("SELECT collected_ms FROM fleet_snapshot WHERE id=1")
        .toArray()[0];
      // An older report after a newer one leaves the newer snapshot.
      if (!stored || collected > stored.collected_ms) {
        this.ctx.storage.sql.exec(
          "INSERT OR REPLACE INTO fleet_snapshot VALUES (1,?,?)",
          JSON.stringify({ ...snapshot, receivedAt: receipt.receivedAt }),
          collected,
        );
      }
      return receipt;
    });
  }
  /** The latest snapshot, or null before the first report. */
  fleetSnapshot(): FleetSnapshot | null {
    const row = this.ctx.storage.sql
      .exec<{ snapshot: string }>("SELECT snapshot FROM fleet_snapshot WHERE id=1")
      .toArray()[0];
    return row ? (JSON.parse(row.snapshot) as FleetSnapshot) : null;
  }
  read() {
    const row = this.ctx.storage.sql
      .exec<{
        revision: number;
        previous_revision: number;
        config: string;
        operator_digest: string;
        requested_at: string;
      }>("SELECT * FROM runner_history ORDER BY revision DESC LIMIT 1")
      .toArray()[0];
    return {
      config: row
        ? parseRunnerConfig(JSON.parse(row.config))
        : { version: 1 as const, revision: 0, machines: [] },
      observedState: "unknown",
      requestStatus: row ? "pending" : "none",
      audit: row
        ? {
            previousRevision: row.previous_revision,
            operatorDigest: row.operator_digest,
            requestedAt: row.requested_at,
          }
        : null,
    };
  }
  replace(expected: number, input: unknown, operatorDigest: string) {
    const config = parseRunnerConfig(input);
    const encoded = JSON.stringify(config);
    if (
      !Number.isSafeInteger(expected) ||
      expected < 0 ||
      config.revision !== expected + 1 ||
      !/^[a-f0-9]{64}$/.test(operatorDigest) ||
      new TextEncoder().encode(encoded).length > MAX_RUNNER_BYTES
    )
      throw new Error("invalid_config");
    return this.ctx.storage.transactionSync(() => {
      const previous = this.read().config;
      if (previous.revision !== expected) return "conflict";
      if (previous.machines.some((m) => !config.machines.some((n) => n.id === m.id)))
        return "deletion_forbidden";
      this.ctx.storage.sql.exec(
        "INSERT INTO runner_history VALUES (?,?,?,?,?)",
        config.revision,
        expected,
        encoded,
        operatorDigest,
        new Date().toISOString(),
      );
      return "saved";
    });
  }
}
