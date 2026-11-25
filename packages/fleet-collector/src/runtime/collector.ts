import { createHash } from "node:crypto";
import type { ActivityEvent, FleetReport } from "@zs-home/shared-contracts";
import type { CollectorConfig, SshMachine } from "../config.js";
import { cleanName, machineAlertEvent } from "../events.js";
import { poll, type ReachabilityReading, type Snapshot } from "../poll.js";
import { acknowledgeReport, buildFleetReport } from "../report.js";
import type { IntakeClient } from "./intake-client.js";
import {
  applyCheck,
  initialReachability,
  type ReachabilityState,
  type SshCheck,
} from "./reachability.js";
import type { SparkdashClient } from "./sparkdash-client.js";
import { MAX_QUEUE, type StateStore, type StoredState } from "./store.js";

/** One line of the Collector's log: codes and counts only, never a body, an address or a credential. */
export type LogLine = Record<string, string | number | boolean>;

export interface CollectorDeps {
  config: CollectorConfig;
  store: StateStore;
  sparkdash: SparkdashClient;
  check: SshCheck;
  intake: IntakeClient;
  /** The clock, in ms. */
  now: () => number;
  log: (line: LogLine) => void;
}

/** Retries wait longer after each failure, but never past one poll's worth of tries per poll. */
const BACKOFF_MS = [30_000, 60_000, 120_000, 300_000];

/**
 * A Fleet Report's id from its content: an identical retry keeps its
 * `reportId`, so the intake answers with the original receipt, and changed
 * content never reuses one.
 */
export function reportIdFor(report: FleetReport): string {
  const content: Partial<FleetReport> = { ...report };
  delete content.reportId;
  const hex = createHash("sha256").update(JSON.stringify(content)).digest("hex");
  const variant = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const PLACEHOLDER_ID = "00000000-0000-8000-8000-000000000000";

/**
 * The Fleet Collector's runtime (fleet monitoring spec, packet 3): it polls
 * sparkDash, runs the Reachability Checks, keeps the queue on disk and
 * delivers reports. Calls are serialized; nothing runs twice at once.
 */
export class FleetCollector {
  private chain: Promise<unknown> = Promise.resolve();
  private snapshot: Snapshot | undefined;

  constructor(private readonly deps: CollectorDeps) {}

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private readings(stored: StoredState): Map<string, ReachabilityReading> {
    return new Map(
      Object.entries(stored.reachability).map(([id, r]) => [
        id,
        { state: r.state, lastSeenAt: r.lastSuccessAt },
      ]),
    );
  }

  /** Every 30 seconds: read sparkDash, queue new events, then deliver. */
  pollOnce(): Promise<void> {
    return this.serialize(async () => {
      const { config, store, now, log } = this.deps;
      const stored = await store.load();
      const read = await this.deps.sparkdash.readAll();
      const result = poll({
        config,
        state: stored.collector,
        read,
        reachability: this.readings(stored),
        now: now(),
        queueRoom: MAX_QUEUE - stored.queue.length,
      });
      const next: StoredState = {
        ...stored,
        collector: result.state,
        queue: [...stored.queue, ...result.events],
      };
      // The events are on disk before the cursor that counts them.
      await store.save(next);
      this.snapshot = result.snapshot;
      log({
        event: "poll",
        sparkdash: result.snapshot.sparkdash.state,
        queued: result.events.length,
        queue: next.queue.length,
      });
      await this.deliver(next);
    });
  }

  /** Every 60 seconds: check every reachability-only machine's SSH banner. */
  checkOnce(): Promise<void> {
    return this.serialize(async () => {
      const { config, store, now, log } = this.deps;
      const machines = config.machines.filter((m): m is SshMachine => "ssh" in m);
      const results = await Promise.all(
        machines.map(async (m) => [m, await this.deps.check(m.ssh.host, m.ssh.port)] as const),
      );
      const stored = await store.load();
      const at = now();
      const reachability = { ...stored.reachability };
      const events: ActivityEvent[] = [];
      let room = MAX_QUEUE - stored.queue.length;
      for (const [machine, result] of results) {
        const previous = Object.hasOwn(reachability, machine.machineId)
          ? (reachability[machine.machineId] as ReachabilityState)
          : initialReachability();
        const { next, transition } = applyCheck(previous, result, at);
        if (transition) {
          // No room: leave this machine as it was, so the next Check makes the same transition.
          if (room <= 0) continue;
          const event = machineAlertEvent({
            source: "homer",
            kind: transition.kind,
            machineId: machine.machineId,
            name: cleanName(machine.name, machine.machineId),
            rule: "reachability",
            severity: "critical",
            startsAt: transition.startsAt,
            at,
            sparkdashVersion: this.snapshot?.sparkdash.version ?? null,
            frontDoorOrigin: config.frontDoorOrigin,
            collectedAt: at,
          });
          if (event === undefined) continue;
          events.push(event);
          room--;
        }
        reachability[machine.machineId] = next;
      }
      await store.save({ ...stored, reachability, queue: [...stored.queue, ...events] });
      log({ event: "check", machines: machines.length, queued: events.length });
    });
  }

  /**
   * Deliver a report (fleet monitoring spec, "Deliver a report"): the latest
   * snapshot and the oldest 100 waiting events. A `2xx` removes exactly those
   * events and the held diagnostics carried; the next 100 go at once. A
   * failure keeps everything and waits, with backoff.
   */
  private async deliver(start: StoredState): Promise<void> {
    const { store, now, log } = this.deps;
    let stored = start;
    const snapshot = this.snapshot;
    if (!snapshot) return;
    for (;;) {
      const at = now();
      if (at < stored.delivery.nextAttemptAt) return;
      const built = buildFleetReport({
        reportId: PLACEHOLDER_ID,
        collectedAt: at,
        snapshot,
        state: stored.collector,
        queue: stored.queue,
      });
      if (!built.ok) {
        // Never sent. The count says how many rules it broke, not what it held.
        log({ event: "report_refused", errors: built.errors.length });
        return;
      }
      const report = { ...built.report, reportId: reportIdFor(built.report) };
      const status = await this.deps.intake.post(report);
      if (typeof status === "number" && status >= 200 && status < 300) {
        stored = {
          ...stored,
          collector: acknowledgeReport(built.state, report),
          queue: stored.queue.slice(report.events.length),
          delivery: { failures: 0, nextAttemptAt: 0 },
        };
        await store.save(stored);
        log({
          event: "delivered",
          status,
          events: report.events.length,
          queue: stored.queue.length,
        });
        if (stored.queue.length === 0) return;
        continue;
      }
      const failures = stored.delivery.failures + 1;
      const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1] as number;
      stored = {
        ...stored,
        collector: built.state,
        delivery: { failures, nextAttemptAt: at + wait },
      };
      await store.save(stored);
      log({
        event: "delivery_failed",
        status: String(status),
        failures,
        queue: stored.queue.length,
      });
      return;
    }
  }
}
