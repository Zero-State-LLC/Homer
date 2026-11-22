export interface Command {
  machineId: string;
  revision: number;
  operationId: string;
  desiredState: "enabled" | "maintenance";
}
export interface Observation {
  listener: "running" | "stopped" | "unknown";
  job: "busy" | "idle" | "unknown";
  acceptingJobs: boolean | null;
}
export interface Report extends Observation {
  reportId: string;
  operationId: string;
  revision: number;
  observedAt: string;
}
export interface Receipt {
  reportId: string;
  operationId: string;
  receivedAt: string;
  digest: string;
}
export interface Transport {
  poll(): Promise<unknown>;
  /** Idempotent POST: an identical report returns its original durable receipt. */
  report(report: Readonly<Report>): Promise<unknown>;
}
export interface LocalAdapter {
  /** Must read actual local state; unavailable evidence is unknown, never idle. */
  observe(): Promise<Observation>;
  /** Must prevent new jobs without interrupting active work. */
  closeAdmission(): Promise<void>;
  stop(): Promise<void>;
  start(): Promise<void>;
  openAdmission(): Promise<void>;
}
export interface JournalState {
  accepted: Command | null;
  outbox: Report | null;
}
export interface DurableJournal {
  /** Missing journal returns {accepted:null,outbox:null}. One controller owns a journal. */
  load(): Promise<JournalState>;
  /** Atomically replace and durably flush before resolving. Never acknowledge a buffered write. */
  save(state: JournalState): Promise<void>;
}
/** Transport uses this only for a definitive server refusal, never a timeout. */
export class ReportRejected extends Error {
  constructor() {
    super("Report rejected; operator reconciliation required");
    this.name = "ReportRejected";
  }
}
export type FailureCode =
  | "report_rejected"
  | "invalid_command"
  | "wrong_machine"
  | "stale_command"
  | "transport_failed"
  | "adapter_failed"
  | "journal_failed"
  | "receipt_mismatch";
export type Result = { ok: true; report: Report } | { ok: false; code: FailureCode };
export interface ControllerOptions {
  machineId: string;
  transport: Transport;
  adapter: LocalAdapter;
  journal: DurableJournal;
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function command(value: unknown): value is Command {
  return (
    object(value) &&
    Object.keys(value).sort().join() === "desiredState,machineId,operationId,revision" &&
    typeof value.machineId === "string" &&
    /^[a-z0-9][a-z0-9-]{0,63}$/.test(value.machineId) &&
    Number.isSafeInteger(value.revision) &&
    (value.revision as number) >= 1 &&
    value.operationId === `${value.machineId}:${value.revision as number}` &&
    (value.desiredState === "enabled" || value.desiredState === "maintenance")
  );
}
function utc(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === 24 &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function observation(value: unknown): value is Observation {
  return (
    object(value) &&
    ["running", "stopped", "unknown"].includes(value.listener as string) &&
    ["busy", "idle", "unknown"].includes(value.job as string) &&
    (typeof value.acceptingJobs === "boolean" || value.acceptingJobs === null)
  );
}
function journalState(value: unknown, machineId: string): value is JournalState {
  if (!object(value) || Object.keys(value).sort().join() !== "accepted,outbox") return false;
  const accepted = value.accepted;
  if (accepted !== null && (!command(accepted) || accepted.machineId !== machineId)) return false;
  const report = value.outbox;
  if (report === null) return true;
  return (
    accepted !== null &&
    object(report) &&
    observation(report) &&
    Object.keys(report).sort().join() ===
      "acceptingJobs,job,listener,observedAt,operationId,reportId,revision" &&
    typeof report.reportId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      report.reportId,
    ) &&
    utc(report.observedAt) &&
    report.operationId === accepted.operationId &&
    report.revision === accepted.revision
  );
}
/** Portable only: supply trusted, qualified host and durable storage adapters. */
export function createController(options: ControllerOptions) {
  const { machineId, transport, adapter, journal } = options;
  async function observe(): Promise<Observation> {
    const value = await adapter.observe();
    if (!observation(value) || Object.keys(value).sort().join() !== "acceptingJobs,job,listener")
      throw new Error("invalid observation");
    return { listener: value.listener, job: value.job, acceptingJobs: value.acceptingJobs };
  }
  async function deliver(state: JournalState): Promise<Result> {
    const report = state.outbox!;
    let receipt: unknown;
    try {
      receipt = await transport.report(structuredClone(report));
    } catch (error) {
      return {
        ok: false,
        code: error instanceof ReportRejected ? "report_rejected" : "transport_failed",
      };
    }
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify({
          reportId: report.reportId,
          operationId: report.operationId,
          revision: report.revision,
          observedAt: report.observedAt,
          listener: report.listener,
          job: report.job,
          acceptingJobs: report.acceptingJobs,
        }),
      ),
    );
    const digest = Array.from(new Uint8Array(bytes), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    if (
      !object(receipt) ||
      Object.keys(receipt).sort().join() !== "digest,operationId,receivedAt,reportId" ||
      receipt.reportId !== report.reportId ||
      receipt.operationId !== report.operationId ||
      receipt.digest !== digest ||
      typeof receipt.receivedAt !== "string" ||
      !Number.isFinite(Date.parse(receipt.receivedAt)) ||
      new Date(receipt.receivedAt).toISOString() !== receipt.receivedAt
    ) {
      return { ok: false, code: "receipt_mismatch" };
    }
    try {
      await journal.save({ accepted: state.accepted, outbox: null });
    } catch {
      return { ok: false, code: "journal_failed" };
    }
    return { ok: true, report };
  }
  async function cycle(): Promise<Result> {
    let failure: FailureCode = "journal_failed";
    try {
      const state = await journal.load();
      if (!journalState(state, machineId)) return { ok: false, code: "journal_failed" };
      if (state.outbox) return await deliver(state);
      failure = "transport_failed";
      const next = await transport.poll();
      if (!command(next)) return { ok: false, code: "invalid_command" };
      if (next.machineId !== machineId) return { ok: false, code: "wrong_machine" };
      if (
        state.accepted &&
        (next.revision < state.accepted.revision ||
          (next.revision === state.accepted.revision &&
            next.desiredState !== state.accepted.desiredState))
      ) {
        return { ok: false, code: "stale_command" };
      }
      failure = "journal_failed";
      await journal.save({ accepted: next, outbox: null });
      failure = "adapter_failed";
      let observed = await observe();
      if (next.desiredState === "maintenance" && observed.acceptingJobs !== false) {
        await adapter.closeAdmission();
        observed = await observe();
      }
      if (
        next.desiredState === "maintenance" &&
        observed.acceptingJobs === false &&
        observed.job === "idle" &&
        observed.listener !== "stopped"
      ) {
        await adapter.stop();
        observed = await observe();
      }
      if (next.desiredState === "enabled") {
        if (observed.listener !== "running") {
          await adapter.start();
          observed = await observe();
        }
        if (observed.listener === "running" && observed.acceptingJobs !== true) {
          await adapter.openAdmission();
          observed = await observe();
        }
      }
      const report: Report = {
        reportId: crypto.randomUUID(),
        operationId: next.operationId,
        revision: next.revision,
        observedAt: new Date().toISOString(),
        ...observed,
      };
      failure = "journal_failed";
      await journal.save({ ...state, accepted: next, outbox: report });
      return await deliver({ accepted: next, outbox: report });
    } catch {
      return { ok: false, code: failure };
    }
  }
  let tail: Promise<unknown> = Promise.resolve();
  return {
    reconcile(): Promise<Result> {
      const result = tail.then(cycle);
      tail = result;
      return result;
    },
  };
}
